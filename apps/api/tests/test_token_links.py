"""One-time tokens never sit in the job queue in plain text (security review, 2026-10-14)."""

import json

import httpx

from docent.db.pool import Pool
from tests.conftest import Drain, token_from, unique_email, verified_owner


async def queued_payloads(admin_pool: Pool) -> list[str]:
    async with admin_pool.acquire() as conn:
        rows = await conn.fetch("select payload from jobs where kind = 'send_email'")
    return [json.dumps(row["payload"]) for row in rows]


async def test_token_links_are_sealed_in_jobs_and_still_work(
    client: httpx.AsyncClient, drain: Drain, admin_pool: Pool
) -> None:
    me = await verified_owner(client, drain, workspace="Sealed Co")  # the verify link worked
    invited = await client.post("/v1/invitations", json={"email": unique_email("guest")})
    assert invited.status_code == 201, invited.text
    forgot = await client.post("/v1/auth/password/forgot", json={"email": me["user"]["email"]})
    assert forgot.status_code == 202

    payloads = await queued_payloads(admin_pool)
    assert payloads
    for payload in payloads:
        assert "token=" not in payload
        assert '"url"' not in payload or "sealed_url" not in payload

    sent = await drain()
    links = {email.subject: token_from(email) for email in sent}
    assert len(links) == 2  # the invitation and the reset, each with a working token in the link
    assert all(len(token) > 20 for token in links.values())
