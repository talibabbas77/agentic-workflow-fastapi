"""Postgres job queue: enqueue, claim with SKIP LOCKED, complete, retry, reap."""

import json
import random
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from docent.db.pool import Connection

BACKOFF_SECONDS = (30, 120, 600, 3600)

# Lower runs first. Anything a person is waiting on outranks bulk indexing.
DEFAULT_PRIORITY = 100
PRIORITY_BY_KIND = {
    "delete_source": 10,
    "send_email": 20,
    "summarize_escalation": 30,
}


@dataclass(frozen=True, slots=True)
class Job:
    id: int
    tenant_id: uuid.UUID | None
    kind: str
    payload: dict[str, Any]
    attempts: int
    max_attempts: int


async def enqueue(
    conn: Connection,
    kind: str,
    payload: dict[str, Any],
    *,
    tenant_id: uuid.UUID | None = None,
    run_at: datetime | None = None,
    priority: int | None = None,
    max_attempts: int = 5,
    dedupe_key: str | None = None,
) -> int | None:
    """Insert a job in the caller's transaction. Returns None if deduplicated."""
    row = await conn.fetchrow(
        """
        insert into jobs (tenant_id, kind, payload, run_at, priority, max_attempts, dedupe_key)
        values ($1, $2, $3, coalesce($4, now()), $5, $6, $7)
        on conflict (dedupe_key)
          where dedupe_key is not null and status in ('queued', 'running')
          do nothing
        returning id
        """,
        tenant_id,
        kind,
        payload,
        run_at,
        priority if priority is not None else PRIORITY_BY_KIND.get(kind, DEFAULT_PRIORITY),
        max_attempts,
        dedupe_key,
    )
    return int(row["id"]) if row else None


async def claim(
    conn: Connection, worker_id: str, kinds: list[str], lease_seconds: int
) -> Job | None:
    row = await conn.fetchrow(
        """
        update jobs
        set status = 'running', locked_by = $1, attempts = attempts + 1,
            lease_until = now() + make_interval(secs => $3::int)
        where id = (
          select id from jobs
          where status = 'queued' and run_at <= now() and kind = any($2::text[])
          order by priority, run_at
          for update skip locked
          limit 1
        )
        returning id, tenant_id, kind, payload, attempts, max_attempts
        """,
        worker_id,
        kinds,
        lease_seconds,
    )
    if row is None:
        return None
    payload = row["payload"]
    return Job(
        id=row["id"],
        tenant_id=row["tenant_id"],
        kind=row["kind"],
        payload=payload if isinstance(payload, dict) else json.loads(payload),
        attempts=row["attempts"],
        max_attempts=row["max_attempts"],
    )


async def heartbeat(conn: Connection, job_id: int, worker_id: str, lease_seconds: int) -> bool:
    status = await conn.execute(
        """
        update jobs set lease_until = now() + make_interval(secs => $3::int)
        where id = $1 and locked_by = $2 and status = 'running'
        """,
        job_id,
        worker_id,
        lease_seconds,
    )
    return status.endswith(" 1")


async def complete(conn: Connection, job_id: int, worker_id: str) -> None:
    await conn.execute(
        """
        update jobs set status = 'succeeded', finished_at = now(), lease_until = null
        where id = $1 and locked_by = $2
        """,
        job_id,
        worker_id,
    )


def backoff_seconds(attempt: int) -> float:
    base = BACKOFF_SECONDS[min(attempt - 1, len(BACKOFF_SECONDS) - 1)]
    return base * random.uniform(0.8, 1.2)  # noqa: S311 - jitter, not security


async def fail(conn: Connection, job: Job, worker_id: str, error: str) -> str:
    """Schedule a retry, or mark the job dead after its last attempt."""
    if job.attempts >= job.max_attempts:
        await conn.execute(
            """
            update jobs set status = 'dead', finished_at = now(), lease_until = null,
                            last_error = $3
            where id = $1 and locked_by = $2
            """,
            job.id,
            worker_id,
            error[:2000],
        )
        return "dead"
    await conn.execute(
        """
        update jobs set status = 'queued', locked_by = null, lease_until = null,
                        run_at = now() + make_interval(secs => $3::float8), last_error = $4
        where id = $1 and locked_by = $2
        """,
        job.id,
        worker_id,
        backoff_seconds(job.attempts),
        error[:2000],
    )
    return "retry"


async def reap_expired(conn: Connection) -> int:
    """Return jobs whose worker vanished to the queue (or mark them dead)."""
    status = await conn.execute(
        """
        update jobs
        set status = case when attempts >= max_attempts then 'dead' else 'queued' end,
            finished_at = case when attempts >= max_attempts then now() end,
            locked_by = null, lease_until = null,
            last_error = coalesce(last_error, 'lease expired')
        where status = 'running' and lease_until < now()
        """
    )
    return int(status.split()[-1])


async def purge_finished(conn: Connection) -> int:
    status = await conn.execute(
        """
        delete from jobs
        where (status = 'succeeded' and finished_at < now() - interval '7 days')
           or (status = 'dead' and finished_at < now() - interval '30 days')
        """
    )
    return int(status.split()[-1])
