"""Customer conversations for the demo, run through the real agent.

Each scenario is a visitor (anonymous, or a signed-in customer of the company)
asking real questions in the widget. Every turn goes through the production
pipeline: triage, search, the model, validation, handoffs with summaries, usage
and cost. Afterwards the conversations are spread over the past four weeks in
working hours, handoffs get realistic progress (most resolved, a few still
open), the months before this one get usage history, and signed-in customers
get their memory written, so the inbox, the memory map, and the billing page
look like a team that has used Docent for a while.
"""

import asyncio
import random
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from docent.agent import repo as agent_repo
from docent.agent.loop import AgentDeps, Reply, run_turn
from docent.billing.plans import PLAN_BY_ID
from docent.db.pool import Pool, transaction
from docent.jobs.queue import Job
from docent.jobs.worker import JobContext
from docent.llm.client import ChatModel
from docent.memory.customers import REMEMBER_CUSTOMER, make_memory_handlers
from docent.seed.catalog import Workspace
from docent.widget import repo as widget_repo
from docent.widget.identity import Identity

Say = Callable[[str], None]


async def wait_for_knowledge(pool: Pool, tenant_ids: list[uuid.UUID], say: Say) -> bool:
    """Wait until the worker has indexed every source. False after 15 minutes."""
    for attempt in range(180):
        busy = 0
        for tenant_id in tenant_ids:
            async with transaction(pool, tenant_id=tenant_id) as conn:
                busy += await conn.fetchval(
                    "select count(*) from knowledge_sources where status in ('queued', 'syncing')"
                )
        if busy == 0:
            return True
        if attempt % 6 == 0:
            say(f"  waiting for the worker to index {busy} sources")
        await asyncio.sleep(5)
    return False


async def run_scenarios(deps: AgentDeps, tenant_id: uuid.UUID, ws: Workspace, say: Say) -> str:
    async with transaction(deps.pool, tenant_id=tenant_id) as conn:
        if await conn.fetchval(
            "select exists(select 1 from conversations where channel = 'widget')"
        ):
            return f"{ws.name}: conversations already seeded"
        widget_id = await conn.fetchval("select id from widgets order by created_at limit 1")
    handoffs = replies = 0
    for index, scenario in enumerate(ws.scenarios):
        customer = ws.customers.get(scenario.customer) if scenario.customer else None
        async with transaction(deps.pool, tenant_id=tenant_id) as conn:
            end_user_id = None
            claims: dict[str, str] = {}
            if customer:
                identity = Identity(
                    external_id=customer.external_id,
                    name=customer.name,
                    email=customer.email,
                    claims=customer.claims,
                    jti=f"seed-{uuid.uuid4().hex}",
                    expires_at=0,
                )
                end_user_id = await widget_repo.upsert_end_user(conn, tenant_id, identity)
                claims = {"name": customer.name, "email": customer.email, **customer.claims}
            conversation_id = await agent_repo.create_conversation(
                conn,
                tenant_id=tenant_id,
                channel="widget",
                mode="identified" if customer else "anonymous",
                claims=claims,
                visitor_id=None if customer else f"seed{ws.slug.replace('-', '')}{index:04d}",
            )
            await conn.execute(
                "update conversations set widget_id = $2, end_user_id = $3 where id = $1",
                conversation_id,
                widget_id,
                end_user_id,
            )
        for text in scenario.turns:
            async for event in run_turn(
                deps, tenant_id=tenant_id, conversation_id=conversation_id, text=text
            ):
                if isinstance(event, Reply):
                    replies += 1
                    kind = event.message["decision"]["type"]
                    handoffs += kind == "escalate"
                    say(f"  {ws.name}: {text[:60]!r} -> {kind}")
    return f"{ws.name}: {len(ws.scenarios)} conversations, {replies} replies, {handoffs} handoffs"


async def spread_over_past_month(pool: Pool, tenant_id: uuid.UUID, ws: Workspace) -> None:
    """Move each conversation to a working hour in the past four weeks, keeping its pace."""
    rnd = random.Random(f"{ws.slug}-time")  # noqa: S311 - demo data, not security
    now = datetime.now(UTC)
    async with transaction(pool, tenant_id=tenant_id) as conn:
        rows = await conn.fetch(
            "select id, started_at from conversations where channel = 'widget' order by started_at"
        )
        total = len(rows)
        for position, row in enumerate(rows):
            days_ago = max(0, round((total - position) * 27 / max(total, 1)) - rnd.randint(0, 1))
            day = now - timedelta(days=days_ago)
            start = day.replace(hour=rnd.randint(8, 18), minute=rnd.randint(0, 59), second=0)
            if start > now - timedelta(minutes=30):
                start = now - timedelta(minutes=rnd.randint(30, 90))
            delta = start - row["started_at"]
            await conn.execute(
                """
                update conversations set started_at = started_at + $2,
                       last_message_at = last_message_at + $2 where id = $1
                """,
                row["id"],
                delta,
            )
            for table in ("messages", "escalations"):
                await conn.execute(
                    f"update {table} set created_at = created_at + $2"  # noqa: S608
                    " where conversation_id = $1",
                    row["id"],
                    delta,
                )


async def progress_handoffs(pool: Pool, tenant_id: uuid.UUID, ws: Workspace) -> None:
    """Older handoffs are resolved by the team, newer ones are still being worked on."""
    rnd = random.Random(f"{ws.slug}-handoffs")  # noqa: S311 - demo data, not security
    now = datetime.now(UTC)
    async with transaction(pool, tenant_id=tenant_id) as conn:
        team = [
            r["user_id"]
            for r in await conn.fetch(
                "select user_id from memberships where role in ('agent', 'admin') order by role"
            )
        ]
        rows = await conn.fetch(
            """
            select e.id, e.created_at, e.contact_email, c.mode from escalations e
            join conversations c on c.id = e.conversation_id order by e.created_at
            """
        )
        for position, row in enumerate(rows):
            share = position / max(len(rows) - 1, 1)
            status = (
                "resolved"
                if share < 0.6
                else "assigned"
                if share < 0.8
                else "waiting"
                if share < 0.9
                else "open"
            )
            first_response = row["created_at"] + timedelta(minutes=rnd.randint(18, 300))
            resolved = first_response + timedelta(hours=rnd.randint(2, 40))
            contact = row["contact_email"]
            if row["mode"] == "anonymous" and contact is None and status != "open":
                contact = f"docent-visitor{position + 1}.{ws.slug}@mailinator.com"
            await conn.execute(
                """
                update escalations
                set status = $2, assignee_user_id = $3, contact_email = $4,
                    first_response_at = $5, resolved_at = $6
                where id = $1
                """,
                row["id"],
                status,
                team[position % len(team)] if team and status != "open" else None,
                contact,
                min(first_response, now) if status != "open" else None,
                min(resolved, now) if status == "resolved" else None,
            )
        await conn.execute(
            """
            update conversations c set status = 'closed', closed_at = e.resolved_at
            from escalations e
            where e.conversation_id = c.id and e.status = 'resolved'
            """
        )


async def usage_history(pool: Pool, tenant_id: uuid.UUID, ws: Workspace) -> None:
    """Three earlier months of replies and cost, and this month brought up to its figure."""
    if not ws.replies_history:
        return
    cap = PLAN_BY_ID[ws.plan.plan_id].replies_per_month
    async with transaction(pool, tenant_id=tenant_id) as conn:
        for months_ago, used in zip((3, 2, 1), ws.replies_history, strict=True):
            await conn.execute(
                """
                insert into usage_periods (tenant_id, period_start, period_end, replies_cap,
                                           replies_used, cost_micros, notified_80_at)
                values ($1, (date_trunc('month', now()) - make_interval(months => $2))::date,
                        (date_trunc('month', now()) - make_interval(months => $2 - 1))::date,
                        $3, $4, $4 * 650, case when $4 * 5 >= $3 * 4 then now() end)
                on conflict (tenant_id, period_start) do nothing
                """,
                tenant_id,
                months_ago,
                cap,
                used,
            )
        await conn.execute(
            """
            insert into usage_periods (tenant_id, period_start, period_end, replies_cap)
            values ($1, date_trunc('month', now())::date,
                    (date_trunc('month', now()) + interval '1 month')::date, $2)
            on conflict (tenant_id, period_start) do nothing
            """,
            tenant_id,
            cap,
        )
        await conn.execute(
            """
            update usage_periods
            set replies_used = greatest(replies_used, $1),
                cost_micros = greatest(cost_micros, $1 * 650),
                notified_80_at = case when greatest(replies_used, $1) * 5 >= replies_cap * 4
                                      then coalesce(notified_80_at, now()) end
            where period_start = date_trunc('month', now())::date
            """,
            ws.replies_this_month,
        )


async def remember_customers(worker_pool: Pool, llm: ChatModel, tenant_id: uuid.UUID) -> int:
    """Write customer memory now instead of waiting for the quiet period. Once per tenant."""
    handler = make_memory_handlers(llm)[REMEMBER_CUSTOMER]
    async with transaction(worker_pool, tenant_id=tenant_id) as conn:
        existing: int = await conn.fetchval("select count(*) from customer_memories")
        if existing:
            return existing
        rows = await conn.fetch(
            "select id from conversations where end_user_id is not null order by started_at"
        )
        await conn.execute(
            "delete from jobs where kind = $1 and tenant_id = $2 and status = 'queued'",
            REMEMBER_CUSTOMER,
            tenant_id,
        )
    for row in rows:
        job = Job(
            id=0,
            tenant_id=tenant_id,
            kind=REMEMBER_CUSTOMER,
            payload={"conversation_id": str(row["id"])},
            attempts=1,
            max_attempts=1,
        )
        await handler(JobContext(job=job, pool=worker_pool))
    async with transaction(worker_pool, tenant_id=tenant_id) as conn:
        facts: int = await conn.fetchval("select count(*) from customer_memories")
    return facts


async def wait_for_summaries(worker_pool: Pool, say: Say) -> None:
    """The Docker worker writes handoff summaries; give it a few minutes to catch up."""
    for attempt in range(60):
        async with worker_pool.acquire() as conn:
            pending = await conn.fetchval(
                "select count(*) from jobs where kind = 'summarize_escalation'"
                " and status in ('queued', 'running')"
            )
        if pending == 0:
            return
        if attempt % 6 == 0:
            say(f"  waiting for {pending} handoff summaries from the worker")
        await asyncio.sleep(5)
