"""Tenants (workspaces) and memberships."""

import re
import secrets
import string
import unicodedata
import uuid

import asyncpg

from docent.billing import subscriptions
from docent.db.pool import Connection, set_context
from docent.ids import new_id

_ALPHABET = string.ascii_lowercase + string.digits


def slugify(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:40].strip("-")
    return slug or "workspace"


async def create_tenant(conn: Connection, *, name: str, owner_id: uuid.UUID) -> uuid.UUID:
    """Create a tenant, its owner membership, and its trial. Switches RLS context to it."""
    tenant_id = new_id()
    await set_context(conn, tenant_id=tenant_id, user_id=owner_id)
    base = slugify(name)
    slug = base
    for _ in range(6):
        try:
            async with conn.transaction():  # savepoint, so a slug clash does not abort the outer tx
                await conn.execute(
                    "insert into tenants (id, name, slug) values ($1, $2, $3)",
                    tenant_id,
                    name,
                    slug,
                )
            break
        except asyncpg.UniqueViolationError:
            suffix = "".join(secrets.choice(_ALPHABET) for _ in range(4))
            slug = f"{base[:35].rstrip('-')}-{suffix}"
    else:
        raise RuntimeError("could not allocate a workspace slug")
    await conn.execute(
        "insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')",
        tenant_id,
        owner_id,
    )
    await subscriptions.start_trial(conn, tenant_id)
    return tenant_id


async def tenants_for_user(conn: Connection) -> list[asyncpg.Record]:
    """Tenants the current user belongs to. Needs app.user_id context."""
    return await conn.fetch(
        """
        select t.id, t.name, t.slug, m.role, m.created_at as joined_at
        from memberships m join tenants t on t.id = m.tenant_id
        where m.user_id = app_current_user() and t.status = 'active'
        order by m.created_at
        """
    )


async def get_tenant(conn: Connection, tenant_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        "select id, name, slug, timezone, created_at from tenants where id = $1", tenant_id
    )


async def rename_tenant(conn: Connection, tenant_id: uuid.UUID, name: str) -> None:
    await conn.execute(
        "update tenants set name = $2, updated_at = now() where id = $1", tenant_id, name
    )


async def set_timezone(conn: Connection, tenant_id: uuid.UUID, timezone: str) -> None:
    await conn.execute(
        "update tenants set timezone = $2, updated_at = now() where id = $1", tenant_id, timezone
    )


async def role_of(conn: Connection, tenant_id: uuid.UUID, user_id: uuid.UUID) -> str | None:
    role: str | None = await conn.fetchval(
        "select role from memberships where tenant_id = $1 and user_id = $2", tenant_id, user_id
    )
    return role
