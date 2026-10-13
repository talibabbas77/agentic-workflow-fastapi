"""Connection pools and transaction helpers.

Every unit of work runs in one explicit transaction that first sets
transaction-local context with set_config(..., true). That is safe behind
PgBouncer in transaction mode, where session-level SET is not.
"""

import json
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
from asyncpg.pool import PoolConnectionProxy

type Connection = asyncpg.Connection[asyncpg.Record] | PoolConnectionProxy[asyncpg.Record]
type Pool = asyncpg.Pool[asyncpg.Record]


async def _init_connection(conn: Connection) -> None:
    for typename in ("json", "jsonb"):
        await conn.set_type_codec(
            typename, encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )


async def create_pool(dsn: str, *, min_size: int = 1, max_size: int = 10) -> Pool:
    pool = await asyncpg.create_pool(
        dsn,
        min_size=min_size,
        max_size=max_size,
        init=_init_connection,
        command_timeout=30,
    )
    assert pool is not None
    return pool


def _ctx(value: uuid.UUID | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.hex()
    return str(value)


async def set_context(
    conn: Connection,
    *,
    tenant_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    invite_token_hash: bytes | None = None,
) -> None:
    """Replace the RLS context for the rest of the current transaction."""
    await conn.execute(
        "select set_config('app.tenant_id', $1, true),"
        " set_config('app.user_id', $2, true),"
        " set_config('app.invite_token', $3, true)",
        _ctx(tenant_id),
        _ctx(user_id),
        _ctx(invite_token_hash),
    )


@asynccontextmanager
async def transaction(
    pool: Pool,
    *,
    tenant_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    invite_token_hash: bytes | None = None,
) -> AsyncIterator[Connection]:
    """Run a transaction with RLS context.

    tenant_id         rows of this tenant are visible and writable
    user_id           the user's own memberships and tenants are readable
    invite_token_hash the one invitation matching this hash is readable
    """
    async with pool.acquire() as conn, conn.transaction():
        await set_context(
            conn, tenant_id=tenant_id, user_id=user_id, invite_token_hash=invite_token_hash
        )
        yield conn
