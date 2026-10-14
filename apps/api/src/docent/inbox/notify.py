"""Notifications: new handoff emails, Slack messages, and the daily digest.

Every notification is a row with a dedupe key unique per workspace, written in
the same transaction as the job that sends it. A job that runs twice finds the
row already there and sends nothing, which is what keeps the digest to one
email per member per day.
"""

import json
import logging
import uuid
from datetime import UTC, date, datetime, time
from typing import Any

import httpx

from docent.db.pool import Connection, Pool, transaction
from docent.ids import new_id
from docent.inbox import deliveries
from docent.inbox.events import ISSUE_SQL
from docent.inbox.outbound import UNREACHABLE, OutboundDeps, describe_error, response_excerpt
from docent.jobs import queue
from docent.jobs.worker import JobContext, PermanentJobError

log = logging.getLogger(__name__)

SEND_SLACK = "send_slack"
SEND_DIGEST = "send_digest"
DIGEST_HOUR_UTC = 8
DIGEST_ITEMS = 6
# The scheduler checks hourly; each workspace gets one digest job per day.
SCHEDULE_EVERY_SECONDS = 3600.0


class SlackFailed(Exception):
    """Slack did not accept the message. The queue retries."""


async def notify_once(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    kind: str,
    channel: str,
    dedupe_key: str,
    escalation_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    channel_id: uuid.UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> uuid.UUID | None:
    """Record a notification. None if one with this key exists: it was already sent."""
    notification_id: uuid.UUID | None = await conn.fetchval(
        """
        insert into notifications (id, tenant_id, kind, channel, escalation_id, user_id,
                                   channel_id, dedupe_key, payload)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (tenant_id, dedupe_key) do nothing
        returning id
        """,
        new_id(),
        tenant_id,
        kind,
        channel,
        escalation_id,
        user_id,
        channel_id,
        dedupe_key,
        payload or {},
    )
    return notification_id


async def queue_slack(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    channel_id: uuid.UUID,
    kind: str,
    dedupe_key: str,
    text: str,
    escalation_id: uuid.UUID | None = None,
    max_attempts: int = 5,
) -> uuid.UUID | None:
    notification_id = await notify_once(
        conn,
        tenant_id=tenant_id,
        kind=kind,
        channel="slack",
        dedupe_key=dedupe_key,
        escalation_id=escalation_id,
        channel_id=channel_id,
        payload={"text": text},
    )
    if notification_id:
        await queue.enqueue(
            conn,
            SEND_SLACK,
            {"notification_id": str(notification_id)},
            tenant_id=tenant_id,
            max_attempts=max_attempts,
            dedupe_key=f"slack:{notification_id}",
        )
    return notification_id


def slack_escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def handoff_slack_text(
    *,
    workspace: str,
    issue: str,
    url: str,
    reason: str,
    priority: str,
    ticket_type: str | None,
    assignee: str | None,
) -> str:
    from docent.email.templates import REASONS

    details = [
        ticket_type or "No type",
        f"{priority} priority",
        REASONS.get(reason, reason),
        f"assigned to {assignee}" if assignee else "nobody assigned",
    ]
    title = slack_escape(issue[:200]).replace("|", "/")
    return f"*New handoff in {slack_escape(workspace)}*: <{url}|{title}>\n" + slack_escape(
        " · ".join(details)
    )


async def send_slack(ctx: JobContext, deps: OutboundDeps) -> None:
    tenant_id = ctx.job.tenant_id
    assert tenant_id is not None
    notification_id = uuid.UUID(ctx.job.payload["notification_id"])
    async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
        row = await conn.fetchrow(
            """
            select n.status, n.payload, c.id as channel_id, c.active, c.target_encrypted
            from notifications n join notification_channels c on c.id = n.channel_id
            where n.id = $1
            """,
            notification_id,
        )
    if row is None or row["status"] in ("sent", "skipped", "dead"):
        return
    if not row["active"]:
        await _slack_result(ctx, notification_id, "skipped", "The channel is turned off.")
        return
    url = deps.box.open(
        row["target_encrypted"], purpose="slack", tenant_id=tenant_id, row_id=row["channel_id"]
    )
    error: str | None = None
    try:
        async with deps.http.stream(
            "POST",
            url,
            content=json.dumps({"text": row["payload"]["text"]}).encode(),
            headers={"content-type": "application/json"},
            follow_redirects=False,
            timeout=10.0,
        ) as response:
            if not 200 <= response.status_code < 300:
                error = f"HTTP {response.status_code}" + await response_excerpt(response)
    except httpx.HTTPError as exc:
        error = describe_error(exc)
    if error is None:
        await _slack_result(ctx, notification_id, "sent", None)
        return
    final = ctx.job.attempts >= ctx.job.max_attempts or error == UNREACHABLE
    await _slack_result(ctx, notification_id, "dead" if final else "retrying", error)
    if error == UNREACHABLE:
        raise PermanentJobError(error)
    raise SlackFailed(error)


async def _slack_result(
    ctx: JobContext, notification_id: uuid.UUID, status: str, error: str | None
) -> None:
    assert ctx.job.tenant_id is not None
    async with transaction(ctx.pool, tenant_id=ctx.job.tenant_id) as conn:
        await conn.execute(
            """
            update notifications
            set status = $2, attempts = $3, last_error = $4,
                sent_at = case when $2 = 'sent' then now() else sent_at end
            where id = $1
            """,
            notification_id,
            status,
            ctx.job.attempts,
            error,
        )


# Daily digest


def digest_run_at(now: datetime) -> datetime:
    return max(now, datetime.combine(now.date(), time(DIGEST_HOUR_UTC), UTC))


async def schedule_digests(pool: Pool, now: datetime | None = None) -> int:
    """Queue today's digest for every active workspace that does not have one yet."""
    now = now or datetime.now(UTC)
    day = now.date().isoformat()
    async with transaction(pool, scheduler=True) as conn:
        tenant_ids = [
            r["id"]
            for r in await conn.fetch("select id from tenant_profiles where status = 'active'")
        ]
    queued = 0
    async with transaction(pool) as conn:
        for tenant_id in tenant_ids:
            job_id = await queue.enqueue_once(
                conn,
                SEND_DIGEST,
                {"day": day},
                tenant_id=tenant_id,
                run_at=digest_run_at(now),
                dedupe_key=f"digest:{tenant_id}:{day}",
            )
            queued += job_id is not None
    if queued:
        log.info("daily digests queued", extra={"count": queued, "day": day})
    return queued


async def send_digest(ctx: JobContext, deps: OutboundDeps) -> None:
    tenant_id = ctx.job.tenant_id
    assert tenant_id is not None
    day = date.fromisoformat(ctx.job.payload["day"])
    web = deps.settings.web_origin.rstrip("/")
    secret = deps.settings.secret_key.get_secret_value()
    async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
        workspace = await conn.fetchval("select name from tenant_profiles where id = $1", tenant_id)
        stats = await conn.fetchrow(
            """
            select count(*) filter (where status <> 'resolved') as open,
                   count(*) filter (where status <> 'resolved' and assignee_user_id is null)
                     as unassigned,
                   count(*) filter (where created_at > now() - interval '1 day') as new_today,
                   extract(epoch from now() - min(created_at) filter (
                     where status <> 'resolved' and first_response_at is null)) / 3600
                     as oldest_hours
            from escalations
            """
        )
        assert stats is not None
        if stats["open"] == 0 and stats["new_today"] == 0:
            return  # nothing to say: no email
        members = await conn.fetch(
            """
            select mc.user_id, mc.email, mc.name
            from member_contacts mc
            left join notification_preferences p
              on p.tenant_id = mc.tenant_id and p.user_id = mc.user_id
            where coalesce(p.daily_digest, true)
            order by mc.name
            """
        )
        for member in members:
            items = await conn.fetch(
                f"""
                select e.id, e.priority, e.created_at, e.assignee_user_id, {ISSUE_SQL} as issue
                from escalations e
                where e.status <> 'resolved'
                  and (e.assignee_user_id = $1 or e.assignee_user_id is null)
                order by (e.assignee_user_id is null), e.created_at
                limit {DIGEST_ITEMS}
                """,  # noqa: S608
                member["user_id"],
            )
            yours = await conn.fetchval(
                """
                select count(*) from escalations
                where status <> 'resolved' and assignee_user_id = $1
                """,
                member["user_id"],
            )
            notification_id = await notify_once(
                conn,
                tenant_id=tenant_id,
                kind="daily_digest",
                channel="email",
                user_id=member["user_id"],
                dedupe_key=f"digest:{member['user_id']}:{day.isoformat()}",
                payload={"open": stats["open"], "yours": yours},
            )
            if notification_id is None:
                continue  # already sent today
            oldest = stats["oldest_hours"]
            await deliveries.queue_email(
                conn,
                tenant_id=tenant_id,
                secret=secret,
                to=member["email"],
                subject=f"[{workspace}] Daily digest",
                template="daily_digest",
                data={
                    "name": member["name"].split()[0] if member["name"] else "there",
                    "workspace": workspace,
                    "open_count": stats["open"],
                    "unassigned": stats["unassigned"],
                    "yours": yours,
                    "new_today": stats["new_today"],
                    "oldest_hours": int(oldest) if oldest is not None else None,
                    "items": [
                        {
                            "title": item["issue"][:140],
                            "meta": (
                                "Assigned to you"
                                if item["assignee_user_id"] == member["user_id"]
                                else "Nobody assigned"
                            )
                            + f", {item['priority']} priority",
                            "url": f"{web}/app/inbox/{item['id']}",
                        }
                        for item in items
                    ],
                    "url": f"{web}/app/inbox",
                },
                kind="digest",
                notification_id=notification_id,
            )
