"""Widget: admin setup, signed identity, origins, frame policy, sessions, ownership, limits."""

import runpy
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from jwt.algorithms import ECAlgorithm

from docent.config import repo_root
from docent.db.pool import Pool
from tests.conftest import ClientFactory, Drain, verified_owner

WIDGET_ORIGIN = "http://localhost:8000"
SITE = "http://localhost:5173"
DOC = b"# Billing guide\n\n## Refunds\n\nAnnual plans can be refunded within 30 days of renewal.\n"


class Tenant:
    def __init__(
        self,
        admin: httpx.AsyncClient,
        widget: dict[str, Any],
        key: ec.EllipticCurvePrivateKey,
        kid: str,
    ):
        self.admin, self.widget, self.key, self.kid = admin, widget, key, kid

    def token(self, **overrides: Any) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {
            "iss": self.widget["public_id"],
            "aud": "docent",
            "sub": "user_8812",
            "iat": now,
            "exp": now + 600,
            "jti": uuid.uuid4().hex,
            "name": "Sam Ortiz",
            "email": "sam@example.com",
            "ctx": {"plan": "pro", "secret_internal": "x"},
        }
        headers = {"kid": overrides.pop("kid", self.kid)}
        key = overrides.pop("key", self.key)
        claims.update(overrides)
        return jwt.encode(
            {k: v for k, v in claims.items() if v is not None},
            key,
            algorithm="ES256",
            headers=headers,
        )


def new_key() -> tuple[ec.EllipticCurvePrivateKey, dict[str, Any]]:
    private = ec.generate_private_key(ec.SECP256R1())
    return private, ECAlgorithm.to_jwk(private.public_key(), as_dict=True)


@pytest.fixture
async def tenant(client_factory: ClientFactory, drain: Drain) -> Tenant:
    admin = client_factory()
    await verified_owner(admin, drain, "Lumen Notes")
    await admin.post("/v1/knowledge/uploads", files={"file": ("billing.md", DOC)})
    await drain()
    created = await admin.post(
        "/v1/widgets",
        json={
            "name": "Help",
            "allowed_origins": [SITE, "https://app.example.com/"],
            "allowed_claims": ["plan"],
            "greeting": "Ask me anything.",
        },
    )
    assert created.status_code == 201, created.text
    private, jwk = new_key()
    key = await admin.post(f"/v1/widgets/{created.json()['id']}/keys", json={"public_jwk": jwk})
    assert key.status_code == 201, key.text
    return Tenant(admin, created.json(), private, key.json()["kid"])


@pytest.fixture
def frame(client_factory: ClientFactory) -> httpx.AsyncClient:
    """Requests as the widget iframe makes them: from the widget origin, no cookies."""
    return client_factory(origin=WIDGET_ORIGIN)


async def session(frame: httpx.AsyncClient, tenant: Tenant, **body: Any) -> httpx.Response:
    return await frame.post(
        "/v1/widget/sessions",
        json={"widget": tenant.widget["public_id"], "parent_origin": SITE, **body},
    )


def bearer(token: str) -> dict[str, str]:
    return {"authorization": f"Bearer {token}"}


async def test_admin_widget_setup_and_origin_rules(tenant: Tenant) -> None:
    assert tenant.widget["allowed_origins"] == ["http://localhost:5173", "https://app.example.com"]
    assert tenant.widget["embed_origin"] == WIDGET_ORIGIN
    assert tenant.widget["public_id"].startswith("wid_")
    for bad in ("https://app.example.com/path", "https://*.example.com", "ftp://x.example"):
        response = await tenant.admin.put(
            f"/v1/widgets/{tenant.widget['id']}", json={"name": "Help", "allowed_origins": [bad]}
        )
        assert response.status_code == 422, bad


async def test_signing_keys_public_only_two_active_and_retire(tenant: Tenant) -> None:
    wid = tenant.widget["id"]
    private = ECAlgorithm.to_jwk(ec.generate_private_key(ec.SECP256R1()), as_dict=True)
    rejected = await tenant.admin.post(f"/v1/widgets/{wid}/keys", json={"public_jwk": private})
    assert rejected.status_code == 422
    assert "private key" in rejected.json()["error"]["message"]
    _, second = new_key()
    assert (
        await tenant.admin.post(f"/v1/widgets/{wid}/keys", json={"public_jwk": second})
    ).status_code == 201
    _, third = new_key()
    full = await tenant.admin.post(f"/v1/widgets/{wid}/keys", json={"public_jwk": third})
    assert full.status_code == 409
    retired = await tenant.admin.post(f"/v1/widgets/{wid}/keys/{tenant.kid}/retire")
    assert retired.json()["status"] == "retired"


async def test_anonymous_session_and_conversation(frame: httpx.AsyncClient, tenant: Tenant) -> None:
    created = await session(frame, tenant)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["mode"] == "anonymous"
    assert body["widget"] == {"name": "Help", "greeting": "Ask me anything."}
    headers = bearer(body["session_token"])
    conversation = (await frame.post("/v1/widget/conversations", json={}, headers=headers)).json()
    sent = await frame.post(
        f"/v1/widget/conversations/{conversation['id']}/messages",
        json={"content": "how are annual plans refunded"},
        headers=headers,
    )
    assert "event: message" in sent.text
    # Same browser tab later: new session with the stored visitor id resumes the conversation.
    again = (await session(frame, tenant, visitor_id=body["visitor_id"])).json()
    resumed = await frame.post(
        "/v1/widget/conversations",
        json={"resume_id": conversation["id"]},
        headers=bearer(again["session_token"]),
    )
    assert resumed.json()["id"] == conversation["id"]
    assert len(resumed.json()["messages"]) == 2


async def test_identified_session_uses_verified_claims_only(
    frame: httpx.AsyncClient, tenant: Tenant, admin_pool: Pool
) -> None:
    created = await session(frame, tenant, token=tenant.token())
    assert created.status_code == 201, created.text
    assert created.json()["mode"] == "identified"
    assert created.json()["user"] == {"name": "Sam Ortiz"}
    headers = bearer(created.json()["session_token"])
    first = (await frame.post("/v1/widget/conversations", json={}, headers=headers)).json()
    async with admin_pool.acquire() as conn:
        claims = await conn.fetchval(
            "select claims from conversations where id = $1", uuid.UUID(first["id"])
        )
    assert claims == {
        "name": "Sam Ortiz",
        "email": "sam@example.com",
        "plan": "pro",
    }  # not allowlisted dropped
    second_session = (await session(frame, tenant, token=tenant.token())).json()
    resumed = await frame.post(
        "/v1/widget/conversations", json={}, headers=bearer(second_session["session_token"])
    )
    assert resumed.json()["id"] == first["id"]  # identified users resume server side


@pytest.mark.parametrize(
    "case",
    [
        "expired",
        "future_iat",
        "wrong_aud",
        "wrong_iss",
        "unknown_kid",
        "foreign_key",
        "too_long",
        "missing_jti",
        "alg_none",
        "hs256_with_public_key",
        "tampered",
        "garbage",
    ],
)
async def test_rejected_tokens(frame: httpx.AsyncClient, tenant: Tenant, case: str) -> None:
    now = int(time.time())
    if case == "expired":
        token = tenant.token(iat=now - 1000, exp=now - 200)
    elif case == "future_iat":
        token = tenant.token(iat=now + 600, exp=now + 900)
    elif case == "wrong_aud":
        token = tenant.token(aud="someone-else")
    elif case == "wrong_iss":
        token = tenant.token(iss="wid_AAAAAAAAAAAAAAAA")
    elif case == "unknown_kid":
        token = tenant.token(kid="key_unknown12345")
    elif case == "foreign_key":
        token = tenant.token(key=ec.generate_private_key(ec.SECP256R1()))
    elif case == "too_long":
        token = tenant.token(iat=now, exp=now + 3600)
    elif case == "missing_jti":
        token = tenant.token(jti=None)
    elif case == "alg_none":
        token = jwt.encode(
            {"iss": tenant.widget["public_id"], "aud": "docent", "sub": "x"}, None, algorithm="none"
        )
    elif case == "hs256_with_public_key":
        public_pem = tenant.key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        token = _hs256(public_pem, tenant)
    elif case == "tampered":
        head, payload, sig = tenant.token().split(".")
        token = ".".join([head, payload[:-4] + "AAAA", sig])
    else:
        token = "not.a.token"
    response = await session(frame, tenant, token=token)
    assert response.status_code == 401, (case, response.text)
    assert response.json()["error"]["code"] == "token_invalid"


def _hs256(secret: bytes, tenant: Tenant) -> str:
    import base64
    import hashlib
    import hmac
    import json

    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    now = int(time.time())
    header = b64(json.dumps({"alg": "HS256", "kid": tenant.kid}).encode())
    payload = b64(
        json.dumps(
            {
                "iss": tenant.widget["public_id"],
                "aud": "docent",
                "sub": "x",
                "iat": now,
                "exp": now + 60,
                "jti": "abcdefgh",
            }
        ).encode()
    )
    signature = b64(hmac.new(secret, f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


async def test_empty_token_is_rejected_not_downgraded(
    frame: httpx.AsyncClient, tenant: Tenant
) -> None:
    """A host that meant identified mode must not silently get an anonymous session."""
    response = await session(frame, tenant, token="")
    assert response.status_code == 422


async def test_python_signing_example_is_accepted(
    frame: httpx.AsyncClient, tenant: Tenant, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The snippet customers copy from the install guide signs tokens the API accepts."""
    root = repo_root()
    assert root is not None
    pem = tenant.key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    monkeypatch.setenv("DOCENT_WIDGET_ID", tenant.widget["public_id"])
    monkeypatch.setenv("DOCENT_KEY_ID", tenant.kid)
    monkeypatch.setenv("DOCENT_PRIVATE_KEY", pem)
    example = runpy.run_path(str(root / "examples" / "signing" / "python.py"))
    user = {"id": 42, "name": "Ana Souza", "email": "ana@example.com", "plan": "Team"}
    response = await session(frame, tenant, token=example["docent_token"](user))
    assert response.status_code == 201, response.text
    assert response.json()["user"]["name"] == "Ana Souza"


async def test_replayed_token_and_retired_key_are_rejected(
    frame: httpx.AsyncClient, tenant: Tenant
) -> None:
    token = tenant.token()
    assert (await session(frame, tenant, token=token)).status_code == 201
    replay = await session(frame, tenant, token=token)
    assert replay.status_code == 401
    assert "already used" in replay.json()["error"]["message"]
    await tenant.admin.post(f"/v1/widgets/{tenant.widget['id']}/keys/{tenant.kid}/retire")
    assert (await session(frame, tenant, token=tenant.token())).status_code == 401


async def test_origins_and_anonymous_switch(
    frame: httpx.AsyncClient, tenant: Tenant, client_factory: ClientFactory
) -> None:
    other_site = await frame.post(
        "/v1/widget/sessions",
        json={"widget": tenant.widget["public_id"], "parent_origin": "https://evil.example"},
    )
    assert other_site.status_code == 403
    host_page = await client_factory(origin=SITE).post(
        "/v1/widget/sessions", json={"widget": tenant.widget["public_id"], "parent_origin": SITE}
    )
    assert host_page.status_code == 403  # must come from the widget frame
    await tenant.admin.put(
        f"/v1/widgets/{tenant.widget['id']}",
        json={"name": "Help", "allowed_origins": [SITE], "anonymous_enabled": False},
    )
    closed = await session(frame, tenant)
    assert closed.status_code == 403
    assert closed.json()["error"]["code"] == "anonymous_disabled"
    assert (await session(frame, tenant, token=tenant.token())).status_code == 201


async def test_frame_page_policy(frame: httpx.AsyncClient, tenant: Tenant) -> None:
    response = await frame.get(f"/widget/v1/frame/{tenant.widget['public_id']}")
    assert response.status_code == 200
    csp = response.headers["content-security-policy"]
    assert "frame-ancestors http://localhost:5173 https://app.example.com" in csp
    assert "script-src 'self'" in csp
    assert "x-frame-options" not in response.headers
    assert "&quot;allowedOrigins&quot;" in response.text
    assert (await frame.get("/widget/v1/frame/wid_doesnotexist0000")).status_code == 404
    admin_page = await frame.get("/v1/auth/me")
    assert admin_page.headers["x-frame-options"] == "DENY"


async def test_static_files_are_served_from_the_build(
    frame: httpx.AsyncClient, app: FastAPI, tmp_path: Path
) -> None:
    settings = app.state.docent.settings
    original = settings.widget_dist_dir
    (tmp_path / "loader.js").write_text("/* loader */")
    settings.widget_dist_dir = tmp_path
    try:
        loader = await frame.get("/widget/v1/loader.js")
        assert loader.status_code == 200
        assert loader.headers["content-type"].startswith("application/javascript")
        assert loader.headers["cross-origin-resource-policy"] == "cross-origin"
        assert (await frame.get("/widget/v1/frame.js")).status_code == 404
        assert (await frame.get("/widget/v1/secrets.txt")).status_code == 404
    finally:
        settings.widget_dist_dir = original


async def test_visitors_cannot_reach_each_others_conversations(
    frame: httpx.AsyncClient, tenant: Tenant
) -> None:
    alice = (await session(frame, tenant)).json()
    bob = (await session(frame, tenant)).json()
    conversation = (
        await frame.post(
            "/v1/widget/conversations", json={}, headers=bearer(alice["session_token"])
        )
    ).json()
    stolen = await frame.post(
        f"/v1/widget/conversations/{conversation['id']}/messages",
        json={"content": "hello"},
        headers=bearer(bob["session_token"]),
    )
    assert stolen.status_code == 404
    hijack = await frame.post(
        "/v1/widget/conversations",
        json={"resume_id": conversation["id"]},
        headers=bearer(bob["session_token"]),
    )
    assert hijack.json()["id"] != conversation["id"]


async def test_anonymous_rate_limit_contact_and_revocation(
    frame: httpx.AsyncClient, tenant: Tenant, drain: Drain, admin_pool: Pool
) -> None:
    created = (await session(frame, tenant)).json()
    headers = bearer(created["session_token"])
    conversation = (await frame.post("/v1/widget/conversations", json={}, headers=headers)).json()
    url = f"/v1/widget/conversations/{conversation['id']}"
    handoff = await frame.post(
        f"{url}/messages", json={"content": "talk to a human"}, headers=headers
    )
    assert '"reason": "user_requested"' in handoff.text
    assert created["expires_in"] == 30 * 60

    async def resumed_handoff() -> dict[str, Any]:
        body = {"resume_id": conversation["id"]}
        resumed = await frame.post("/v1/widget/conversations", json=body, headers=headers)
        assert resumed.json()["id"] == conversation["id"]
        handoff: dict[str, Any] = resumed.json()["handoff"]
        return handoff

    assert conversation["handoff"] is None
    assert await resumed_handoff() == {"status": "open", "contact_given": False}
    assert (
        await frame.post(f"{url}/contact", json={"email": "visitor@example.com"}, headers=headers)
    ).status_code == 204
    assert (await resumed_handoff())["contact_given"] is True
    async with admin_pool.acquire() as conn:
        assert await conn.fetchval("select contact_email from escalations") == "visitor@example.com"
    codes = []
    for _ in range(10):
        r = await frame.post(
            f"{url}/messages", json={"content": "talk to a human"}, headers=headers
        )
        codes.append(r.status_code)
    assert codes[-1] == 429  # eleventh message this hour from one address
    assert (await frame.delete("/v1/widget/sessions/current", headers=headers)).status_code == 204
    assert (
        await frame.post("/v1/widget/conversations", json={}, headers=headers)
    ).status_code == 401


async def test_widget_sessions_are_tenant_scoped(
    frame: httpx.AsyncClient, tenant: Tenant, client_factory: ClientFactory, drain: Drain
) -> None:
    other = client_factory()
    await verified_owner(other, drain, "Other Co")
    other_conversation = (await other.post("/v1/agent/conversations", json={})).json()
    mine = (await session(frame, tenant)).json()
    response = await frame.post(
        "/v1/widget/conversations",
        json={"resume_id": other_conversation["id"]},
        headers=bearer(mine["session_token"]),
    )
    assert response.json()["id"] != other_conversation["id"]
    widgets = (await other.get("/v1/widgets")).json()
    assert widgets == []
