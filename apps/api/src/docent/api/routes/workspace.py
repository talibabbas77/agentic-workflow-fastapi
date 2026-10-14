"""The active workspace: details, settings, onboarding progress."""

import uuid

import asyncpg
from fastapi import APIRouter

from docent.api.deps import AdminMember, CurrentMember, State
from docent.api.errors import not_found
from docent.api.schemas import ErrorOut, OnboardingOut, OnboardingStep, TenantOut, TenantUpdateIn
from docent.db.pool import Connection, transaction
from docent.knowledge import repo as knowledge
from docent.services import audit, tenants
from docent.timezones import timezone_names

router = APIRouter(prefix="/v1", tags=["workspace"], responses={403: {"model": ErrorOut}})


def _tenant_out(row: asyncpg.Record, role: str) -> TenantOut:
    return TenantOut(
        id=row["id"],
        name=row["name"],
        slug=row["slug"],
        timezone=row["timezone"],
        created_at=row["created_at"],
        your_role=role,  # type: ignore[arg-type]
    )


@router.get("/tenant")
async def get_tenant(member: CurrentMember, state: State) -> TenantOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        row = await tenants.get_tenant(conn, member.tenant_id)
    if row is None:
        raise not_found("Workspace")
    return _tenant_out(row, member.role)


@router.get("/tenant/timezones")
async def list_timezones(member: CurrentMember) -> list[str]:
    """Time zones a workspace can pick: UTC, then IANA names such as Europe/Berlin."""
    return timezone_names()


@router.patch("/tenant")
async def update_tenant(body: TenantUpdateIn, member: AdminMember, state: State) -> TenantOut:
    """Rename the workspace or set its time zone. Send only what changes."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        row = await tenants.get_tenant(conn, member.tenant_id)
        if row is None:
            raise not_found("Workspace")
        if body.name is not None and body.name != row["name"]:
            await tenants.rename_tenant(conn, member.tenant_id, body.name)
            await _audit(conn, member.tenant_id, member.user_id, "tenant.renamed", {})
        if body.timezone is not None and body.timezone != row["timezone"]:
            await tenants.set_timezone(conn, member.tenant_id, body.timezone)
            await _audit(
                conn,
                member.tenant_id,
                member.user_id,
                "tenant.timezone_changed",
                {"from": row["timezone"], "to": body.timezone},
            )
        row = await tenants.get_tenant(conn, member.tenant_id)
    assert row is not None
    return _tenant_out(row, member.role)


async def _audit(
    conn: Connection,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    action: str,
    metadata: dict[str, str],
) -> None:
    await audit.record(
        conn,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        action=action,
        target_type="tenant",
        target_id=tenant_id,
        metadata=metadata,
    )


@router.get("/onboarding")
async def onboarding(member: CurrentMember, state: State) -> OnboardingOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        team = await conn.fetchval(
            """
            select (select count(*) from memberships where tenant_id = $1)
                 + (select count(*) from invitations
                    where tenant_id = $1 and revoked_at is null and expires_at > now())
            """,
            member.tenant_id,
        )
        taught = await knowledge.ready_source_exists(conn)
        installed = await conn.fetchval("select exists(select 1 from widget_sessions)")
        answered = await conn.fetchval(
            """
            select exists(select 1 from messages m join conversations c on c.id = m.conversation_id
                          where c.channel = 'widget' and m.role = 'agent'
                            and m.decision ->> 'type' = 'answer')
            """
        )
    steps = [
        OnboardingStep(key="create_workspace", status="done"),
        OnboardingStep(key="verify_email", status="done" if member.user.email_verified else "todo"),
        OnboardingStep(key="invite_team", status="done" if team > 1 else "todo"),
        OnboardingStep(key="teach_agent", status="done" if taught else "todo"),
        OnboardingStep(key="install_widget", status="done" if installed else "todo"),
        OnboardingStep(key="first_answer", status="done" if answered else "todo"),
    ]
    return OnboardingOut(steps=steps, completed=sum(s.status == "done" for s in steps))
