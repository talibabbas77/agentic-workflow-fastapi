"""What a tenant's plan allows right now.

Every tenant has one subscriptions row: a 14 day trial at first, a Stripe
subscription after checkout. Our database owns entitlements and caps; Stripe
owns payment status and tells us through webhooks.

Access:
  trial (no payment yet)  until trial_ends_at
  trialing, active        yes
  past_due                for a 7 day grace period, then off
  anything else           off
Off means escalate-only mode: every message becomes a handoff. Data is kept.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

import asyncpg

from docent.billing.plans import PLAN_BY_ID, TRIAL, Plan
from docent.db.pool import Connection

GRACE = timedelta(days=7)

type Limit = Literal["widgets", "seats", "documents"]


@dataclass(frozen=True, slots=True)
class Entitlement:
    plan: Plan
    status: str
    provider: str
    active: bool
    trial_ends_at: datetime | None
    current_period_end: datetime | None
    cancel_at: datetime | None
    grace_ends_at: datetime | None
    customer_id: str | None
    subscription_id: str | None


async def start_trial(conn: Connection, tenant_id: uuid.UUID) -> None:
    await conn.execute(
        """
        insert into subscriptions (tenant_id, plan_id, status, trial_ends_at)
        values ($1, $2, 'trialing', now() + $3::interval)
        """,
        tenant_id,
        TRIAL.id,
        timedelta(days=TRIAL.trial_days or 14),
    )


async def entitlement(conn: Connection, tenant_id: uuid.UUID) -> Entitlement:
    row = await conn.fetchrow("select * from subscriptions where tenant_id = $1", tenant_id)
    if row is None:  # every tenant gets a row at creation; this is a broken invariant
        raise RuntimeError(f"tenant {tenant_id} has no subscription")
    return _entitlement(row, datetime.now(UTC))


def _entitlement(row: asyncpg.Record, now: datetime) -> Entitlement:
    status = row["status"]
    grace_ends_at = row["past_due_since"] + GRACE if row["past_due_since"] else None
    if row["provider"] == "manual" and status == "trialing":
        active = row["trial_ends_at"] is None or now < row["trial_ends_at"]
    elif status in ("trialing", "active"):
        active = True
    elif status == "past_due":
        active = grace_ends_at is None or now < grace_ends_at
    else:
        active = False
    return Entitlement(
        plan=PLAN_BY_ID.get(row["plan_id"], TRIAL),
        status=status,
        provider=row["provider"],
        active=active,
        trial_ends_at=row["trial_ends_at"],
        current_period_end=row["current_period_end"],
        cancel_at=row["cancel_at"],
        grace_ends_at=grace_ends_at,
        customer_id=row["provider_customer_id"],
        subscription_id=row["provider_subscription_id"],
    )


async def reply_cap(conn: Connection, tenant_id: uuid.UUID) -> int:
    current = await entitlement(conn, tenant_id)
    return current.plan.replies_per_month if current.active else 0


async def usage_counts(conn: Connection, *, reinvite: str | None = None) -> dict[Limit, int]:
    """Current counts for the tenant in context. Open invitations hold a seat, except
    the one a re-invite to the same email would replace."""
    row = await conn.fetchrow(
        """
        select
          (select count(*) from widgets) as widgets,
          (select count(*) from memberships)
            + (select count(*) from invitations
               where accepted_at is null and revoked_at is null and expires_at > now()
                 and lower(email) is distinct from lower($1)) as seats,
          (select count(*) from documents) as documents
        """,
        reinvite,
    )
    assert row is not None
    return {"widgets": row["widgets"], "seats": row["seats"], "documents": row["documents"]}


def plan_limit(plan: Plan, kind: Limit) -> int:
    return {"widgets": plan.widgets, "seats": plan.seats, "documents": plan.pages}[kind]
