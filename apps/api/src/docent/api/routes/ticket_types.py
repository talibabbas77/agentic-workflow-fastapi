"""Ticket types: how escalations are classified and what the team needs to know."""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
from fastapi import APIRouter, status

from docent.agent import repo
from docent.api.deps import AdminMember, CurrentMember, Member, State, require_verified_email
from docent.api.errors import AppError, not_found
from docent.api.schemas import ErrorOut, TicketTypeIn, TicketTypeOut
from docent.db.pool import Connection, transaction
from docent.ids import new_id
from docent.services import audit

router = APIRouter(
    prefix="/v1/ticket-types",
    tags=["ticket types"],
    responses={403: {"model": ErrorOut}, 404: {"model": ErrorOut}, 422: {"model": ErrorOut}},
)

_COLUMNS = "id, name, description, fields, notify_emails, priority, active, created_at, updated_at"


@router.get("")
async def list_ticket_types(member: CurrentMember, state: State) -> list[TicketTypeOut]:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return [TicketTypeOut(**dict(r)) for r in await repo.list_ticket_types(conn)]


@router.post("", status_code=status.HTTP_201_CREATED, responses={409: {"model": ErrorOut}})
async def create_ticket_type(
    body: TicketTypeIn, member: AdminMember, state: State
) -> TicketTypeOut:
    if body.notify_emails:
        require_verified_email(member, "Docent emails people about handoffs")
    ticket_type_id = new_id()
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        async with _unique_name():
            await conn.execute(
                """
                insert into ticket_types (id, tenant_id, name, description, fields,
                                          notify_emails, priority, active)
                values ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                ticket_type_id,
                member.tenant_id,
                body.name,
                body.description,
                [f.model_dump() for f in body.fields],
                [str(e) for e in body.notify_emails],
                body.priority,
                body.active,
            )
        await _audit(conn, member, "ticket_type.created", ticket_type_id)
        return await _get(conn, ticket_type_id)


@router.put("/{ticket_type_id}", responses={409: {"model": ErrorOut}})
async def replace_ticket_type(
    ticket_type_id: uuid.UUID, body: TicketTypeIn, member: AdminMember, state: State
) -> TicketTypeOut:
    if body.notify_emails:
        require_verified_email(member, "Docent emails people about handoffs")
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _get(conn, ticket_type_id)
        async with _unique_name():
            await conn.execute(
                """
                update ticket_types
                set name = $2, description = $3, fields = $4, notify_emails = $5, priority = $6,
                    active = $7, updated_at = now()
                where id = $1
                """,
                ticket_type_id,
                body.name,
                body.description,
                [f.model_dump() for f in body.fields],
                [str(e) for e in body.notify_emails],
                body.priority,
                body.active,
            )
        await _audit(conn, member, "ticket_type.updated", ticket_type_id)
        return await _get(conn, ticket_type_id)


@router.delete("/{ticket_type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ticket_type(ticket_type_id: uuid.UUID, member: AdminMember, state: State) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _get(conn, ticket_type_id)
        await conn.execute("delete from ticket_types where id = $1", ticket_type_id)
        await _audit(conn, member, "ticket_type.deleted", ticket_type_id)


async def _get(conn: Connection, ticket_type_id: uuid.UUID) -> TicketTypeOut:
    row = await conn.fetchrow(
        f"select {_COLUMNS} from ticket_types where id = $1",  # noqa: S608
        ticket_type_id,
    )
    if row is None:
        raise not_found("Ticket type")
    return TicketTypeOut(**dict(row))


@asynccontextmanager
async def _unique_name() -> AsyncIterator[None]:
    try:
        yield
    except asyncpg.UniqueViolationError:
        raise AppError(
            409, "name_taken", "A ticket type with this name exists.", {"name": "Already used."}
        ) from None


async def _audit(conn: Connection, member: Member, action: str, target: uuid.UUID) -> None:
    await audit.record(
        conn,
        tenant_id=member.tenant_id,
        actor_user_id=member.user_id,
        action=action,
        target_type="ticket_type",
        target_id=target,
    )
