"""Apply verified Stripe events to our subscriptions.

The tenant comes only from the Stripe customer id, mapped through our own
subscriptions row (ARCHITECTURE section 3), never from event metadata. Each
event id is stored once, so redelivery is a no-op, and an event older than the
last one applied never rolls the subscription back: Stripe does not promise
delivery order. A paid top-up checkout credits its pack once (topups.py).
"""

import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from docent.billing import topups
from docent.billing.plans import plan_for_lookup_key
from docent.db.pool import Connection, Pool, set_context, transaction

log = logging.getLogger(__name__)

type Outcome = Literal["applied", "duplicate", "ignored", "unknown_customer", "stale"]

SUBSCRIPTION_EVENTS = {
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.resumed",
}
INVOICE_EVENTS = {"invoice.paid", "invoice.payment_failed", "charge.refunded"}
LIVE_STATUSES = ("trialing", "active", "past_due")


async def apply_event(pool: Pool, event: dict[str, Any]) -> Outcome:
    kind: str = event["type"]
    obj: dict[str, Any] = event["data"]["object"]
    customer = obj.get("customer")
    customer_id = customer.get("id") if isinstance(customer, dict) else customer
    created = datetime.fromtimestamp(int(event["created"]), UTC)

    async with transaction(pool, billing_customer=customer_id or None) as conn:
        tenant_id: uuid.UUID | None = (
            await conn.fetchval(
                "select tenant_id from subscriptions where provider_customer_id = $1", customer_id
            )
            if customer_id
            else None
        )
        first_time = await conn.fetchval(
            """
            insert into billing_events (id, provider, type, tenant_id, created_at)
            values ($1, 'stripe', $2, $3, $4)
            on conflict (id) do nothing
            returning true
            """,
            event["id"],
            kind,
            tenant_id,
            created,
        )
        if not first_time:
            return "duplicate"
        outcome = await _apply(conn, tenant_id, kind, obj, created, event["id"])
        # Kept with the event, so the platform admin console can show what each one did.
        await conn.execute(
            "update billing_events set outcome = $2 where id = $1", event["id"], outcome
        )
        return outcome


async def _apply(
    conn: Connection,
    tenant_id: uuid.UUID | None,
    kind: str,
    obj: dict[str, Any],
    created: datetime,
    event_id: str,
) -> Outcome:
    if kind not in SUBSCRIPTION_EVENTS | INVOICE_EVENTS | topups.CHECKOUT_EVENTS:
        return "ignored"
    if tenant_id is None:
        log.warning("billing event for an unknown customer", extra={"event": event_id})
        return "unknown_customer"
    await set_context(conn, tenant_id=tenant_id)
    if kind in SUBSCRIPTION_EVENTS:
        return await _apply_subscription(conn, tenant_id, kind, obj, created)
    if kind in topups.CHECKOUT_EVENTS:
        return await topups.credit(conn, tenant_id, obj, created)
    return await _apply_invoice(conn, tenant_id, kind, created)


async def _apply_subscription(
    conn: Connection, tenant_id: uuid.UUID, kind: str, sub: dict[str, Any], created: datetime
) -> Outcome:
    item = sub["items"]["data"][0]
    plan = plan_for_lookup_key(item["price"].get("lookup_key"))
    if plan is None:
        log.warning("subscription price is not in the catalog", extra={"price": item["price"]})
    status = "canceled" if kind == "customer.subscription.deleted" else sub["status"]
    updated = await conn.execute(
        """
        update subscriptions
        set provider = 'stripe',
            provider_subscription_id = $2,
            comped_until = null,  -- a paid subscription replaces a plan Docent gave
            status = $3,
            plan_id = coalesce($4, plan_id),
            current_period_start = $10,
            current_period_end = $5,
            cancel_at = $6,
            cancel_at_period_end = $11,
            trial_ends_at = $7,
            past_due_since = case when $3 = 'past_due' then coalesce(past_due_since, $8) end,
            -- A scheduled downgrade is done once the plan is the scheduled one.
            scheduled_plan_id = case when coalesce($4, plan_id) = scheduled_plan_id
                                     then null else scheduled_plan_id end,
            scheduled_change_at = case when coalesce($4, plan_id) = scheduled_plan_id
                                       then null else scheduled_change_at end,
            provider_schedule_id = case when coalesce($4, plan_id) = scheduled_plan_id
                                        then null else provider_schedule_id end,
            provider_event_at = $8,
            updated_at = now()
        where tenant_id = $1
          and (provider_event_at is null or provider_event_at <= $8)
          and (provider_subscription_id is null or provider_subscription_id = $2
               or $3 = any($9::text[]))
        """,
        tenant_id,
        sub["id"],
        status,
        plan.id if plan else None,
        _time(item.get("current_period_end")),
        _time(sub.get("cancel_at")),
        _time(sub.get("trial_end")),
        created,
        list(LIVE_STATUSES),
        _time(item.get("current_period_start")),
        bool(sub.get("cancel_at_period_end")),
    )
    return "applied" if updated.endswith(" 1") else "stale"


async def _apply_invoice(
    conn: Connection, tenant_id: uuid.UUID, kind: str, created: datetime
) -> Outcome:
    if kind == "charge.refunded":
        await conn.execute(
            "update subscriptions set refunded_at = coalesce(refunded_at, $2), updated_at = now()"
            " where tenant_id = $1",
            tenant_id,
            created,
        )
    elif kind == "invoice.payment_failed":
        await conn.execute(
            """
            update subscriptions set past_due_since = coalesce(past_due_since, $2),
                                     updated_at = now()
            where tenant_id = $1
            """,
            tenant_id,
            created,
        )
    else:  # invoice.paid; the first one opens the money-back window
        await conn.execute(
            """
            update subscriptions
            set past_due_since = null, first_paid_at = coalesce(first_paid_at, $2),
                updated_at = now()
            where tenant_id = $1
            """,
            tenant_id,
            created,
        )
    return "applied"


def _time(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value, UTC) if value else None
