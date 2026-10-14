"""The API the widget frame calls. No cookies: a session token in the Authorization header.

Sessions are created from a widget public id plus, in identified mode, a token
the tenant's server signed. Every later request resolves the session by the
hash of its token, and the session alone decides tenant, widget, and who the
visitor is. Nothing in a request body or a chat message can change that.
"""

import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, Header, Request, status
from fastapi.responses import StreamingResponse

from docent.agent import repo as agent_repo
from docent.agent.loop import AgentDeps
from docent.api.deps import State, enforce, ip_key
from docent.api.errors import AppError, not_found, unauthenticated
from docent.api.schemas import (
    ContactIn,
    ErrorOut,
    MessageIn,
    MessageOut,
    WidgetConversationIn,
    WidgetConversationOut,
    WidgetHandoff,
    WidgetInfo,
    WidgetSessionIn,
    WidgetSessionOut,
    WidgetUser,
)
from docent.api.streaming import stream_turn
from docent.db.pool import Connection, transaction
from docent.ids import hash_token, new_token
from docent.security.ratelimit import Limit
from docent.widget import repo
from docent.widget.identity import IdentityError, normalize_origin, verify_token

router = APIRouter(
    prefix="/v1/widget",
    tags=["widget"],
    responses={401: {"model": ErrorOut}, 403: {"model": ErrorOut}, 429: {"model": ErrorOut}},
)

SESSIONS_PER_IP = Limit("widget-session-ip", 60, 3600)


@dataclass(frozen=True, slots=True)
class WidgetSession:
    token_hash: bytes
    tenant_id: uuid.UUID
    widget_id: uuid.UUID
    mode: str
    end_user_id: uuid.UUID | None
    visitor_id: str | None


async def widget_session(
    state: State, authorization: Annotated[str, Header()] = ""
) -> WidgetSession:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not 10 <= len(token) <= 200:
        raise unauthenticated()
    async with transaction(state.pool, widget_session_hash=hash_token(token)) as conn:
        row = await repo.live_session(conn)
    if row is None:
        raise AppError(401, "session_expired", "Start the conversation again.")
    return WidgetSession(
        token_hash=row["token_hash"],
        tenant_id=row["tenant_id"],
        widget_id=row["widget_id"],
        mode=row["mode"],
        end_user_id=row["end_user_id"],
        visitor_id=row["visitor_id"],
    )


Session = Annotated[WidgetSession, Depends(widget_session)]


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def create_session(
    body: WidgetSessionIn, request: Request, state: State, origin: Annotated[str, Header()] = ""
) -> WidgetSessionOut:
    s = state.settings
    if origin.rstrip("/") != s.widget_origin.rstrip("/"):
        raise AppError(403, "origin_not_allowed", "Sessions are created from the widget only.")
    await enforce(state, SESSIONS_PER_IP, ip_key(request, state))
    async with transaction(state.pool, widget_public_id=body.widget) as conn:
        widget = await repo.widget_by_public_id(conn)
        keys = await repo.active_keys(conn, widget["id"]) if widget else {}
    if widget is None:
        raise AppError(404, "widget_not_found", "This widget does not exist.")
    try:
        parent = normalize_origin(body.parent_origin, allow_http=True)
    except IdentityError:
        parent = ""
    if parent not in widget["allowed_origins"]:
        raise AppError(403, "origin_not_allowed", "This site is not allowed to use this widget.")

    identity = None
    if body.token:
        try:
            identity = verify_token(
                body.token,
                widget_public_id=body.widget,
                keys=keys,
                allowed_claims=list(widget["allowed_claims"]),
                max_lifetime=s.widget_token_max_lifetime_seconds,
                skew=s.widget_clock_skew_seconds,
            )
        except IdentityError as exc:
            raise AppError(
                401, "token_invalid", f"The sign-in token was rejected: {exc}."
            ) from None
    elif not widget["anonymous_enabled"]:
        raise AppError(403, "anonymous_disabled", "Chat is available after you sign in.")

    tenant_id = widget["tenant_id"]
    visitor_id = None if identity else (body.visitor_id or new_token()[:32])
    ttl = timedelta(minutes=s.widget_session_minutes)
    async with transaction(state.pool, tenant_id=tenant_id) as conn:
        end_user_id = await repo.upsert_end_user(conn, tenant_id, identity) if identity else None
        try:
            token, expires_at = await repo.create_session(
                conn,
                tenant_id=tenant_id,
                widget_id=widget["id"],
                mode="identified" if identity else "anonymous",
                end_user_id=end_user_id,
                visitor_id=visitor_id,
                jti=identity.jti if identity else None,
                parent_origin=parent,
                ip_hash=ip_key(request, state),
                ttl=ttl,
            )
        except asyncpg.UniqueViolationError:
            raise AppError(401, "token_invalid", "This sign-in token was already used.") from None
    return WidgetSessionOut(
        session_token=token,
        expires_at=expires_at,
        expires_in=int(ttl.total_seconds()),
        mode="identified" if identity else "anonymous",
        visitor_id=visitor_id,
        user=WidgetUser(name=identity.name if identity else None),
        widget=WidgetInfo(name=widget["name"], greeting=widget["greeting"]),
    )


@router.delete("/sessions/current", status_code=status.HTTP_204_NO_CONTENT)
async def end_session(session: Session, state: State) -> None:
    async with transaction(state.pool, tenant_id=session.tenant_id) as conn:
        await conn.execute(
            "update widget_sessions set revoked_at = now() where token_hash = $1",
            session.token_hash,
        )


@router.post(
    "/conversations", status_code=status.HTTP_201_CREATED, responses={404: {"model": ErrorOut}}
)
async def open_conversation(
    body: WidgetConversationIn, session: Session, state: State
) -> WidgetConversationOut:
    """Resume this visitor's conversation, or start one. Opening the panel passes
    create=false, so a visitor who never writes leaves no empty conversation behind."""
    async with transaction(state.pool, tenant_id=session.tenant_id) as conn:
        conversation_id = await _resumable(conn, session, body.resume_id)
        if conversation_id is None and not body.create:
            raise AppError(404, "no_conversation", "There is no conversation to resume.")
        if conversation_id is None:
            claims = await _claims(conn, session)
            conversation_id = await agent_repo.create_conversation(
                conn,
                tenant_id=session.tenant_id,
                channel="widget",
                mode=session.mode,
                claims=claims,
                visitor_id=session.visitor_id,
            )
            await conn.execute(
                "update conversations set widget_id = $2, end_user_id = $3 where id = $1",
                conversation_id,
                session.widget_id,
                session.end_user_id,
            )
        return await _conversation_out(conn, conversation_id)


@router.post(
    "/conversations/{conversation_id}/messages",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def send(
    conversation_id: uuid.UUID, body: MessageIn, request: Request, session: Session, state: State
) -> StreamingResponse:
    s = state.settings
    if session.mode == "identified":
        limit = Limit("widget-user", s.widget_identified_per_hour, 3600)
        await enforce(state, limit, str(session.end_user_id))
    else:
        limit = Limit("widget-anon", s.widget_anonymous_per_hour, 3600)
        await enforce(state, limit, ip_key(request, state))
    async with transaction(state.pool, tenant_id=session.tenant_id) as conn:
        await _owned(conn, session, conversation_id)
        if session.mode == "anonymous":
            widget_cap = await conn.fetchval(
                "select anonymous_daily_cap from widgets where id = $1", session.widget_id
            )
            if await repo.anonymous_messages_today(conn, session.widget_id) >= widget_cap:
                raise AppError(
                    429, "anonymous_cap", "Chat is busy today. Sign in or try again tomorrow."
                )
    deps = AgentDeps(
        settings=s, pool=state.pool, embedder=state.embedder, llm=state.llm, waker=state.waker
    )
    return stream_turn(deps, session.tenant_id, conversation_id, body.content)


@router.post("/conversations/{conversation_id}/contact", status_code=status.HTTP_204_NO_CONTENT)
async def set_contact(
    conversation_id: uuid.UUID, body: ContactIn, session: Session, state: State
) -> None:
    async with transaction(state.pool, tenant_id=session.tenant_id) as conn:
        await _owned(conn, session, conversation_id)
        await conn.execute(
            """
            update escalations set contact_email = $2
            where conversation_id = $1 and status <> 'resolved'
            """,
            conversation_id,
            str(body.email),
        )


async def _owned(conn: Connection, session: WidgetSession, conversation_id: uuid.UUID) -> None:
    """A widget session may only touch its own visitor's conversations."""
    owned = await conn.fetchval(
        """
        select exists(select 1 from conversations
                      where id = $1 and widget_id = $2
                        and (end_user_id = $3 or (end_user_id is null and visitor_id = $4)))
        """,
        conversation_id,
        session.widget_id,
        session.end_user_id,
        session.visitor_id,
    )
    if not owned:
        raise not_found("Conversation")


async def _resumable(
    conn: Connection, session: WidgetSession, resume_id: uuid.UUID | None
) -> uuid.UUID | None:
    if session.end_user_id:
        latest: uuid.UUID | None = await conn.fetchval(
            """
            select id from conversations
            where widget_id = $1 and end_user_id = $2 and status <> 'closed'
            order by last_message_at desc limit 1
            """,
            session.widget_id,
            session.end_user_id,
        )
        return latest
    if resume_id is None:
        return None
    try:
        await _owned(conn, session, resume_id)
    except AppError:
        return None
    return resume_id


async def _claims(conn: Connection, session: WidgetSession) -> dict[str, str]:
    if session.end_user_id is None:
        return {}
    row = await conn.fetchrow(
        "select name, email, claims from end_users where id = $1", session.end_user_id
    )
    assert row is not None
    base = {"name": row["name"], "email": row["email"]}
    return {k: v for k, v in (base | dict(row["claims"])).items() if v}


async def _conversation_out(conn: Connection, conversation_id: uuid.UUID) -> WidgetConversationOut:
    row = await agent_repo.get_conversation(conn, conversation_id)
    assert row is not None
    messages = await agent_repo.conversation_messages(conn, conversation_id)
    handoff = await conn.fetchrow(
        """
        select e.status, (e.contact_email is not null or u.email is not null) as contact_given
        from escalations e
        join conversations c on c.id = e.conversation_id
        left join end_users u on u.id = c.end_user_id
        where e.conversation_id = $1
        order by e.created_at desc limit 1
        """,
        conversation_id,
    )
    return WidgetConversationOut(
        id=row["id"],
        status=row["status"],
        handoff=WidgetHandoff(**dict(handoff)) if handoff else None,
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
    )
