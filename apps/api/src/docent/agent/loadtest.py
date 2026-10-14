"""Load test for the hard cap (Phase 7 acceptance check 1).

Leave a few replies in a workspace's monthly allowance, send many messages at
once through the real agent loop (run_turn, with the reservation in usage.py),
and count: exactly as many turns as there were replies left get one, and every
other turn is handed to the team as an escalate-only response, without a model
call. The API suite runs it with stand-in models; `docent loadtest caps` runs
it against a live database and the configured models:

    docent loadtest caps                    a new scratch workspace, 50 messages, 10 left
    docent loadtest caps --workspace SLUG   an existing workspace; its usage is put back after
    docent loadtest caps --keep-at-cap      leave the workspace at its cap, to try the widget

Each turn past the cap opens a handoff, as it would for a real visitor, so the
worker writes a summary for each one. Use a workspace made for testing.
"""

import asyncio
import secrets
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx

from docent.agent import repo
from docent.agent.loop import AgentDeps, Reply, run_turn
from docent.billing import subscriptions
from docent.config import Settings
from docent.db.pool import Pool, create_pool, transaction
from docent.knowledge.embeddings import OllamaEmbedder
from docent.llm.client import chat_model
from docent.security.passwords import hash_password
from docent.services import accounts, tenants

# Synthetic questions only: a load test never sends real customer data to a model.
QUESTIONS = (
    "How do I export my notes as a PDF?",
    "Can I change the email address on my account?",
    "Where do I find the invoices for last year?",
    "How do I invite a teammate to my workspace?",
    "What happens to my data if I cancel?",
)


@dataclass(frozen=True, slots=True)
class CapCheck:
    messages: int
    left: int
    granted: int  # turns that reserved a reply before writing
    at_cap: int  # turns handed to the team because the allowance was used up
    ai_replies: int  # ai_reply usage events the run wrote: what the workspace is billed
    start_used: int  # replies_used once the test left `left` replies
    used_after: int
    reserved_after: int
    allowance: int  # the plan's cap plus this month's top-ups
    seconds: float

    @property
    def expected(self) -> int:
        return min(self.left, self.messages)

    @property
    def passed(self) -> bool:
        return (
            self.granted == self.expected
            and self.at_cap == self.messages - self.expected
            and self.ai_replies <= self.granted
            and self.used_after == self.start_used + self.ai_replies
            and self.used_after <= self.allowance
            and self.reserved_after == 0
        )

    def report(self) -> list[str]:
        given_back = self.granted - self.ai_replies
        return [
            f"{self.messages} messages at once with {self.left} replies left "
            f"({self.allowance:,} this month), in {self.seconds:.1f} s.",
            f"Reserved a reply: {self.granted} (expected {self.expected}).",
            f"Handed to the team at the cap: {self.at_cap} "
            f"(expected {self.messages - self.expected}).",
            f"AI replies billed: {self.ai_replies}"
            + (f", {given_back} given back as small talk" if given_back else "")
            + ".",
            f"Replies used: {self.start_used:,} before, {self.used_after:,} after, "
            f"{self.reserved_after} still reserved.",
            "PASS: the cap held." if self.passed else "FAIL: the cap did not hold.",
        ]


async def fire(
    deps: AgentDeps, tenant_id: uuid.UUID, conversations: list[uuid.UUID]
) -> list[Reply]:
    """Send one message to every conversation at the same time; return each final reply."""

    async def one(conversation_id: uuid.UUID, text: str) -> Reply:
        final: Reply | None = None
        async for event in run_turn(
            deps, tenant_id=tenant_id, conversation_id=conversation_id, text=text
        ):
            if isinstance(event, Reply):
                final = event
        assert final is not None
        return final

    return await asyncio.gather(
        *(one(c, QUESTIONS[i % len(QUESTIONS)]) for i, c in enumerate(conversations))
    )


async def check_caps(
    deps: AgentDeps, tenant_id: uuid.UUID, *, messages: int, left: int
) -> tuple[CapCheck, int]:
    """Leave `left` replies this month, send `messages` at once, and count what happened.

    Returns the result and replies_used as it was before the test changed it.
    """
    async with transaction(deps.pool, tenant_id=tenant_id) as conn:
        cap = await subscriptions.reply_cap(conn, tenant_id)
        if cap <= 0:
            raise ValueError("The workspace's plan is not on, so it has no replies to test.")
        row = await conn.fetchrow(
            """
            insert into usage_periods (tenant_id, period_start, period_end, replies_cap)
            values ($1, date_trunc('month', now())::date,
                    (date_trunc('month', now()) + interval '1 month')::date, $2)
            on conflict (tenant_id, period_start) do update set replies_cap = excluded.replies_cap
            returning replies_used, replies_cap + replies_topup as allowance
            """,
            tenant_id,
            cap,
        )
        assert row is not None
        original, allowance = int(row["replies_used"]), int(row["allowance"])
        if left > allowance:
            raise ValueError(f"The workspace allows {allowance:,} replies a month, under {left}.")
        await conn.execute(
            """
            update usage_periods set replies_used = $2, replies_reserved = 0
            where tenant_id = $1 and period_start = date_trunc('month', now())::date
            """,
            tenant_id,
            allowance - left,
        )
        conversations = [
            await repo.create_conversation(
                conn, tenant_id=tenant_id, channel="preview", mode="anonymous", claims={}
            )
            for _ in range(messages)
        ]

    started = time.perf_counter()
    replies = await fire(deps, tenant_id, conversations)
    seconds = time.perf_counter() - started

    at_cap = sum(1 for r in replies if r.message["decision"]["reason"] == "cap_reached")
    async with transaction(deps.pool, tenant_id=tenant_id) as conn:
        billed = await conn.fetchval(
            """
            select count(*) from usage_events
            where kind = 'ai_reply' and conversation_id = any($1::uuid[])
            """,
            conversations,
        )
        after = await conn.fetchrow(
            """
            select replies_used, replies_reserved from usage_periods
            where period_start = date_trunc('month', now())::date
            """
        )
    assert after is not None
    result = CapCheck(
        messages=messages,
        left=left,
        granted=messages - at_cap,
        at_cap=at_cap,
        ai_replies=int(billed),
        start_used=allowance - left,
        used_after=int(after["replies_used"]),
        reserved_after=int(after["replies_reserved"]),
        allowance=allowance,
        seconds=seconds,
    )
    return result, original


async def run(
    settings: Settings,
    *,
    workspace: str | None,
    messages: int,
    left: int,
    keep_at_cap: bool,
    say: Callable[[str], None],
) -> bool:
    """`docent loadtest caps`: the check against the configured database and models."""
    pool = await create_pool(settings.database_url, min_size=1, max_size=min(messages, 20))
    try:
        async with httpx.AsyncClient() as http:
            tenant_id, name = await _workspace(pool, workspace)
            say(f"Workspace: {name}. Model: {settings.llm_model}.")
            deps = AgentDeps(
                settings=settings,
                pool=pool,
                embedder=OllamaEmbedder(
                    http,
                    settings.ollama_base_url,
                    settings.embedding_model,
                    settings.embedding_dims,
                    timeout=settings.embedding_timeout_seconds,
                ),
                llm=chat_model(settings, http, settings.llm_model),
            )
            try:
                result, original = await check_caps(deps, tenant_id, messages=messages, left=left)
            except ValueError as exc:
                raise SystemExit(str(exc)) from None
            for line in result.report():
                say(line)
            if keep_at_cap:
                say(f"{name} stays at its cap: every message is a handoff until the month ends.")
            else:
                # Undo only the jump the test made; the replies it wrote stay counted.
                restored = original + result.ai_replies
                async with transaction(pool, tenant_id=tenant_id) as conn:
                    await conn.execute(
                        """
                        update usage_periods set replies_used = $1
                        where period_start = date_trunc('month', now())::date
                        """,
                        restored,
                    )
                say(f"Replies used put back to {restored:,} (before the test, plus its replies).")
            return result.passed
    finally:
        await pool.close()


async def _workspace(pool: Pool, slug: str | None) -> tuple[uuid.UUID, str]:
    """The workspace with this slug, or a new scratch workspace on a trial."""
    if slug:
        async with transaction(pool, platform_admin=True) as conn:
            row = await conn.fetchrow("select id, name from tenants where slug = $1", slug)
        if row is None:
            raise SystemExit(f"No workspace has the slug {slug}.")
        return row["id"], row["name"]
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
    name = f"Cap load test {stamp}"
    async with transaction(pool) as conn:
        user_id = await accounts.create_user(
            conn,
            email=f"cap-load-{secrets.token_hex(6)}@docent.invalid",
            name="Cap load test",
            password_hash=await hash_password(secrets.token_urlsafe(24)),
        )
        tenant_id = await tenants.create_tenant(conn, name=name, owner_id=user_id)
    return tenant_id, name
