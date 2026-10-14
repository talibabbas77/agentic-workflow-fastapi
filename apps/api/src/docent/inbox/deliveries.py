"""Email deliveries: every email Docent sends for a workspace, and what happened to it.

Queueing an email writes an email_deliveries row and a send_email job in the
caller's transaction. The job reports back: sent, retrying with the last error,
or dead after its last attempt. A delivery that already went out is never sent
again, so a job that runs twice sends one email.
"""

import uuid
from typing import Any

from docent.db.pool import Connection, Pool, transaction
from docent.ids import keyed_hash, new_id
from docent.jobs import queue

SEND_EMAIL = "send_email"


def mask_email(address: str) -> str:
    """a***@example.com: enough to recognize, not enough to copy."""
    local, _, domain = address.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


def email_hash(secret: str, address: str) -> str:
    return keyed_hash(secret, address.strip().lower(), length=32)


async def queue_email(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    secret: str,
    to: str,
    subject: str,
    template: str,
    data: dict[str, Any],
    kind: str,
    escalation_id: uuid.UUID | None = None,
    message_id: uuid.UUID | None = None,
    notification_id: uuid.UUID | None = None,
    max_attempts: int = 5,
) -> uuid.UUID:
    """Record a delivery and queue the job that sends it. Returns the delivery id."""
    delivery_id = new_id()
    await conn.execute(
        """
        insert into email_deliveries (id, tenant_id, escalation_id, message_id, kind, to_hash,
                                      to_hint, subject)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        delivery_id,
        tenant_id,
        escalation_id,
        message_id,
        kind,
        email_hash(secret, to),
        mask_email(to),
        " ".join(subject.split())[:200],
    )
    if notification_id:
        await conn.execute(
            "update notifications set email_delivery_id = $2 where id = $1",
            notification_id,
            delivery_id,
        )
    payload: dict[str, Any] = {
        "template": template,
        "data": {"to": to, **data},
        "delivery_id": str(delivery_id),
    }
    if notification_id:
        payload["notification_id"] = str(notification_id)
    await queue.enqueue(
        conn,
        SEND_EMAIL,
        payload,
        tenant_id=tenant_id,
        max_attempts=max_attempts,
        dedupe_key=f"email:{delivery_id}",
    )
    return delivery_id


async def already_sent(pool: Pool, tenant_id: uuid.UUID, delivery_id: uuid.UUID) -> bool:
    async with transaction(pool, tenant_id=tenant_id) as conn:
        status: str | None = await conn.fetchval(
            "select status from email_deliveries where id = $1", delivery_id
        )
    return status == "sent"


async def mark_sent(
    pool: Pool,
    tenant_id: uuid.UUID,
    delivery_id: uuid.UUID,
    notification_id: uuid.UUID | None,
    provider_message_id: str,
    attempts: int,
) -> None:
    async with transaction(pool, tenant_id=tenant_id) as conn:
        await conn.execute(
            """
            update email_deliveries
            set status = 'sent', provider_message_id = $2, attempts = $3, last_error = null,
                sent_at = now(), updated_at = now()
            where id = $1
            """,
            delivery_id,
            provider_message_id[:300],
            attempts,
        )
        if notification_id:
            await conn.execute(
                """
                update notifications set status = 'sent', attempts = $2, sent_at = now(),
                                         last_error = null
                where id = $1
                """,
                notification_id,
                attempts,
            )


async def mark_failed(
    pool: Pool,
    tenant_id: uuid.UUID,
    delivery_id: uuid.UUID,
    notification_id: uuid.UUID | None,
    error: str,
    attempts: int,
    final: bool,
) -> None:
    status = "dead" if final else "retrying"
    async with transaction(pool, tenant_id=tenant_id) as conn:
        await conn.execute(
            """
            update email_deliveries
            set status = $2, attempts = $3, last_error = $4, updated_at = now()
            where id = $1 and status <> 'sent'
            """,
            delivery_id,
            status,
            attempts,
            error[:500],
        )
        if notification_id:
            await conn.execute(
                """
                update notifications set status = $2, attempts = $3, last_error = $4
                where id = $1 and status <> 'sent'
                """,
                notification_id,
                status,
                attempts,
                error[:500],
            )
