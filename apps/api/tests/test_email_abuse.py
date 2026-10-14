"""Docent cannot be used as a mailer by a workspace (security review, 2026-10-14)."""

import uuid
from typing import Any

import httpx
import pytest

from docent.config import Settings
from docent.db.pool import Pool
from docent.email import sender as sender_module
from docent.email.sender import OutgoingEmail, SmtpEmailSender
from tests.conftest import Drain, signup, verified_owner
from tests.inbox_helpers import handoff

TYPE = {"name": "Billing", "description": "Charges and invoices", "fields": []}


async def test_an_unverified_member_cannot_make_docent_email_anyone(
    client: httpx.AsyncClient,
) -> None:
    await signup(client, workspace="Unverified Co")
    refused = await client.post(
        "/v1/ticket-types", json=TYPE | {"notify_emails": ["victim@example.org"]}
    )
    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "email_not_verified"
    assert (await client.post("/v1/ticket-types", json=TYPE)).status_code == 201
    rule = await client.post(
        "/v1/automation/rules",
        json={"name": "Everyone", "notify_emails": ["victim@example.org"]},
    )
    assert rule.status_code == 403

    escalation = await handoff(client)
    reply = await client.post(f"/v1/inbox/{escalation['id']}/replies", json={"body": "Hello"})
    assert reply.status_code == 403
    assert reply.json()["error"]["code"] == "email_not_verified"


async def test_people_outside_the_workspace_see_docent_as_the_sender(
    client: httpx.AsyncClient, drain: Drain
) -> None:
    me = await verified_owner(client, drain, workspace="ACCOUNT LOCKED verify now")
    notify = ["outside@example.org", me["user"]["email"]]
    created = await client.post("/v1/ticket-types", json=TYPE | {"notify_emails": notify})
    assert created.status_code == 201
    await handoff(client, "a double charge on my card")
    sent = {email.to: email for email in await drain()}
    assert sent["outside@example.org"].from_name == "Docent"
    assert sent[me["user"]["email"]].from_name == "ACCOUNT LOCKED verify now via Docent"


async def test_handoff_emails_stop_at_the_daily_cap(
    client: httpx.AsyncClient, drain: Drain, admin_pool: Pool, settings: Settings
) -> None:
    me = await verified_owner(client, drain, workspace="Busy Co")
    tenant_id = uuid.UUID(me["active_tenant"]["id"])
    await client.post("/v1/ticket-types", json=TYPE | {"notify_emails": ["ops@example.org"]})
    async with admin_pool.acquire() as conn:
        await conn.executemany(
            """
            insert into email_deliveries (id, tenant_id, kind, to_hash, to_hint, subject)
            values ($1, $2, 'notification', 'x', 'o***@example.org', 'Earlier')
            """,
            [(uuid.uuid4(), tenant_id) for _ in range(settings.notification_emails_per_day)],
        )
    await handoff(client, "a double charge on my card")
    assert [e.to for e in await drain() if e.to == "ops@example.org"] == []


async def test_a_subject_with_a_line_break_is_sent_on_one_line(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: list[Any] = []

    async def fake_send(message: Any, **_: Any) -> None:
        captured.append(message)

    monkeypatch.setattr(sender_module.aiosmtplib, "send", fake_send)
    email = OutgoingEmail(
        to="team@example.com",
        subject="[Acme] New handoff: hi\nBcc: x@example.org",
        text="t",
        html="h",
    )
    await SmtpEmailSender(settings).send(email)
    assert captured[0]["Subject"] == "[Acme] New handoff: hi Bcc: x@example.org"
    assert captured[0]["Bcc"] is None
