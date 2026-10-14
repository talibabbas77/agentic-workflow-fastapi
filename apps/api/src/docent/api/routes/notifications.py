"""A member's notifications in the admin app: the bell, and the Inbox's unread count.

The bell lists in-app notifications addressed to the member: new handoffs routed
to them and handoffs assigned to them. Each links to its handoff; opening the
handoff reads it. The unread count beside Inbox is the inbox's own rule:
handoffs not resolved that changed since the member last opened them.

The admin app polls this every 30 seconds while the tab is visible: one
transaction, three small queries.
"""

import uuid
from typing import Annotated

import asyncpg
from fastapi import APIRouter, Query, status

from docent.api.deps import CurrentMember, State
from docent.api.errors import not_found
from docent.api.schemas import ErrorOut, NotificationOut, NotificationsOut
from docent.db.pool import transaction
from docent.inbox import repo as inbox_repo
from docent.inbox.events import ISSUE_SQL

router = APIRouter(
    prefix="/v1/notifications", tags=["notifications"], responses={403: {"model": ErrorOut}}
)


def _detail(row: asyncpg.Record) -> str | None:
    payload = row["payload"] or {}
    if payload.get("by"):
        return f"Assigned by {payload['by']}"
    if payload.get("rule"):
        return f"Routed by the rule {payload['rule']}"
    return None


@router.get("")
async def list_notifications(
    member: CurrentMember,
    state: State,
    limit: Annotated[int, Query(ge=1, le=50)] = 15,
) -> NotificationsOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        rows = await conn.fetch(
            f"""
            select n.id, n.kind, n.escalation_id, n.payload, n.created_at, n.read_at,
                   {ISSUE_SQL} as issue
            from notifications n
            join escalations e on e.id = n.escalation_id
            where n.user_id = $1 and n.channel = 'in_app'
            order by n.created_at desc, n.id desc
            limit $2
            """,  # noqa: S608
            member.user_id,
            limit,
        )
        unread: int = await conn.fetchval(
            """
            select count(*) from notifications
            where user_id = $1 and channel = 'in_app' and read_at is null
            """,
            member.user_id,
        )
        inbox_unread = await inbox_repo.unread_count(conn, member.user_id)
    return NotificationsOut(
        items=[
            NotificationOut(
                id=r["id"],
                kind=r["kind"],
                escalation_id=r["escalation_id"],
                issue=r["issue"],
                detail=_detail(r),
                created_at=r["created_at"],
                read_at=r["read_at"],
            )
            for r in rows
        ],
        unread=unread,
        inbox_unread=inbox_unread,
    )


@router.post(
    "/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorOut}},
)
async def read_notification(
    notification_id: uuid.UUID, member: CurrentMember, state: State
) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        found = await conn.fetchval(
            """
            update notifications set read_at = coalesce(read_at, now())
            where id = $1 and user_id = $2 and channel = 'in_app'
            returning id
            """,
            notification_id,
            member.user_id,
        )
    if found is None:
        raise not_found("Notification")


@router.post("/read", status_code=status.HTTP_204_NO_CONTENT)
async def read_all_notifications(member: CurrentMember, state: State) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await conn.execute(
            """
            update notifications set read_at = now()
            where user_id = $1 and channel = 'in_app' and read_at is null
            """,
            member.user_id,
        )
