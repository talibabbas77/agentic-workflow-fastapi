"""Outgoing webhooks: escalation events, signed like Stripe's, delivered by the worker.

Events: escalation.created (after routing, with the ticket type and summary),
escalation.updated (status, assignee, priority, ticket type, or fields changed),
escalation.resolved. Every webhook subscribed to the event gets it; a routing
rule can also send a new handoff to a webhook that is not subscribed to all of
them.

Each request carries `Docent-Signature: t=<unix seconds>,v1=<hex>`, where v1 is
HMAC-SHA256 of "<t>.<raw body>" with the webhook's signing secret. Receivers
recompute it, compare in constant time, and reject timestamps older than five
minutes. The event id stays the same on every retry, so receivers can skip
duplicates.

Delivery goes through the SSRF-guarded client: every address must be public,
redirects are not followed, and the request times out after ten seconds. A
failure retries with the job queue's backoff (30 s, 2 min, 10 min, 1 h), then
the delivery is dead and the log shows the last error.
"""

import hashlib
import hmac
import json
import re
import time
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

import httpx

from docent.db.pool import Connection, transaction
from docent.ids import new_id
from docent.inbox.outbound import OutboundDeps, describe_error, response_excerpt
from docent.jobs import queue
from docent.jobs.worker import JobContext, PermanentJobError

DELIVER_WEBHOOK = "deliver_webhook"
EVENT_TYPES = ("escalation.created", "escalation.updated", "escalation.resolved")
SIGNATURE_HEADER = "Docent-Signature"
MAX_ATTEMPTS = 5
TOLERANCE_SECONDS = 300

ISSUE_SQL = """coalesce(nullif(e.summary ->> 'issue', ''), (
    select left(m.content, 300) from messages m
    where m.conversation_id = e.conversation_id and m.role = 'visitor'
      and m.created_at <= e.created_at
    order by m.created_at desc limit 1), 'Handoff')"""


class WebhookFailed(Exception):
    """The receiver did not answer 2xx. The queue retries."""


def sign(secret: str, timestamp: int, body: bytes) -> str:
    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={mac}"


def verify(
    secret: str, header: str, body: bytes, *, now: int | None = None, tolerance: int = 300
) -> bool:
    """What a receiver does. Used in tests and shown in the docs."""
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    try:
        timestamp = int(parts["t"])
    except KeyError, ValueError:
        return False
    if abs((now or int(time.time())) - timestamp) > tolerance:
        return False
    expected = sign(secret, timestamp, body).split("v1=", 1)[1]
    return hmac.compare_digest(expected, parts.get("v1", ""))


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z") if value else None


async def snapshot(conn: Connection, escalation_id: uuid.UUID, web_origin: str) -> dict[str, Any]:
    """The escalation as webhook receivers see it. Never the transcript."""
    row = await conn.fetchrow(
        f"""
        select e.id, e.conversation_id, e.status, e.reason, e.priority, e.fields, e.summary,
               e.contact_email, e.created_at, e.updated_at, e.first_response_at, e.resolved_at,
               t.id as type_id, t.name as type_name, e.assignee_user_id,
               a.name as assignee_name, a.email as assignee_email,
               c.mode, u.external_id, u.name as customer_name, u.email as customer_email,
               {ISSUE_SQL} as issue
        from escalations e
        join conversations c on c.id = e.conversation_id
        left join ticket_types t on t.id = e.ticket_type_id
        left join member_contacts a on a.user_id = e.assignee_user_id
        left join end_users u on u.id = c.end_user_id
        where e.id = $1
        """,  # noqa: S608
        escalation_id,
    )
    if row is None:
        raise LookupError("escalation not found")
    return {
        "id": str(row["id"]),
        "url": f"{web_origin.rstrip('/')}/app/inbox/{row['id']}",
        "conversation_id": str(row["conversation_id"]),
        "status": row["status"],
        "reason": row["reason"],
        "priority": row["priority"],
        "issue": row["issue"],
        "ticket_type": (
            {"id": str(row["type_id"]), "name": row["type_name"]} if row["type_id"] else None
        ),
        "fields": row["fields"] or {},
        "summary": row["summary"],
        "contact_email": row["contact_email"],
        "assignee": (
            {
                "id": str(row["assignee_user_id"]),
                "name": row["assignee_name"],
                "email": row["assignee_email"],
            }
            if row["assignee_user_id"] and row["assignee_name"]
            else None
        ),
        "customer": (
            {
                "external_id": row["external_id"],
                "name": row["customer_name"],
                "email": row["customer_email"],
            }
            if row["mode"] == "identified" and row["external_id"]
            else None
        ),
        "created_at": _iso(row["created_at"]),
        "updated_at": _iso(row["updated_at"]),
        "first_response_at": _iso(row["first_response_at"]),
        "resolved_at": _iso(row["resolved_at"]),
    }


def envelope(
    event_type: str,
    workspace: dict[str, str],
    escalation: dict[str, Any],
    *,
    changes: Sequence[str] = (),
    test: bool = False,
) -> dict[str, Any]:
    data: dict[str, Any] = {"escalation": escalation}
    if event_type == "escalation.updated":
        data["changes"] = list(changes)
    return {
        "id": f"evt_{new_id().hex}",
        "type": event_type,
        "created_at": _iso(datetime.now(UTC)),
        "test": test,
        "workspace": workspace,
        "data": data,
    }


async def _workspace(conn: Connection, tenant_id: uuid.UUID) -> dict[str, str]:
    name = await conn.fetchval("select name from tenant_profiles where id = $1", tenant_id)
    return {"id": str(tenant_id), "name": str(name or "")}


async def _queue_delivery(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    webhook_id: uuid.UUID,
    event: dict[str, Any],
    escalation_id: uuid.UUID | None,
    max_attempts: int,
) -> uuid.UUID:
    delivery_id = new_id()
    await conn.execute(
        """
        insert into webhook_deliveries (id, tenant_id, webhook_id, event_id, event_type,
                                        escalation_id, payload, max_attempts)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        delivery_id,
        tenant_id,
        webhook_id,
        event["id"],
        event["type"],
        escalation_id,
        event,
        max_attempts,
    )
    await queue.enqueue(
        conn,
        DELIVER_WEBHOOK,
        {"delivery_id": str(delivery_id)},
        tenant_id=tenant_id,
        max_attempts=max_attempts,
        dedupe_key=f"webhook:{delivery_id}",
    )
    return delivery_id


async def emit(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    event_type: str,
    escalation_id: uuid.UUID,
    web_origin: str,
    changes: Sequence[str] = (),
    also: Sequence[uuid.UUID] = (),
) -> int:
    """Queue this event for every subscribed webhook (and any in `also`). Returns how many."""
    hooks = await conn.fetch(
        """
        select id from webhooks
        where active and ($1 = any(events) or id = any($2::uuid[]))
        order by created_at
        """,
        event_type,
        list(also),
    )
    if not hooks:
        return 0
    event = envelope(
        event_type,
        await _workspace(conn, tenant_id),
        await snapshot(conn, escalation_id, web_origin),
        changes=changes,
    )
    for hook in hooks:
        await _queue_delivery(
            conn,
            tenant_id=tenant_id,
            webhook_id=hook["id"],
            event=event,
            escalation_id=escalation_id,
            max_attempts=MAX_ATTEMPTS,
        )
    return len(hooks)


def sample_escalation(web_origin: str) -> dict[str, Any]:
    """Made-up data for test events, so tools such as Zapier can map fields."""
    now = datetime.now(UTC)
    sample_id = "00000000-0000-7000-8000-000000000000"
    return {
        "id": sample_id,
        "url": f"{web_origin.rstrip('/')}/app/inbox",
        "conversation_id": "00000000-0000-7000-8000-000000000001",
        "status": "open",
        "reason": "user_requested",
        "priority": "normal",
        "issue": "Charged twice for the March invoice",
        "ticket_type": {"id": "00000000-0000-7000-8000-000000000002", "name": "Billing"},
        "fields": {"invoice_number": "INV-1042"},
        "summary": {
            "issue": "Charged twice for the March invoice",
            "tried": "Checked the billing page; both charges show.",
            "user_context": "Team plan, admin of the account.",
            "sentiment": "calm",
            "suggested_next_step": "Refund the duplicate charge and confirm by email.",
        },
        "contact_email": "customer@example.com",
        "assignee": None,
        "customer": {"external_id": "user_123", "name": "Ana Souza", "email": "ana@example.com"},
        "created_at": _iso(now),
        "updated_at": _iso(now),
        "first_response_at": None,
        "resolved_at": None,
    }


async def queue_test_event(
    conn: Connection, *, tenant_id: uuid.UUID, webhook_id: uuid.UUID, web_origin: str
) -> uuid.UUID:
    """One attempt, marked "test": true, with sample data."""
    event = envelope(
        "escalation.created",
        await _workspace(conn, tenant_id),
        sample_escalation(web_origin),
        test=True,
    )
    return await _queue_delivery(
        conn,
        tenant_id=tenant_id,
        webhook_id=webhook_id,
        event=event,
        escalation_id=None,
        max_attempts=1,
    )


def body_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()


_EVENT_ID = re.compile(r"^evt_[0-9a-f]{32}$")


async def deliver_webhook(ctx: JobContext, deps: OutboundDeps) -> None:
    tenant_id = ctx.job.tenant_id
    assert tenant_id is not None
    delivery_id = uuid.UUID(ctx.job.payload["delivery_id"])
    async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
        row = await conn.fetchrow(
            """
            select d.status, d.payload, d.event_type, w.id as webhook_id, w.active,
                   w.url_encrypted, w.secret_encrypted
            from webhook_deliveries d join webhooks w on w.id = d.webhook_id
            where d.id = $1
            """,
            delivery_id,
        )
    if row is None or row["status"] in ("succeeded", "dead"):
        return  # the webhook was deleted, or this delivery already finished
    if not row["active"]:
        await _finish(ctx, delivery_id, error="The webhook is turned off.", dead=True)
        return
    webhook_id = row["webhook_id"]
    url = deps.box.open(
        row["url_encrypted"], purpose="webhook_url", tenant_id=tenant_id, row_id=webhook_id
    )
    secret = deps.box.open(
        row["secret_encrypted"], purpose="webhook_secret", tenant_id=tenant_id, row_id=webhook_id
    )
    body = body_bytes(row["payload"])
    timestamp = int(time.time())
    headers = {
        "content-type": "application/json",
        "user-agent": "Docent-Webhooks/1.0",
        "docent-event": row["event_type"],
        "docent-delivery": str(delivery_id),
        SIGNATURE_HEADER.lower(): sign(secret, timestamp, body),
    }
    started = time.monotonic()
    status_code: int | None = None
    error: str | None = None
    try:
        async with deps.http.stream(
            "POST", url, content=body, headers=headers, follow_redirects=False, timeout=10.0
        ) as response:
            status_code = response.status_code
            if not 200 <= status_code < 300:
                error = f"HTTP {status_code}" + await response_excerpt(response)
                if 300 <= status_code < 400:
                    error += " (redirects are not followed)"
    except httpx.HTTPError as exc:
        error = describe_error(exc)
    elapsed = round((time.monotonic() - started) * 1000)
    final = ctx.job.attempts >= ctx.job.max_attempts
    unreachable = error is not None and "not reachable" in error
    await _finish(
        ctx,
        delivery_id,
        error=error,
        dead=error is not None and (final or unreachable),
        status_code=status_code,
        elapsed_ms=elapsed,
    )
    if error is not None:
        if unreachable:
            raise PermanentJobError(error)
        raise WebhookFailed(error)


async def _finish(
    ctx: JobContext,
    delivery_id: uuid.UUID,
    *,
    error: str | None,
    dead: bool,
    status_code: int | None = None,
    elapsed_ms: int | None = None,
) -> None:
    attempts = ctx.job.attempts
    if error is None:
        status, next_at = "succeeded", None
    elif dead:
        status, next_at = "dead", None
    else:
        status = "retrying"
        next_at = queue.BACKOFF_SECONDS[min(attempts - 1, len(queue.BACKOFF_SECONDS) - 1)]
    assert ctx.job.tenant_id is not None
    async with transaction(ctx.pool, tenant_id=ctx.job.tenant_id) as conn:
        await conn.execute(
            """
            update webhook_deliveries
            set status = $2, attempts = $3, last_error = $4, response_status = $5,
                response_ms = $6, updated_at = now(),
                next_attempt_at = case when $7::int is null then null
                                       else now() + make_interval(secs => $7::int) end,
                delivered_at = case when $2 = 'succeeded' then now() else delivered_at end
            where id = $1
            """,
            delivery_id,
            status,
            attempts,
            error,
            status_code,
            elapsed_ms,
            next_at,
        )
