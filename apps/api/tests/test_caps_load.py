"""Phase 7 acceptance check 1: 50 concurrent messages with 10 replies left produce exactly
10 AI replies, and the other 40 get escalate-only responses.

The real agent loop and the real reservation SQL against Postgres, with the
messages sent at the same moment over a pool of real connections. The stand-in
model takes a moment per call, so reservations are held while other turns
check the cap. `docent loadtest caps` runs the same check on a live stack.
"""

import asyncio
import uuid
from collections import Counter
from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio

from docent.agent.loadtest import check_caps
from docent.agent.loop import AgentDeps
from docent.config import Settings
from docent.db.pool import Pool, create_pool
from tests.conftest import ClientFactory, Drain, set_plan, verified_owner
from tests.fakes import FakeChat, FakeEmbedder

# One section for each question in docent.agent.loadtest.QUESTIONS, so every turn
# that gets a reply is a cited answer.
GUIDE = b"""# Lumen Notes help

## Export my notes as a PDF

Open a note and select Export, then PDF. Markdown and HTML work the same way.

## Change the email address on my account

Go to Settings > Account > Email, type the new address, and confirm it.

## Find the invoices for last year

Every invoice, for this year and last year, is under Settings > Billing > Invoices.

## Invite a teammate to my workspace

Owners invite a teammate from Settings > Members > Invite.

## What happens to my data if I cancel

If you cancel, your data is kept for 30 days, then deleted.
"""


class SlowChat(FakeChat):
    """The default stand-in answers, each after a short wait, like a real model call."""

    async def structured(self, messages, schema, *, name, max_tokens):  # type: ignore[no-untyped-def]
        await asyncio.sleep(0.05)
        return await super().structured(messages, schema, name=name, max_tokens=max_tokens)


@pytest_asyncio.fixture
async def busy_pool(settings: Settings) -> AsyncIterator[Pool]:
    """Twenty real connections for fifty turns: they contend for the period row and the pool."""
    pool = await create_pool(settings.database_url, min_size=20, max_size=20)
    yield pool
    await pool.close()


async def taught_workspace(client: httpx.AsyncClient, drain: Drain) -> uuid.UUID:
    await verified_owner(client, drain, "Lumen Notes")
    upload = await client.post("/v1/knowledge/uploads", files={"file": ("help.md", GUIDE)})
    assert upload.status_code == 201, upload.text
    await drain()
    return uuid.UUID((await client.get("/v1/tenant")).json()["id"])


@pytest.mark.parametrize(
    ("plan", "topup"),
    [("trial", 0), ("starter", 5)],
    ids=["plan-cap", "cap-plus-top-up"],
)
async def test_fifty_concurrent_messages_with_ten_replies_left_get_exactly_ten_replies(
    client_factory: ClientFactory,
    drain: Drain,
    settings: Settings,
    embedder: FakeEmbedder,
    admin_pool: Pool,
    busy_pool: Pool,
    plan: str,
    topup: int,
) -> None:
    owner = client_factory()
    tenant_id = await taught_workspace(owner, drain)
    if plan != "trial":
        await set_plan(owner, admin_pool, plan)
    if topup:  # some of the ten come from a top-up pack bought this month
        async with admin_pool.acquire() as conn:
            await conn.execute(
                """
                insert into usage_periods (tenant_id, period_start, period_end, replies_cap,
                                           replies_topup)
                values ($1, date_trunc('month', now())::date,
                        (date_trunc('month', now()) + interval '1 month')::date, 1000, $2)
                """,
                tenant_id,
                topup,
            )
    chat = SlowChat()
    deps = AgentDeps(settings=settings, pool=busy_pool, embedder=embedder, llm=chat)

    result, _ = await check_caps(deps, tenant_id, messages=50, left=10)

    assert result.passed, "\n".join(result.report())
    assert (result.granted, result.at_cap, result.ai_replies) == (10, 40, 10)
    assert result.used_after == result.allowance  # exactly at the cap, never past it
    async with admin_pool.acquire() as conn:
        period = await conn.fetchrow(
            "select replies_used, replies_reserved, replies_cap, replies_topup"
            " from usage_periods where tenant_id = $1",
            tenant_id,
        )
        decisions = await conn.fetch(
            "select decision from messages where tenant_id = $1 and role = 'agent'", tenant_id
        )
        handoffs = await conn.fetch(
            "select reason, count(*) from escalations where tenant_id = $1 group by reason",
            tenant_id,
        )
        billed = await conn.fetchval(
            "select count(*) from usage_events where tenant_id = $1 and kind = 'ai_reply'",
            tenant_id,
        )
    assert period is not None
    assert period["replies_used"] == period["replies_cap"] + period["replies_topup"]
    assert period["replies_reserved"] == 0
    kinds = Counter((d["decision"]["type"], d["decision"]["reason"]) for d in decisions)
    assert kinds == {("answer", None): 10, ("escalate", "cap_reached"): 40}
    assert {r["reason"]: r["count"] for r in handoffs} == {"cap_reached": 40}
    assert billed == 10
    # Past the cap no model is called: the forty handoffs cost nothing.
    assert len(chat.calls) == 10
