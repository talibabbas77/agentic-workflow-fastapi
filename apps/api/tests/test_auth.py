"""Staff auth: sign up, verify, log in and out, reset, sessions, CSRF, rate limits."""

import httpx

from docent.db.pool import Pool
from tests.conftest import PASSWORD, ClientFactory, Drain, signup, token_from, unique_email


async def test_signup_creates_user_workspace_and_session(client: httpx.AsyncClient) -> None:
    me = await signup(client, workspace="Acme Support")
    assert me["user"]["email_verified"] is False
    assert me["active_tenant"]["role"] == "owner"
    assert me["active_tenant"]["slug"] == "acme-support"
    assert client.cookies.get("docent_session")
    again = await client.get("/v1/auth/me")
    assert again.status_code == 200
    assert again.json()["user"]["id"] == me["user"]["id"]


async def test_session_cookie_flags(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/v1/auth/signup",
        json={
            "name": "A",
            "email": unique_email(),
            "password": PASSWORD,
            "workspace_name": "W",
        },
    )
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "path=/" in cookie


async def test_duplicate_slug_gets_suffix(client_factory: ClientFactory) -> None:
    a = await signup(client_factory(), workspace="Same Name")
    b = await signup(client_factory(), workspace="Same Name")
    assert a["active_tenant"]["slug"] == "same-name"
    assert b["active_tenant"]["slug"].startswith("same-name-")


async def test_signup_rejects_duplicate_email_case_insensitive(
    client_factory: ClientFactory,
) -> None:
    email = unique_email()
    await signup(client_factory(), email=email)
    response = await client_factory().post(
        "/v1/auth/signup",
        json={"name": "B", "email": email.upper(), "password": PASSWORD, "workspace_name": "W"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "email_taken"


async def test_signup_validates_fields(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/v1/auth/signup",
        json={"name": "", "email": "not-an-email", "password": "short", "workspace_name": "W"},
    )
    assert response.status_code == 422
    fields = response.json()["error"]["fields"]
    assert {"name", "email", "password"} <= fields.keys()
    assert "10 characters" in fields["password"]


async def test_verify_email_with_token_once(client: httpx.AsyncClient, drain: Drain) -> None:
    me = await signup(client)
    emails = await drain()
    assert len(emails) == 1
    assert emails[0].to == me["user"]["email"]
    assert "verify-email?token=" in emails[0].text
    token = token_from(emails[0])
    assert (await client.post("/v1/auth/verify-email", json={"token": token})).status_code == 204
    assert (await client.get("/v1/auth/me")).json()["user"]["email_verified"] is True
    reused = await client.post("/v1/auth/verify-email", json={"token": token})
    assert reused.status_code == 400
    assert reused.json()["error"]["code"] == "token_invalid"


async def test_resend_verification_invalidates_old_token(
    client: httpx.AsyncClient, drain: Drain
) -> None:
    await signup(client)
    first = token_from((await drain())[0])
    assert (await client.post("/v1/auth/verify-email/resend")).status_code == 204
    second = token_from((await drain())[0])
    assert first != second
    old = await client.post("/v1/auth/verify-email", json={"token": first})
    assert old.status_code == 400
    new = await client.post("/v1/auth/verify-email", json={"token": second})
    assert new.status_code == 204


async def test_login_logout(client_factory: ClientFactory) -> None:
    email = unique_email()
    await signup(client_factory(), email=email)
    c = client_factory()
    wrong = await c.post("/v1/auth/login", json={"email": email, "password": "wrong password!"})
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "invalid_credentials"
    unknown = await c.post("/v1/auth/login", json={"email": unique_email(), "password": PASSWORD})
    assert unknown.status_code == 401
    assert unknown.json()["error"]["message"] == wrong.json()["error"]["message"]
    ok = await c.post("/v1/auth/login", json={"email": email.upper(), "password": PASSWORD})
    assert ok.status_code == 200
    assert ok.json()["active_tenant"]["role"] == "owner"
    assert (await c.post("/v1/auth/logout")).status_code == 204
    assert (await c.get("/v1/auth/me")).status_code == 401


async def test_logout_revokes_session_server_side(client: httpx.AsyncClient) -> None:
    await signup(client)
    token = client.cookies["docent_session"]
    await client.post("/v1/auth/logout")
    client.cookies.set("docent_session", token)
    assert (await client.get("/v1/auth/me")).status_code == 401


async def test_unauthenticated_requests(client: httpx.AsyncClient) -> None:
    for method, path in [("GET", "/v1/auth/me"), ("GET", "/v1/tenant"), ("GET", "/v1/members")]:
        response = await client.request(method, path)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "not_authenticated"


async def test_password_reset_flow(client_factory: ClientFactory, drain: Drain) -> None:
    email = unique_email()
    old_session = client_factory()
    await signup(old_session, email=email)
    await drain()
    c = client_factory()
    assert (
        await c.post("/v1/auth/password/forgot", json={"email": unique_email()})
    ).status_code == 202
    assert await drain() == []
    assert (await c.post("/v1/auth/password/forgot", json={"email": email})).status_code == 202
    emails = await drain()
    assert len(emails) == 1
    assert "reset-password?token=" in emails[0].text
    reset = await c.post(
        "/v1/auth/password/reset",
        json={"token": token_from(emails[0]), "password": "a brand new password"},
    )
    assert reset.status_code == 200
    assert reset.json()["user"]["email_verified"] is True
    assert (await c.get("/v1/auth/me")).status_code == 200
    assert (await old_session.get("/v1/auth/me")).status_code == 401
    relog = await client_factory().post(
        "/v1/auth/login", json={"email": email, "password": "a brand new password"}
    )
    assert relog.status_code == 200


async def test_login_rate_limited_per_email(client_factory: ClientFactory) -> None:
    email = unique_email()
    await signup(client_factory(), email=email)
    c = client_factory()
    for _ in range(10):
        r = await c.post("/v1/auth/login", json={"email": email, "password": "nope nope nope"})
        assert r.status_code == 401
    blocked = await c.post("/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"
    assert int(blocked.headers["retry-after"]) >= 1


async def test_writes_require_allowed_origin(client_factory: ClientFactory) -> None:
    body = {"name": "A", "email": unique_email(), "password": PASSWORD, "workspace_name": "W"}
    no_origin = await client_factory(origin=None).post("/v1/auth/signup", json=body)
    assert no_origin.status_code == 403
    assert no_origin.json()["error"]["code"] == "csrf_failed"
    evil = await client_factory(origin="https://evil.example").post("/v1/auth/signup", json=body)
    assert evil.status_code == 403
    with_referer = await client_factory(origin=None).post(
        "/v1/auth/signup", json=body, headers={"referer": "http://localhost:3000/signup"}
    )
    assert with_referer.status_code == 201


async def test_security_headers(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/auth/me")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["cache-control"] == "no-store"
    assert len(response.headers["x-request-id"]) >= 8


async def test_session_expiry(client: httpx.AsyncClient, owner_pool: Pool) -> None:
    await signup(client)
    async with owner_pool.acquire() as conn:
        await conn.execute("update user_sessions set expires_at = now() - interval '1 second'")
    assert (await client.get("/v1/auth/me")).status_code == 401


async def test_switch_tenant(client_factory: ClientFactory, drain: Drain) -> None:
    owner_b = client_factory()
    from tests.conftest import verified_owner

    b = await verified_owner(owner_b, drain, "Second")
    user = client_factory()
    me = await signup(user, workspace="First")
    await drain()
    invite = await owner_b.post("/v1/invitations", json={"email": me["user"]["email"]})
    token = token_from((await drain())[0])
    assert invite.status_code == 201
    accepted = await user.post("/v1/invitations/accept", json={"token": token})
    assert accepted.status_code == 200
    assert accepted.json()["active_tenant"]["id"] == b["active_tenant"]["id"]
    assert len(accepted.json()["tenants"]) == 2
    back = await user.post("/v1/auth/switch-tenant", json={"tenant_id": me["active_tenant"]["id"]})
    assert back.status_code == 200
    assert back.json()["active_tenant"]["name"] == "First"


async def test_oversized_body_rejected(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/v1/auth/login",
        content=b'{"email": "' + b"a" * 1_100_000 + b'"}',
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"
