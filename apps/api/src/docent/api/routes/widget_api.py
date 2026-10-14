"""The API the widget frame calls. No cookies: a session token in the Authorization header.

Sessions are created from a widget public id plus, in identified mode, a token
the tenant's server signed. Every later request resolves the session by the
hash of its token, and the session alone decides tenant, widget, and who the
visitor is. Nothing in a request body or a chat message can change that.

Every conversation read or write is scoped to the session's widget and visitor:
the verified end user in identified mode, the visitor id in anonymous mode.
That includes "Was this helpful?" votes: only answers in the visitor's own
conversations can be rated.
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
    FeedbackIn,
    MessageFeedbackOut,
    MessageIn,
    MessageOut,
    WidgetConversationIn,
    WidgetConversationOut,
    WidgetConversationSummaryOut,
    WidgetHandoff,
    WidgetInfo,
    WidgetSessionIn,
    WidgetSessionOut,
    WidgetUser,
)
from docent.api.streaming import stream_turn
from docent.db.pool import Connection, transaction
from docent.ids import hash_token, new_id, new_token
from docent.security.ratelimit import Limit
from docent.widget import repo
from docent.widget.identity import IdentityError, normalize_origin, verify_token

router = APIRouter(
    prefix="/v1/widget",
    tags=["widget"],
    responses={401: {"model": ErrorOut}, 403: {"model": ErrorOut}, 429: {"model": ErrorOut}},
)

SESSIONS_PER_IP = Limit("widget-session-ip", 60, 3600)
RECENT_CONVERSATIONS = 10


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
        widget=WidgetInfo(
            name=widget["name"],
            greeting=widget["greeting"],
            suggestions=list(widget["suggestions"]),
        ),
    )


@router.delete("/sessions/current", status_code=status.HTTP_204_NO_CONTENT)
async def end_session(session: Session, state: State) -> None:
    async with transaction(state.pool, tenant_id=session.tenant_id) as conn:
        await conn.execute(
            "update widget_sessions set revoked_at = now() where token_hash = $1",
            session.token_hash,
        )


@router.get("/conversations")
async def recent_conversations(
    session: Session, state: State
) -> list[WidgetConversationSummaryOut]:
    """A signed-in customer's latest conversations on this widget, newest first.

    Only conversations with a message from them are listed. Anonymous visitors
    have no history to list, so they get an empty list.
    """
    if session.end_user_id is None:
        return []
    async with transaction(state.pool, tenant_id=session.tenant_id) as conn:
        rows = await conn.fetch(
            """
            select c.id, c.status, c.started_at, c.last_message_at, left(f.content, 120) as title
            from conversations c
            join lateral (
              select m.content from messages m
              where m.conversation_id = c.id and m.role = 'visitor'
              order by m.created_at limit 1
            ) f on true
            where c.widget_id = $1 and c.end_user_id = $2
            order by c.last_message_at desc
            limit $3
            """,
            session.widget_id,
            session.end_user_id,
            RECENT_CONVERSATIONS,
        )
    return [
        WidgetConversationSummaryOut(
            id=r["id"],
            status=r["status"],
            title=" ".join(r["title"].split()),
            started_at=r["started_at"],
            last_message_at=r["last_message_at"],
        )
        for r in rows
    ]


@router.get("/conversations/{conversation_id}", responses={404: {"model": ErrorOut}})
async def read_conversation(
    conversation_id: uuid.UUID, session: Session, state: State
) -> WidgetConversationOut:
    """One of this visitor's own conversations, for the recent chats view."""
    async with transaction(state.pool, tenant_id=session.tenant_id) as conn:
        await _owned(conn, session, conversation_id)
        return await _conversation_out(conn, conversation_id)


@router.post(
    "/conversations", status_code=status.HTTP_201_CREATED, responses={404: {"model": ErrorOut}}
)
async def open_conversation(
    body: WidgetConversationIn, request: Request, session: Session, state: State
) -> WidgetConversationOut:
    """Resume this visitor's conversation, or start one. Opening the panel passes
    create=false, so a visitor who never writes leaves no empty conversation behind.
    new=true always starts one (the visitor chose "New chat"); the previous
    conversation stays as it is for the team."""
    if body.new or body.create:
        limit = Limit("widget-new", state.settings.widget_new_conversations_per_hour, 3600)
        who = str(session.end_user_id) if session.end_user_id else ip_key(request, state)
        await enforce(state, limit, who)
    async with transaction(state.pool, tenant_id=session.tenant_id) as conn:
        conversation_id = None if body.new else await _resumable(conn, session, body.resume_id)
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
    responses={200: {"content": {"text/event-stream": {}}}, 409: {"model": ErrorOut}},
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
        if await _owned(conn, session, conversation_id) == "closed":
            raise AppError(
                409, "conversation_closed", "This conversation is closed. Start a new one."
            )
        if session.mode == "anonymous":
            widget_cap = await conn.fetchval(
                "select anonymous_daily_cap from widgets where id = $1", session.widget_id
            )
            if await repo.anonymous_messages_today(conn, session.widget_id) >= widget_cap:
                raise AppError(
                    429, "anonymous_cap", "Chat is busy today. Sign in or try again tomorrow."
                )
    deps = AgentDeps(
        settings=s,
        pool=state.pool,
        embedder=state.embedder,
        llm=state.llm,
        waker=state.waker,
        cache=state.cache,
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


@router.put(
    "/conversations/{conversation_id}/messages/{message_id}/feedback",
    responses={404: {"model": ErrorOut}, 422: {"model": ErrorOut}},
)
async def rate_answer(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    body: FeedbackIn,
    request: Request,
    session: Session,
    state: State,
) -> MessageFeedbackOut:
    """Was this helpful? One vote per answer; voting again changes it. A note on what
    was wrong is kept with a thumbs down only."""
    await _limit_feedback(request, session, state)
    comment = body.comment if body.vote == "down" else ""
    async with transaction(state.pool, tenant_id=session.tenant_id) as conn:
        await _owned(conn, session, conversation_id)
        await _answer(conn, conversation_id, message_id)
        row = await conn.fetchrow(
            """
            insert into message_feedback (id, tenant_id, conversation_id, message_id,
                                          end_user_id, visitor_id, vote, comment)
            values ($1, $2, $3, $4, $5, $6, $7, $8)
            on conflict (message_id) do update
              set vote = excluded.vote, comment = excluded.comment, updated_at = now()
            returning vote, comment, updated_at
            """,
            new_id(),
            session.tenant_id,
            conversation_id,
            message_id,
            session.end_user_id,
            session.visitor_id,
            body.vote,
            comment,
        )
    assert row is not None
    return MessageFeedbackOut(**dict(row))


@router.delete(
    "/conversations/{conversation_id}/messages/{message_id}/feedback",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorOut}},
)
async def take_back_vote(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    request: Request,
    session: Session,
    state: State,
) -> None:
    await _limit_feedback(request, session, state)
    async with transaction(state.pool, tenant_id=session.tenant_id) as conn:
        await _owned(conn, session, conversation_id)
        await _answer(conn, conversation_id, message_id)
        await conn.execute("delete from message_feedback where message_id = $1", message_id)


async def _limit_feedback(request: Request, session: WidgetSession, state: State) -> None:
    """Votes are limited like messages: per customer, or per address when anonymous."""
    per_hour = state.settings.widget_feedback_per_hour
    if session.mode == "identified":
        await enforce(state, Limit("widget-vote-user", per_hour, 3600), str(session.end_user_id))
    else:
        await enforce(state, Limit("widget-vote-anon", per_hour, 3600), ip_key(request, state))


async def _answer(conn: Connection, conversation_id: uuid.UUID, message_id: uuid.UUID) -> None:
    """The message must be an agent answer in this conversation: not a greeting, a
    clarifying question, a handoff, or a message from anyone else."""
    row = await conn.fetchrow(
        """
        select role, decision ->> 'type' as kind from messages
        where id = $1 and conversation_id = $2
        """,
        message_id,
        conversation_id,
    )
    if row is None:
        raise not_found("Message")
    if row["role"] != "agent" or row["kind"] != "answer":
        raise AppError(422, "not_an_answer", "Only the agent's answers can be rated.")


async def _owned(conn: Connection, session: WidgetSession, conversation_id: uuid.UUID) -> str:
    """A widget session may only touch its own visitor's conversations. Returns the status."""
    status_: str | None = await conn.fetchval(
        """
        select status from conversations
        where id = $1 and widget_id = $2
          and (end_user_id = $3 or (end_user_id is null and visitor_id = $4))
        """,
        conversation_id,
        session.widget_id,
        session.end_user_id,
        session.visitor_id,
    )
    if status_ is None:
        raise not_found("Conversation")
    return status_


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
        closed = await _owned(conn, session, resume_id) == "closed"
    except AppError:
        return None
    # A resolved handoff closes its conversation, so the widget starts fresh.
    return None if closed else resume_id


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
                feedback=(
                    MessageFeedbackOut(
                        vote=m["vote"], comment=m["feedback_comment"], updated_at=m["voted_at"]
                    )
                    if m["vote"]
                    else None
                ),
            )
            for m in messages
        ],
    )
