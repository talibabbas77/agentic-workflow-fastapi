"""Job handlers. Each must be safe to run more than once."""

import uuid
from collections.abc import Callable

from docent.email import templates
from docent.email.links import open_link
from docent.email.sender import EmailSender, OutgoingEmail
from docent.inbox import deliveries
from docent.jobs.worker import Handler, JobContext, PermanentJobError
from docent.security.secretbox import SecretError

SEND_EMAIL = deliveries.SEND_EMAIL

_BUILDERS: dict[str, Callable[..., OutgoingEmail]] = {
    "verify_email": templates.verify_email,
    "reset_password": templates.reset_password,
    "invitation": templates.invitation,
    "usage_threshold": templates.usage_threshold,
    "redis_budget": templates.redis_budget,
    "inbox_reply": templates.inbox_reply,
    "new_handoff": templates.new_handoff,
    "handoff_assigned": templates.handoff_assigned,
    "daily_digest": templates.daily_digest,
}


def build_email(template: str, data: dict[str, object]) -> OutgoingEmail:
    builder = _BUILDERS.get(template)
    if builder is None:
        raise ValueError(f"unknown email template {template!r}")
    return builder(**data)


def make_handlers(sender: EmailSender, secret_key: str) -> dict[str, Handler]:
    async def send_email(ctx: JobContext) -> None:
        payload = ctx.job.payload
        tenant_id = ctx.job.tenant_id
        # Emails about a workspace's handoffs are tracked: status, attempts, last error.
        tracked = tenant_id is not None and "delivery_id" in payload
        delivery_id = uuid.UUID(payload["delivery_id"]) if tracked else None
        notification_id = (
            uuid.UUID(payload["notification_id"]) if payload.get("notification_id") else None
        )
        if (
            tenant_id
            and delivery_id
            and await deliveries.already_sent(ctx.pool, tenant_id, delivery_id)
        ):
            return
        try:
            email = build_email(
                str(payload["template"]), open_link(secret_key, dict(payload["data"]))
            )
        except (TypeError, ValueError, SecretError) as exc:
            if tenant_id and delivery_id:
                await deliveries.mark_failed(
                    ctx.pool, tenant_id, delivery_id, notification_id, str(exc), 1, final=True
                )
            raise PermanentJobError(str(exc)) from exc
        try:
            provider_id = await sender.send(email)
        except Exception as exc:
            if tenant_id and delivery_id:
                await deliveries.mark_failed(
                    ctx.pool,
                    tenant_id,
                    delivery_id,
                    notification_id,
                    f"{type(exc).__name__}: {exc}",
                    ctx.job.attempts,
                    final=ctx.job.attempts >= ctx.job.max_attempts,
                )
            raise
        if tenant_id and delivery_id:
            await deliveries.mark_sent(
                ctx.pool, tenant_id, delivery_id, notification_id, provider_id, ctx.job.attempts
            )

    return {SEND_EMAIL: send_email}
