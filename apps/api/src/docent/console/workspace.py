"""One workspace as the console sees it: plan, usage, people, widgets, and counts.

Run inside the workspace's own tenant context with the app.platform_admin
capability as well (the median for the anomaly flag spans every workspace).
Conversations, handoffs, and knowledge are counted, never read.
"""

import uuid
from dataclasses import dataclass

import asyncpg

from docent.console.figures import STATE_SQL
from docent.db.pool import Connection

USAGE_MONTHS = 6
RECENT_BILLING_EVENTS = 10
RECENT_AUDIT = 20


@dataclass(frozen=True, slots=True)
class Workspace:
    tenant: asyncpg.Record
    usage: list[asyncpg.Record]
    members: list[asyncpg.Record]
    widgets: list[asyncpg.Record]
    counts: asyncpg.Record
    billing_events: list[asyncpg.Record]
    audit: list[asyncpg.Record]


async def find(conn: Connection, tenant_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        f"""
        select t.id, t.name, t.slug, t.status, t.created_at, {STATE_SQL} as state
        from tenants t left join subscriptions s on s.tenant_id = t.id
        where t.id = $1
        """,  # noqa: S608
        tenant_id,
    )


async def load(conn: Connection, tenant: asyncpg.Record) -> Workspace:
    tenant_id: uuid.UUID = tenant["id"]
    usage = await conn.fetch(
        """
        with months as (
          select (date_trunc('month', now()) - make_interval(months => n))::date as month
          from generate_series(0, $2 - 1) as n
        ),
        events as (
          select date_trunc('month', occurred_at)::date as month,
                 sum(cost_micros)::bigint as cost_micros,
                 sum(tokens_in)::bigint as tokens_in, sum(tokens_out)::bigint as tokens_out
          from usage_events
          where tenant_id = $1
            and occurred_at >= date_trunc('month', now()) - make_interval(months => $2 - 1)
          group by 1
        )
        select m.month, coalesce(up.replies_used, 0) as replies_used, up.replies_cap,
               coalesce(e.cost_micros, 0) as cost_micros, coalesce(e.tokens_in, 0) as tokens_in,
               coalesce(e.tokens_out, 0) as tokens_out
        from months m
        left join usage_periods up on up.tenant_id = $1 and up.period_start = m.month
        left join events e on e.month = m.month
        order by m.month
        """,
        tenant_id,
        USAGE_MONTHS,
    )
    members = await conn.fetch(
        """
        select ms.user_id, u.name, u.email, ms.role, ms.created_at as joined_at,
               u.email_verified_at is not null as email_verified,
               greatest(u.last_login_at,
                        (select max(us.last_seen_at) from user_sessions us
                         where us.user_id = u.id)) as last_active_at
        from memberships ms join users u on u.id = ms.user_id
        where ms.tenant_id = $1
        order by case ms.role when 'owner' then 0 when 'admin' then 1 else 2 end, u.name
        """,
        tenant_id,
    )
    widgets = await conn.fetch(
        """
        select id, public_id, name, anonymous_enabled,
               cardinality(allowed_origins) as allowed_origins, created_at
        from widgets where tenant_id = $1 order by created_at
        """,
        tenant_id,
    )
    counts = await conn.fetchrow(
        """
        select
          (select count(*) from knowledge_sources
           where tenant_id = $1 and kind <> 'answer') as sources,
          (select count(*) from knowledge_sources
           where tenant_id = $1 and kind <> 'answer' and status = 'failed') as failed_sources,
          (select count(*) from knowledge_sources
           where tenant_id = $1 and kind = 'answer') as team_answers,
          (select count(*) from documents where tenant_id = $1) as documents,
          (select coalesce(sum(chunk_count), 0) from knowledge_sources
           where tenant_id = $1)::bigint as passages,
          (select count(*) from conversations
           where tenant_id = $1 and started_at >= date_trunc('month', now())) as conversations,
          (select count(*) from conversations
           where tenant_id = $1 and channel = 'widget'
             and started_at >= date_trunc('month', now())) as widget_conversations,
          (select count(*) from escalations
           where tenant_id = $1 and created_at >= date_trunc('month', now())) as handoffs,
          (select count(*) from escalations
           where tenant_id = $1 and status <> 'resolved') as open_handoffs
        """,
        tenant_id,
    )
    assert counts is not None
    billing_events = await conn.fetch(
        """
        select e.id, e.type, e.outcome, e.tenant_id, e.created_at, e.received_at
        from billing_events e where e.tenant_id = $1
        order by e.received_at desc, e.id desc limit $2
        """,
        tenant_id,
        RECENT_BILLING_EVENTS,
    )
    audit = await conn.fetch(
        """
        select a.id, a.action, u.name as actor_name, u.email as actor_email, a.target_type,
               a.target_id, a.metadata, a.created_at
        from audit_log a left join users u on u.id = a.actor_user_id
        where a.tenant_id = $1
        order by a.created_at desc, a.id desc limit $2
        """,
        tenant_id,
        RECENT_AUDIT,
    )
    return Workspace(tenant, usage, members, widgets, counts, billing_events, audit)
