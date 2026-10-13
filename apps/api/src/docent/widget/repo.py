"""SQL for widgets, signing keys, end users, and widget sessions."""

import uuid
from datetime import timedelta
from typing import Any

import asyncpg

from docent.db.pool import Connection
from docent.ids import hash_token, new_id, new_token
from docent.widget.identity import Identity

WIDGET_COLUMNS = """
    id, public_id, name, allowed_origins, anonymous_enabled, anonymous_daily_cap,
    allowed_claims, greeting, created_at, updated_at
"""


async def widget_by_public_id(conn: Connection) -> asyncpg.Record | None:
    """Needs app.widget_public_id context. Returns the widget and its tenant."""
    return await conn.fetchrow(
        f"select tenant_id, {WIDGET_COLUMNS} from widgets where public_id = app_current_widget()"  # noqa: S608
    )


async def active_keys(conn: Connection, widget_id: uuid.UUID) -> dict[str, dict[str, Any]]:
    rows = await conn.fetch(
        "select kid, public_jwk from signing_keys where widget_id = $1 and status = 'active'",
        widget_id,
    )
    return {r["kid"]: r["public_jwk"] for r in rows}


async def list_widgets(conn: Connection) -> list[asyncpg.Record]:
    return await conn.fetch(
        f"select {WIDGET_COLUMNS} from widgets order by created_at"  # noqa: S608
    )


async def get_widget(conn: Connection, widget_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        f"select {WIDGET_COLUMNS} from widgets where id = $1",  # noqa: S608
        widget_id,
    )


async def widget_keys(conn: Connection, widget_id: uuid.UUID) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        select kid, status, public_jwk, created_at, retired_at from signing_keys
        where widget_id = $1 order by created_at
        """,
        widget_id,
    )


async def upsert_end_user(conn: Connection, tenant_id: uuid.UUID, identity: Identity) -> uuid.UUID:
    end_user_id: uuid.UUID = await conn.fetchval(
        """
        insert into end_users (id, tenant_id, external_id, email, name, claims)
        values ($1, $2, $3, $4, $5, $6)
        on conflict (tenant_id, external_id) do update
          set email = excluded.email, name = excluded.name, claims = excluded.claims,
              last_seen_at = now()
        returning id
        """,
        new_id(),
        tenant_id,
        identity.external_id,
        identity.email,
        identity.name,
        identity.claims,
    )
    return end_user_id


async def create_session(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    widget_id: uuid.UUID,
    mode: str,
    end_user_id: uuid.UUID | None,
    visitor_id: str | None,
    jti: str | None,
    parent_origin: str,
    ip_hash: str,
    ttl: timedelta,
) -> tuple[str, Any]:
    """Store a session and return its token. A reused jti violates a unique index."""
    token = new_token()
    expires_at = await conn.fetchval(
        """
        insert into widget_sessions (token_hash, tenant_id, widget_id, mode, end_user_id,
                                     visitor_id, jti, parent_origin, ip_hash, expires_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + $10::interval)
        returning expires_at
        """,
        hash_token(token),
        tenant_id,
        widget_id,
        mode,
        end_user_id,
        visitor_id,
        jti,
        parent_origin,
        ip_hash,
        ttl,
    )
    return token, expires_at


async def live_session(conn: Connection) -> asyncpg.Record | None:
    """Needs app.widget_session context."""
    return await conn.fetchrow(
        """
        select token_hash, tenant_id, widget_id, mode, end_user_id, visitor_id, parent_origin
        from widget_sessions
        where token_hash = app_current_widget_session()
          and revoked_at is null and expires_at > now()
        """
    )


async def anonymous_messages_today(conn: Connection, widget_id: uuid.UUID) -> int:
    return int(
        await conn.fetchval(
            """
            select count(*) from messages m join conversations c on c.id = m.conversation_id
            where c.widget_id = $1 and c.mode = 'anonymous' and m.role = 'visitor'
              and m.created_at >= date_trunc('day', now())
            """,
            widget_id,
        )
    )
