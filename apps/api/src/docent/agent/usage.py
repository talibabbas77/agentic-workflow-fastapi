"""Usage metering and hard caps.

Every model call writes a usage event with its token cost, priced from
model_prices at that moment. A reply first reserves one unit of the tenant's
monthly cap with a single conditional UPDATE, so concurrent turns can never
overshoot it; the reservation becomes usage when the reply is stored.
"""

import logging
import uuid

from docent.db.pool import Connection
from docent.ids import new_id

log = logging.getLogger(__name__)


async def reserve_reply(conn: Connection, tenant_id: uuid.UUID, default_cap: int) -> bool:
    await conn.execute(
        """
        insert into usage_periods (tenant_id, period_start, period_end, replies_cap)
        values ($1, date_trunc('month', now())::date,
                (date_trunc('month', now()) + interval '1 month')::date, $2)
        on conflict (tenant_id, period_start) do nothing
        """,
        tenant_id,
        default_cap,
    )
    reserved = await conn.fetchval(
        """
        update usage_periods set replies_reserved = replies_reserved + 1
        where tenant_id = $1 and period_start = date_trunc('month', now())::date
          and replies_used + replies_reserved < replies_cap
        returning true
        """,
        tenant_id,
    )
    return bool(reserved)


async def settle_reply(conn: Connection, tenant_id: uuid.UUID, *, used: bool) -> None:
    """Turn a reservation into usage, or give it back."""
    await conn.execute(
        """
        update usage_periods
        set replies_reserved = greatest(replies_reserved - 1, 0),
            replies_used = replies_used + $2
        where tenant_id = $1 and period_start = date_trunc('month', now())::date
        """,
        tenant_id,
        1 if used else 0,
    )


async def record(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    kind: str,
    idempotency_key: str,
    model: str | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    conversation_id: uuid.UUID | None = None,
    message_id: uuid.UUID | None = None,
) -> int:
    """Store one usage event and return its cost in micro dollars."""
    cost = 0
    if model and (tokens_in or tokens_out):
        price = await conn.fetchrow(
            """
            select input_micros_per_mtok, output_micros_per_mtok from model_prices
            where model = $1 and effective_from <= now()
            order by effective_from desc limit 1
            """,
            model,
        )
        if price is None:
            log.warning("no price for model", extra={"model": model})
        else:
            cost = round(
                (
                    tokens_in * price["input_micros_per_mtok"]
                    + tokens_out * price["output_micros_per_mtok"]
                )
                / 1_000_000
            )
    await conn.execute(
        """
        insert into usage_events (id, tenant_id, kind, model, tokens_in, tokens_out, cost_micros,
                                  conversation_id, message_id, idempotency_key)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (idempotency_key) do nothing
        """,
        new_id(),
        tenant_id,
        kind,
        model,
        tokens_in,
        tokens_out,
        cost,
        conversation_id,
        message_id,
        idempotency_key,
    )
    if cost:
        await conn.execute(
            """
            update usage_periods set cost_micros = cost_micros + $2
            where tenant_id = $1 and period_start = date_trunc('month', now())::date
            """,
            tenant_id,
            cost,
        )
    return cost
