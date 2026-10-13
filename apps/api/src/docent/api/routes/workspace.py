"""The active workspace: details, settings, onboarding progress."""

from fastapi import APIRouter

from docent.api.deps import AdminMember, CurrentMember, State
from docent.api.errors import not_found
from docent.api.schemas import ErrorOut, OnboardingOut, OnboardingStep, TenantOut, TenantUpdateIn
from docent.db.pool import transaction
from docent.knowledge import repo as knowledge
from docent.services import audit, tenants

router = APIRouter(prefix="/v1", tags=["workspace"], responses={403: {"model": ErrorOut}})


@router.get("/tenant")
async def get_tenant(member: CurrentMember, state: State) -> TenantOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        row = await tenants.get_tenant(conn, member.tenant_id)
    if row is None:
        raise not_found("Workspace")
    return TenantOut(
        id=row["id"],
        name=row["name"],
        slug=row["slug"],
        created_at=row["created_at"],
        your_role=member.role,  # type: ignore[arg-type]
    )


@router.patch("/tenant")
async def update_tenant(body: TenantUpdateIn, member: AdminMember, state: State) -> TenantOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await tenants.rename_tenant(conn, member.tenant_id, body.name)
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="tenant.renamed",
            target_type="tenant",
            target_id=member.tenant_id,
        )
        row = await tenants.get_tenant(conn, member.tenant_id)
    assert row is not None
    return TenantOut(
        id=row["id"],
        name=row["name"],
        slug=row["slug"],
        created_at=row["created_at"],
        your_role=member.role,  # type: ignore[arg-type]
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
