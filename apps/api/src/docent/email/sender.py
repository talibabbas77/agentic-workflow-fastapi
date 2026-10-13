"""Outgoing email. SMTP covers Mailpit locally and Resend or any provider in production."""

from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import make_msgid
from typing import Protocol

import aiosmtplib

from docent.config import Settings


@dataclass(frozen=True, slots=True)
class OutgoingEmail:
    to: str
    subject: str
    text: str
    html: str
    reply_to: str | None = None
    headers: dict[str, str] = field(default_factory=dict)


class EmailSender(Protocol):
    async def send(self, email: OutgoingEmail) -> str: ...


class SmtpEmailSender:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    async def send(self, email: OutgoingEmail) -> str:
        msg = EmailMessage()
        msg["From"] = self._s.email_from
        msg["To"] = email.to
        msg["Subject"] = email.subject
        msg_id = make_msgid(domain="docent")
        msg["Message-ID"] = msg_id
        if email.reply_to:
            msg["Reply-To"] = email.reply_to
        for key, value in email.headers.items():
            msg[key] = value
        msg.set_content(email.text)
        msg.add_alternative(email.html, subtype="html")
        password = self._s.smtp_password.get_secret_value() if self._s.smtp_password else None
        await aiosmtplib.send(
            msg,
            hostname=self._s.smtp_host,
            port=self._s.smtp_port,
            username=self._s.smtp_username,
            password=password,
            start_tls=self._s.smtp_starttls,
            use_tls=self._s.smtp_use_tls,
            timeout=15,
        )
        return msg_id


class MemoryEmailSender:
    """Test double that keeps sent messages in memory."""

    def __init__(self) -> None:
        self.sent: list[OutgoingEmail] = []

    async def send(self, email: OutgoingEmail) -> str:
        self.sent.append(email)
        return f"<memory-{len(self.sent)}@docent>"
