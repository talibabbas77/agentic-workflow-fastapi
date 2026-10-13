"""Shared response builders."""

import uuid

from docent.api.schemas import MeOut, TenantSummary, UserOut
from docent.db.pool import Connection, set_context
from docent.services import accounts, tenants


async def build_me(
    conn: Connection, user_id: uuid.UUID, active_tenant_id: uuid.UUID | None
) -> MeOut:
    await set_context(conn, user_id=user_id)
    user = await accounts.get_user(conn, user_id)
    assert user is not None
    rows = await tenants.tenants_for_user(conn)
    summaries = [
        TenantSummary(id=r["id"], name=r["name"], slug=r["slug"], role=r["role"]) for r in rows
    ]
    active = next((t for t in summaries if t.id == active_tenant_id), None)
    return MeOut(
        user=UserOut(
            id=user["id"],
            email=user["email"],
            name=user["name"],
            email_verified=user["email_verified_at"] is not None,
        ),
        active_tenant=active,
        tenants=summaries,
    )
