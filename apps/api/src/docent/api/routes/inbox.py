"""The inbox: handoffs for the team to work.

Every member (the agent role too) can list and read handoffs, reply by email,
add notes, change status and priority, edit fields, take a handoff, and mark an
agent answer as wrong. Assigning someone else, and the workspace's reply
address, need an owner or admin.
"""

import uuid
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, Query, status

from docent.agent import repo as agent_repo
from docent.api.deps import (
    AdminMember,
    CurrentMember,
    Member,
    State,
    enforce,
    require_verified_email,
)
from docent.api.errors import AppError, forbidden, not_found
from docent.api.schemas import (
    AssigneeOut,
    BoardColumnOut,
    CitationOut,
    CustomerOut,
    DecisionOut,
    EmailDeliveryOut,
    ErrorOut,
    EscalationStatus,
    EscalationSummaryOut,
    FlagIn,
    HandoffReason,
    HistoryEntryOut,
    InboxBoardOut,
    InboxCountsOut,
    InboxDetailOut,
    InboxItemOut,
    InboxMessageOut,
    InboxPageOut,
    InboxSettingsIn,
    InboxSettingsOut,
    InboxSort,
    InboxStatsOut,
    InboxUpdateIn,
    MessageFeedbackOut,
    MessageFlagOut,
    NoteIn,
    NoteOut,
    NotificationPrefs,
    PersonOut,
    ReplyIn,
    ReplyOut,
    TicketField,
    TicketTypeRef,
)
from docent.db.pool import Connection, transaction
from docent.email.sender import sender_address
from docent.ids import new_id
from docent.inbox import deliveries, events, metrics, notify
from docent.inbox import repo as inbox_repo
from docent.inbox.repo import BadCursor, Filters
from docent.security import ratelimit
from docent.services import audit

router = APIRouter(
    prefix="/v1",
    tags=["inbox"],
    responses={
        403: {"model": ErrorOut},
        404: {"model": ErrorOut},
        409: {"model": ErrorOut},
        422: {"model": ErrorOut},
    },
)

STATUS_LABEL = {
    "open": "Open",
    "assigned": "Assigned",
    "waiting": "Waiting on customer",
    "resolved": "Resolved",
}
BOARD_COLUMN_SIZE = 50

AssigneeFilter = Annotated[
    str | None,
    Query(
        pattern=r"^(me|unassigned|any|[0-9a-fA-F-]{36})$",
        description="me, unassigned, any, or a member's user id",
    ),
]


def _filters(
    statuses: list[str],
    ticket_type_id: uuid.UUID | None,
    reasons: list[str],
    assignee: str | None,
    q: str | None,
    unread: bool,
) -> Filters:
    return Filters(
        statuses=statuses,
        ticket_type_id=ticket_type_id,
        reasons=reasons,
        assignee=None if assignee in (None, "any") else assignee,
        query=q.strip() if q and q.strip() else None,
        unread_only=unread,
    )


def _item(row: asyncpg.Record) -> InboxItemOut:
    return InboxItemOut(
        id=row["id"],
        status=row["status"],
        reason=row["reason"],
        priority=row["priority"],
        issue=row["issue"],
        ticket_type=(
            TicketTypeRef(id=row["ticket_type_id"], name=row["ticket_type_name"])
            if row["ticket_type_id"]
            else None
        ),
        contact_email=row["contact_email"],
        customer_name=row["customer_name"],
        mode=row["mode"],
        channel=row["channel"],
        assignee=(
            PersonOut(id=row["assignee_user_id"], name=row["assignee_name"] or "Former member")
            if row["assignee_user_id"]
            else None
        ),
        unread=row["unread"],
        summary_ready=row["summary_ready"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        first_response_at=row["first_response_at"],
        resolved_at=row["resolved_at"],
    )


def _counts(row: asyncpg.Record) -> InboxCountsOut:
    return InboxCountsOut(**dict(row))


@router.get("/inbox")
async def list_inbox(
    member: CurrentMember,
    state: State,
    statuses: Annotated[list[EscalationStatus], Query(alias="status")] = [],  # noqa: B006
    ticket_type_id: uuid.UUID | None = None,
    reasons: Annotated[list[HandoffReason], Query(alias="reason")] = [],  # noqa: B006
    assignee: AssigneeFilter = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    unread: bool = False,
    sort: InboxSort = "newest",
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    cursor: Annotated[str | None, Query(max_length=500)] = None,
) -> InboxPageOut:
    filters = _filters(list(statuses), ticket_type_id, list(reasons), assignee, q, unread)
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        try:
            rows, next_cursor = await inbox_repo.list_page(
                conn, member.user_id, filters, sort=sort, limit=limit, cursor=cursor
            )
        except BadCursor:
            raise AppError(
                422, "invalid_cursor", "Start again from the first page.", {"cursor": "Invalid."}
            ) from None
        counts = await inbox_repo.counts(conn, member.user_id)
    return InboxPageOut(
        items=[_item(r) for r in rows], next_cursor=next_cursor, counts=_counts(counts)
    )


@router.get("/inbox/board")
async def inbox_board(
    member: CurrentMember,
    state: State,
    ticket_type_id: uuid.UUID | None = None,
    reasons: Annotated[list[HandoffReason], Query(alias="reason")] = [],  # noqa: B006
    assignee: AssigneeFilter = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
) -> InboxBoardOut:
    """Handoffs by status. Each column shows its first 50; resolved shows the latest."""
    filters = _filters([], ticket_type_id, list(reasons), assignee, q, False)
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        columns = await inbox_repo.board(
            conn, member.user_id, filters, per_column=BOARD_COLUMN_SIZE
        )
        counts = await inbox_repo.counts(conn, member.user_id)
    return InboxBoardOut(
        columns=[
            BoardColumnOut(status=s, total=total, items=[_item(r) for r in items])  # type: ignore[arg-type]
            for s, (total, items) in columns.items()
        ],
        counts=_counts(counts),
    )


@router.get("/inbox/stats")
async def inbox_stats(member: CurrentMember, state: State) -> InboxStatsOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        work = await metrics.workload(conn, member.user_id)
        quality = await metrics.answer_quality(conn, 30)
    median = work["median_first_response_minutes"]
    return InboxStatsOut(
        open=int(str(work["open"])),
        unassigned=int(str(work["unassigned"])),
        mine=int(str(work["mine"])),
        waiting=int(str(work["waiting"])),
        resolved_7d=int(str(work["resolved_7d"])),
        median_first_response_minutes=round(float(str(median)), 1) if median is not None else None,
        answers_30d=quality.answers,
        wrong_answers_30d=quality.flagged_wrong,
        wrong_answer_rate_30d=quality.wrong_rate,
    )


@router.get("/inbox/assignees")
async def list_assignees(member: CurrentMember, state: State) -> list[AssigneeOut]:
    """Everyone a handoff can be assigned to. Names only, for every role."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        rows = await conn.fetch(
            """
            select m.user_id, u.name, m.role from memberships m join users u on u.id = m.user_id
            where m.tenant_id = $1 order by lower(u.name)
            """,
            member.tenant_id,
        )
    return [
        AssigneeOut(
            id=r["user_id"], name=r["name"], role=r["role"], is_you=r["user_id"] == member.user_id
        )
        for r in rows
    ]


@router.get("/inbox/settings")
async def get_inbox_settings(member: CurrentMember, state: State) -> InboxSettingsOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        workspace, support = await _workspace(conn, member.tenant_id)
    return InboxSettingsOut(
        support_email=support, reply_from=_reply_from(state.settings.email_from, workspace)
    )


@router.patch("/inbox/settings")
async def update_inbox_settings(
    body: InboxSettingsIn, member: AdminMember, state: State
) -> InboxSettingsOut:
    support = str(body.support_email).lower() if body.support_email else None
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await conn.execute(
            """
            update tenants
            set settings = jsonb_set(
                  settings, '{inbox}',
                  coalesce(settings -> 'inbox', '{}')
                    || jsonb_build_object('support_email', $2::text)),
                updated_at = now()
            where id = $1
            """,
            member.tenant_id,
            support,
        )
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="inbox.settings_updated",
            target_type="tenant",
            target_id=member.tenant_id,
            metadata={"support_email": support},
        )
        workspace, saved = await _workspace(conn, member.tenant_id)
    return InboxSettingsOut(
        support_email=saved, reply_from=_reply_from(state.settings.email_from, workspace)
    )


@router.get("/inbox/preferences")
async def get_preferences(member: CurrentMember, state: State) -> NotificationPrefs:
    """Your own notification choices in this workspace."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        row = await conn.fetchrow(
            "select daily_digest, assigned_email from notification_preferences where user_id = $1",
            member.user_id,
        )
    return NotificationPrefs(
        daily_digest=row["daily_digest"] if row else True,
        assigned_email=row["assigned_email"] if row else True,
    )


@router.put("/inbox/preferences")
async def update_preferences(
    body: NotificationPrefs, member: CurrentMember, state: State
) -> NotificationPrefs:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await conn.execute(
            """
            insert into notification_preferences (tenant_id, user_id, daily_digest, assigned_email)
            values ($1, $2, $3, $4)
            on conflict (tenant_id, user_id) do update
              set daily_digest = excluded.daily_digest, assigned_email = excluded.assigned_email,
                  updated_at = now()
            """,
            member.tenant_id,
            member.user_id,
            body.daily_digest,
            body.assigned_email,
        )
    return body


@router.get("/inbox/{escalation_id}")
async def get_handoff(
    escalation_id: uuid.UUID, member: CurrentMember, state: State
) -> InboxDetailOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return await _detail(conn, state.settings.email_from, member, escalation_id)


@router.post("/inbox/{escalation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(escalation_id: uuid.UUID, member: CurrentMember, state: State) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _lock(conn, escalation_id)
        await inbox_repo.mark_read(conn, member.tenant_id, member.user_id, escalation_id)


@router.patch("/inbox/{escalation_id}")
async def update_handoff(
    escalation_id: uuid.UUID, body: InboxUpdateIn, member: CurrentMember, state: State
) -> InboxDetailOut:
    sent = body.model_fields_set
    admin = member.role in ("owner", "admin")
    queued = False
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        cur = await _lock(conn, escalation_id)
        old_status, old_assignee = cur["status"], cur["assignee_user_id"]
        new_status, assignee = old_status, old_assignee
        priority, type_id = cur["priority"], cur["ticket_type_id"]
        fields: dict[str, str] = dict(cur["fields"] or {})
        changes: list[str] = []

        if "assignee_user_id" in sent and body.assignee_user_id != assignee:
            target = body.assignee_user_id
            _check_assign(admin, member.user_id, current=assignee, target=target)
            if target is not None and not await _is_member(conn, member.tenant_id, target):
                raise AppError(
                    422,
                    "not_a_member",
                    "That person is not in this workspace.",
                    {"assignee_user_id": "Not a member of this workspace."},
                )
            assignee = target
            changes.append("assignee")
        if body.status is not None and body.status != old_status:
            new_status = body.status
            if new_status == "assigned" and assignee is None:
                assignee = member.user_id  # moving it to Assigned takes it
                changes.append("assignee")
            elif new_status == "open" and assignee is not None and "assignee_user_id" not in sent:
                # Back to the queue: nobody is on it any more.
                _check_assign(admin, member.user_id, current=assignee, target=None)
                assignee = None
                changes.append("assignee")
            changes.append("status")
        elif "assignee" in changes:
            if assignee is not None and old_status == "open":
                new_status = "assigned"
                changes.append("status")
            elif assignee is None and old_status == "assigned":
                new_status = "open"
                changes.append("status")
        if body.priority is not None and body.priority != priority:
            priority = body.priority
            changes.append("priority")
        if "ticket_type_id" in sent and body.ticket_type_id != type_id:
            if body.ticket_type_id is not None and not await conn.fetchval(
                "select exists(select 1 from ticket_types where id = $1)", body.ticket_type_id
            ):
                raise AppError(
                    422,
                    "unknown_ticket_type",
                    "That ticket type does not exist.",
                    {"ticket_type_id": "Unknown ticket type."},
                )
            type_id = body.ticket_type_id
            changes.append("ticket_type")
        allowed = {f.key for f in await _type_fields(conn, type_id)}
        if body.fields is not None:
            unknown = sorted(set(body.fields) - allowed)
            if unknown:
                raise AppError(
                    422,
                    "unknown_field",
                    "Some details do not belong to this ticket type.",
                    {"fields": f"Not a detail of this ticket type: {', '.join(unknown)}."},
                )
            edited = {k: v for k, v in body.fields.items() if v}
            if edited != fields:
                fields = edited
                changes.append("fields")
        elif "ticket_type" in changes:
            fields = {k: v for k, v in fields.items() if k in allowed}

        if changes:
            await conn.execute(
                """
                update escalations
                set status = $2, assignee_user_id = $3, priority = $4, ticket_type_id = $5,
                    fields = $6, updated_at = now(),
                    resolved_at = case when $2 = 'resolved' then coalesce(resolved_at, now()) end
                where id = $1
                """,
                escalation_id,
                new_status,
                assignee,
                priority,
                type_id,
                fields,
            )
            await _sync_conversation(conn, cur["conversation_id"], old_status, new_status)
            await _audit_changes(
                conn,
                member,
                escalation_id,
                changes,
                old_status=old_status,
                new_status=new_status,
                assignee=assignee,
                priority=priority,
                type_id=type_id,
            )
            if "assignee" in changes and assignee and assignee != member.user_id:
                await notify.notify_in_app(
                    conn,
                    tenant_id=member.tenant_id,
                    user_id=assignee,
                    kind="assigned",
                    escalation_id=escalation_id,
                    dedupe_key=f"app:assigned:{escalation_id}:{assignee}:{new_id()}",
                    payload={"by": member.user.name},
                )
                queued = await _email_assignee(conn, state, member, escalation_id, assignee)
            queued = (
                await _emit_update(
                    conn, state, member, escalation_id, changes, old_status, new_status
                )
                or queued
            )
        await inbox_repo.mark_read(conn, member.tenant_id, member.user_id, escalation_id)
        detail = await _detail(conn, state.settings.email_from, member, escalation_id)
    if queued:
        await state.waker.wake()
    return detail


@router.post(
    "/inbox/{escalation_id}/replies",
    status_code=status.HTTP_201_CREATED,
    responses={429: {"model": ErrorOut}},
)
async def reply(
    escalation_id: uuid.UUID, body: ReplyIn, member: CurrentMember, state: State
) -> ReplyOut:
    """Email the customer. The reply is kept in the conversation as a team message."""
    require_verified_email(member, "replying to customers by email")
    await enforce(state, ratelimit.INBOX_REPLY_PER_USER, str(member.user_id))
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        cur = await _lock(conn, escalation_id)
        contact = cur["contact_email"]
        if not contact:
            raise AppError(
                409,
                "no_contact",
                "This customer did not leave an email, so a reply cannot reach them.",
            )
        workspace, support = await _workspace(conn, member.tenant_id)
        message_id = await agent_repo.add_message(
            conn,
            tenant_id=member.tenant_id,
            conversation_id=cur["conversation_id"],
            role="human",
            content=body.body,
        )
        await conn.execute(
            "update messages set author_user_id = $2 where id = $1", message_id, member.user_id
        )
        subject = f"Your question to {workspace}"
        await deliveries.queue_email(
            conn,
            tenant_id=member.tenant_id,
            secret=state.settings.secret_key.get_secret_value(),
            to=contact,
            subject=subject,
            template="inbox_reply",
            data={
                "workspace": workspace,
                "sender_name": member.user.name,
                "body": body.body,
                "subject": subject,
                "reply_to": support or member.user.email,
                "handoff_id": str(escalation_id),
            },
            kind="reply",
            escalation_id=escalation_id,
            message_id=message_id,
        )
        old_status, old_assignee = cur["status"], cur["assignee_user_id"]
        new_status = old_status if body.then == "keep" else body.then
        if new_status == "open":
            new_status = "assigned"
        assignee = old_assignee or member.user_id  # replying takes an unowned handoff
        await conn.execute(
            """
            update escalations
            set status = $2, assignee_user_id = $3,
                first_response_at = coalesce(first_response_at, now()), updated_at = now(),
                resolved_at = case when $2 = 'resolved' then coalesce(resolved_at, now()) end
            where id = $1
            """,
            escalation_id,
            new_status,
            assignee,
        )
        await _sync_conversation(conn, cur["conversation_id"], old_status, new_status)
        changes = ["reply"]
        if assignee != old_assignee:
            changes.append("assignee")
        if new_status != old_status:
            changes.append("status")
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="escalation.replied",
            target_type="escalation",
            target_id=escalation_id,
            metadata={"to": deliveries.mask_email(contact)},
        )
        await _audit_changes(
            conn,
            member,
            escalation_id,
            [c for c in changes if c != "reply"],
            old_status=old_status,
            new_status=new_status,
            assignee=assignee,
            priority=cur["priority"],
            type_id=cur["ticket_type_id"],
        )
        await _emit_update(conn, state, member, escalation_id, changes, old_status, new_status)
        await inbox_repo.mark_read(conn, member.tenant_id, member.user_id, escalation_id)
        message = next(
            m
            for m in await _messages(conn, cur["conversation_id"], escalation_id)
            if m.id == message_id
        )
        item = await inbox_repo.get_item(conn, member.user_id, escalation_id)
    assert item is not None
    await state.waker.wake()
    return ReplyOut(message=message, item=_item(item))


@router.post("/inbox/{escalation_id}/notes", status_code=status.HTTP_201_CREATED)
async def add_note(
    escalation_id: uuid.UUID, body: NoteIn, member: CurrentMember, state: State
) -> NoteOut:
    """An internal note for the team. Customers never see it."""
    note_id = new_id()
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _lock(conn, escalation_id)
        created = await conn.fetchval(
            """
            insert into escalation_notes (id, tenant_id, escalation_id, author_user_id, body)
            values ($1, $2, $3, $4, $5) returning created_at
            """,
            note_id,
            member.tenant_id,
            escalation_id,
            member.user_id,
            body.body,
        )
        await inbox_repo.touch(conn, escalation_id)
        await inbox_repo.mark_read(conn, member.tenant_id, member.user_id, escalation_id)
    return NoteOut(
        id=note_id,
        body=body.body,
        author=PersonOut(id=member.user_id, name=member.user.name),
        created_at=created,
        can_delete=True,
    )


@router.delete("/inbox/{escalation_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    escalation_id: uuid.UUID, note_id: uuid.UUID, member: CurrentMember, state: State
) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        author = await conn.fetchrow(
            "select author_user_id from escalation_notes where id = $1 and escalation_id = $2",
            note_id,
            escalation_id,
        )
        if author is None:
            raise not_found("Note")
        if author["author_user_id"] != member.user_id and member.role not in ("owner", "admin"):
            raise forbidden("Only the author or an admin can delete a note.")
        await conn.execute("delete from escalation_notes where id = $1", note_id)


@router.post("/messages/{message_id}/flag")
async def flag_message(
    message_id: uuid.UUID, body: FlagIn, member: CurrentMember, state: State
) -> InboxMessageOut:
    """Mark an agent message as a wrong answer. It counts in the answer quality numbers."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        conversation_id = await _agent_message(conn, message_id)
        await conn.execute(
            """
            update messages
            set flagged_wrong = true, flag_reason = $2, flagged_by = $3, flagged_at = now()
            where id = $1
            """,
            message_id,
            body.reason,
            member.user_id,
        )
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="message.flagged_wrong",
            target_type="message",
            target_id=message_id,
        )
        return await _one_message(conn, conversation_id, message_id)


@router.delete("/messages/{message_id}/flag")
async def unflag_message(
    message_id: uuid.UUID, member: CurrentMember, state: State
) -> InboxMessageOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        conversation_id = await _agent_message(conn, message_id)
        await conn.execute(
            """
            update messages
            set flagged_wrong = false, flag_reason = null, flagged_by = null, flagged_at = null
            where id = $1
            """,
            message_id,
        )
        return await _one_message(conn, conversation_id, message_id)


# Helpers


def _reply_from(email_from: str, workspace: str) -> str:
    return sender_address(email_from, f"{workspace} via Docent")


async def _workspace(conn: Connection, tenant_id: uuid.UUID) -> tuple[str, str | None]:
    row = await conn.fetchrow("select name, settings from tenants where id = $1", tenant_id)
    assert row is not None
    inbox = (row["settings"] or {}).get("inbox") or {}
    return row["name"], inbox.get("support_email") or None


async def _lock(conn: Connection, escalation_id: uuid.UUID) -> asyncpg.Record:
    row = await conn.fetchrow(
        """
        select id, status, assignee_user_id, priority, ticket_type_id, fields, conversation_id,
               contact_email
        from escalations where id = $1 for update
        """,
        escalation_id,
    )
    if row is None:
        raise not_found("Handoff")
    return row


def _check_assign(
    admin: bool, me: uuid.UUID, *, current: uuid.UUID | None, target: uuid.UUID | None
) -> None:
    """Agents can take a handoff nobody has, or let go of their own. Admins can do anything."""
    if admin:
        return
    if target not in (None, me) or current not in (None, me):
        raise forbidden("Only owners and admins can assign a handoff to someone else.")


async def _is_member(conn: Connection, tenant_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    return bool(
        await conn.fetchval(
            "select exists(select 1 from memberships where tenant_id = $1 and user_id = $2)",
            tenant_id,
            user_id,
        )
    )


async def _type_fields(conn: Connection, type_id: uuid.UUID | None) -> list[TicketField]:
    if type_id is None:
        return []
    raw = await conn.fetchval("select fields from ticket_types where id = $1", type_id)
    return [TicketField(**f) for f in (raw or [])]


async def _sync_conversation(
    conn: Connection, conversation_id: uuid.UUID, old_status: str, new_status: str
) -> None:
    """A resolved handoff closes its conversation, so the widget starts fresh next time."""
    if new_status == "resolved" and old_status != "resolved":
        await conn.execute(
            """
            update conversations set status = 'closed', closed_at = now()
            where id = $1 and not exists (
              select 1 from escalations where conversation_id = $1 and status <> 'resolved')
            """,
            conversation_id,
        )
    elif old_status == "resolved" and new_status != "resolved":
        await conn.execute(
            "update conversations set status = 'escalated', closed_at = null where id = $1",
            conversation_id,
        )


async def _audit_changes(
    conn: Connection,
    member: Member,
    escalation_id: uuid.UUID,
    changes: list[str],
    *,
    old_status: str,
    new_status: str,
    assignee: uuid.UUID | None,
    priority: str,
    type_id: uuid.UUID | None,
) -> None:
    async def record(action: str, metadata: dict[str, Any]) -> None:
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action=action,
            target_type="escalation",
            target_id=escalation_id,
            metadata=metadata,
        )

    if "assignee" in changes:
        if assignee is None:
            await record("escalation.unassigned", {})
        else:
            name = await conn.fetchval("select name from users where id = $1", assignee)
            await record("escalation.assigned", {"assignee_id": str(assignee), "assignee": name})
    if "status" in changes:
        await record("escalation.status_changed", {"from": old_status, "to": new_status})
    if "priority" in changes:
        await record("escalation.priority_changed", {"to": priority})
    if "ticket_type" in changes:
        name = (
            await conn.fetchval("select name from ticket_types where id = $1", type_id)
            if type_id
            else None
        )
        await record("escalation.ticket_type_changed", {"to": name})
    if "fields" in changes:
        await record("escalation.fields_updated", {})


async def _emit_update(
    conn: Connection,
    state: State,
    member: Member,
    escalation_id: uuid.UUID,
    changes: list[str],
    old_status: str,
    new_status: str,
) -> bool:
    resolved = new_status == "resolved" and old_status != "resolved"
    sent = await events.emit(
        conn,
        tenant_id=member.tenant_id,
        event_type="escalation.resolved" if resolved else "escalation.updated",
        escalation_id=escalation_id,
        web_origin=state.settings.web_origin,
        changes=changes,
    )
    return sent > 0


async def _email_assignee(
    conn: Connection, state: State, member: Member, escalation_id: uuid.UUID, assignee: uuid.UUID
) -> bool:
    """Tell a member someone else assigned them a handoff, unless they turned that off."""
    row = await conn.fetchrow(
        f"""
        select u.email, u.name, coalesce(p.assigned_email, true) as wanted,
               {events.ISSUE_SQL} as issue
        from escalations e
        join users u on u.id = $2
        left join notification_preferences p on p.user_id = u.id and p.tenant_id = e.tenant_id
        where e.id = $1
        """,  # noqa: S608
        escalation_id,
        assignee,
    )
    if row is None or not row["wanted"]:
        return False
    notification_id = await notify.notify_once(
        conn,
        tenant_id=member.tenant_id,
        kind="assigned",
        channel="email",
        escalation_id=escalation_id,
        user_id=assignee,
        dedupe_key=f"assigned:{escalation_id}:{assignee}:{new_id()}",
    )
    workspace, _ = await _workspace(conn, member.tenant_id)
    await deliveries.queue_email(
        conn,
        tenant_id=member.tenant_id,
        secret=state.settings.secret_key.get_secret_value(),
        to=row["email"],
        subject=f"[{workspace}] Assigned to you",
        template="handoff_assigned",
        data={
            "name": (row["name"] or "there").split()[0],
            "workspace": workspace,
            "issue": row["issue"][:200],
            "assigned_by": member.user.name,
            "url": f"{state.settings.web_origin.rstrip('/')}/app/inbox/{escalation_id}",
        },
        kind="notification",
        escalation_id=escalation_id,
        notification_id=notification_id,
    )
    return True


def _delivery(row: asyncpg.Record) -> EmailDeliveryOut:
    return EmailDeliveryOut(
        id=row["id"],
        kind=row["kind"],
        to_hint=row["to_hint"],
        subject=row["subject"],
        status=row["status"],
        attempts=row["attempts"],
        last_error=row["last_error"],
        created_at=row["created_at"],
        sent_at=row["sent_at"],
    )


def _message(row: asyncpg.Record, delivery: EmailDeliveryOut | None) -> InboxMessageOut:
    decision = row["decision"]
    return InboxMessageOut(
        id=row["id"],
        role=row["role"],
        content=row["content"],
        decision=DecisionOut(**decision) if decision else None,
        citations=[CitationOut(**c) for c in row["citations"]],
        created_at=row["created_at"],
        author=(
            PersonOut(id=row["author_user_id"], name=row["author_name"] or "Former member")
            if row["author_user_id"]
            else None
        ),
        flag=(
            MessageFlagOut(
                reason=row["flag_reason"] or "", by=row["flagged_by_name"], at=row["flagged_at"]
            )
            if row["flagged_wrong"] and row["flagged_at"]
            else None
        ),
        delivery=delivery,
        feedback=(
            MessageFeedbackOut(
                vote=row["vote"], comment=row["feedback_comment"], updated_at=row["voted_at"]
            )
            if row["vote"]
            else None
        ),
    )


async def _messages(
    conn: Connection, conversation_id: uuid.UUID, escalation_id: uuid.UUID | None
) -> list[InboxMessageOut]:
    by_message: dict[uuid.UUID, EmailDeliveryOut] = {}
    if escalation_id:
        for d in await inbox_repo.deliveries(conn, escalation_id):
            if d["message_id"]:
                by_message[d["message_id"]] = _delivery(d)
    else:
        rows = await conn.fetch(
            """
            select d.id, d.kind, d.message_id, d.to_hint, d.subject, d.status, d.attempts,
                   d.last_error, d.created_at, d.sent_at
            from email_deliveries d join messages m on m.id = d.message_id
            where m.conversation_id = $1
            """,
            conversation_id,
        )
        by_message = {d["message_id"]: _delivery(d) for d in rows}
    return [
        _message(row, by_message.get(row["id"]))
        for row in await inbox_repo.messages(conn, conversation_id)
    ]


async def _agent_message(conn: Connection, message_id: uuid.UUID) -> uuid.UUID:
    row = await conn.fetchrow(
        "select role, conversation_id from messages where id = $1 for update", message_id
    )
    if row is None:
        raise not_found("Message")
    if row["role"] != "agent":
        raise AppError(
            422, "not_an_agent_message", "Only the agent's messages can be marked as wrong."
        )
    conversation_id: uuid.UUID = row["conversation_id"]
    return conversation_id


async def _one_message(
    conn: Connection, conversation_id: uuid.UUID, message_id: uuid.UUID
) -> InboxMessageOut:
    return next(m for m in await _messages(conn, conversation_id, None) if m.id == message_id)


def _history_text(action: str, meta: dict[str, Any]) -> str:
    rule = meta.get("rule")
    match action:
        case "escalation.routed":
            return f"Routed by the rule {rule}"
        case "escalation.assigned":
            who = meta.get("assignee") or "a teammate"
            return f"Assigned to {who} by the rule {rule}" if rule else f"Assigned to {who}"
        case "escalation.unassigned":
            return "Unassigned"
        case "escalation.status_changed":
            old = STATUS_LABEL.get(str(meta.get("from")), str(meta.get("from")))
            new = STATUS_LABEL.get(str(meta.get("to")), str(meta.get("to")))
            return f"Moved from {old} to {new}"
        case "escalation.priority_changed":
            return f"Priority set to {str(meta.get('to', '')).capitalize()}"
        case "escalation.ticket_type_changed":
            return f"Ticket type set to {meta['to']}" if meta.get("to") else "Ticket type removed"
        case "escalation.fields_updated":
            return "Details edited"
        case "escalation.replied":
            return f"Replied by email to {meta.get('to', 'the customer')}"
        case _:
            return action


async def _detail(
    conn: Connection, email_from: str, member: Member, escalation_id: uuid.UUID
) -> InboxDetailOut:
    row = await inbox_repo.get_item(conn, member.user_id, escalation_id)
    if row is None:
        raise not_found("Handoff")
    extra = await conn.fetchrow(
        """
        select e.summary, e.fields, e.conversation_id, c.claims, c.end_user_id,
               rr.name as rule_name
        from escalations e
        join conversations c on c.id = e.conversation_id
        left join routing_rules rr on rr.id = e.routed_by_rule_id
        where e.id = $1
        """,
        escalation_id,
    )
    assert extra is not None
    customer = None
    if extra["end_user_id"]:
        cu = await conn.fetchrow(
            """
            select external_id, name, email, claims, first_seen_at, last_seen_at
            from end_users where id = $1
            """,
            extra["end_user_id"],
        )
        if cu:
            customer = CustomerOut(
                external_id=cu["external_id"],
                name=cu["name"],
                email=cu["email"],
                claims={str(k): str(v) for k, v in (cu["claims"] or {}).items()},
                first_seen_at=cu["first_seen_at"],
                last_seen_at=cu["last_seen_at"],
            )
    workspace, support = await _workspace(conn, member.tenant_id)
    admin = member.role in ("owner", "admin")
    summary = extra["summary"]
    return InboxDetailOut(
        item=_item(row),
        summary=EscalationSummaryOut(**summary) if summary else None,
        fields={str(k): str(v) for k, v in (extra["fields"] or {}).items()},
        ticket_type_fields=await _type_fields(conn, row["ticket_type_id"]),
        conversation_id=extra["conversation_id"],
        claims={str(k): str(v) for k, v in (extra["claims"] or {}).items()},
        customer=customer,
        messages=await _messages(conn, extra["conversation_id"], escalation_id),
        notes=[
            NoteOut(
                id=n["id"],
                body=n["body"],
                author=(
                    PersonOut(id=n["author_user_id"], name=n["author_name"] or "Former member")
                    if n["author_user_id"]
                    else None
                ),
                created_at=n["created_at"],
                can_delete=admin or n["author_user_id"] == member.user_id,
            )
            for n in await inbox_repo.notes(conn, escalation_id)
        ],
        history=[
            HistoryEntryOut(
                id=h["id"],
                action=h["action"],
                text=_history_text(h["action"], dict(h["metadata"] or {})),
                actor=h["actor_name"],
                created_at=h["created_at"],
            )
            for h in await inbox_repo.history(conn, escalation_id)
        ],
        deliveries=[_delivery(d) for d in await inbox_repo.deliveries(conn, escalation_id)],
        routed_by_rule=extra["rule_name"],
        reply_from=_reply_from(email_from, workspace),
        reply_to=support or member.user.email,
        can_assign_others=admin,
    )
