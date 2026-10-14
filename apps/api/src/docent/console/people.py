"""People: every account, its workspaces and roles. Needs the app.platform_admin capability
to see memberships and workspace names across tenants; users itself is a global table."""

import uuid

import asyncpg

from docent.console.figures import PER_PAGE
from docent.db.pool import Connection

# $1 search text (lowercase) or null.
_FILTER = """
where $1::text is null or strpos(lower(u.email), $1) > 0 or strpos(lower(u.name), $1) > 0
   or u.id::text = $1
"""


async def search(
    conn: Connection, search: str | None, page: int
) -> tuple[list[asyncpg.Record], dict[uuid.UUID, list[asyncpg.Record]], int]:
    """One page of people, newest first, their workspaces, and how many match in all."""
    text = (search or "").strip().lower() or None
    people = await conn.fetch(
        f"""
        select u.id, u.name, u.email, u.email_verified_at is not null as email_verified,
               u.is_platform_admin, u.created_at, u.last_login_at
        from users u
        {_FILTER}
        order by u.created_at desc, u.id
        limit $2 offset $3
        """,  # noqa: S608
        text,
        PER_PAGE,
        (page - 1) * PER_PAGE,
    )
    total: int = await conn.fetchval(f"select count(*) from users u {_FILTER}", text)  # noqa: S608
    rows = await conn.fetch(
        """
        select m.user_id, m.tenant_id, t.name, m.role
        from memberships m join tenants t on t.id = m.tenant_id
        where m.user_id = any($1::uuid[])
        order by m.created_at
        """,
        [p["id"] for p in people],
    )
    workspaces: dict[uuid.UUID, list[asyncpg.Record]] = {}
    for row in rows:
        workspaces.setdefault(row["user_id"], []).append(row)
    return people, workspaces, total
