"""One conversation turn.

  1. record    store the visitor message, reserve one reply from the monthly cap
  2. guard     rules catch requests for a person and restricted topics (no model call)
  3. retrieve  hybrid search over the tenant's knowledge, filtered by audience
  4. gate      no source above the evidence threshold means a handoff (no model call),
               unless the visitor is verified: then the model sees only their
               account details, so "what plan am I on" can still be answered
  5. generate  the model returns a structured decision with cited source numbers
  6. validate  citations must point at retrieved sources, account answers must
               repeat a verified value, links must be the sources' own, and a
               second low-confidence turn becomes a handoff
  7. persist   reply, citations, usage and cost, escalation and its summary job

The generator yields progress events while it works and the final reply last,
so a client can show what is happening without ever seeing an unchecked answer.
"""

import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal

from docent.agent import guards, prompts, repo, usage
from docent.agent.prompts import AgentDecision, AgentProfile, EscalationReason, Source
from docent.config import Settings
from docent.db.pool import Connection, Pool, transaction
from docent.jobs import queue
from docent.jobs.wake import WorkerWaker
from docent.knowledge.embeddings import Embedder, EmbeddingError
from docent.knowledge.search import Hit, search
from docent.llm.client import ChatModel, LLMError, Structured

SUMMARIZE_ESCALATION = "summarize_escalation"

HANDOFF_MESSAGES: dict[str, str] = {
    "user_requested": "I am passing you to the team now. They will reply by email.",
    "restricted_topic": "Our team handles this directly. I have passed your message on, "
    "and they will reply by email.",
    "no_source": "I could not find this in our help articles, so I have passed your question "
    "to the team. They will reply by email.",
    "low_confidence": "I am not sure enough to answer this well, so I have passed your question "
    "to the team. They will reply by email.",
    "repeated_failure": "I have passed this to the team so a person can help. They will reply "
    "by email.",
    "cap_reached": "The assistant is not available right now. I have passed your message to "
    "the team, and they will reply by email.",
}


class ConversationNotFound(Exception):
    pass


@dataclass(frozen=True, slots=True)
class AgentDeps:
    settings: Settings
    pool: Pool
    embedder: Embedder
    llm: ChatModel
    waker: WorkerWaker | None = None


@dataclass(frozen=True, slots=True)
class Progress:
    stage: Literal["searching", "writing", "checking"]


@dataclass(frozen=True, slots=True)
class Reply:
    message: dict[str, Any]
    escalation_id: uuid.UUID | None


@dataclass(slots=True)
class _Outcome:
    kind: Literal["answer", "clarify", "escalate"]
    text: str
    reason: EscalationReason | None = None
    confidence: str | None = None
    cited: list[tuple[int, Hit]] = field(default_factory=list)
    account_facts: list[str] = field(default_factory=list)
    generation: Structured[AgentDecision] | None = None
    low_confidence_turns: int = 0


async def run_turn(
    deps: AgentDeps, *, tenant_id: uuid.UUID, conversation_id: uuid.UUID, text: str
) -> AsyncIterator[Progress | Reply]:
    s = deps.settings
    async with transaction(deps.pool, tenant_id=tenant_id) as conn:
        conversation = await repo.lock_conversation(conn, conversation_id)
        if conversation is None:
            raise ConversationNotFound
        profile = await _profile(conn, tenant_id)
        history = await repo.recent_turns(conn, conversation_id, s.agent_history_turns)
        await repo.add_message(
            conn, tenant_id=tenant_id, conversation_id=conversation_id, role="visitor", content=text
        )
        reserved = await usage.reserve_reply(conn, tenant_id, s.default_replies_cap)

    claims: dict[str, str] = dict(conversation["claims"] or {})
    low_turns = int(conversation["low_confidence_turns"])
    try:
        if not reserved:
            outcome = _escalate("cap_reached", low_turns)
        elif guards.asks_for_human(text):
            outcome = _escalate("user_requested", low_turns)
        elif guards.restricted_topic(text, profile.restricted_topics):
            outcome = _escalate("restricted_topic", low_turns)
        else:
            yield Progress("searching")
            hits = await _retrieve(deps, tenant_id, conversation["mode"], text, history)
            if not _supported(hits, s.retrieval_min_similarity):
                hits = []
            if not hits and not claims:
                outcome = _escalate("no_source", low_turns)
            else:
                yield Progress("writing")
                outcome = await _generate(deps, profile, claims, hits, history, text, low_turns)
                yield Progress("checking")
    except BaseException:
        if reserved:
            async with transaction(deps.pool, tenant_id=tenant_id) as conn:
                await usage.settle_reply(conn, tenant_id, used=False)
        raise

    async with transaction(deps.pool, tenant_id=tenant_id) as conn:
        reply, escalation_id = await _persist(
            conn, tenant_id, conversation_id, outcome, reserved, claims.get("email")
        )
    if escalation_id and deps.waker:
        await deps.waker.wake()
    yield Reply(message=reply, escalation_id=escalation_id)


async def _profile(conn: Connection, tenant_id: uuid.UUID) -> AgentProfile:
    row = await conn.fetchrow("select name, settings from tenants where id = $1", tenant_id)
    assert row is not None
    agent = (row["settings"] or {}).get("agent", {})
    return AgentProfile(
        company=row["name"],
        agent_name=agent.get("name") or f"{row['name']} assistant",
        tone=agent.get("tone") or "friendly",
        restricted_topics=tuple(agent.get("restricted_topics") or ()),
    )


def retrieval_query(text: str, history: list[tuple[str, str]]) -> str:
    """Short follow-ups borrow the previous question, without an extra model call."""
    if len(text.split()) >= 6:
        return text
    previous = next((t for role, t in reversed(history) if role == "visitor"), None)
    return f"{previous} {text}" if previous else text


async def _retrieve(
    deps: AgentDeps, tenant_id: uuid.UUID, mode: str, text: str, history: list[tuple[str, str]]
) -> list[Hit]:
    query = retrieval_query(text, history)
    try:
        vector: list[float] | None = await deps.embedder.embed_query(query)
    except EmbeddingError:
        vector = None
    async with transaction(deps.pool, tenant_id=tenant_id) as conn:
        return await search(
            conn,
            query=query,
            query_vector=vector,
            audience="identified" if mode == "identified" else "public",
            limit=deps.settings.agent_sources,
        )


def _supported(hits: list[Hit], threshold: float) -> bool:
    """The evidence gate: something retrieved must be close enough to the question."""
    similarities = [h.similarity for h in hits if h.similarity is not None]
    if similarities:
        return max(similarities) >= threshold
    return any(h.keyword_rank for h in hits)  # keyword-only mode while embeddings are down


async def _generate(
    deps: AgentDeps,
    profile: AgentProfile,
    claims: dict[str, str],
    hits: list[Hit],
    history: list[tuple[str, str]],
    text: str,
    low_turns: int,
) -> _Outcome:
    sources = [
        Source(i, h.document_title, h.heading_path, h.content) for i, h in enumerate(hits, 1)
    ]
    messages = prompts.answer_messages(profile, claims or None, sources, history, text)
    try:
        generation = await deps.llm.structured(
            messages,
            AgentDecision,
            name="agent_decision",
            max_tokens=deps.settings.agent_max_answer_tokens,
        )
    except LLMError:
        return _escalate("low_confidence", low_turns)
    outcome = validate(generation.value, hits, claims, low_turns)
    outcome.generation = generation
    return outcome


def validate(
    decision: AgentDecision, hits: list[Hit], claims: dict[str, str], low_turns: int
) -> _Outcome:
    """Turn the model's decision into what the visitor sees, failing toward a person."""
    if decision.type == "escalate":
        return _escalate(decision.escalation_reason or "no_source", low_turns)
    answer = decision.answer.strip()
    if not answer:
        return _escalate("low_confidence", low_turns)
    if decision.type == "clarify":
        return _Outcome(
            "clarify",
            guards.strip_untrusted_links(answer, []),
            confidence=decision.confidence,
            low_confidence_turns=low_turns,
        )

    valid = set(range(1, len(hits) + 1))
    cited = sorted((set(decision.citations) | guards.markers(answer)) & valid)
    facts = _account_facts(decision.account_facts, claims, answer)
    if not cited and not facts:
        return _escalate("no_source", low_turns)
    for marker in guards.markers(answer) - valid:
        answer = answer.replace(f"[{marker}]", "")
    answer = guards.strip_untrusted_links(answer, [hits[n - 1].url or "" for n in cited])

    if decision.confidence == "low":
        low_turns += 1
        if low_turns >= 2:
            return _escalate("low_confidence", low_turns)
    return _Outcome(
        "answer",
        answer,
        confidence=decision.confidence,
        cited=[(n, hits[n - 1]) for n in cited],
        account_facts=facts,
        low_confidence_turns=low_turns,
    )


def _account_facts(named: list[str], claims: dict[str, str], answer: str) -> list[str]:
    """Verified details the answer really uses: a known key whose value the answer repeats.

    Small models write "Plan: Free" where the schema asks for "plan", so the key is
    read from the text before any colon.
    """
    by_key = {k.casefold(): k for k in claims}
    keys = [by_key.get(n.split(":", 1)[0].strip().casefold()) for n in named]

    def repeated(value: str) -> bool:
        return re.search(rf"(?<!\w){re.escape(value)}(?!\w)", answer, re.IGNORECASE) is not None

    return [k for k in dict.fromkeys(keys) if k and claims[k] and repeated(claims[k])]


def _escalate(reason: EscalationReason, low_turns: int) -> _Outcome:
    return _Outcome(
        "escalate", HANDOFF_MESSAGES[reason], reason=reason, low_confidence_turns=low_turns
    )


async def _persist(
    conn: Connection,
    tenant_id: uuid.UUID,
    conversation_id: uuid.UUID,
    outcome: _Outcome,
    reserved: bool,
    contact_email: str | None,
) -> tuple[dict[str, Any], uuid.UUID | None]:
    gen = outcome.generation
    decision = {
        "type": outcome.kind,
        "confidence": outcome.confidence,
        "reason": outcome.reason,
        "citations": [n for n, _ in outcome.cited],
        "account_facts": outcome.account_facts,
    }
    message_id = await repo.add_message(
        conn,
        tenant_id=tenant_id,
        conversation_id=conversation_id,
        role="agent",
        content=outcome.text,
        decision=decision,
        model=gen.model if gen else None,
        prompt_version=prompts.ANSWER_PROMPT_VERSION if gen else None,
        tokens_in=gen.tokens_in if gen else None,
        tokens_out=gen.tokens_out if gen else None,
        latency_ms=gen.latency_ms if gen else None,
    )
    citations = [
        {
            "marker": n,
            "chunk_id": hit.chunk_id,
            "document_title": hit.document_title,
            "heading_path": hit.heading_path,
            "url": hit.url,
            "excerpt": hit.content[:500],
            "score": hit.similarity,
        }
        for n, hit in outcome.cited
    ]
    if citations:
        await repo.add_citations(conn, tenant_id=tenant_id, message_id=message_id, rows=citations)
    if gen:
        await usage.record(
            conn,
            tenant_id=tenant_id,
            kind="llm_call",
            idempotency_key=f"llm:{message_id}",
            model=gen.model,
            tokens_in=gen.tokens_in,
            tokens_out=gen.tokens_out,
            conversation_id=conversation_id,
            message_id=message_id,
        )
    if reserved:
        await usage.record(
            conn,
            tenant_id=tenant_id,
            kind="ai_reply",
            idempotency_key=f"reply:{message_id}",
            conversation_id=conversation_id,
            message_id=message_id,
        )
        await usage.settle_reply(conn, tenant_id, used=True)

    escalation_id = None
    if outcome.kind == "escalate":
        assert outcome.reason is not None
        escalation_id = await repo.create_escalation(
            conn,
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            reason=outcome.reason,
            contact_email=contact_email,
        )
        await queue.enqueue(
            conn,
            SUMMARIZE_ESCALATION,
            {"escalation_id": str(escalation_id)},
            tenant_id=tenant_id,
            dedupe_key=f"summarize:{escalation_id}",
        )
    await repo.set_conversation_state(
        conn,
        conversation_id,
        status="escalated" if escalation_id else "open",
        low_confidence_turns=outcome.low_confidence_turns,
    )
    reply = {
        "id": message_id,
        "role": "agent",
        "content": outcome.text,
        "decision": decision,
        "citations": [{k: v for k, v in c.items() if k != "chunk_id"} for c in citations],
    }
    return reply, escalation_id
