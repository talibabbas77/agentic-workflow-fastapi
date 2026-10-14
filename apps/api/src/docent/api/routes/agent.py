"""The agent: behavior settings and preview conversations for staff.

A turn streams Server-Sent Events: `status` while the agent searches, writes,
and checks, then one `message` with the validated reply (or `error`). Nothing
unchecked is ever sent, so the stream carries progress, not tokens.
"""

import logging
import uuid

from fastapi import APIRouter, status
from fastapi.responses import StreamingResponse

from docent.agent import repo
from docent.agent.loop import AgentDeps
from docent.api.deps import AdminMember, CurrentMember, State, enforce
from docent.api.errors import not_found
from docent.api.schemas import (
    AgentSettingsIn,
    AgentSettingsOut,
    ConversationCreateIn,
    ConversationOut,
    ErrorOut,
    EscalationOut,
    MessageIn,
    MessageOut,
)
from docent.api.streaming import stream_turn
from docent.db.pool import Connection, transaction
from docent.knowledge import repo as knowledge_repo
from docent.security import ratelimit
from docent.services import audit

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/v1/agent",
    tags=["agent"],
    responses={403: {"model": ErrorOut}, 404: {"model": ErrorOut}, 422: {"model": ErrorOut}},
)


@router.get("/settings")
async def get_settings(member: CurrentMember, state: State) -> AgentSettingsOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return await _settings(conn, member.tenant_id)


@router.patch("/settings")
async def update_settings(
    body: AgentSettingsIn, member: AdminMember, state: State
) -> AgentSettingsOut:
    changes = body.model_dump(exclude_none=True)
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await conn.execute(
            """
            update tenants
            set settings = jsonb_set(
                  settings, '{agent}', coalesce(settings -> 'agent', '{}') || $2
                ),
                updated_at = now()
            where id = $1
            """,
            member.tenant_id,
            changes,
        )
        await knowledge_repo.bump_knowledge_version(conn)  # cached answers used the old voice
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="agent.settings_updated",
            metadata=changes,
        )
        return await _settings(conn, member.tenant_id)


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
async def create_conversation(
    body: ConversationCreateIn, member: CurrentMember, state: State
) -> ConversationOut:
    claims = body.claims if body.mode == "identified" else {}
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        conversation_id = await repo.create_conversation(
            conn,
            tenant_id=member.tenant_id,
            channel="preview",
            mode=body.mode,
            claims=claims,
            staff_user_id=member.user_id,
        )
        return await _conversation(conn, conversation_id)


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: uuid.UUID, member: CurrentMember, state: State
) -> ConversationOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return await _conversation(conn, conversation_id)


@router.post(
    "/conversations/{conversation_id}/messages",
    response_class=StreamingResponse,
    responses={
        200: {"content": {"text/event-stream": {}}, "description": "status, message, error events"},
        429: {"model": ErrorOut},
    },
)
async def send_message(
    conversation_id: uuid.UUID, body: MessageIn, member: CurrentMember, state: State
) -> StreamingResponse:
    await enforce(state, ratelimit.AGENT_TURN_PER_USER, str(member.user_id))
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if await repo.get_conversation(conn, conversation_id) is None:
            raise not_found("Conversation")
    deps = AgentDeps(
        settings=state.settings,
        pool=state.pool,
        embedder=state.embedder,
        llm=state.llm,
        waker=state.waker,
        cache=state.cache,
    )
    return stream_turn(deps, member.tenant_id, conversation_id, body.content)


async def _settings(conn: Connection, tenant_id: uuid.UUID) -> AgentSettingsOut:
    row = await conn.fetchrow("select name, settings from tenants where id = $1", tenant_id)
    assert row is not None
    agent = (row["settings"] or {}).get("agent", {})
    return AgentSettingsOut(
        name=agent.get("name") or f"{row['name']} assistant",
        tone=agent.get("tone") or "friendly",
        restricted_topics=agent.get("restricted_topics") or [],
    )


async def _conversation(conn: Connection, conversation_id: uuid.UUID) -> ConversationOut:
    row = await repo.get_conversation(conn, conversation_id)
    if row is None:
        raise not_found("Conversation")
    messages = await repo.conversation_messages(conn, conversation_id)
    escalation = await conn.fetchrow(
        """
        select e.id, e.reason, e.status, e.fields, e.summary, e.contact_email, e.created_at,
               t.name as ticket_type
        from escalations e left join ticket_types t on t.id = e.ticket_type_id
        where e.conversation_id = $1 order by e.created_at desc limit 1
        """,
        conversation_id,
    )
    return ConversationOut(
        id=row["id"],
        channel=row["channel"],
        mode=row["mode"],
        claims=row["claims"] or {},
        status=row["status"],
        messages=[
            MessageOut(
                id=m["id"],
                role=m["role"],
                content=m["content"],
                decision=m["decision"],
                citations=m["citations"],
                created_at=m["created_at"],
            )
            for m in messages
        ],
        escalation=EscalationOut(**dict(escalation)) if escalation else None,
    )
