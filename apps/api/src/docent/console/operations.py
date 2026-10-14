"""Operations: the Postgres job queue's health, retrying a dead job, and Stripe events.

jobs and billing_events are global tables without RLS. Workspace names come
from tenants, which needs the app.platform_admin capability.
"""

from dataclasses import dataclass

import asyncpg

from docent.db.pool import Connection

DEAD_JOBS_SHOWN = 50
EVENTS_PER_PAGE = 50


@dataclass(frozen=True, slots=True)
class QueueHealth:
    counts: list[asyncpg.Record]
    totals: asyncpg.Record
    dead_jobs: list[asyncpg.Record]


class RetryRefused(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


async def queue_health(conn: Connection) -> QueueHealth:
    counts = await conn.fetch(
        "select kind, status, count(*) as count from jobs group by 1, 2 order by 1, 2"
    )
    totals = await conn.fetchrow(
        """
        select
          count(*) filter (where status = 'queued' and run_at <= now()) as ready,
          count(*) filter (where status = 'queued' and run_at > now()) as scheduled,
          count(*) filter (where status = 'running') as running,
          count(*) filter (where status = 'dead') as dead,
          extract(epoch from now() - min(run_at) filter (
            where status = 'queued' and run_at <= now()))::bigint as oldest_ready_seconds
        from jobs
        """
    )
    assert totals is not None
    dead_jobs = await conn.fetch(
        """
        select j.id, j.kind, j.tenant_id, t.name as workspace_name, j.attempts,
               j.max_attempts, j.last_error, j.created_at, j.finished_at
        from jobs j left join tenants t on t.id = j.tenant_id
        where j.status = 'dead'
        order by j.finished_at desc nulls last, j.id desc
        limit $1
        """,
        DEAD_JOBS_SHOWN,
    )
    return QueueHealth(counts, totals, dead_jobs)


async def retry_dead_job(conn: Connection, job_id: int) -> asyncpg.Record:
    """Put a dead job back in the queue with a fresh set of attempts. Its last error stays
    until the next attempt replaces it. Returns the job's id, kind, and tenant."""
    try:
        async with conn.transaction():  # savepoint, so a dedupe clash leaves the outer tx usable
            row = await conn.fetchrow(
                """
                update jobs
                set status = 'queued', attempts = 0, run_at = now(), locked_by = null,
                    finished_at = null
                where id = $1 and status = 'dead'
                returning id, kind, tenant_id
                """,
                job_id,
            )
    except asyncpg.UniqueViolationError:
        raise RetryRefused(
            409, "already_queued", "A job like this one is already waiting to run."
        ) from None
    if row is not None:
        return row
    status = await conn.fetchval("select status from jobs where id = $1", job_id)
    if status is None:
        raise RetryRefused(404, "not_found", "Job not found.")
    raise RetryRefused(409, "not_dead", f"Only a dead job can be retried. This one is {status}.")


async def billing_events(conn: Connection, page: int) -> tuple[list[asyncpg.Record], int]:
    """Stripe webhook events, newest first, with what applying each one did."""
    rows = await conn.fetch(
        """
        select e.id, e.type, e.outcome, e.tenant_id, t.name as workspace_name, e.created_at,
               e.received_at
        from billing_events e left join tenants t on t.id = e.tenant_id
        order by e.received_at desc, e.id desc
        limit $1 offset $2
        """,
        EVENTS_PER_PAGE,
        (page - 1) * EVENTS_PER_PAGE,
    )
    total: int = await conn.fetchval("select count(*) from billing_events")
    return rows, total
