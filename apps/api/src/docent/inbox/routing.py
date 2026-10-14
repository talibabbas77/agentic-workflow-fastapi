"""Routing rules: "when ticket type is X and reason is Y and the customer's claims match Z,
then assign, set priority, notify, call a webhook".

Rules are checked in order and the first match wins. Routing runs once per
handoff, in the summary job, once the ticket type is known. It also sends the
new handoff notifications: emails to the ticket type's and the rule's
addresses (or, for a customer's handoff, to owners and admins when nothing
else would hear about it), Slack channels, and the escalation.created webhook
event. Handoffs from the preview chat are routed the same way, so a team can
try its rules, but never fall back to owners and admins.

Members among those email recipients also get the handoff in the bell in the
admin app, and an assignee always does, even with assignment emails turned off.
"""

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from docent.config import Settings
from docent.db.pool import Connection
from docent.inbox import deliveries, events, notify
from docent.services import audit

log = logging.getLogger(__name__)

CLAIM_OPS = ("equals", "not_equals", "contains", "exists")


@dataclass(frozen=True, slots=True)
class Rule:
    id: uuid.UUID
    name: str
    ticket_type_ids: list[uuid.UUID] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    claim_conditions: list[dict[str, str]] = field(default_factory=list)
    assign_user_id: uuid.UUID | None = None
    set_priority: str | None = None
    notify_emails: list[str] = field(default_factory=list)
    notify_channel_id: uuid.UUID | None = None
    webhook_id: uuid.UUID | None = None

    @classmethod
    def from_row(cls, row: Any) -> Rule:
        return cls(
            id=row["id"],
            name=row["name"],
            ticket_type_ids=list(row["ticket_type_ids"] or []),
            reasons=list(row["reasons"] or []),
            claim_conditions=list(row["claim_conditions"] or []),
            assign_user_id=row["assign_user_id"],
            set_priority=row["set_priority"],
            notify_emails=list(row["notify_emails"] or []),
            notify_channel_id=row["notify_channel_id"],
            webhook_id=row["webhook_id"],
        )


def claim_matches(condition: dict[str, str], claims: dict[str, str]) -> bool:
    op = condition.get("op", "equals")
    value = claims.get(condition.get("key", ""))
    wanted = (condition.get("value") or "").strip().casefold()
    if op == "exists":
        return bool(value and value.strip())
    if value is None:
        return op == "not_equals"
    have = str(value).strip().casefold()
    if op == "equals":
        return have == wanted
    if op == "not_equals":
        return have != wanted
    if op == "contains":
        return wanted in have
    return False


def matches(
    rule: Rule, *, ticket_type_id: uuid.UUID | None, reason: str, claims: dict[str, str]
) -> bool:
    if rule.ticket_type_ids and ticket_type_id not in rule.ticket_type_ids:
        return False
    if rule.reasons and reason not in rule.reasons:
        return False
    return all(claim_matches(c, claims) for c in rule.claim_conditions)


def first_match(
    rules: list[Rule], *, ticket_type_id: uuid.UUID | None, reason: str, claims: dict[str, str]
) -> Rule | None:
    return next(
        (
            r
            for r in rules
            if matches(r, ticket_type_id=ticket_type_id, reason=reason, claims=claims)
        ),
        None,
    )


async def active_rules(conn: Connection) -> list[Rule]:
    rows = await conn.fetch(
        """
        select id, name, ticket_type_ids, reasons, claim_conditions, assign_user_id, set_priority,
               notify_emails, notify_channel_id, webhook_id
        from routing_rules where active order by position, created_at
        """
    )
    return [Rule.from_row(r) for r in rows]


async def route(
    conn: Connection, *, tenant_id: uuid.UUID, escalation_id: uuid.UUID, settings: Settings
) -> Rule | None:
    """Apply the first matching rule and send new handoff notifications. Runs once."""
    claimed = await conn.fetchval(
        "update escalations set routed_at = now() where id = $1 and routed_at is null returning id",
        escalation_id,
    )
    if claimed is None:
        return None
    esc = await conn.fetchrow(
        f"""
        select e.id, e.reason, e.status, e.priority, e.ticket_type_id, e.assignee_user_id,
               e.summary, e.fields, e.contact_email, c.claims, c.channel,
               t.name as type_name, t.priority as type_priority, t.notify_emails,
               t.fields as type_fields, {events.ISSUE_SQL} as issue
        from escalations e
        join conversations c on c.id = e.conversation_id
        left join ticket_types t on t.id = e.ticket_type_id
        where e.id = $1
        """,  # noqa: S608
        escalation_id,
    )
    assert esc is not None
    claims = {str(k): str(v) for k, v in (esc["claims"] or {}).items()}
    rule = first_match(
        await active_rules(conn),
        ticket_type_id=esc["ticket_type_id"],
        reason=esc["reason"],
        claims=claims,
    )
    members = {
        r["user_id"]: r
        for r in await conn.fetch(
            """
            select mc.user_id, mc.email, mc.name, mc.role,
                   coalesce(p.assigned_email, true) as assigned_email
            from member_contacts mc
            left join notification_preferences p
              on p.tenant_id = mc.tenant_id and p.user_id = mc.user_id
            """
        )
    }
    assignee = (
        rule.assign_user_id
        if rule and rule.assign_user_id in members and esc["assignee_user_id"] is None
        else None
    )
    priority = (rule.set_priority if rule else None) or esc["type_priority"] or esc["priority"]
    status = "assigned" if assignee and esc["status"] == "open" else esc["status"]
    await conn.execute(
        """
        update escalations
        set priority = $2, assignee_user_id = coalesce($3, assignee_user_id), status = $4,
            routed_by_rule_id = $5, updated_at = now()
        where id = $1
        """,
        escalation_id,
        priority,
        assignee,
        status,
        rule.id if rule else None,
    )
    if rule:
        await audit.record(
            conn,
            tenant_id=tenant_id,
            actor_user_id=None,
            action="escalation.routed",
            target_type="escalation",
            target_id=escalation_id,
            metadata={"rule_id": str(rule.id), "rule": rule.name},
        )
    if assignee:
        await audit.record(
            conn,
            tenant_id=tenant_id,
            actor_user_id=None,
            action="escalation.assigned",
            target_type="escalation",
            target_id=escalation_id,
            metadata={
                "assignee_id": str(assignee),
                "assignee": members[assignee]["name"],
                "rule": rule.name if rule else None,
            },
        )

    workspace = str(
        await conn.fetchval("select name from tenant_profiles where id = $1", tenant_id) or ""
    )
    web = settings.web_origin.rstrip("/")
    url = f"{web}/app/inbox/{escalation_id}"
    secret = settings.secret_key.get_secret_value()
    labels = {f["key"]: f["label"] for f in (esc["type_fields"] or [])}
    fields = [[labels.get(k, k), str(v)] for k, v in (esc["fields"] or {}).items()]

    # Who hears about it by email: the type's list, the rule's list, and the assignee.
    recipients: dict[str, tuple[str, uuid.UUID | None, bool]] = {}
    by_email = {str(m["email"]).lower(): uid for uid, m in members.items()}
    for address in [*(esc["notify_emails"] or []), *(rule.notify_emails if rule else [])]:
        key = address.strip().lower()
        recipients.setdefault(key, (address.strip(), by_email.get(key), False))
    if assignee and members[assignee]["assigned_email"]:
        email = str(members[assignee]["email"])
        recipients[email.lower()] = (email, assignee, True)
    if not recipients and esc["channel"] == "widget":
        # Nothing routes a customer's handoff to anyone: owners and admins hear about it
        # rather than nobody. Handoffs from the team's own preview chat skip this.
        for uid, m in members.items():
            if m["role"] in ("owner", "admin"):
                recipients[str(m["email"]).lower()] = (str(m["email"]), uid, False)

    # A cap per workspace per day, so a workspace cannot turn Docent into a mailer.
    sent_today: int = await conn.fetchval(
        """
        select count(*) from email_deliveries
        where kind = 'notification' and created_at > now() - interval '1 day'
        """
    )
    room = settings.notification_emails_per_day - sent_today
    for address, user_id, assigned in recipients.values():
        if room <= 0:
            log.warning("notification email cap reached", extra={"tenant_id": str(tenant_id)})
            break
        room -= 1
        notification_id = await notify.notify_once(
            conn,
            tenant_id=tenant_id,
            kind="assigned" if assigned else "new_handoff",
            channel="email",
            escalation_id=escalation_id,
            user_id=user_id,
            dedupe_key=f"new:{escalation_id}:{deliveries.email_hash(secret, address)}",
        )
        if notification_id is None:
            continue
        await deliveries.queue_email(
            conn,
            tenant_id=tenant_id,
            secret=secret,
            to=address,
            subject=f"[{workspace}] New handoff: {esc['issue'][:120]}",
            template="new_handoff",
            data={
                "workspace": workspace,
                "issue": esc["issue"][:300],
                "reason": esc["reason"],
                "priority": priority,
                "ticket_type": esc["type_name"],
                "fields": fields,
                "summary": esc["summary"],
                "contact": esc["contact_email"],
                "url": url,
                "assigned_to_you": assigned,
                "rule": rule.name if rule else None,
                # Someone outside the workspace sees "Docent", not a name the workspace chose.
                "member": user_id is not None,
            },
            kind="notification",
            escalation_id=escalation_id,
            notification_id=notification_id,
        )

    # The bell: members the email went to, and the assignee whatever their email choice.
    in_app = {user_id: assigned for _, user_id, assigned in recipients.values() if user_id}
    if assignee:
        in_app[assignee] = True
    for user_id, assigned in in_app.items():
        kind = "assigned" if assigned else "new_handoff"
        await notify.notify_in_app(
            conn,
            tenant_id=tenant_id,
            user_id=user_id,
            kind=kind,
            escalation_id=escalation_id,
            dedupe_key=f"app:{kind}:{escalation_id}:{user_id}",
            payload={"rule": rule.name} if rule else {},
        )

    channels = await conn.fetch(
        """
        select id from notification_channels
        where active and ('escalation.created' = any(events) or id = $1)
        """,
        rule.notify_channel_id if rule else None,
    )
    if channels:
        text = notify.handoff_slack_text(
            workspace=workspace,
            issue=esc["issue"],
            url=url,
            reason=esc["reason"],
            priority=priority,
            ticket_type=esc["type_name"],
            assignee=members[assignee]["name"] if assignee else None,
        )
        for channel in channels:
            await notify.queue_slack(
                conn,
                tenant_id=tenant_id,
                channel_id=channel["id"],
                kind="new_handoff",
                dedupe_key=f"new:{escalation_id}:slack:{channel['id']}",
                text=text,
                escalation_id=escalation_id,
            )

    await events.emit(
        conn,
        tenant_id=tenant_id,
        event_type="escalation.created",
        escalation_id=escalation_id,
        web_origin=settings.web_origin,
        also=[rule.webhook_id] if rule and rule.webhook_id else [],
    )
    return rule
