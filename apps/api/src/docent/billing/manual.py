"""Plans Docent changes by hand from the platform admin console: longer trials and comps.

A comp is a paid plan given free of charge until a date. It stays on provider
'manual', so no Stripe customer, invoice, or webhook is involved, and it ends
by itself when comped_until passes (subscriptions.py). None of this ever
touches a workspace that pays through Stripe: Stripe owns that subscription,
and a change made only here would be undone by its next webhook, or would
give away a plan the customer is being charged for.
"""

import uuid
from datetime import UTC, datetime, timedelta

from docent.billing.changes import PlanChangeError
from docent.billing.plans import Plan
from docent.billing.subscriptions import Entitlement
from docent.db.pool import Connection

MAX_TRIAL_EXTENSION_DAYS = 30
MAX_COMP = timedelta(days=366)

STRIPE_MANAGED = (
    "This workspace pays through Stripe, so its plan changes only through Stripe: the "
    "owner changes it on their billing page, or you change the subscription in the Stripe "
    "dashboard. Trial extensions and comps are for workspaces that do not pay through Stripe."
)


def refusal(current: Entitlement) -> str | None:
    """Why no manual change may touch this workspace, or None when one may."""
    return STRIPE_MANAGED if current.provider == "stripe" else None


def is_comped(current: Entitlement) -> bool:
    """A paid plan with no Stripe subscription behind it. The demo seed's plans count too."""
    return (
        current.provider == "manual" and current.status == "active" and current.plan.id != "trial"
    )


async def extend_trial(
    conn: Connection, tenant_id: uuid.UUID, current: Entitlement, days: int
) -> datetime:
    """Add days to the trial. A trial that already ended restarts from now. Returns the new end."""
    _check_manual(current)
    if current.status != "trialing":
        raise PlanChangeError(
            "not_on_trial",
            "This workspace is not on a trial, so there is no trial to extend. Give it a "
            "comped plan instead.",
        )
    if not 1 <= days <= MAX_TRIAL_EXTENSION_DAYS:
        raise PlanChangeError(
            "invalid_days", f"Extend a trial by 1 to {MAX_TRIAL_EXTENSION_DAYS} days."
        )
    ends: datetime = await conn.fetchval(
        """
        update subscriptions
        set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + $2::interval,
            updated_at = now()
        where tenant_id = $1
        returning trial_ends_at
        """,
        tenant_id,
        timedelta(days=days),
    )
    return ends


async def give_comp(
    conn: Connection, tenant_id: uuid.UUID, current: Entitlement, plan: Plan, until: datetime
) -> None:
    """Put the workspace on a paid plan, free of charge, until a time in the future."""
    _check_manual(current)
    if plan.price_usd_month <= 0:
        raise PlanChangeError("invalid_plan", "Choose a paid plan to give.")
    now = datetime.now(UTC)
    if until <= now:
        raise PlanChangeError("invalid_until", "Choose an end date after today.")
    if until > now + MAX_COMP:
        raise PlanChangeError("invalid_until", "A comp can last a year at most.")
    await conn.execute(
        """
        update subscriptions
        set plan_id = $2, status = 'active', comped_until = $3, past_due_since = null,
            cancel_at = null, cancel_at_period_end = false, scheduled_plan_id = null,
            scheduled_change_at = null, provider_schedule_id = null, updated_at = now()
        where tenant_id = $1
        """,
        tenant_id,
        plan.id,
        until,
    )


async def end_comp(conn: Connection, tenant_id: uuid.UUID, current: Entitlement) -> None:
    """End a comped plan now. The workspace hands every message to its team until it pays."""
    _check_manual(current)
    if not is_comped(current):
        raise PlanChangeError("no_comp", "This workspace has no comped plan to end.")
    await conn.execute(
        """
        update subscriptions
        set status = 'canceled', comped_until = null, cancel_at = now(), updated_at = now()
        where tenant_id = $1
        """,
        tenant_id,
    )


def _check_manual(current: Entitlement) -> None:
    if (reason := refusal(current)) is not None:
        raise PlanChangeError("stripe_managed", reason)
