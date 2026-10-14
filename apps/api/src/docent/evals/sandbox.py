"""Run one agent turn for an eval without keeping anything it writes.

An eval case goes through the real turn (docent.agent.loop.run_turn): guards,
retrieval, the evidence gate, triage, the answer model, and validation, the same
code a visitor's message runs through. Its side effects must not happen, so the
turn runs in a sandbox:

- One connection and one outer transaction, always rolled back at the end. The
  case's conversation and its earlier turns are written there first.
- Every transaction the turn opens becomes a savepoint that is rolled back as
  soon as it ends. Row locks it took, such as the usage period row while it
  reserves a reply, are released at once, as in a normal turn, so real traffic
  never waits on an eval.
- The outer transaction sets app.sandbox to 'eval', which lifts the reply cap
  (docent.billing.subscriptions.reply_cap): a reply reserved here is rolled
  back anyway, so a workspace at its cap can still run evals.
- The turn gets no worker waker and no answer cache.

So nothing the turn writes survives: no messages, no handoff and no summary job
(so no inbox item, email, Slack post, or webhook), no reply counted against the
plan, no usage email, no knowledge gap, no customer memory. A side effect added
to the loop later is rolled back the same way, without a change here.

Just before each savepoint is undone, the sandbox reads what the eval needs
from it: the reply's citations with their chunk and document, the handoff
reason, and the model usage with its cost.
"""

import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from types import TracebackType
from typing import Any, cast

from asyncpg.transaction import Transaction

from docent.agent import repo
from docent.agent.loop import AgentDeps, Reply, retrieval_query, run_turn
from docent.config import Settings
from docent.db.pool import Connection, Pool, set_context
from docent.evals.scoring import RETRIEVAL_DEPTH
from docent.knowledge.embeddings import Embedder, EmbeddingError
from docent.knowledge.search import Hit, search
from docent.llm.client import ChatModel

Undo = Callable[[Connection], Awaitable[None]]


class _Savepoint:
    """A transaction the turn opens: a savepoint that is always rolled back."""

    def __init__(self, conn: Connection, before_undo: Undo) -> None:
        self._conn = conn
        self._before_undo = before_undo
        self._tx: Transaction | None = None

    async def __aenter__(self) -> _Savepoint:
        self._tx = self._conn.transaction()
        await self._tx.start()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        assert self._tx is not None
        try:
            if exc_type is None:
                await self._before_undo(self._conn)
        finally:
            await self._tx.rollback()


class _SandboxConnection:
    """The sandbox's one connection, as the turn sees it."""

    def __init__(self, conn: Connection, before_undo: Undo) -> None:
        self._conn = conn
        self._before_undo = before_undo

    def transaction(self, **_: object) -> _Savepoint:
        return _Savepoint(self._conn, self._before_undo)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._conn, name)


class SandboxPool:
    """Stands in for the pool in AgentDeps: every acquire gets the sandbox's connection."""

    def __init__(self, conn: Connection, before_undo: Undo) -> None:
        self._conn = _SandboxConnection(conn, before_undo)
        self.closed = False

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[_SandboxConnection]:
        if self.closed:
            raise RuntimeError("the eval sandbox has ended")
        yield self._conn

    def __getattr__(self, name: str) -> Any:
        # pool.fetch(...) and friends run on the sandbox connection, inside the outer transaction.
        if self.closed:
            raise RuntimeError("the eval sandbox has ended")
        return getattr(self._conn, name)


class RecordingEmbedder:
    """Passes calls through and keeps each query vector, so the eval can look at
    what retrieval found without embedding the question a second time."""

    def __init__(self, inner: Embedder) -> None:
        self._inner = inner
        self.model = inner.model
        self.queries: dict[str, list[float]] = {}

    async def embed_documents(self, items: list[tuple[str, str]]) -> list[list[float]]:
        return await self._inner.embed_documents(items)

    async def embed_query(self, text: str) -> list[float]:
        vector = await self._inner.embed_query(text)
        self.queries[text] = vector
        return vector


@dataclass(frozen=True, slots=True)
class SandboxDeps:
    settings: Settings
    pool: Pool  # connects as docent_app, the role the agent loop is written for
    embedder: Embedder
    llm: ChatModel


@dataclass(frozen=True, slots=True)
class CaseInput:
    question: str
    history: list[tuple[str, str]]  # (visitor or agent, text), oldest first
    identity: dict[str, str] | None  # None: an anonymous visitor
    # Search again for the gold document check even if the turn never searched
    # (a handoff decided by rules). Without gold documents there is nothing to check.
    wants_retrieval: bool = True


@dataclass(slots=True)
class Captured:
    citations: list[dict[str, Any]] = field(default_factory=list)
    escalation_reason: str | None = None
    usage: dict[str, dict[str, Any]] = field(default_factory=dict)  # by idempotency key


@dataclass(slots=True)
class TurnOutcome:
    reply: dict[str, Any]  # the reply as the visitor would have seen it
    citations: list[dict[str, Any]]  # with chunk_id and document_id
    escalation_reason: str | None
    retrieved: list[Hit]  # what search returns for the question, top 8
    usage: list[dict[str, Any]]  # model, tokens_in, tokens_out, cost_micros per model call
    latency_ms: int


_CAPTURE = """
    select
      (select coalesce(json_agg(json_build_object(
                'marker', c.marker, 'chunk_id', c.chunk_id, 'document_id', ch.document_id,
                'document_title', c.document_title, 'heading_path', c.heading_path,
                'url', c.url, 'excerpt', c.excerpt, 'score', c.score) order by c.marker), '[]')
       from message_citations c
       join messages m on m.id = c.message_id
       left join chunks ch on ch.id = c.chunk_id
       where m.conversation_id = $1 and m.role = 'agent') as citations,
      (select e.reason from escalations e where e.conversation_id = $1
       order by e.created_at desc limit 1) as reason,
      (select coalesce(json_agg(json_build_object(
                'key', u.idempotency_key, 'model', u.model, 'tokens_in', u.tokens_in,
                'tokens_out', u.tokens_out, 'cost_micros', u.cost_micros)), '[]')
       from usage_events u where u.conversation_id = $1 and u.kind = 'llm_call') as usage
"""


async def run_case(deps: SandboxDeps, tenant_id: uuid.UUID, case: CaseInput) -> TurnOutcome:
    """Run the full turn for one case. Nothing it writes is kept."""
    async with deps.pool.acquire() as conn:
        outer = conn.transaction()
        await outer.start()
        try:
            await set_context(conn, tenant_id=tenant_id)
            await conn.execute("select set_config('app.sandbox', 'eval', true)")
            identified = case.identity is not None
            conversation_id = await repo.create_conversation(
                conn,
                tenant_id=tenant_id,
                channel="preview",
                mode="identified" if identified else "anonymous",
                claims=dict(case.identity or {}),
            )
            for role, text in case.history:
                await repo.add_message(
                    conn,
                    tenant_id=tenant_id,
                    conversation_id=conversation_id,
                    role=role,
                    content=text,
                )

            captured = Captured()

            async def before_undo(c: Connection) -> None:
                row = await c.fetchrow(_CAPTURE, conversation_id)
                assert row is not None
                if row["citations"]:
                    captured.citations = list(row["citations"])
                if row["reason"]:
                    captured.escalation_reason = row["reason"]
                for item in row["usage"]:
                    captured.usage[item["key"]] = item

            sandbox = SandboxPool(conn, before_undo)
            embedder = RecordingEmbedder(deps.embedder)
            agent = AgentDeps(
                settings=deps.settings,
                pool=cast(Pool, sandbox),
                embedder=embedder,
                llm=deps.llm,
            )
            started = time.perf_counter()
            reply: Reply | None = None
            try:
                async for event in run_turn(
                    agent, tenant_id=tenant_id, conversation_id=conversation_id, text=case.question
                ):
                    if isinstance(event, Reply):
                        reply = event
            finally:
                sandbox.closed = True
            latency_ms = round((time.perf_counter() - started) * 1000)
            assert reply is not None
            retrieved = (
                await _retrieved(conn, deps, embedder, case)
                if embedder.queries or case.wants_retrieval
                else []
            )
        finally:
            await outer.rollback()
    return TurnOutcome(
        reply=reply.message,
        citations=captured.citations,
        escalation_reason=captured.escalation_reason,
        retrieved=retrieved,
        usage=list(captured.usage.values()),
        latency_ms=latency_ms,
    )


async def _retrieved(
    conn: Connection, deps: SandboxDeps, embedder: RecordingEmbedder, case: CaseInput
) -> list[Hit]:
    """What hybrid search returns for the question, for the gold document check.

    The same query the turn searched with (short follow-ups borrow the previous
    question), reusing its vector. The turn sends fewer sources to the model;
    this looks at the top 8, as retrieval recall is defined.
    """
    query = retrieval_query(case.question, case.history)
    vector = embedder.queries.get(query)
    if vector is None and query not in embedder.queries:
        try:
            vector = await deps.embedder.embed_query(query)
        except EmbeddingError:
            vector = None  # keyword-only, as the turn does while embeddings are down
    return await search(
        conn,
        query=query,
        query_vector=vector,
        audience="identified" if case.identity is not None else "public",
        limit=RETRIEVAL_DEPTH,
    )
