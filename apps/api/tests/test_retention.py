"""Retention: old delivery logs and notifications go, and finished email jobs lose their
content, in every workspace, from a daily job the worker's maintenance queues."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from docent.config import Settings
from docent.db.pool import Pool, transaction
from docent.ids import new_id
from docent.inbox import retention
from docent.inbox.jobs import inbox_schedules
from docent.jobs.worker import Schedule, Worker
from tests.conftest import ClientFactory, Drain, make_settings, verified_owner
from tests.inbox_helpers import tid

TABLES = ("email_deliveries", "webhook_deliveries", "notifications")


async def seed(conn: Any, tenant_id: uuid.UUID, age: timedelta) -> None:
    """One row in each retained table, created `age` ago."""
    created = datetime.now(UTC) - age
    webhook_id = new_id()
    await conn.execute(
        """
        insert into webhooks (id, tenant_id, url_encrypted, url_hint, secret_encrypted,
                              secret_hint, events)
        values ($1, $2, '\\x00', 'https://hooks.example/…abcd', '\\x00', 'whsec_…abcd',
                '{escalation.created}')
        """,
        webhook_id,
        tenant_id,
    )
    await conn.execute(
        """
        insert into webhook_deliveries (id, tenant_id, webhook_id, event_id, event_type, payload,
                                        status, created_at)
        values ($1, $2, $3, $4, 'escalation.created', '{}', 'succeeded', $5)
        """,
        new_id(),
        tenant_id,
        webhook_id,
        uuid.uuid4().hex,
        created,
    )
    await conn.execute(
        """
        insert into email_deliveries (id, tenant_id, kind, to_hash, to_hint, subject, status,
                                      created_at)
        values ($1, $2, 'notification', 'hash', 'a***@example.com', 'New handoff', 'sent', $3)
        """,
        new_id(),
        tenant_id,
        created,
    )
    await conn.execute(
        """
        insert into notifications (id, tenant_id, kind, channel, dedupe_key, status, created_at)
        values ($1, $2, 'new_handoff', 'in_app', $3, 'sent', $4)
        """,
        new_id(),
        tenant_id,
        uuid.uuid4().hex,
        created,
    )


async def email_job(
    conn: Any, tenant_id: uuid.UUID, status: str, finished_ago: timedelta | None
) -> int:
    payload = {
        "template": "inbox_reply",
        "data": {"to": "ana@example.com", "body": "Your refund is on its way.", "subject": "Hi"},
        "delivery_id": str(new_id()),
    }
    job_id: int = await conn.fetchval(
        """
        insert into jobs (tenant_id, kind, payload, status, attempts, finished_at)
        values ($1, 'send_email', $2, $3, 1, $4) returning id
        """,
        tenant_id,
        payload,
        status,
        datetime.now(UTC) - finished_ago if finished_ago else None,
    )
    return job_id


async def counts(conn: Any, tenant_id: uuid.UUID) -> dict[str, int]:
    return {
        table: await conn.fetchval(
            f"select count(*) from {table} where tenant_id = $1",  # noqa: S608
            tenant_id,
        )
        for table in TABLES
    }


async def payload(conn: Any, job_id: int) -> dict[str, Any]:
    raw = await conn.fetchval("select payload from jobs where id = $1", job_id)
    found: dict[str, Any] = raw
    return found


async def test_retention_purges_old_logs_in_every_workspace_and_empties_old_email_jobs(
    client_factory: ClientFactory, drain: Drain, worker_pool: Pool, admin_pool: Pool
) -> None:
    tenants = []
    for name in ("Lumen Notes", "Parcelwise"):
        tenants.append(tid(await verified_owner(client_factory(), drain, name)))
    async with admin_pool.acquire() as conn:
        for tenant_id in tenants:
            await seed(conn, tenant_id, timedelta(days=120))  # past the 90 days
            await seed(conn, tenant_id, timedelta(days=40))  # kept by default
            await seed(conn, tenant_id, timedelta(hours=1))
        old_sent = await email_job(conn, tenants[0], "succeeded", timedelta(days=8))
        old_dead = await email_job(conn, tenants[1], "dead", timedelta(days=20))
        recent = await email_job(conn, tenants[0], "succeeded", timedelta(days=2))
        waiting = await email_job(conn, tenants[0], "queued", None)

    # Queued once a day, however often the scheduler runs.
    assert await retention.schedule_retention(worker_pool) == 1
    assert await retention.schedule_retention(worker_pool) == 0
    await drain()
    async with admin_pool.acquire() as conn:
        for tenant_id in tenants:
            assert await counts(conn, tenant_id) == dict.fromkeys(TABLES, 2)
        for job_id in (old_sent, old_dead):
            emptied = await payload(conn, job_id)
            assert emptied["data"] == {}
            assert emptied["redacted_at"]
            assert emptied["template"] == "inbox_reply"
        for job_id in (recent, waiting):
            assert (await payload(conn, job_id))["data"]["body"] == "Your refund is on its way."
        assert (
            await conn.fetchval(
                "select status from jobs where kind = $1", retention.PURGE_RETENTION
            )
            == "succeeded"
        )

    # The number of days is a setting.
    shorter: Settings = make_settings(retention_delivery_days=30)
    removed = await retention.purge(worker_pool, shorter)
    assert removed == {
        "email_deliveries": 2,
        "webhook_deliveries": 2,
        "notifications": 2,
        "email_job_payloads": 0,
    }
    async with admin_pool.acquire() as conn:
        for tenant_id in tenants:
            assert await counts(conn, tenant_id) == dict.fromkeys(TABLES, 1)
        # A dead email emptied by retention cannot be sent again: retrying it fails at once.
        await conn.execute(
            "update jobs set status = 'queued', attempts = 0, run_at = now() where id = $1",
            old_dead,
        )
    assert await drain() == []
    async with admin_pool.acquire() as conn:
        status, error = await conn.fetchrow(
            "select status, last_error from jobs where id = $1", old_dead
        )
    assert status == "dead"
    assert "removed by retention" in error


async def test_the_worker_deletes_only_inside_a_workspace(
    worker_pool: Pool, admin_pool: Pool, client_factory: ClientFactory, drain: Drain
) -> None:
    tenant_id = tid(await verified_owner(client_factory(), drain, "Lumen Notes"))
    async with admin_pool.acquire() as conn:
        await seed(conn, tenant_id, timedelta(days=120))
    async with transaction(worker_pool) as conn:  # no tenant context: row-level security
        for table in TABLES:
            assert await conn.execute(f"delete from {table}") == "DELETE 0"  # noqa: S608
    async with admin_pool.acquire() as conn:
        assert await counts(conn, tenant_id) == dict.fromkeys(TABLES, 1)


async def test_maintenance_queues_retention_and_digests_and_idles_quietly(
    worker_pool: Pool, admin_pool: Pool, client_factory: ClientFactory, drain: Drain
) -> None:
    await verified_owner(client_factory(), drain, "Lumen Notes")
    runs: list[str] = []

    def counted(schedule: Schedule) -> Schedule:
        async def run(pool: Pool) -> object:
            runs.append(schedule.name)
            return await schedule.run(pool)

        return Schedule(schedule.name, schedule.every_seconds, run)

    worker = Worker(
        worker_pool,
        {},
        idle_poll_seconds=60,
        lease_seconds=30,
        schedules=[counted(s) for s in inbox_schedules()],
    )
    await worker.maintenance()
    assert sorted(runs) == ["daily_digests", "retention"]
    today = datetime.now(UTC).date().isoformat()
    async with admin_pool.acquire() as conn:
        kinds = {
            r["kind"]: r["dedupe_key"]
            for r in await conn.fetch("select kind, dedupe_key from jobs where status = 'queued'")
        }
    assert kinds[retention.PURGE_RETENTION] == f"retention:{today}"
    assert "send_digest" in kinds
    # The next cycles within the hour run no schedule, so an idle worker stays quiet.
    await worker.maintenance()
    await worker.maintenance()
    assert len(runs) == 2
