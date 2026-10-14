"""SQL for conversations, messages, citations, ticket types, and escalations."""

import uuid
from typing import Any

import asyncpg

from docent.db.pool import Connection
from docent.ids import new_id

CONVERSATION_COLUMNS = """
    id, channel, mode, claims, status, low_confidence_turns, started_at, last_message_at,
    end_user_id
"""


async def create_conversation(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    channel: str,
    mode: str,
    claims: dict[str, str],
    staff_user_id: uuid.UUID | None = None,
    visitor_id: str | None = None,
) -> uuid.UUID:
    conversation_id = new_id()
    await conn.execute(
        """
        insert into conversations (id, tenant_id, channel, mode, claims, staff_user_id, visitor_id)
        values ($1, $2, $3, $4, $5, $6, $7)
        """,
        conversation_id,
        tenant_id,
        channel,
        mode,
        claims,
        staff_user_id,
        visitor_id,
    )
    return conversation_id


async def lock_conversation(conn: Connection, conversation_id: uuid.UUID) -> asyncpg.Record | None:
    """Serialize turns in one conversation, so two quick messages do not interleave."""
    return await conn.fetchrow(
        f"select {CONVERSATION_COLUMNS} from conversations where id = $1 for update",  # noqa: S608
        conversation_id,
    )


async def get_conversation(conn: Connection, conversation_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        f"select {CONVERSATION_COLUMNS} from conversations where id = $1",  # noqa: S608
        conversation_id,
    )


async def recent_turns(
    conn: Connection, conversation_id: uuid.UUID, limit: int
) -> list[tuple[str, str]]:
    rows = await conn.fetch(
        """
        select role, content from (
          select role, content, created_at from messages
          where conversation_id = $1 and role in ('visitor', 'agent', 'human')
          order by created_at desc limit $2
        ) recent order by created_at
        """,
        conversation_id,
        limit,
    )
    return [(r["role"], r["content"]) for r in rows]


async def last_agent_decision(conn: Connection, conversation_id: uuid.UUID) -> str | None:
    """What the agent's last turn was: answer, clarify, escalate, or reply."""
    decision: str | None = await conn.fetchval(
        """
        select decision->>'type' from messages
        where conversation_id = $1 and role = 'agent'
        order by created_at desc limit 1
        """,
        conversation_id,
    )
    return decision


async def add_message(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    conversation_id: uuid.UUID,
    role: str,
    content: str,
    decision: dict[str, Any] | None = None,
    model: str | None = None,
    prompt_version: str | None = None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    latency_ms: int | None = None,
) -> uuid.UUID:
    message_id = new_id()
    await conn.execute(
        """
        insert into messages (id, tenant_id, conversation_id, role, content, decision, model,
                              prompt_version, tokens_in, tokens_out, latency_ms)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        """,
        message_id,
        tenant_id,
        conversation_id,
        role,
        content,
        decision,
        model,
        prompt_version,
        tokens_in,
        tokens_out,
        latency_ms,
    )
    await conn.execute(
        "update conversations set last_message_at = now() where id = $1", conversation_id
    )
    return message_id


async def add_citations(
    conn: Connection, *, tenant_id: uuid.UUID, message_id: uuid.UUID, rows: list[dict[str, Any]]
) -> None:
    await conn.executemany(
        """
        insert into message_citations (id, tenant_id, message_id, marker, chunk_id,
                                       document_title, heading_path, url, excerpt, score)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        """,
        [
            (
                new_id(),
                tenant_id,
                message_id,
                r["marker"],
                r["chunk_id"],
                r["document_title"],
                r["heading_path"],
                r["url"],
                r["excerpt"],
                r["score"],
            )
            for r in rows
        ],
    )


async def conversation_messages(
    conn: Connection, conversation_id: uuid.UUID
) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        select m.id, m.role, m.content, m.decision, m.created_at, m.latency_ms,
               f.vote, f.comment as feedback_comment, f.updated_at as voted_at,
               coalesce(json_agg(json_build_object(
                 'marker', c.marker, 'document_title', c.document_title,
                 'heading_path', c.heading_path, 'url', c.url, 'excerpt', c.excerpt
               ) order by c.marker) filter (where c.id is not null), '[]') as citations
        from messages m
        left join message_citations c on c.message_id = m.id
        left join message_feedback f on f.message_id = m.id
        where m.conversation_id = $1
        group by m.id, f.id
        order by m.created_at
        """,
        conversation_id,
    )


async def set_conversation_state(
    conn: Connection, conversation_id: uuid.UUID, *, escalated: bool, low_confidence_turns: int
) -> None:
    """A new handoff marks the conversation escalated; later answers never undo that."""
    await conn.execute(
        """
        update conversations
        set status = case when $2 then 'escalated' else status end, low_confidence_turns = $3
        where id = $1
        """,
        conversation_id,
        escalated,
        low_confidence_turns,
    )


async def handoff_waiting_for_contact(
    conn: Connection, conversation_id: uuid.UUID
) -> uuid.UUID | None:
    escalation_id: uuid.UUID | None = await conn.fetchval(
        """
        select id from escalations
        where conversation_id = $1 and contact_email is null and status <> 'resolved'
        order by created_at desc limit 1
        """,
        conversation_id,
    )
    return escalation_id


async def handoff_contact(conn: Connection, conversation_id: uuid.UUID) -> str | None:
    """The email this visitor already gave the team in this conversation, if any."""
    email: str | None = await conn.fetchval(
        """
        select contact_email from escalations
        where conversation_id = $1 and contact_email is not null
        order by created_at desc limit 1
        """,
        conversation_id,
    )
    return email


async def set_handoff_contact(conn: Connection, escalation_id: uuid.UUID, email: str) -> None:
    await conn.execute(
        """
        update escalations set contact_email = $2, updated_at = now()
        where id = $1 and contact_email is null
        """,
        escalation_id,
        email,
    )


async def touch_open_handoff(conn: Connection, conversation_id: uuid.UUID) -> None:
    """The customer wrote again after a handoff: it shows as unread in the inbox."""
    await conn.execute(
        """
        update escalations set updated_at = now()
        where conversation_id = $1 and status <> 'resolved'
        """,
        conversation_id,
    )


async def create_escalation(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    conversation_id: uuid.UUID,
    reason: str,
    contact_email: str | None,
) -> uuid.UUID:
    """One open escalation per conversation: later turns reuse it."""
    existing: uuid.UUID | None = await conn.fetchval(
        "select id from escalations where conversation_id = $1 and status <> 'resolved'",
        conversation_id,
    )
    if existing:
        return existing
    escalation_id = new_id()
    await conn.execute(
        """
        insert into escalations (id, tenant_id, conversation_id, reason, contact_email)
        values ($1, $2, $3, $4, $5)
        """,
        escalation_id,
        tenant_id,
        conversation_id,
        reason,
        contact_email,
    )
    return escalation_id


async def active_ticket_types(conn: Connection) -> list[asyncpg.Record]:
    return await conn.fetch(
        "select id, name, description, fields from ticket_types where active order by name"
    )


async def list_ticket_types(conn: Connection) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        select id, name, description, fields, notify_emails, priority, active, created_at,
               updated_at
        from ticket_types order by name
        """
    )
