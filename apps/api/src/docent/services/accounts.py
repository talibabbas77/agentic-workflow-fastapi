"""Users, staff sessions, and one-time auth tokens."""

import uuid
from dataclasses import dataclass
from datetime import timedelta

import asyncpg

from docent.db.pool import Connection
from docent.ids import hash_token, new_id, new_token

SESSION_TOUCH_INTERVAL = timedelta(minutes=5)


class EmailTaken(Exception):
    pass


@dataclass(frozen=True, slots=True)
class SessionUser:
    user_id: uuid.UUID
    email: str
    name: str
    email_verified: bool
    token_hash: bytes
    active_tenant_id: uuid.UUID | None
    is_platform_admin: bool = False

    @property
    def platform_admin(self) -> bool:
        """May open the platform admin console: the flag and a verified email, both."""
        return self.is_platform_admin and self.email_verified


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def create_user(
    conn: Connection, *, email: str, name: str, password_hash: str, verified: bool = False
) -> uuid.UUID:
    user_id = new_id()
    try:
        await conn.execute(
            """
            insert into users (id, email, name, password_hash, email_verified_at)
            values ($1, $2, $3, $4, case when $5 then now() end)
            """,
            user_id,
            normalize_email(email),
            name,
            password_hash,
            verified,
        )
    except asyncpg.UniqueViolationError as exc:
        raise EmailTaken from exc
    return user_id


async def find_user_by_email(conn: Connection, email: str) -> asyncpg.Record | None:
    return await conn.fetchrow(
        """
        select id, email, name, password_hash, email_verified_at
        from users where lower(email) = $1
        """,
        normalize_email(email),
    )


async def get_user(conn: Connection, user_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        "select id, email, name, email_verified_at, is_platform_admin from users where id = $1",
        user_id,
    )


async def set_platform_admin(conn: Connection, email: str, value: bool) -> asyncpg.Record | None:
    """Grant or revoke the platform admin flag. Only the command line and the demo seed call
    this; no API route does. Returns the user, or None when no account has that email."""
    return await conn.fetchrow(
        """
        update users set is_platform_admin = $2, updated_at = now()
        where lower(email) = $1
        returning id, email, email_verified_at is not null as verified
        """,
        normalize_email(email),
        value,
    )


async def set_password(conn: Connection, user_id: uuid.UUID, password_hash: str) -> None:
    await conn.execute(
        "update users set password_hash = $2, updated_at = now() where id = $1",
        user_id,
        password_hash,
    )


async def mark_login(conn: Connection, user_id: uuid.UUID) -> None:
    await conn.execute("update users set last_login_at = now() where id = $1", user_id)


# Sessions


async def create_session(
    conn: Connection,
    *,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID | None,
    ttl: timedelta,
    ip_hash: str | None,
    user_agent: str | None,
) -> str:
    token = new_token()
    await conn.execute(
        """
        insert into user_sessions (token_hash, user_id, active_tenant_id, ip_hash, user_agent,
                                   expires_at)
        values ($1, $2, $3, $4, $5, now() + $6::interval)
        """,
        hash_token(token),
        user_id,
        tenant_id,
        ip_hash,
        (user_agent or "")[:300],
        ttl,
    )
    return token


async def load_session(conn: Connection, token: str, ttl: timedelta) -> SessionUser | None:
    """Return the session's user if the session is live. Slides expiry at most every 5 min."""
    token_hash = hash_token(token)
    row = await conn.fetchrow(
        """
        select s.user_id, s.active_tenant_id, s.last_seen_at, u.email, u.name,
               u.email_verified_at is not null as verified, u.is_platform_admin
        from user_sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
        """,
        token_hash,
    )
    if row is None:
        return None
    await conn.execute(
        """
        update user_sessions set last_seen_at = now(), expires_at = now() + $2::interval
        where token_hash = $1 and last_seen_at < now() - $3::interval
        """,
        token_hash,
        ttl,
        SESSION_TOUCH_INTERVAL,
    )
    return SessionUser(
        user_id=row["user_id"],
        email=row["email"],
        name=row["name"],
        email_verified=row["verified"],
        token_hash=token_hash,
        active_tenant_id=row["active_tenant_id"],
        is_platform_admin=row["is_platform_admin"],
    )


async def set_active_tenant(
    conn: Connection, token_hash: bytes, tenant_id: uuid.UUID | None
) -> None:
    await conn.execute(
        "update user_sessions set active_tenant_id = $2 where token_hash = $1",
        token_hash,
        tenant_id,
    )


async def revoke_session(conn: Connection, token_hash: bytes) -> None:
    await conn.execute(
        "update user_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null",
        token_hash,
    )


async def revoke_all_sessions(conn: Connection, user_id: uuid.UUID) -> None:
    await conn.execute(
        "update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",
        user_id,
    )


# One-time tokens (email verification, password reset)


async def issue_auth_token(
    conn: Connection, user_id: uuid.UUID, purpose: str, ttl: timedelta
) -> str:
    """Create a token and invalidate older unused tokens with the same purpose."""
    await conn.execute(
        """
        update auth_tokens set used_at = now()
        where user_id = $1 and purpose = $2 and used_at is null
        """,
        user_id,
        purpose,
    )
    token = new_token()
    await conn.execute(
        """
        insert into auth_tokens (token_hash, user_id, purpose, expires_at)
        values ($1, $2, $3, now() + $4::interval)
        """,
        hash_token(token),
        user_id,
        purpose,
        ttl,
    )
    return token


async def consume_auth_token(conn: Connection, token: str, purpose: str) -> uuid.UUID | None:
    user_id: uuid.UUID | None = await conn.fetchval(
        """
        update auth_tokens set used_at = now()
        where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
        returning user_id
        """,
        hash_token(token),
        purpose,
    )
    return user_id


async def mark_email_verified(conn: Connection, user_id: uuid.UUID) -> None:
    await conn.execute(
        """
        update users set email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
        where id = $1
        """,
        user_id,
    )
