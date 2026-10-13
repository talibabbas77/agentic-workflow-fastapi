"""Job handlers. Each must be safe to run more than once."""

from collections.abc import Callable

from docent.email import templates
from docent.email.sender import EmailSender, OutgoingEmail
from docent.jobs.worker import Handler, JobContext

SEND_EMAIL = "send_email"

_BUILDERS: dict[str, Callable[..., OutgoingEmail]] = {
    "verify_email": templates.verify_email,
    "reset_password": templates.reset_password,
    "invitation": templates.invitation,
}


def build_email(template: str, data: dict[str, object]) -> OutgoingEmail:
    builder = _BUILDERS.get(template)
    if builder is None:
        raise ValueError(f"unknown email template {template!r}")
    return builder(**data)


def make_handlers(sender: EmailSender) -> dict[str, Handler]:
    async def send_email(ctx: JobContext) -> None:
        payload = ctx.job.payload
        email = build_email(str(payload["template"]), dict(payload["data"]))
        await sender.send(email)

    return {SEND_EMAIL: send_email}
