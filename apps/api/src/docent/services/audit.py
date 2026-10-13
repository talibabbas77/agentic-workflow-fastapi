"""Append-only audit log for tenant-level changes."""

import uuid
from typing import Any

from docent.db.pool import Connection
from docent.ids import new_id


async def record(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    action: str,
    target_type: str | None = None,
    target_id: str | uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    await conn.execute(
        """
        insert into audit_log (id, tenant_id, actor_user_id, action, target_type, target_id,
                               metadata)
        values ($1, $2, $3, $4, $5, $6, $7)
        """,
        new_id(),
        tenant_id,
        actor_user_id,
        action,
        target_type,
        str(target_id) if target_id is not None else None,
        metadata or {},
    )
