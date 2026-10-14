"""Automation: routing rules, Slack channels, and outgoing webhooks.

Every member can see them; owners and admins change them. Slack URLs, webhook
URLs, and signing secrets are encrypted at rest and never returned: a signing
secret is shown once, when it is made. The API never calls tenant URLs itself;
test messages and events go through the worker's guarded client like real ones.
"""

import ipaddress
import secrets
import uuid
from functools import lru_cache
from urllib.parse import urlsplit

import asyncpg
from fastapi import APIRouter, status

from docent.api.deps import AdminMember, CurrentMember, Member, State, enforce
from docent.api.errors import AppError, not_found
from docent.api.schemas import (
    ClaimCondition,
    ErrorOut,
    NotificationStateOut,
    QueuedOut,
    RoutingRuleIn,
    RoutingRuleOut,
    RuleOrderIn,
    SlackChannelIn,
    SlackChannelOut,
    SlackChannelUpdateIn,
    WebhookCreatedOut,
    WebhookDeliveryOut,
    WebhookIn,
    WebhookOut,
    WebhookSecretOut,
    WebhookUpdateIn,
)
from docent.config import Settings
from docent.db.pool import Connection, transaction
from docent.ids import new_id
from docent.inbox import events, notify
from docent.jobs import queue
from docent.knowledge.fetch import FetchError, check_url, is_public_address
from docent.security import ratelimit
from docent.security.secretbox import SecretBox
from docent.services import audit

router = APIRouter(
    prefix="/v1/automation",
    tags=["automation"],
    responses={403: {"model": ErrorOut}, 404: {"model": ErrorOut}, 422: {"model": ErrorOut}},
)

SLACK_HOST = "hooks.slack.com"
DELIVERY_LOG_SIZE = 50


@lru_cache(maxsize=4)
def _box(secret_key: str) -> SecretBox:
    return SecretBox(secret_key)


def box(settings: Settings) -> SecretBox:
    return _box(settings.secret_key.get_secret_value())


# Routing rules

_RULE_COLUMNS = """
    id, name, position, active, ticket_type_ids, reasons, claim_conditions, assign_user_id,
    set_priority, notify_emails, notify_channel_id, webhook_id, created_at, updated_at
"""


def _rule(row: asyncpg.Record) -> RoutingRuleOut:
    return RoutingRuleOut(
        id=row["id"],
        name=row["name"],
        position=row["position"],
        active=row["active"],
        ticket_type_ids=list(row["ticket_type_ids"]),
        reasons=list(row["reasons"]),
        claim_conditions=[ClaimCondition(**c) for c in row["claim_conditions"]],
        assign_user_id=row["assign_user_id"],
        set_priority=row["set_priority"],
        notify_emails=list(row["notify_emails"]),
        notify_channel_id=row["notify_channel_id"],
        webhook_id=row["webhook_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def _rules(conn: Connection) -> list[RoutingRuleOut]:
    rows = await conn.fetch(
        f"select {_RULE_COLUMNS} from routing_rules order by position, created_at"  # noqa: S608
    )
    return [_rule(r) for r in rows]


async def _check_rule(conn: Connection, tenant_id: uuid.UUID, body: RoutingRuleIn) -> None:
    """Every id a rule names must belong to this workspace."""
    problems: dict[str, str] = {}
    if not body.has_action():
        problems["actions"] = "Choose at least one thing for the rule to do."
    if body.ticket_type_ids:
        found = await conn.fetchval(
            "select count(*) from ticket_types where id = any($1::uuid[])",
            list(set(body.ticket_type_ids)),
        )
        if found != len(set(body.ticket_type_ids)):
            problems["ticket_type_ids"] = "A ticket type no longer exists."
    if body.assign_user_id and not await conn.fetchval(
        "select exists(select 1 from memberships where tenant_id = $1 and user_id = $2)",
        tenant_id,
        body.assign_user_id,
    ):
        problems["assign_user_id"] = "That person is not in this workspace."
    if body.notify_channel_id and not await conn.fetchval(
        "select exists(select 1 from notification_channels where id = $1)", body.notify_channel_id
    ):
        problems["notify_channel_id"] = "That Slack channel no longer exists."
    if body.webhook_id and not await conn.fetchval(
        "select exists(select 1 from webhooks where id = $1)", body.webhook_id
    ):
        problems["webhook_id"] = "That webhook no longer exists."
    if problems:
        raise AppError(422, "invalid_rule", "Some parts of the rule need attention.", problems)


def _rule_args(body: RoutingRuleIn) -> tuple[object, ...]:
    return (
        body.name,
        body.active,
        list(dict.fromkeys(body.ticket_type_ids)),
        list(dict.fromkeys(body.reasons)),
        [c.model_dump() for c in body.claim_conditions],
        body.assign_user_id,
        body.set_priority,
        list(dict.fromkeys(str(e).lower() for e in body.notify_emails)),
        body.notify_channel_id,
        body.webhook_id,
    )


@router.get("/rules")
async def list_rules(member: CurrentMember, state: State) -> list[RoutingRuleOut]:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return await _rules(conn)


@router.post("/rules", status_code=status.HTTP_201_CREATED)
async def create_rule(body: RoutingRuleIn, member: AdminMember, state: State) -> RoutingRuleOut:
    rule_id = new_id()
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _check_rule(conn, member.tenant_id, body)
        if await conn.fetchval("select count(*) from routing_rules") >= 100:
            raise AppError(422, "too_many_rules", "A workspace can have 100 rules at most.")
        row = await conn.fetchrow(
            f"""
            insert into routing_rules (id, tenant_id, position, name, active, ticket_type_ids,
                                       reasons, claim_conditions, assign_user_id, set_priority,
                                       notify_emails, notify_channel_id, webhook_id, created_by)
            values ($1, $2, (select coalesce(max(position), 0) + 1 from routing_rules),
                    $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            returning {_RULE_COLUMNS}
            """,  # noqa: S608
            rule_id,
            member.tenant_id,
            *_rule_args(body),
            member.user_id,
        )
        await _audit(conn, member, "routing_rule.created", "routing_rule", rule_id)
    assert row is not None
    return _rule(row)


@router.put("/rules/order")
async def reorder_rules(
    body: RuleOrderIn, member: AdminMember, state: State
) -> list[RoutingRuleOut]:
    """Set the order rules are checked in. Send every rule's id, first one first."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        existing = {r["id"] for r in await conn.fetch("select id from routing_rules for update")}
        if set(body.ids) != existing or len(body.ids) != len(existing):
            raise AppError(
                422, "invalid_order", "Send every rule exactly once.", {"ids": "Every rule, once."}
            )
        await conn.execute(
            """
            update routing_rules r set position = o.position, updated_at = now()
            from unnest($1::uuid[]) with ordinality as o(id, position)
            where r.id = o.id
            """,
            body.ids,
        )
        await _audit(conn, member, "routing_rule.reordered", "routing_rule", None)
        return await _rules(conn)


@router.put("/rules/{rule_id}")
async def replace_rule(
    rule_id: uuid.UUID, body: RoutingRuleIn, member: AdminMember, state: State
) -> RoutingRuleOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _check_rule(conn, member.tenant_id, body)
        row = await conn.fetchrow(
            f"""
            update routing_rules
            set name = $2, active = $3, ticket_type_ids = $4, reasons = $5, claim_conditions = $6,
                assign_user_id = $7, set_priority = $8, notify_emails = $9,
                notify_channel_id = $10, webhook_id = $11, updated_at = now()
            where id = $1
            returning {_RULE_COLUMNS}
            """,  # noqa: S608
            rule_id,
            *_rule_args(body),
        )
        if row is None:
            raise not_found("Rule")
        await _audit(conn, member, "routing_rule.updated", "routing_rule", rule_id)
    return _rule(row)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(rule_id: uuid.UUID, member: AdminMember, state: State) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        deleted = await conn.execute("delete from routing_rules where id = $1", rule_id)
        if deleted.endswith(" 0"):
            raise not_found("Rule")
        await _audit(conn, member, "routing_rule.deleted", "routing_rule", rule_id)


# Slack channels


def _check_target(raw: str, settings: Settings, *, slack: bool) -> str:
    """Shape checks at save time. The worker's guarded client checks every address again."""
    field = "url"
    try:
        url = check_url(raw)
    except FetchError as exc:
        raise AppError(422, "invalid_url", str(exc), {field: str(exc)}) from None
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    production = settings.env not in ("local", "test")
    if production and parts.scheme != "https":
        raise AppError(422, "invalid_url", "Use an https URL.", {field: "Use an https URL."})
    if slack and production and host != SLACK_HOST:
        message = "Use a Slack incoming webhook URL, from hooks.slack.com."
        raise AppError(422, "invalid_url", message, {field: message})
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if (
        literal is not None
        and not settings.crawl_allow_private
        and not is_public_address(str(literal))
    ):
        message = "That address is not reachable from Docent."
        raise AppError(422, "invalid_url", message, {field: message})
    return url


def _hint(url: str) -> str:
    parts = urlsplit(url)
    rest = parts.path + (f"?{parts.query}" if parts.query else "")
    tail = rest[-4:] if len(rest) > 8 else ""
    return (
        f"{parts.scheme}://{parts.netloc}/…{tail}"
        if tail
        else f"{parts.scheme}://{parts.netloc}{rest}"
    )


def _channel(row: asyncpg.Record) -> SlackChannelOut:
    last = None
    if row["last_status"]:
        last = NotificationStateOut(
            kind=row["last_kind"],
            status=row["last_status"],
            attempts=row["last_attempts"],
            last_error=row["last_error"],
            created_at=row["last_created_at"],
            sent_at=row["last_sent_at"],
        )
    return SlackChannelOut(
        id=row["id"],
        name=row["name"],
        url_hint=row["target_hint"],
        post_all="escalation.created" in row["events"],
        active=row["active"],
        created_at=row["created_at"],
        last_delivery=last,
    )


async def _channels(conn: Connection, channel_id: uuid.UUID | None = None) -> list[SlackChannelOut]:
    rows = await conn.fetch(
        """
        select c.id, c.name, c.target_hint, c.events, c.active, c.created_at,
               n.kind as last_kind, n.status as last_status, n.attempts as last_attempts,
               n.last_error, n.created_at as last_created_at, n.sent_at as last_sent_at
        from notification_channels c
        left join lateral (
          select kind, status, attempts, last_error, created_at, sent_at from notifications
          where channel_id = c.id order by created_at desc limit 1
        ) n on true
        where $1::uuid is null or c.id = $1
        order by c.created_at
        """,
        channel_id,
    )
    return [_channel(r) for r in rows]


@router.get("/channels")
async def list_channels(member: CurrentMember, state: State) -> list[SlackChannelOut]:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return await _channels(conn)


@router.post("/channels", status_code=status.HTTP_201_CREATED)
async def create_channel(
    body: SlackChannelIn, member: AdminMember, state: State
) -> SlackChannelOut:
    url = _check_target(body.url, state.settings, slack=True)
    channel_id = new_id()
    sealed = box(state.settings).seal(
        url, purpose="slack", tenant_id=member.tenant_id, row_id=channel_id
    )
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if await conn.fetchval("select count(*) from notification_channels") >= 10:
            raise AppError(422, "too_many_channels", "A workspace can have 10 Slack channels.")
        await conn.execute(
            """
            insert into notification_channels (id, tenant_id, name, target_encrypted, target_hint,
                                               events, created_by)
            values ($1, $2, $3, $4, $5, $6, $7)
            """,
            channel_id,
            member.tenant_id,
            body.name,
            sealed,
            _hint(url),
            ["escalation.created"] if body.post_all else [],
            member.user_id,
        )
        await _audit(conn, member, "channel.created", "notification_channel", channel_id)
        return (await _channels(conn, channel_id))[0]


@router.patch("/channels/{channel_id}")
async def update_channel(
    channel_id: uuid.UUID, body: SlackChannelUpdateIn, member: AdminMember, state: State
) -> SlackChannelOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if not await conn.fetchval(
            "select exists(select 1 from notification_channels where id = $1)", channel_id
        ):
            raise not_found("Channel")
        if body.url is not None:
            url = _check_target(body.url, state.settings, slack=True)
            await conn.execute(
                """
                update notification_channels set target_encrypted = $2, target_hint = $3
                where id = $1
                """,
                channel_id,
                box(state.settings).seal(
                    url, purpose="slack", tenant_id=member.tenant_id, row_id=channel_id
                ),
                _hint(url),
            )
        await conn.execute(
            """
            update notification_channels
            set name = coalesce($2, name), active = coalesce($3, active),
                events = case when $4::boolean is null then events
                              when $4 then '{escalation.created}'::text[] else '{}'::text[] end,
                updated_at = now()
            where id = $1
            """,
            channel_id,
            body.name,
            body.active,
            body.post_all,
        )
        await _audit(conn, member, "channel.updated", "notification_channel", channel_id)
        return (await _channels(conn, channel_id))[0]


@router.delete("/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(channel_id: uuid.UUID, member: AdminMember, state: State) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        deleted = await conn.execute("delete from notification_channels where id = $1", channel_id)
        if deleted.endswith(" 0"):
            raise not_found("Channel")
        await _audit(conn, member, "channel.deleted", "notification_channel", channel_id)


@router.post(
    "/channels/{channel_id}/test",
    status_code=status.HTTP_202_ACCEPTED,
    responses={429: {"model": ErrorOut}},
)
async def test_channel(channel_id: uuid.UUID, member: AdminMember, state: State) -> QueuedOut:
    """Post a test message. The result shows on the channel as its last delivery."""
    await enforce(state, ratelimit.OUTBOUND_TEST_PER_TENANT, str(member.tenant_id))
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        row = await conn.fetchrow(
            "select name from notification_channels where id = $1", channel_id
        )
        if row is None:
            raise not_found("Channel")
        workspace = await conn.fetchval("select name from tenants where id = $1", member.tenant_id)
        notification_id = await notify.queue_slack(
            conn,
            tenant_id=member.tenant_id,
            channel_id=channel_id,
            kind="test",
            dedupe_key=f"test:{channel_id}:{new_id()}",
            text=(
                f"Test message from Docent for {notify.slack_escape(str(workspace))}. "
                f"New handoffs will appear here. Sent by {notify.slack_escape(member.user.name)}."
            ),
            max_attempts=1,
        )
    assert notification_id is not None
    await state.waker.wake()
    return QueuedOut(id=notification_id)


# Webhooks


def _new_secret() -> str:
    return f"whsec_{secrets.token_urlsafe(32)}"


def _secret_hint(secret: str) -> str:
    return f"whsec_…{secret[-4:]}"


def _delivery(row: asyncpg.Record) -> WebhookDeliveryOut:
    return WebhookDeliveryOut(
        id=row["id"],
        event_id=row["event_id"],
        event_type=row["event_type"],
        test=bool(row["test"]),
        status=row["status"],
        attempts=row["attempts"],
        max_attempts=row["max_attempts"],
        response_status=row["response_status"],
        response_ms=row["response_ms"],
        last_error=row["last_error"],
        next_attempt_at=row["next_attempt_at"],
        created_at=row["created_at"],
        delivered_at=row["delivered_at"],
    )


_DELIVERY_COLUMNS = """
    d.id, d.event_id, d.event_type, coalesce((d.payload ->> 'test')::boolean, false) as test,
    d.status, d.attempts, d.max_attempts, d.response_status, d.response_ms, d.last_error,
    d.next_attempt_at, d.created_at, d.delivered_at
"""


async def _webhooks(conn: Connection, webhook_id: uuid.UUID | None = None) -> list[WebhookOut]:
    hooks = await conn.fetch(
        """
        select id, url_hint, description, events, active, secret_hint, created_at, updated_at
        from webhooks where $1::uuid is null or id = $1 order by created_at
        """,
        webhook_id,
    )
    latest = {
        r["webhook_id"]: _delivery(r)
        for r in await conn.fetch(
            f"""
            select distinct on (d.webhook_id) d.webhook_id, {_DELIVERY_COLUMNS}
            from webhook_deliveries d
            where $1::uuid is null or d.webhook_id = $1
            order by d.webhook_id, d.created_at desc
            """,  # noqa: S608
            webhook_id,
        )
    }
    return [
        WebhookOut(
            id=h["id"],
            url_hint=h["url_hint"],
            description=h["description"],
            events=list(h["events"]),
            active=h["active"],
            secret_hint=h["secret_hint"],
            created_at=h["created_at"],
            updated_at=h["updated_at"],
            last_delivery=latest.get(h["id"]),
        )
        for h in hooks
    ]


async def _webhook_exists(conn: Connection, webhook_id: uuid.UUID) -> None:
    if not await conn.fetchval("select exists(select 1 from webhooks where id = $1)", webhook_id):
        raise not_found("Webhook")


@router.get("/webhooks")
async def list_webhooks(member: CurrentMember, state: State) -> list[WebhookOut]:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return await _webhooks(conn)


@router.post("/webhooks", status_code=status.HTTP_201_CREATED)
async def create_webhook(body: WebhookIn, member: AdminMember, state: State) -> WebhookCreatedOut:
    url = _check_target(body.url, state.settings, slack=False)
    webhook_id = new_id()
    secret = _new_secret()
    sealer = box(state.settings)
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if await conn.fetchval("select count(*) from webhooks") >= 10:
            raise AppError(422, "too_many_webhooks", "A workspace can have 10 webhooks.")
        await conn.execute(
            """
            insert into webhooks (id, tenant_id, description, url_encrypted, url_hint,
                                  secret_encrypted, secret_hint, events, active, created_by)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """,
            webhook_id,
            member.tenant_id,
            body.description,
            sealer.seal(url, purpose="webhook_url", tenant_id=member.tenant_id, row_id=webhook_id),
            _hint(url),
            sealer.seal(
                secret, purpose="webhook_secret", tenant_id=member.tenant_id, row_id=webhook_id
            ),
            _secret_hint(secret),
            list(dict.fromkeys(body.events)),
            body.active,
            member.user_id,
        )
        await _audit(conn, member, "webhook.created", "webhook", webhook_id)
        webhook = (await _webhooks(conn, webhook_id))[0]
    return WebhookCreatedOut(webhook=webhook, secret=secret)


@router.patch("/webhooks/{webhook_id}")
async def update_webhook(
    webhook_id: uuid.UUID, body: WebhookUpdateIn, member: AdminMember, state: State
) -> WebhookOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _webhook_exists(conn, webhook_id)
        if body.url is not None:
            url = _check_target(body.url, state.settings, slack=False)
            await conn.execute(
                "update webhooks set url_encrypted = $2, url_hint = $3 where id = $1",
                webhook_id,
                box(state.settings).seal(
                    url, purpose="webhook_url", tenant_id=member.tenant_id, row_id=webhook_id
                ),
                _hint(url),
            )
        await conn.execute(
            """
            update webhooks
            set description = coalesce($2, description), active = coalesce($3, active),
                events = coalesce($4, events), updated_at = now()
            where id = $1
            """,
            webhook_id,
            body.description,
            body.active,
            list(dict.fromkeys(body.events)) if body.events is not None else None,
        )
        await _audit(conn, member, "webhook.updated", "webhook", webhook_id)
        return (await _webhooks(conn, webhook_id))[0]


@router.delete("/webhooks/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(webhook_id: uuid.UUID, member: AdminMember, state: State) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        deleted = await conn.execute("delete from webhooks where id = $1", webhook_id)
        if deleted.endswith(" 0"):
            raise not_found("Webhook")
        await _audit(conn, member, "webhook.deleted", "webhook", webhook_id)


@router.post("/webhooks/{webhook_id}/secret")
async def rotate_secret(
    webhook_id: uuid.UUID, member: AdminMember, state: State
) -> WebhookSecretOut:
    """Replace the signing secret. The old one stops working at once."""
    secret = _new_secret()
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _webhook_exists(conn, webhook_id)
        await conn.execute(
            """
            update webhooks set secret_encrypted = $2, secret_hint = $3, updated_at = now()
            where id = $1
            """,
            webhook_id,
            box(state.settings).seal(
                secret, purpose="webhook_secret", tenant_id=member.tenant_id, row_id=webhook_id
            ),
            _secret_hint(secret),
        )
        await _audit(conn, member, "webhook.secret_rotated", "webhook", webhook_id)
    return WebhookSecretOut(secret=secret)


@router.post(
    "/webhooks/{webhook_id}/test",
    status_code=status.HTTP_202_ACCEPTED,
    responses={429: {"model": ErrorOut}},
)
async def test_webhook(webhook_id: uuid.UUID, member: AdminMember, state: State) -> QueuedOut:
    """Send a sample escalation.created event marked "test": true. One attempt."""
    await enforce(state, ratelimit.OUTBOUND_TEST_PER_TENANT, str(member.tenant_id))
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _webhook_exists(conn, webhook_id)
        delivery_id = await events.queue_test_event(
            conn,
            tenant_id=member.tenant_id,
            webhook_id=webhook_id,
            web_origin=state.settings.web_origin,
        )
    await state.waker.wake()
    return QueuedOut(id=delivery_id)


@router.get("/webhooks/{webhook_id}/deliveries")
async def list_deliveries(
    webhook_id: uuid.UUID, member: CurrentMember, state: State
) -> list[WebhookDeliveryOut]:
    """The latest 50 deliveries, newest first."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _webhook_exists(conn, webhook_id)
        rows = await conn.fetch(
            f"""
            select {_DELIVERY_COLUMNS} from webhook_deliveries d
            where d.webhook_id = $1 order by d.created_at desc limit {DELIVERY_LOG_SIZE}
            """,  # noqa: S608
            webhook_id,
        )
    return [_delivery(r) for r in rows]


@router.post(
    "/webhooks/{webhook_id}/deliveries/{delivery_id}/retry",
    status_code=status.HTTP_202_ACCEPTED,
)
async def retry_delivery(
    webhook_id: uuid.UUID, delivery_id: uuid.UUID, member: AdminMember, state: State
) -> QueuedOut:
    """Send a dead delivery again, once, with the same event id."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        current = await conn.fetchval(
            "select status from webhook_deliveries where id = $1 and webhook_id = $2 for update",
            delivery_id,
            webhook_id,
        )
        if current is None:
            raise not_found("Delivery")
        if current != "dead":
            raise AppError(409, "not_dead", "Only a failed delivery can be sent again.")
        await conn.execute(
            """
            update webhook_deliveries
            set status = 'queued', max_attempts = 1, next_attempt_at = null, updated_at = now()
            where id = $1
            """,
            delivery_id,
        )
        await queue.enqueue(
            conn,
            events.DELIVER_WEBHOOK,
            {"delivery_id": str(delivery_id)},
            tenant_id=member.tenant_id,
            max_attempts=1,
            dedupe_key=f"webhook:{delivery_id}",
        )
    await state.waker.wake()
    return QueuedOut(id=delivery_id)


async def _audit(
    conn: Connection, member: Member, action: str, target_type: str, target: uuid.UUID | None
) -> None:
    await audit.record(
        conn,
        tenant_id=member.tenant_id,
        actor_user_id=member.user_id,
        action=action,
        target_type=target_type,
        target_id=target,
    )
