"""People, workspaces, roles, invitations, and plan states for the demo.

Uses the same service functions as the API, so RLS and validation apply. A
workspace this seed created is marked in its settings, which is how a rerun
finds it and how --reset removes only demo data.
"""

import uuid
from datetime import timedelta

from docent.config import Settings
from docent.db.pool import Connection, Pool, set_context, transaction
from docent.seed.catalog import OWNER, TEAM, Person, Workspace
from docent.services import accounts, audit, members, tenants


async def ensure_user(conn: Connection, person: Person, password_hash: str) -> uuid.UUID:
    existing = await accounts.find_user_by_email(conn, person.email)
    if existing is not None:
        user_id: uuid.UUID = existing["id"]
        await accounts.set_password(conn, user_id, password_hash)
        await accounts.mark_email_verified(conn, user_id)
        return user_id
    return await accounts.create_user(
        conn, email=person.email, name=person.name, password_hash=password_hash, verified=True
    )


async def seeded_tenant(conn: Connection, slug: str, user_ids: list[uuid.UUID]) -> uuid.UUID | None:
    """Find a tenant this seed created, through any of its members (RLS hides others)."""
    for user_id in user_ids:
        await set_context(conn, user_id=user_id)
        found: uuid.UUID | None = await conn.fetchval(
            "select id from tenants where settings ->> 'seed' = $1", slug
        )
        if found:
            return found
    return None


async def create_workspace(
    pool: Pool, ws: Workspace, people: dict[str, uuid.UUID], settings: Settings
) -> tuple[uuid.UUID | None, str]:
    """The new tenant's id, or None when it was seeded before, and a line for the summary."""
    owner_key = next(key for key, role in ws.members if role == "owner")
    owner_id = people[owner_key]
    async with transaction(pool) as conn:
        if await seeded_tenant(conn, ws.slug, list(people.values())) is not None:
            return None, f"{ws.name}: already seeded"

        tenant_id = await tenants.create_tenant(conn, name=ws.name, owner_id=owner_id)
        await conn.execute(
            "update tenants set settings = settings || jsonb_build_object('seed', $2::text)"
            " where id = $1",
            tenant_id,
            ws.slug,
        )
        await audit.record(
            conn,
            tenant_id=tenant_id,
            actor_user_id=owner_id,
            action="tenant.created",
            target_type="tenant",
            target_id=tenant_id,
        )
        for key, role in ws.members:
            if key == owner_key:
                continue
            await conn.execute(
                "insert into memberships (tenant_id, user_id, role) values ($1, $2, $3)",
                tenant_id,
                people[key],
                role,
            )
            await audit.record(
                conn,
                tenant_id=tenant_id,
                actor_user_id=owner_id,
                action="invitation.accepted",
                target_type="user",
                target_id=people[key],
                metadata={"role": role},
            )
        for email, role in ws.invites:
            invitation_id, _ = await members.create_invitation(
                conn,
                tenant_id=tenant_id,
                email=email,
                role=role,
                invited_by=owner_id,
                ttl=timedelta(days=settings.invite_ttl_days),
            )
            await audit.record(
                conn,
                tenant_id=tenant_id,
                actor_user_id=owner_id,
                action="member.invited",
                target_type="invitation",
                target_id=invitation_id,
                metadata={"role": role},
            )
        await set_plan(conn, tenant_id, ws)
    return tenant_id, (
        f"{ws.name}: created on {ws.plan.plan_id} with {len(ws.members)} members and "
        f"{len(ws.invites)} invitations"
    )


async def set_plan(conn: Connection, tenant_id: uuid.UUID, ws: Workspace) -> None:
    """Put the workspace in its demo plan state, as a settled checkout would."""
    plan = ws.plan
    days = timedelta(days=plan.days_left)
    await conn.execute(
        """
        update subscriptions
        set plan_id = $2, status = $3,
            trial_ends_at = case when $3 = 'trialing' then now() + $4::interval end,
            current_period_end = case when $3 <> 'trialing' then now() + $4::interval end,
            past_due_since = case when $3 = 'past_due' then now() - $5::interval end,
            updated_at = now()
        where tenant_id = $1
        """,
        tenant_id,
        plan.plan_id,
        plan.status,
        days,
        timedelta(days=plan.past_due_days),
    )


async def reset(pool: Pool, owner_email: str) -> None:
    """Remove seeded workspaces and demo teammates. The owner account is kept."""
    emails = [owner_email, *(p.email for p in TEAM.values())]
    async with transaction(pool) as conn:
        user_ids = [
            row["id"] for e in emails if (row := await accounts.find_user_by_email(conn, e))
        ]
        tenant_ids: set[uuid.UUID] = set()
        for user_id in user_ids:
            await set_context(conn, user_id=user_id)
            rows = await conn.fetch("select id from tenants where settings ? 'seed'")
            tenant_ids.update(r["id"] for r in rows)
        for tenant_id in tenant_ids:
            await set_context(conn, tenant_id=tenant_id)
            await conn.execute("delete from tenants where id = $1", tenant_id)
        for person in TEAM.values():
            row = await accounts.find_user_by_email(conn, person.email)
            if row is None:
                continue
            await set_context(conn, user_id=row["id"])
            if not await conn.fetchval("select exists(select 1 from memberships)"):
                await conn.execute("delete from users where id = $1", row["id"])


def owner_person(name: str, email: str) -> dict[str, Person]:
    return {OWNER: Person(name, email), **TEAM}
