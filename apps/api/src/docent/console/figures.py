"""This month's figures per workspace, and the overview built from them.

Replies are the billed count the cap enforces (usage_periods), which is one per
ai_reply usage event. Cost is the usage_events ledger. Revenue is the plan's
monthly price for a workspace that pays through Stripe (an active
subscription); trials and comps bring in nothing. Margin is revenue less model
cost. A workspace whose cost per reply this month is more than 3 times the
median, across every workspace with replies this month, is flagged as an
anomaly (ARCHITECTURE section 10: prompt abuse or a runaway loop). While the
median is zero, nothing is flagged.

Every query here needs the app.platform_admin capability. Money is in micro
dollars, 1 USD = 1,000,000, like usage_events.cost_micros.
"""

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Literal

import asyncpg

from docent.billing.plans import PLAN_BY_ID, PLANS, TRIAL
from docent.billing.subscriptions import Entitlement
from docent.db.pool import Connection

MICROS_PER_USD = 1_000_000
ANOMALY_FACTOR = 3
PER_PAGE = 25

type Sort = Literal["newest", "name", "cost", "margin"]

# Where a workspace stands, in one word, worked out in SQL so lists can filter on it.
# It agrees with subscriptions.Entitlement: trial_ended, comp_ended, and canceled never
# answer, and past_due answers only during its grace period.
STATE_SQL = """
case
  when s.status is null then 'other'
  when s.status in ('past_due', 'unpaid') then 'past_due'
  when s.status in ('canceled', 'incomplete_expired') then 'canceled'
  when s.status in ('incomplete', 'paused') then 'other'
  when s.provider = 'manual' and s.status = 'trialing' then
    case when s.trial_ends_at is null or s.trial_ends_at > now() then 'trial'
         else 'trial_ended' end
  when s.provider = 'manual' and s.status = 'active' then
    case when s.comped_until is null or s.comped_until > now() then 'comped'
         else 'comp_ended' end
  when s.status = 'active' then 'paying'
  when s.status = 'trialing' then 'trial'
  else 'other'
end
"""

# $1 and $2 are the plan catalog (ids and monthly prices), from price_params().
# Built from constants only, like every query in this module.
FIGURES_SQL = f"""
with prices (plan_id, price_micros) as (
  select * from unnest($1::text[], $2::bigint[])
),
month_cost as (
  select tenant_id, sum(cost_micros)::bigint as cost_micros
  from usage_events
  where occurred_at >= date_trunc('month', now())
  group by tenant_id
),
figures as (
  select t.id, t.name, t.slug, t.created_at, s.plan_id, s.provider, {STATE_SQL} as state,
         coalesce(up.replies_used, 0)::bigint as replies_used,
         coalesce(mc.cost_micros, 0)::bigint as cost_micros
  from tenants t
  left join subscriptions s on s.tenant_id = t.id
  left join usage_periods up
    on up.tenant_id = t.id and up.period_start = date_trunc('month', now())::date
  left join month_cost mc on mc.tenant_id = t.id
),
money as (
  select f.*,
         case when f.state = 'paying' then coalesce(p.price_micros, 0) else 0 end
           as revenue_micros
  from figures f left join prices p on p.plan_id = f.plan_id
),
median as (
  select percentile_cont(0.5) within group (order by cost_micros::float8 / replies_used)
           as value
  from figures where replies_used > 0
)
"""  # noqa: S608

_SORTS: dict[Sort, str] = {
    "newest": "m.created_at desc, m.id",
    "name": "lower(m.name), m.id",
    "cost": "m.cost_micros desc, m.created_at desc",
    "margin": "m.revenue_micros - m.cost_micros, m.created_at desc",
}

# $3 search text (lowercase), $4 plan id, $5 state; each null for no filter.
_FILTER = """
where ($3::text is null
       or strpos(lower(m.name), $3) > 0 or strpos(m.slug, $3) > 0 or m.id::text = $3
       or exists (select 1 from memberships ms join users u on u.id = ms.user_id
                  where ms.tenant_id = m.id and strpos(lower(u.email), $3) > 0))
  and ($4::text is null or m.plan_id = $4)
  and ($5::text is null or m.state = $5)
"""


@dataclass(frozen=True, slots=True)
class Figures:
    replies_used: int
    replies_cap: int
    cost_micros: int
    revenue_micros: int
    margin_micros: int
    cost_per_reply_micros: float | None
    anomaly: bool


@dataclass(frozen=True, slots=True)
class Overview:
    period_start: date
    workspaces: int
    by_plan_state: list[asyncpg.Record]
    paying_workspaces: int
    mrr_micros: int
    new_workspaces_30d: int
    new_accounts_30d: int
    replies_this_month: int
    cost_this_month_micros: int
    gross_margin: float | None
    median_cost_per_reply_micros: float | None
    anomalies: list[asyncpg.Record]


def price_params() -> tuple[list[str], list[int]]:
    return [plan.id for plan in PLANS], [plan.price_usd_month * MICROS_PER_USD for plan in PLANS]


def is_anomaly(cost_per_reply: float | None, median: float | None) -> bool:
    return (
        cost_per_reply is not None
        and median is not None
        and median > 0
        and cost_per_reply > ANOMALY_FACTOR * median
    )


def figures(row: asyncpg.Record, current: Entitlement | None, median: float | None) -> Figures:
    """One workspace's figures from a FIGURES_SQL `money` row and its entitlement."""
    replies, cost, revenue = row["replies_used"], row["cost_micros"], row["revenue_micros"]
    per_reply = cost / replies if replies else None
    plan = current.plan if current else PLAN_BY_ID.get(row["plan_id"] or "", TRIAL)
    return Figures(
        replies_used=replies,
        replies_cap=plan.replies_per_month if current and current.active else 0,
        cost_micros=cost,
        revenue_micros=revenue,
        margin_micros=revenue - cost,
        cost_per_reply_micros=per_reply,
        anomaly=is_anomaly(per_reply, median),
    )


async def median_cost_per_reply(conn: Connection) -> float | None:
    value: float | None = await conn.fetchval(
        f"{FIGURES_SQL} select value from median",  # noqa: S608
        *price_params(),
    )
    return value


async def overview(conn: Connection) -> Overview:
    params = price_params()
    totals = await conn.fetchrow(
        f"""
        {FIGURES_SQL}
        select
          date_trunc('month', now())::date as period_start,
          (select count(*) from money) as workspaces,
          (select count(*) from money where state = 'paying') as paying,
          (select coalesce(sum(revenue_micros), 0) from money)::bigint as mrr,
          (select count(*) from money where created_at > now() - interval '30 days')
            as new_workspaces,
          (select count(*) from users where created_at > now() - interval '30 days')
            as new_accounts,
          (select coalesce(sum(replies_used), 0) from money)::bigint as replies,
          (select coalesce(sum(cost_micros), 0) from money)::bigint as cost,
          (select value from median) as median
        """,  # noqa: S608
        *params,
    )
    assert totals is not None
    by_plan_state = await conn.fetch(
        f"""
        {FIGURES_SQL}
        select coalesce(plan_id, 'trial') as plan_id, state, count(*) as count
        from money group by 1, 2 order by 1, 2
        """,  # noqa: S608
        *params,
    )
    median: float | None = totals["median"]
    anomalies = await conn.fetch(
        f"""
        {FIGURES_SQL}
        select m.id, m.name, m.plan_id, m.replies_used, m.cost_micros,
               m.cost_micros::float8 / m.replies_used as cost_per_reply
        from money m, median
        where m.replies_used > 0 and median.value > 0
          and m.cost_micros::float8 / m.replies_used > $3::float8 * median.value
        order by cost_per_reply desc
        """,  # noqa: S608
        *params,
        ANOMALY_FACTOR,
    )
    mrr, cost = totals["mrr"], totals["cost"]
    return Overview(
        period_start=totals["period_start"],
        workspaces=totals["workspaces"],
        by_plan_state=by_plan_state,
        paying_workspaces=totals["paying"],
        mrr_micros=mrr,
        new_workspaces_30d=totals["new_workspaces"],
        new_accounts_30d=totals["new_accounts"],
        replies_this_month=totals["replies"],
        cost_this_month_micros=cost,
        gross_margin=(mrr - cost) / mrr if mrr > 0 else None,
        median_cost_per_reply_micros=median,
        anomalies=anomalies,
    )


async def list_workspaces(
    conn: Connection,
    *,
    search: str | None,
    plan_id: str | None,
    state: str | None,
    sort: Sort,
    page: int,
) -> tuple[list[asyncpg.Record], int]:
    """One page of workspaces with this month's money figures, and how many match in all."""
    text = (search or "").strip().lower() or None
    args = (*price_params(), text, plan_id, state)
    rows = await conn.fetch(
        f"""
        {FIGURES_SQL}
        select m.*, (select count(*) from memberships ms where ms.tenant_id = m.id) as members
        from money m
        {_FILTER}
        order by {_SORTS[sort]}
        limit $6 offset $7
        """,  # noqa: S608
        *args,
        PER_PAGE,
        (page - 1) * PER_PAGE,
    )
    total: int = await conn.fetchval(
        f"{FIGURES_SQL} select count(*) from money m {_FILTER}",  # noqa: S608
        *args,
    )
    return rows, total


async def workspace_figures(conn: Connection, tenant_id: uuid.UUID) -> asyncpg.Record | None:
    """The `money` row for one workspace, with the median across all of them."""
    return await conn.fetchrow(
        f"""
        {FIGURES_SQL}
        select m.*, (select value from median) as median from money m where m.id = $3
        """,  # noqa: S608
        *price_params(),
        tenant_id,
    )
