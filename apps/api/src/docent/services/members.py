"""Members and invitations of a tenant."""

import uuid
from datetime import timedelta

import asyncpg

from docent.db.pool import Connection
from docent.ids import hash_token, new_id, new_token
from docent.services.accounts import normalize_email


async def list_members(conn: Connection, tenant_id: uuid.UUID) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        select m.user_id, u.name, u.email, m.role, m.created_at as joined_at
        from memberships m join users u on u.id = m.user_id
        where m.tenant_id = $1
        order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, u.name
        """,
        tenant_id,
    )


async def list_open_invitations(conn: Connection, tenant_id: uuid.UUID) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        select i.id, i.email, i.role, i.created_at, i.expires_at, u.name as invited_by_name
        from invitations i left join users u on u.id = i.invited_by
        where i.tenant_id = $1 and i.accepted_at is null and i.revoked_at is null
          and i.expires_at > now()
        order by i.created_at desc
        """,
        tenant_id,
    )


async def is_member_email(conn: Connection, tenant_id: uuid.UUID, email: str) -> bool:
    return bool(
        await conn.fetchval(
            """
            select exists(select 1 from memberships m join users u on u.id = m.user_id
                          where m.tenant_id = $1 and lower(u.email) = $2)
            """,
            tenant_id,
            normalize_email(email),
        )
    )


async def create_invitation(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    email: str,
    role: str,
    invited_by: uuid.UUID,
    ttl: timedelta,
) -> tuple[uuid.UUID, str]:
    """Create an invitation, replacing any open one for the same email."""
    email = normalize_email(email)
    await conn.execute(
        """
        update invitations set revoked_at = now()
        where tenant_id = $1 and lower(email) = $2 and accepted_at is null and revoked_at is null
        """,
        tenant_id,
        email,
    )
    invitation_id = new_id()
    token = new_token()
    await conn.execute(
        """
        insert into invitations (id, tenant_id, email, role, token_hash, invited_by, expires_at)
        values ($1, $2, $3, $4, $5, $6, now() + $7::interval)
        """,
        invitation_id,
        tenant_id,
        email,
        role,
        hash_token(token),
        invited_by,
        ttl,
    )
    return invitation_id, token


async def revoke_invitation(
    conn: Connection, tenant_id: uuid.UUID, invitation_id: uuid.UUID
) -> bool:
    status = await conn.execute(
        """
        update invitations set revoked_at = now()
        where id = $1 and tenant_id = $2 and accepted_at is null and revoked_at is null
        """,
        invitation_id,
        tenant_id,
    )
    return status.endswith(" 1")


async def find_invitation_by_token(conn: Connection) -> asyncpg.Record | None:
    """Needs app.invite_token context. Returns the invitation and its workspace name."""
    return await conn.fetchrow(
        """
        select i.id, i.tenant_id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at,
               i.expires_at <= now() as expired, t.name as workspace_name,
               u.name as inviter_name
        from invitations i
        join tenants t on t.id = i.tenant_id
        left join users u on u.id = i.invited_by
        where i.token_hash = app_current_invite_token()
        """
    )


async def accept_invitation(
    conn: Connection,
    *,
    invitation_id: uuid.UUID,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    role: str,
) -> None:
    """Add the membership and close the invitation. Needs tenant context."""
    await conn.execute(
        """
        insert into memberships (tenant_id, user_id, role) values ($1, $2, $3)
        on conflict (tenant_id, user_id) do nothing
        """,
        tenant_id,
        user_id,
        role,
    )
    await conn.execute("update invitations set accepted_at = now() where id = $1", invitation_id)


async def owner_count(conn: Connection, tenant_id: uuid.UUID) -> int:
    return int(
        await conn.fetchval(
            "select count(*) from memberships where tenant_id = $1 and role = 'owner'", tenant_id
        )
    )


async def get_member_role(conn: Connection, tenant_id: uuid.UUID, user_id: uuid.UUID) -> str | None:
    role: str | None = await conn.fetchval(
        "select role from memberships where tenant_id = $1 and user_id = $2", tenant_id, user_id
    )
    return role


async def set_member_role(
    conn: Connection, tenant_id: uuid.UUID, user_id: uuid.UUID, role: str
) -> None:
    await conn.execute(
        "update memberships set role = $3 where tenant_id = $1 and user_id = $2",
        tenant_id,
        user_id,
        role,
    )


async def remove_member(conn: Connection, tenant_id: uuid.UUID, user_id: uuid.UUID) -> None:
    await conn.execute(
        "delete from memberships where tenant_id = $1 and user_id = $2", tenant_id, user_id
    )
    await conn.execute(
        """
        update user_sessions set active_tenant_id = null
        where user_id = $1 and active_tenant_id = $2
        """,
        user_id,
        tenant_id,
    )


def token_hash_for(token: str) -> bytes:
    return hash_token(token)
