"""A new test case filled in from a real conversation: the inbox's "Add to eval set".

The case asks the visitor's question again, with the turns before it as
history and the conversation's verified claims as the identity. What should
happen is a guess a person checks before saving: a handoff the customer asked
for (or a restricted topic) should stay a handoff; anything else should get an
answer. An answer marked wrong brings its reason along as the reference. An
answer the customer voted down is tagged so; their note is shown in the inbox,
never copied into the case, since it is the visitor's text and not a checked
answer.
"""

import uuid
from dataclasses import dataclass
from typing import Any

from docent.db.pool import Connection
from docent.evals.review import REVIEW_FLAG_REASON

MAX_HISTORY = 6
MAX_TEXT = 2000
KEEP_HANDOFF = ("user_requested", "restricted_topic")


class NoQuestion(Exception):
    """The conversation has no message from the customer to ask again."""


@dataclass(frozen=True, slots=True)
class Prefill:
    question: str
    history: list[dict[str, str]]
    identity: dict[str, str] | None
    expected: str
    reference_answer: str
    tags: list[str]
    source_conversation_id: uuid.UUID
    source_message_id: uuid.UUID | None


async def prefill(
    conn: Connection, conversation_id: uuid.UUID, message_id: uuid.UUID | None
) -> Prefill | None:
    """None when the conversation or the message is not in this workspace."""
    conversation = await conn.fetchrow(
        "select id, mode, claims from conversations where id = $1", conversation_id
    )
    if conversation is None:
        return None
    turns = await conn.fetch(
        """
        select m.id, m.role, m.content, m.decision, m.flagged_wrong, m.flag_reason, f.vote
        from messages m left join message_feedback f on f.message_id = m.id
        where m.conversation_id = $1 and m.role in ('visitor', 'agent')
        order by m.created_at, m.id
        """,
        conversation_id,
    )
    if message_id is not None:
        at = next((i for i, t in enumerate(turns) if t["id"] == message_id), None)
        if at is None:
            return None
    else:
        # The turn that handed off, else the last agent turn, else the last turn.
        at = next(
            (i for i, t in enumerate(turns) if t["role"] == "agent" and _kind(t) == "escalate"),
            next((i for i in range(len(turns) - 1, -1, -1) if turns[i]["role"] == "agent"), None),
        )
        if at is None:
            at = len(turns) - 1
    if at < 0:
        raise NoQuestion
    asked = (
        at
        if turns[at]["role"] == "visitor"
        else next((i for i in range(at - 1, -1, -1) if turns[i]["role"] == "visitor"), None)
    )
    if asked is None:
        raise NoQuestion
    agent = (
        turns[at]
        if turns[at]["role"] == "agent"
        else next((t for t in turns[asked + 1 :] if t["role"] == "agent"), None)
    )
    decision: dict[str, Any] = dict(agent["decision"] or {}) if agent else {}
    handed_off = decision.get("type") == "escalate"
    wrong = bool(agent and agent["flagged_wrong"])
    voted_down = bool(agent and agent["vote"] == "down")
    reason = (agent["flag_reason"] or "") if agent and wrong else ""
    tags = ["marked wrong"] if wrong else ["handoff"] if handed_off else ["conversation"]
    if voted_down:
        tags = ["thumbs down", *(t for t in tags if t != "conversation")]
    return Prefill(
        question=turns[asked]["content"][:MAX_TEXT],
        history=[
            {"role": t["role"], "content": t["content"][:MAX_TEXT]}
            for t in turns[max(0, asked - MAX_HISTORY) : asked]
        ],
        identity=(
            {str(k): str(v) for k, v in (conversation["claims"] or {}).items()}
            if conversation["mode"] == "identified"
            else None
        ),
        expected="escalate" if handed_off and decision.get("reason") in KEEP_HANDOFF else "answer",
        reference_answer="" if reason == REVIEW_FLAG_REASON else reason[:MAX_TEXT],
        tags=tags,
        source_conversation_id=conversation_id,
        source_message_id=agent["id"] if agent else turns[asked]["id"],
    )


def _kind(turn: Any) -> str | None:
    decision = turn["decision"] or {}
    kind: str | None = decision.get("type")
    return kind
