"""Postgres job queue: delivery, retries, dead letters, lease recovery, dedupe, idle behavior."""

import asyncio

import pytest

from docent.db.pool import Pool, transaction
from docent.email.sender import MemoryEmailSender
from docent.jobs import queue
from docent.jobs.handlers import SEND_EMAIL, make_handlers
from docent.jobs.worker import JobContext, Lane, Worker

EMAIL_PAYLOAD = {
    "template": "verify_email",
    "data": {
        "to": "a@example.com",
        "name": "A",
        "url": "http://x/verify-email?token=t",
        "ttl_hours": 24,
    },
}


async def _enqueue(pool: Pool, kind: str = SEND_EMAIL, **kwargs: object) -> int | None:
    async with transaction(pool) as conn:
        return await queue.enqueue(conn, kind, dict(EMAIL_PAYLOAD), **kwargs)  # type: ignore[arg-type]


async def _status(owner_pool: Pool, job_id: int) -> tuple[str, int, str | None]:
    async with owner_pool.acquire() as conn:
        row = await conn.fetchrow(
            "select status, attempts, last_error from jobs where id = $1", job_id
        )
    assert row is not None
    return row["status"], row["attempts"], row["last_error"]


async def test_job_runs_and_succeeds(
    app_pool: Pool, owner_pool: Pool, worker: Worker, mailbox: MemoryEmailSender
) -> None:
    job_id = await _enqueue(app_pool)
    assert job_id is not None
    assert await worker.drain() == 1
    assert await _status(owner_pool, job_id) == ("succeeded", 1, None)
    assert mailbox.sent[0].to == "a@example.com"


async def test_failing_job_retries_then_dies(
    app_pool: Pool, worker_pool: Pool, owner_pool: Pool
) -> None:
    calls = 0

    async def boom(ctx: JobContext) -> None:
        nonlocal calls
        calls += 1
        raise RuntimeError("smtp down")

    w = Worker(worker_pool, {"boom": boom}, idle_poll_seconds=60, lease_seconds=30)
    async with transaction(app_pool) as conn:
        job_id = await queue.enqueue(conn, "boom", {}, max_attempts=5)
    assert job_id is not None
    for attempt in range(1, 6):
        async with owner_pool.acquire() as conn:
            await conn.execute("update jobs set run_at = now() where id = $1", job_id)
        await w.drain()
        status, attempts, error = await _status(owner_pool, job_id)
        assert attempts == attempt
        assert status == ("dead" if attempt == 5 else "queued")
        assert error == "RuntimeError: smtp down"
    assert calls == 5
    async with owner_pool.acquire() as conn:
        assert await conn.fetchval("select run_at > now() from jobs where id = $1", job_id) is False


async def test_retry_is_scheduled_in_the_future(
    app_pool: Pool, worker_pool: Pool, owner_pool: Pool
) -> None:
    async def boom(ctx: JobContext) -> None:
        raise ValueError("nope")

    w = Worker(worker_pool, {"boom": boom}, idle_poll_seconds=60, lease_seconds=30)
    async with transaction(app_pool) as conn:
        job_id = await queue.enqueue(conn, "boom", {})
    await w.drain()
    async with owner_pool.acquire() as conn:
        delay = await conn.fetchval(
            "select extract(epoch from run_at - now()) from jobs where id = $1", job_id
        )
    assert 20 < float(delay) < 40
    assert await w.drain() == 0


async def test_crashed_worker_lease_expires_and_job_reruns(
    app_pool: Pool, worker_pool: Pool, owner_pool: Pool, worker: Worker, mailbox: MemoryEmailSender
) -> None:
    job_id = await _enqueue(app_pool)
    assert job_id is not None
    async with transaction(worker_pool) as conn:
        claimed = await queue.claim(conn, "crashed-worker", [SEND_EMAIL], 300)
    assert claimed is not None
    assert await worker.drain() == 0
    async with owner_pool.acquire() as conn:
        await conn.execute("update jobs set lease_until = now() - interval '1 second'")
    await worker.maintenance(force=True)
    assert (await _status(owner_pool, job_id))[0] == "queued"
    assert await worker.drain() == 1
    assert await _status(owner_pool, job_id) == ("succeeded", 2, "lease expired")
    assert len(mailbox.sent) == 1


async def test_concurrent_workers_never_share_a_job(
    app_pool: Pool, worker_pool: Pool, owner_pool: Pool
) -> None:
    seen: list[int] = []

    async def record(ctx: JobContext) -> None:
        seen.append(ctx.job.id)
        await asyncio.sleep(0.01)

    for _ in range(20):
        async with transaction(app_pool) as conn:
            await queue.enqueue(conn, "record", {})
    workers = [
        Worker(
            worker_pool,
            {"record": record},
            idle_poll_seconds=60,
            lease_seconds=30,
            worker_id=f"w{i}",
        )
        for i in range(3)
    ]
    counts = await asyncio.gather(*(w.drain() for w in workers))
    assert sum(counts) == 20
    assert len(seen) == len(set(seen)) == 20


async def test_dedupe_key_blocks_duplicates_while_pending(app_pool: Pool, worker: Worker) -> None:
    first = await _enqueue(app_pool, dedupe_key="digest:2026-10-14")
    second = await _enqueue(app_pool, dedupe_key="digest:2026-10-14")
    assert first is not None
    assert second is None
    await worker.drain()
    third = await _enqueue(app_pool, dedupe_key="digest:2026-10-14")
    assert third is not None


async def test_idle_worker_does_not_poll(
    worker_pool: Pool, app_pool: Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    claims = 0
    original = queue.claim

    async def counting_claim(*args: object, **kwargs: object) -> object:
        nonlocal claims
        claims += 1
        return await original(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(queue, "claim", counting_claim)
    mailbox = MemoryEmailSender()
    w = Worker(worker_pool, make_handlers(mailbox), idle_poll_seconds=30, lease_seconds=30)
    task = asyncio.create_task(w.run_forever())
    await asyncio.sleep(0.5)
    assert claims == 1  # one empty drain at start, then asleep
    await _enqueue(app_pool)
    w.wake()
    for _ in range(50):
        if mailbox.sent:
            break
        await asyncio.sleep(0.02)
    assert len(mailbox.sent) == 1
    await asyncio.sleep(0.3)
    assert claims == 3  # woken: one claim that ran the job, one that found nothing
    w.stop()
    await asyncio.wait_for(task, timeout=5)


async def test_tenant_job_payload_roundtrip(app_pool: Pool, worker_pool: Pool) -> None:
    async with transaction(app_pool) as conn:
        await queue.enqueue(conn, "k", {"nested": {"a": [1, 2]}, "s": "x"})
    async with transaction(worker_pool) as conn:
        job = await queue.claim(conn, "w", ["k"], 30)
    assert job is not None
    assert job.payload == {"nested": {"a": [1, 2]}, "s": "x"}


async def test_quick_lane_is_not_blocked_by_heavy_lane(app_pool: Pool, worker_pool: Pool) -> None:
    release = asyncio.Event()
    started = asyncio.Event()
    sent: list[int] = []

    async def heavy(ctx: JobContext) -> None:
        started.set()
        await release.wait()

    async def quick(ctx: JobContext) -> None:
        sent.append(ctx.job.id)

    w = Worker(
        worker_pool,
        {"heavy": heavy, "quick": quick},
        lanes=[Lane("ingest", ("heavy",), 1), Lane("io", ("quick",), 1)],
        idle_poll_seconds=30,
        lease_seconds=30,
    )
    task = asyncio.create_task(w.run_forever())
    async with transaction(app_pool) as conn:
        await queue.enqueue(conn, "heavy", {})
    w.wake()
    await asyncio.wait_for(started.wait(), timeout=5)
    async with transaction(app_pool) as conn:
        quick_id = await queue.enqueue(conn, "quick", {})
    w.wake()
    for _ in range(100):
        if sent:
            break
        await asyncio.sleep(0.02)
    assert sent == [quick_id]  # ran while the heavy job still holds its slot
    release.set()
    w.stop()
    await asyncio.wait_for(task, timeout=5)


def test_lanes_must_cover_every_kind(worker_pool: Pool) -> None:
    async def noop(ctx: JobContext) -> None:
        return None

    with pytest.raises(ValueError, match="exactly one lane"):
        Worker(
            worker_pool,
            {"a": noop, "b": noop},
            lanes=[Lane("x", ("a",))],
            idle_poll_seconds=1,
            lease_seconds=1,
        )


async def test_priorities_put_people_first(app_pool: Pool, owner_pool: Pool) -> None:
    async with transaction(app_pool) as conn:
        await queue.enqueue(conn, "embed_document", {})
        await queue.enqueue(conn, "send_email", {})
        await queue.enqueue(conn, "delete_source", {})
    async with owner_pool.acquire() as conn:
        order = await conn.fetch("select kind from jobs order by priority, run_at")
    assert [r["kind"] for r in order] == ["delete_source", "send_email", "embed_document"]
