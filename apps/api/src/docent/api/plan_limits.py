"""Refuse to add one more widget, seat, or document than the tenant's plan includes."""

import uuid

from docent.api.errors import AppError
from docent.billing.subscriptions import Limit, entitlement, plan_limit, usage_counts
from docent.db.pool import Connection

_NOUNS: dict[Limit, str] = {
    "widgets": "widgets",
    "seats": "team seats",
    "documents": "pages of docs",
}


async def check_limit(
    conn: Connection, tenant_id: uuid.UUID, kind: Limit, *, reinvite: str | None = None
) -> None:
    plan = (await entitlement(conn, tenant_id)).plan
    limit = plan_limit(plan, kind)
    if (await usage_counts(conn, reinvite=reinvite))[kind] >= limit:
        raise AppError(
            403,
            "plan_limit",
            f"The {plan.name} plan includes {limit:,} {_NOUNS[kind]}. Upgrade to add more.",
        )
