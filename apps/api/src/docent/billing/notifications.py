"""Tell a tenant's owners when usage crosses 80 percent and 100 percent of the cap.

80 percent goes to owners and admins, 100 percent to owners (ARCHITECTURE section
10). One email job per person and threshold per month, deduplicated in the queue.
"""

import uuid

from docent.db.pool import Connection
from docent.jobs import queue
from docent.jobs.handlers import SEND_EMAIL


async def enqueue_usage_emails(
    conn: Connection, tenant_id: uuid.UUID, percent: int, web_origin: str
) -> int:
    roles = ["owner"] if percent >= 100 else ["owner", "admin"]
    rows = await conn.fetch(
        """
        select u.id as user_id, u.email, u.name, t.name as workspace,
               p.period_start, p.replies_used, p.replies_cap
        from memberships m
        join users u on u.id = m.user_id
        join tenants t on t.id = m.tenant_id
        join usage_periods p on p.tenant_id = m.tenant_id
         and p.period_start = date_trunc('month', now())::date
        where m.tenant_id = $1 and m.role = any($2::text[])
        """,
        tenant_id,
        roles,
    )
    for row in rows:
        await queue.enqueue(
            conn,
            SEND_EMAIL,
            {
                "template": "usage_threshold",
                "data": {
                    "to": row["email"],
                    "name": row["name"],
                    "workspace": row["workspace"],
                    "percent": percent,
                    "used": row["replies_used"],
                    "cap": row["replies_cap"],
                    "url": f"{web_origin.rstrip('/')}/app/billing",
                },
            },
            tenant_id=tenant_id,
            dedupe_key=f"usage:{tenant_id}:{row['period_start']}:{percent}:{row['user_id']}",
        )
    return len(rows)
