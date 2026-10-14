"""Retention for delivery logs: email deliveries, webhook deliveries, notifications.

A daily purge_retention job deletes those rows once they are older than
RETENTION_DELIVERY_DAYS (90 by default), in every workspace. It also empties
the content of finished send_email jobs after RETENTION_JOB_PAYLOAD_DAYS (7):
the jobs table has no row-level security, so a reply's text, a customer's
issue, and email addresses stay there no longer than the queue needs them. A
dead email job emptied this way can no longer be retried.

The scheduler runs with the worker's maintenance, like the digest scheduler, so
an idle worker sends no extra queries between safety polls. It queues one job
per UTC day. The job lists workspaces through the app.scheduler capability and
deletes each workspace's rows in that workspace's own transaction, with its
tenant context: there is no cross-tenant write anywhere.
"""

import logging
from datetime import UTC, datetime, timedelta

from docent.config import Settings
from docent.db.pool import Pool, transaction
from docent.jobs import queue
from docent.jobs.worker import JobContext

log = logging.getLogger(__name__)

PURGE_RETENTION = "purge_retention"
SCHEDULE_EVERY_SECONDS = 3600.0
TABLES = ("email_deliveries", "webhook_deliveries", "notifications")


async def schedule_retention(pool: Pool, now: datetime | None = None) -> int:
    """Queue today's purge unless it was queued already. Returns 1 when queued."""
    day = (now or datetime.now(UTC)).date().isoformat()
    async with transaction(pool) as conn:
        job_id = await queue.enqueue_once(
            conn, PURGE_RETENTION, {"day": day}, tenant_id=None, dedupe_key=f"retention:{day}"
        )
    return int(job_id is not None)


def _count(status: str) -> int:
    return int(status.split()[-1])


async def purge(pool: Pool, settings: Settings, now: datetime | None = None) -> dict[str, int]:
    """Delete old delivery logs in every workspace and empty old email job payloads."""
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=settings.retention_delivery_days)
    async with transaction(pool, scheduler=True) as conn:
        tenant_ids = [r["id"] for r in await conn.fetch("select id from tenant_profiles")]
    removed = dict.fromkeys(TABLES, 0)
    for tenant_id in tenant_ids:
        async with transaction(pool, tenant_id=tenant_id) as conn:
            for table in TABLES:
                status = await conn.execute(
                    f"delete from {table} where created_at < $1",  # noqa: S608 - constant names
                    cutoff,
                )
                removed[table] += _count(status)
    async with transaction(pool) as conn:
        status = await conn.execute(
            """
            update jobs
            set payload = payload || jsonb_build_object('data', '{}'::jsonb,
                                                        'redacted_at', $2::text)
            where kind = 'send_email' and status in ('succeeded', 'dead')
              and finished_at < $1 and payload -> 'data' <> '{}'::jsonb
            """,
            now - timedelta(days=settings.retention_job_payload_days),
            now.isoformat(),
        )
        removed["email_job_payloads"] = _count(status)
    if any(removed.values()):
        log.info("retention purge", extra=removed)
    return removed


async def run_purge(ctx: JobContext, settings: Settings) -> None:
    await purge(ctx.pool, settings)
