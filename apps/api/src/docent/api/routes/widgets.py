"""Widgets for staff: allowed origins, anonymous mode, claim allowlist, signing keys."""

import uuid

from fastapi import APIRouter, status

from docent.api.deps import AdminMember, CurrentMember, Member, State
from docent.api.errors import AppError, not_found
from docent.api.schemas import ErrorOut, SigningKeyIn, SigningKeyOut, WidgetIn, WidgetOut
from docent.config import Settings
from docent.db.pool import Connection, transaction
from docent.ids import new_id
from docent.services import audit
from docent.widget import repo
from docent.widget.identity import (
    IdentityError,
    new_kid,
    new_public_id,
    normalize_origin,
    public_jwk,
)

router = APIRouter(
    prefix="/v1/widgets",
    tags=["widgets"],
    responses={403: {"model": ErrorOut}, 404: {"model": ErrorOut}, 422: {"model": ErrorOut}},
)

MAX_ACTIVE_KEYS = 2


@router.get("")
async def list_widgets(member: CurrentMember, state: State) -> list[WidgetOut]:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return [
            await _out(conn, state.settings, row["id"]) for row in await repo.list_widgets(conn)
        ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_widget(body: WidgetIn, member: AdminMember, state: State) -> WidgetOut:
    origins = _origins(body.allowed_origins, state.settings)
    widget_id = new_id()
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await conn.execute(
            """
            insert into widgets (id, public_id, tenant_id, name, allowed_origins,
                                 anonymous_enabled, anonymous_daily_cap, allowed_claims, greeting)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """,
            widget_id,
            new_public_id(),
            member.tenant_id,
            body.name,
            origins,
            body.anonymous_enabled,
            body.anonymous_daily_cap,
            body.allowed_claims,
            body.greeting,
        )
        await _audit(conn, member, "widget.created", widget_id)
        return await _out(conn, state.settings, widget_id)


@router.put("/{widget_id}")
async def replace_widget(
    widget_id: uuid.UUID, body: WidgetIn, member: AdminMember, state: State
) -> WidgetOut:
    origins = _origins(body.allowed_origins, state.settings)
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        status_line = await conn.execute(
            """
            update widgets
            set name = $2, allowed_origins = $3, anonymous_enabled = $4,
                anonymous_daily_cap = $5, allowed_claims = $6, greeting = $7, updated_at = now()
            where id = $1
            """,
            widget_id,
            body.name,
            origins,
            body.anonymous_enabled,
            body.anonymous_daily_cap,
            body.allowed_claims,
            body.greeting,
        )
        if status_line.endswith(" 0"):
            raise not_found("Widget")
        await _audit(conn, member, "widget.updated", widget_id)
        return await _out(conn, state.settings, widget_id)


@router.delete("/{widget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_widget(widget_id: uuid.UUID, member: AdminMember, state: State) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        status_line = await conn.execute("delete from widgets where id = $1", widget_id)
        if status_line.endswith(" 0"):
            raise not_found("Widget")
        await _audit(conn, member, "widget.deleted", widget_id)


@router.post(
    "/{widget_id}/keys", status_code=status.HTTP_201_CREATED, responses={409: {"model": ErrorOut}}
)
async def add_key(
    widget_id: uuid.UUID, body: SigningKeyIn, member: AdminMember, state: State
) -> SigningKeyOut:
    try:
        jwk = public_jwk(body.public_jwk)
    except IdentityError as exc:
        raise AppError(422, "invalid_key", str(exc), {"public_jwk": str(exc)}) from None
    kid = new_kid()
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if await repo.get_widget(conn, widget_id) is None:
            raise not_found("Widget")
        if len(await repo.active_keys(conn, widget_id)) >= MAX_ACTIVE_KEYS:
            raise AppError(
                409, "too_many_keys", "Retire an active key before adding another (two at most)."
            )
        await conn.execute(
            """
            insert into signing_keys (kid, tenant_id, widget_id, public_jwk)
            values ($1, $2, $3, $4)
            """,
            kid,
            member.tenant_id,
            widget_id,
            jwk,
        )
        await _audit(conn, member, "widget.key_added", widget_id, {"kid": kid})
        row = await conn.fetchrow(
            """
            select kid, status, public_jwk, created_at, retired_at
            from signing_keys where kid = $1
            """,
            kid,
        )
    assert row is not None
    return SigningKeyOut(**dict(row))


@router.post("/{widget_id}/keys/{kid}/retire")
async def retire_key(
    widget_id: uuid.UUID, kid: str, member: AdminMember, state: State
) -> SigningKeyOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        row = await conn.fetchrow(
            """
            update signing_keys set status = 'retired', retired_at = coalesce(retired_at, now())
            where kid = $1 and widget_id = $2
            returning kid, status, public_jwk, created_at, retired_at
            """,
            kid,
            widget_id,
        )
        if row is None:
            raise not_found("Key")
        await _audit(conn, member, "widget.key_retired", widget_id, {"kid": kid})
    return SigningKeyOut(**dict(row))


def _origins(values: list[str], settings: Settings) -> list[str]:
    allow_http = settings.env in ("local", "test")
    try:
        return sorted({normalize_origin(v, allow_http=allow_http) for v in values})
    except IdentityError as exc:
        raise AppError(422, "invalid_origin", str(exc), {"allowed_origins": str(exc)}) from None


async def _out(conn: Connection, settings: Settings, widget_id: uuid.UUID) -> WidgetOut:
    row = await repo.get_widget(conn, widget_id)
    if row is None:
        raise not_found("Widget")
    keys = [SigningKeyOut(**dict(k)) for k in await repo.widget_keys(conn, widget_id)]
    return WidgetOut(**dict(row), keys=keys, embed_origin=settings.widget_origin)


async def _audit(
    conn: Connection,
    member: Member,
    action: str,
    widget_id: uuid.UUID,
    metadata: dict[str, str] | None = None,
) -> None:
    await audit.record(
        conn,
        tenant_id=member.tenant_id,
        actor_user_id=member.user_id,
        action=action,
        target_type="widget",
        target_id=widget_id,
        metadata=metadata,
    )
