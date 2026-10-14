"""Changing, canceling, and refunding a subscription, with the rules in one place.

The arithmetic and the reasoning behind upgrades and downgrades are in
proration.py, and the money-back window in refunds.py. This module checks what
a workspace may do, asks Stripe to do it, and records what Stripe will confirm
by webhook (the webhook stays the source of truth for the plan itself).
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from docent.billing import proration, refunds
from docent.billing.gateway import BillingError, BillingGateway
from docent.billing.plans import Plan
from docent.billing.subscriptions import (
    Entitlement,
    Limit,
    limit_noun,
    plan_limit,
    usage_counts,
)
from docent.db.pool import Connection

log = logging.getLogger(__name__)

MONTH = timedelta(days=30)


class PlanChangeError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class ChangePreview:
    result: proration.Preview
    blockers: list[str]
    stripe_due_now_cents: int | None


def period_bounds(current: Entitlement, now: datetime) -> tuple[datetime, datetime]:
    """The paid period a change is measured against. Stripe bills monthly."""
    end = current.current_period_end or now + MONTH
    return current.current_period_start or end - MONTH, end


async def preview_change(
    conn: Connection, current: Entitlement, target: Plan, gateway: BillingGateway | None
) -> ChangePreview:
    now = datetime.now(UTC)
    start, end = period_bounds(current, now)
    result = proration.preview(current.plan, target, period_start=start, period_end=end, now=now)
    blockers = await _blockers(conn, current, target, result.kind)
    stripe_due = None
    customer, subscription = current.customer_id, current.subscription_id
    if gateway and result.kind == "upgrade" and customer and subscription and not blockers:
        try:
            stripe_due = await gateway.preview_upgrade(
                customer_id=customer, subscription_id=subscription, plan=target
            )
        except BillingError as exc:  # the local figure still explains the change
            log.warning("stripe preview failed", extra={"error": str(exc)})
    return ChangePreview(result, blockers, stripe_due)


async def apply_change(
    conn: Connection,
    tenant_id: uuid.UUID,
    current: Entitlement,
    target: Plan,
    gateway: BillingGateway,
) -> proration.Kind:
    checked = await preview_change(conn, current, target, None)
    if checked.blockers:
        raise PlanChangeError("plan_change_blocked", checked.blockers[0])
    kind = checked.result.kind
    if kind == "same":
        raise PlanChangeError("same_plan", f"This workspace is already on {target.name}.")
    assert current.subscription_id is not None
    if kind == "upgrade":
        if current.schedule_id:  # an upgrade replaces a downgrade that was waiting
            await gateway.release_schedule(schedule_id=current.schedule_id)
        await gateway.upgrade(subscription_id=current.subscription_id, plan=target)
        await _set_schedule(conn, tenant_id, None, None, None)
    else:
        schedule_id = await gateway.schedule_downgrade(
            subscription_id=current.subscription_id, plan=target
        )
        await _set_schedule(conn, tenant_id, target.id, checked.result.effective_at, schedule_id)
    return kind


async def cancel_scheduled_change(
    conn: Connection, tenant_id: uuid.UUID, current: Entitlement, gateway: BillingGateway
) -> None:
    if current.schedule_id is None:
        raise PlanChangeError("no_scheduled_change", "There is no plan change waiting.")
    await gateway.release_schedule(schedule_id=current.schedule_id)
    await _set_schedule(conn, tenant_id, None, None, None)


async def set_canceled(
    conn: Connection,
    tenant_id: uuid.UUID,
    current: Entitlement,
    gateway: BillingGateway,
    *,
    cancel: bool,
) -> None:
    """Cancel at the end of the paid period, or resume before it ends."""
    if current.provider != "stripe" or current.subscription_id is None:
        raise PlanChangeError("no_subscription", "There is no paid subscription to change.")
    if current.cancel_at_period_end == cancel:
        return
    if cancel and current.schedule_id:  # canceling supersedes a waiting downgrade
        await gateway.release_schedule(schedule_id=current.schedule_id)
        await _set_schedule(conn, tenant_id, None, None, None)
    await gateway.set_cancel_at_period_end(subscription_id=current.subscription_id, cancel=cancel)
    await conn.execute(
        "update subscriptions set cancel_at_period_end = $2, updated_at = now()"
        " where tenant_id = $1",
        tenant_id,
        cancel,
    )


async def refund(
    conn: Connection, tenant_id: uuid.UUID, current: Entitlement, gateway: BillingGateway
) -> int:
    """Refund every payment since the first in full and end the plan now. Returns cents."""
    if refunds.window_end(current) is None:
        raise PlanChangeError("refund_unavailable", refunds.reason(current))
    assert current.customer_id is not None
    assert current.subscription_id is not None
    assert current.first_paid_at is not None
    amount = await gateway.refund_and_cancel(
        customer_id=current.customer_id,
        subscription_id=current.subscription_id,
        since=current.first_paid_at,
    )
    await conn.execute(
        """
        update subscriptions
        set refunded_at = now(), status = 'canceled', cancel_at_period_end = false,
            updated_at = now()
        where tenant_id = $1
        """,
        tenant_id,
    )
    return amount


async def _blockers(
    conn: Connection, current: Entitlement, target: Plan, kind: proration.Kind
) -> list[str]:
    found = []
    if current.provider != "stripe" or current.subscription_id is None:
        found.append("Plan changes need a paid subscription. Choose a plan to start one.")
    elif current.status not in ("active", "trialing"):
        found.append("Update the payment method in billing before changing plan.")
    if current.cancel_at_period_end:
        found.append("The plan is canceled. Resume it before changing plan.")
    if kind == "downgrade":
        counts = await usage_counts(conn)
        kinds: tuple[Limit, ...] = ("documents", "widgets", "seats")
        for limit_kind in kinds:
            limit, used = plan_limit(target, limit_kind), counts[limit_kind]
            if used > limit:
                found.append(
                    f"{target.name} includes {limit:,} {limit_noun(limit_kind, limit)} and this "
                    f"workspace uses {used:,}. Remove {used - limit:,} first."
                )
    return found


async def _set_schedule(
    conn: Connection,
    tenant_id: uuid.UUID,
    plan_id: str | None,
    at: datetime | None,
    schedule_id: str | None,
) -> None:
    await conn.execute(
        """
        update subscriptions
        set scheduled_plan_id = $2, scheduled_change_at = $3, provider_schedule_id = $4,
            updated_at = now()
        where tenant_id = $1
        """,
        tenant_id,
        plan_id,
        at,
        schedule_id,
    )
