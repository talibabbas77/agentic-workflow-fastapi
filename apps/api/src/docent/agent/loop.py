"""One conversation turn.

  1. record    store the visitor message; an email sent after a handoff becomes
               the contact the team replies to
  2. triage    rules recognize greetings, thanks, goodbyes, and "who are you" and
               reply from templates (no model call, no reply counted); otherwise
               reserve one reply from the monthly cap
  3. guard     rules catch requests for a person and restricted topics (no model call)
  4. retrieve  hybrid search over the tenant's knowledge, filtered by audience
  5. gate      with no passage above the evidence threshold, one small model call
               sorts the message: small talk and off-topic questions get a polite
               reply, a vague one gets a clarifying question, an account question
               from a verified visitor goes to the model with only their details,
               and a real question without an answer becomes a handoff
  6. generate  the model returns a structured decision with cited source numbers
  7. validate  citations must point at retrieved sources, account answers must
               repeat a verified value, links must be the sources' own, and a
               second low-confidence turn becomes a handoff
  8. persist   reply, citations, usage and cost, escalation and its summary job

The generator yields progress events while it works and the final reply last,
so a client can show what is happening without ever seeing an unchecked answer.
"""

import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal

from docent.agent import answer_cache, guards, prompts, repo, triage, usage
from docent.agent.prompts import AgentDecision, AgentProfile, EscalationReason, Source
from docent.billing import notifications, subscriptions
from docent.cache import TieredCache
from docent.config import Settings
from docent.db.pool import Connection, Pool, transaction
from docent.jobs import queue
from docent.jobs.wake import WorkerWaker
from docent.knowledge import repo as knowledge_repo
from docent.knowledge.embeddings import Embedder, EmbeddingError
from docent.knowledge.search import Hit, search
from docent.llm.client import ChatModel, LLMError, Structured
from docent.memory import customers, gaps

SUMMARIZE_ESCALATION = "summarize_escalation"

HANDOFF_REASONS: dict[str, str] = {
    "user_requested": "I am passing you to the team now.",
    "restricted_topic": "Our team handles this directly, so I have passed your message on.",
    "no_source": "I could not find this in our help articles, so I have passed your question "
    "to the team.",
    "low_confidence": "I am not sure enough to answer this well, so I have passed your question "
    "to the team.",
    "repeated_failure": "I have passed this to the team so a person can help.",
    "cap_reached": "The assistant is not available right now, so I have passed your message to "
    "the team.",
}

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")


def handoff_text(reason: str, *, contact: str | None, anonymous: bool) -> str:
    """Say plainly how the team will get back: to a known email, or ask for one."""
    base = HANDOFF_REASONS[reason]
    if contact:
        return f"{base} They will reply to {contact} by email."
    if anonymous:
        return f"{base} Leave your email below so they can reply."
    return f"{base} They will follow up with you."


class ConversationNotFound(Exception):
    pass


@dataclass(frozen=True, slots=True)
class AgentDeps:
    settings: Settings
    pool: Pool
    embedder: Embedder
    llm: ChatModel
    waker: WorkerWaker | None = None
    cache: TieredCache | None = None


@dataclass(frozen=True, slots=True)
class Progress:
    stage: Literal["searching", "writing", "checking"]


@dataclass(frozen=True, slots=True)
class Reply:
    message: dict[str, Any]
    escalation_id: uuid.UUID | None


@dataclass(slots=True)
class _Outcome:
    kind: Literal["answer", "clarify", "escalate", "reply"]
    text: str
    reason: EscalationReason | None = None
    confidence: str | None = None
    cited: list[tuple[int, Hit]] = field(default_factory=list)
    account_facts: list[str] = field(default_factory=list)
    generation: Structured[AgentDecision] | None = None
    sorted_as: Structured[triage.Triage] | None = None
    from_cache: bool = False
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
        asked_to_clarify = await repo.last_agent_decision(conn, conversation_id) == "clarify"
        await repo.add_message(
            conn, tenant_id=tenant_id, conversation_id=conversation_id, role="visitor", content=text
        )
        if conversation["status"] == "escalated":
            await repo.touch_open_handoff(conn, conversation_id)
        anonymous = conversation["mode"] == "anonymous"
        captured = await _capture_contact(conn, conversation_id, text) if anonymous else None
        small = None if captured else triage.detect(text, profile)
        if small and small.kind == "ack" and asked_to_clarify:
            # "ok" to a clarifying question is not thanks for an answer.
            small = triage.Detected("about", small.lang)
        topics = (
            await knowledge_repo.help_topics(conn, identified=not anonymous)
            if small and small.kind == "about"
            else []
        )
        reserved = False
        if not (captured or small):
            cap = await subscriptions.reply_cap(conn, tenant_id)
            reserved = await usage.reserve_reply(conn, tenant_id, cap)
        claims: dict[str, str] = dict(conversation["claims"] or {})
        contact = claims.get("email") or await repo.handoff_contact(conn, conversation_id)
        end_user_id = conversation["end_user_id"]
        memory = await customers.recall(conn, end_user_id) if end_user_id else []
        cache_key = (
            answer_cache.cache_key(tenant_id, await knowledge_repo.knowledge_version(conn), text)
            if deps.cache and anonymous and not history and not claims
            else None
        )

    low_turns = int(conversation["low_confidence_turns"])
    query_vector: list[float] | None = None
    try:
        if captured:
            outcome = _Outcome("reply", f"Thanks. The team will reply to {captured}.")
        elif small:
            outcome = _Outcome("reply", triage.reply(small.kind, small.lang, profile, topics))
        elif not reserved:
            outcome = _escalate("cap_reached", low_turns)
        elif guards.asks_for_human(text):
            outcome = _escalate("user_requested", low_turns)
        elif guards.restricted_topic(text, profile.restricted_topics):
            outcome = _escalate("restricted_topic", low_turns)
        else:
            yield Progress("searching")
            cached = (
                await answer_cache.lookup(deps.cache, cache_key)
                if deps.cache and cache_key
                else None
            )
            hits, query_vector = (
                ([], None)
                if cached
                else await _retrieve(deps, tenant_id, conversation["mode"], text, history)
            )
            if not _supported(hits, s.retrieval_min_similarity):
                hits = []
            if cached:
                answer, confidence, cited = cached
                outcome = _Outcome(
                    "answer", answer, confidence=confidence, cited=cited, from_cache=True
                )
            elif hits:
                yield Progress("writing")
                outcome = await _generate(
                    deps, profile, claims, hits, history, text, low_turns, memory
                )
                yield Progress("checking")
            else:
                sorted_as = await _triage(deps, profile, history, text)
                if sorted_as and sorted_as.value.intent == "account_question" and claims:
                    yield Progress("writing")
                    outcome = await _generate(
                        deps, profile, claims, [], history, text, low_turns, memory
                    )
                    yield Progress("checking")
                elif _orient(sorted_as, asked_to_clarify, text):
                    # Never a second clarifying question, and never a handoff for "yes":
                    # say what the agent can help with, from the articles customers ask about.
                    async with transaction(deps.pool, tenant_id=tenant_id) as conn:
                        topics = await knowledge_repo.help_topics(conn, identified=not anonymous)
                    language = sorted_as.value.language if sorted_as else "en"
                    outcome = _Outcome("reply", triage.reply("about", language, profile, topics))
                else:
                    outcome = _route(sorted_as, profile, low_turns)
                outcome.sorted_as = sorted_as
    except BaseException:
        if reserved:
            async with transaction(deps.pool, tenant_id=tenant_id) as conn:
                await usage.settle_reply(conn, tenant_id, used=False)
        raise

    if cache_key and deps.cache and outcome.kind == "answer" and not outcome.from_cache:
        await answer_cache.store(
            deps.cache, cache_key, outcome.text, outcome.confidence, outcome.cited
        )
    if outcome.kind == "escalate":
        assert outcome.reason is not None
        contact = contact or _email_in(text)
        outcome.text = handoff_text(outcome.reason, contact=contact, anonymous=anonymous)
    async with transaction(deps.pool, tenant_id=tenant_id) as conn:
        reply, escalation_id, emailed = await _persist(
            conn, tenant_id, conversation_id, outcome, reserved, contact, s.web_origin
        )
        if outcome.reason == "no_source":  # a product question the agent could not answer
            await gaps.record(
                conn,
                tenant_id=tenant_id,
                question=text,
                vector=query_vector,
                conversation_id=conversation_id,
            )
        if end_user_id:
            await customers.schedule(conn, tenant_id, conversation_id)
    if (escalation_id or emailed) and deps.waker:
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
) -> tuple[list[Hit], list[float] | None]:
    """The passages for this question, and its query vector (kept for knowledge gaps)."""
    query = retrieval_query(text, history)
    try:
        vector: list[float] | None = await deps.embedder.embed_query(query)
    except EmbeddingError:
        vector = None
    async with transaction(deps.pool, tenant_id=tenant_id) as conn:
        hits = await search(
            conn,
            query=query,
            query_vector=vector,
            audience="identified" if mode == "identified" else "public",
            limit=deps.settings.agent_sources,
        )
    return hits, vector


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
    memory: list[str],
) -> _Outcome:
    sources = [
        Source(i, h.document_title, h.heading_path, h.content) for i, h in enumerate(hits, 1)
    ]
    messages = prompts.answer_messages(profile, claims or None, sources, history, text, memory)
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
    answer = _unescape_newlines(decision.answer).strip()
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
    """The wording is set once the contact is known; see handoff_text."""
    return _Outcome(
        "escalate", HANDOFF_REASONS[reason], reason=reason, low_confidence_turns=low_turns
    )


async def _triage(
    deps: AgentDeps, profile: AgentProfile, history: list[tuple[str, str]], text: str
) -> Structured[triage.Triage] | None:
    try:
        return await deps.llm.structured(
            triage.triage_messages(profile, history, text),
            triage.Triage,
            name="triage",
            max_tokens=120,
        )
    except LLMError:
        return None  # sorting failed: treat it as a question without an answer


def _route(
    sorted_as: Structured[triage.Triage] | None, profile: AgentProfile, low_turns: int
) -> _Outcome:
    """What to do with a message that found no supporting passage."""
    if sorted_as is None:
        return _escalate("no_source", low_turns)
    found = sorted_as.value
    match found.intent:
        case "off_topic":
            return _Outcome("reply", triage.reply("off_topic", found.language, profile))
        case "wants_person":
            return _escalate("user_requested", low_turns)
        case "unclear" if question := _clarifying(found.clarifying_question):
            return _Outcome("clarify", question, low_confidence_turns=low_turns)
        case _:
            return _escalate("no_source", low_turns)


def _unescape_newlines(text: str) -> str:
    """Undo a model that escaped its line breaks twice, so a list shows as a list.

    Only when the text has no real line break: then every backslash-n came from
    the model's JSON, not from a code sample in the answer.
    """
    if "\n" in text or "\\n" not in text:
        return text
    return text.replace("\\r\\n", "\n").replace("\\n", "\n")


def _orient(sorted_as: Structured[triage.Triage] | None, asked_to_clarify: bool, text: str) -> bool:
    """An answer to the agent's clarifying question that still gives nothing to search for.

    Small talk about the assistant itself is answered the same way.
    """
    intent = sorted_as.value.intent if sorted_as else None
    if intent == "small_talk":
        return True
    if not asked_to_clarify or intent in ("wants_person", "off_topic", "account_question"):
        return False
    return intent == "unclear" or triage.is_bare_reply(text)


def _clarifying(question: str | None) -> str | None:
    """A model-written clarifying question is shown only if it is just a short question."""
    text = (question or "").strip()
    if not 3 <= len(text) <= 200 or text[-1] not in "?؟" or EMAIL.search(text):
        return None
    if guards.strip_untrusted_links(text, []) != text:
        return None
    return text


def _email_in(text: str) -> str | None:
    match = EMAIL.search(text)
    return match.group(0).lower()[:254] if match else None


async def _capture_contact(conn: Connection, conversation_id: uuid.UUID, text: str) -> str | None:
    """An anonymous visitor who types an email after a handoff has answered our request."""
    email = _email_in(text)
    if email is None:
        return None
    escalation_id = await repo.handoff_waiting_for_contact(conn, conversation_id)
    if escalation_id is None:
        return None
    await repo.set_handoff_contact(conn, escalation_id, email)
    return email


async def _persist(
    conn: Connection,
    tenant_id: uuid.UUID,
    conversation_id: uuid.UUID,
    outcome: _Outcome,
    reserved: bool,
    contact_email: str | None,
    web_origin: str,
) -> tuple[dict[str, Any], uuid.UUID | None, bool]:
    """Store the reply and everything it caused. Returns the reply, the handoff it
    opened (if any), and whether a usage email was queued."""
    gen = outcome.generation
    sorted_as = outcome.sorted_as
    decision = {
        "type": outcome.kind,
        "confidence": outcome.confidence,
        "reason": outcome.reason,
        "citations": [n for n, _ in outcome.cited],
        "account_facts": outcome.account_facts,
        "intent": sorted_as.value.intent if sorted_as else None,
        "cache": "hit" if outcome.from_cache else None,
    }
    call = gen or sorted_as
    message_id = await repo.add_message(
        conn,
        tenant_id=tenant_id,
        conversation_id=conversation_id,
        role="agent",
        content=outcome.text,
        decision=decision,
        model=call.model if call else None,
        prompt_version=(
            prompts.ANSWER_PROMPT_VERSION if gen else triage.TRIAGE_PROMPT_VERSION if call else None
        ),
        tokens_in=call.tokens_in if call else None,
        tokens_out=call.tokens_out if call else None,
        latency_ms=call.latency_ms if call else None,
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
    for key, made in (("triage", sorted_as), ("llm", gen)):
        if made:
            await usage.record(
                conn,
                tenant_id=tenant_id,
                kind="llm_call",
                idempotency_key=f"{key}:{message_id}",
                model=made.model,
                tokens_in=made.tokens_in,
                tokens_out=made.tokens_out,
                conversation_id=conversation_id,
                message_id=message_id,
            )
    emailed = 0
    if reserved and outcome.kind == "reply":
        await usage.settle_reply(conn, tenant_id, used=False)  # conversation is not billed
    elif reserved:
        await usage.record(
            conn,
            tenant_id=tenant_id,
            kind="ai_reply",
            idempotency_key=f"reply:{message_id}",
            conversation_id=conversation_id,
            message_id=message_id,
        )
        crossed = await usage.settle_reply(conn, tenant_id, used=True)
        if crossed:
            emailed = await notifications.enqueue_usage_emails(conn, tenant_id, crossed, web_origin)

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
        escalated=escalation_id is not None,
        low_confidence_turns=outcome.low_confidence_turns,
    )
    reply = {
        "id": message_id,
        "created_at": await conn.fetchval(
            "select created_at from messages where id = $1", message_id
        ),
        "role": "agent",
        "content": outcome.text,
        "decision": decision,
        "citations": [{k: v for k, v in c.items() if k != "chunk_id"} for c in citations],
    }
    return reply, escalation_id, emailed > 0
