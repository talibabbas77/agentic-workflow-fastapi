"""Widget: admin setup, signed identity, origins, frame policy, sessions, ownership, limits."""

import html
import json
import re
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
from tests.conftest import ClientFactory, Drain, set_plan, verified_owner

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
    return await make_tenant(client_factory, drain)


async def make_tenant(
    client_factory: ClientFactory, drain: Drain, workspace: str = "Lumen Notes"
) -> Tenant:
    """A company with a billing guide, a widget on SITE, and a signing key."""
    admin = client_factory()
    await verified_owner(admin, drain, workspace)
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
    assert body["widget"] == {"name": "Help", "greeting": "Ask me anything.", "suggestions": []}
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
    lookup = await frame.post("/v1/widget/conversations", json={"create": False}, headers=headers)
    assert lookup.status_code == 404  # no resume id: nothing to look up, nothing created
    assert lookup.json()["error"]["code"] == "no_conversation"
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
    found = (await tenant.admin.get(f"/v1/widgets/{tenant.widget['id']}")).json()
    assert (found["public_id"], [k["kid"] for k in found["keys"]]) == (
        tenant.widget["public_id"],
        [tenant.kid],
    )
    assert (await other.get(f"/v1/widgets/{tenant.widget['id']}")).status_code == 404


# Suggested questions, new chats, and recent chats


async def identified(
    frame: httpx.AsyncClient, tenant: Tenant, sub: str = "user_8812"
) -> dict[str, str]:
    """Authorization headers for a signed-in customer's widget session."""
    created = await session(frame, tenant, token=tenant.token(sub=sub))
    assert created.status_code == 201, created.text
    return bearer(created.json()["session_token"])


async def anonymous(frame: httpx.AsyncClient, tenant: Tenant) -> dict[str, str]:
    created = await session(frame, tenant)
    assert created.status_code == 201, created.text
    return bearer(created.json()["session_token"])


async def start(frame: httpx.AsyncClient, headers: dict[str, str], **body: Any) -> dict[str, Any]:
    response = await frame.post("/v1/widget/conversations", json=body, headers=headers)
    assert response.status_code == 201, response.text
    conversation: dict[str, Any] = response.json()
    return conversation


async def ask(
    frame: httpx.AsyncClient, headers: dict[str, str], conversation: dict[str, Any], text: str
) -> None:
    sent = await frame.post(
        f"/v1/widget/conversations/{conversation['id']}/messages",
        json={"content": text},
        headers=headers,
    )
    assert "event: message" in sent.text, sent.text


async def second_widget(tenant: Tenant, admin_pool: Pool) -> Tenant:
    """Another widget of the same company, with its own signing key."""
    await set_plan(tenant.admin, admin_pool, "growth")
    created = await tenant.admin.post(
        "/v1/widgets", json={"name": "Dashboard", "allowed_origins": [SITE]}
    )
    assert created.status_code == 201, created.text
    private, jwk = new_key()
    key = await tenant.admin.post(
        f"/v1/widgets/{created.json()['id']}/keys", json={"public_jwk": jwk}
    )
    assert key.status_code == 201, key.text
    return Tenant(tenant.admin, created.json(), private, key.json()["kid"])


def frame_config(page: httpx.Response) -> dict[str, Any]:
    match = re.search(r'<meta name="docent-widget" content="([^"]*)">', page.text)
    assert match is not None
    config: dict[str, Any] = json.loads(html.unescape(match.group(1)))
    return config


async def test_suggestions_are_cleaned_checked_and_reach_the_frame(
    frame: httpx.AsyncClient, tenant: Tenant
) -> None:
    url = f"/v1/widgets/{tenant.widget['id']}"
    body = {"name": "Help", "allowed_origins": [SITE], "greeting": "Ask me anything."}
    assert tenant.widget["suggestions"] == []
    saved = await tenant.admin.put(
        url, json=body | {"suggestions": ["  How are   refunds paid? ", "Can I pay yearly?"]}
    )
    assert saved.status_code == 200, saved.text
    wanted = ["How are refunds paid?", "Can I pay yearly?"]
    assert saved.json()["suggestions"] == wanted
    assert (await tenant.admin.get(url)).json()["suggestions"] == wanted

    refused = [
        (["One?", "Two?", "Three?", "Four?", "Five?"], "4 suggested questions at most"),
        (["Refunds?", "  REFUNDS? "], "must be different"),
        (["x" * 101], "100 characters or fewer"),
        (["   "], "remove the empty one"),
    ]
    for bad, message in refused:
        response = await tenant.admin.put(url, json=body | {"suggestions": bad})
        assert response.status_code == 422, bad
        assert message in response.json()["error"]["fields"]["suggestions"], bad
    assert (await tenant.admin.get(url)).json()["suggestions"] == wanted
    exactly = ["x" * 100, "Two?", "Three?", "Four?"]
    assert (await tenant.admin.put(url, json=body | {"suggestions": exactly})).status_code == 200

    # The frame page and the session both carry them, plus the link for "Powered by Docent".
    config = frame_config(await frame.get(f"/widget/v1/frame/{tenant.widget['public_id']}"))
    assert config["suggestions"] == exactly
    assert config["siteUrl"] == "http://localhost:3000"
    created = (await session(frame, tenant)).json()
    assert created["widget"]["suggestions"] == exactly

    # Leaving them out of a full update clears them, like every other setting.
    cleared = await tenant.admin.put(url, json=body)
    assert cleared.json()["suggestions"] == []


async def test_identified_customer_starts_a_new_conversation(
    frame: httpx.AsyncClient, tenant: Tenant
) -> None:
    sam = await identified(frame, tenant)
    first = await start(frame, sam)
    await ask(frame, sam, first, "how are annual plans refunded")
    # Without new, the latest open conversation is resumed.
    assert (await start(frame, sam, create=False))["id"] == first["id"]

    fresh = await start(frame, sam, new=True)
    assert fresh["id"] != first["id"]
    assert fresh["messages"] == []
    # The earlier conversation stays as it was, for the team's inbox.
    old = await frame.get(f"/v1/widget/conversations/{first['id']}", headers=sam)
    assert old.status_code == 200
    assert old.json()["status"] != "closed"
    assert [m["role"] for m in old.json()["messages"]] == ["visitor", "agent"]

    for contradiction in ({"new": True, "create": False}, {"new": True, "resume_id": first["id"]}):
        refused = await frame.post("/v1/widget/conversations", json=contradiction, headers=sam)
        assert refused.status_code == 422, contradiction


async def test_starting_conversations_is_rate_limited(
    frame: httpx.AsyncClient, tenant: Tenant
) -> None:
    sam = await identified(frame, tenant)
    codes = [
        (await frame.post("/v1/widget/conversations", json={"new": True}, headers=sam)).status_code
        for _ in range(21)
    ]
    assert codes[:20] == [201] * 20
    assert codes[20] == 429  # the 21st new chat this hour for one customer
    # Opening the panel only looks up the conversation, so it never counts.
    assert (
        await frame.post("/v1/widget/conversations", json={"create": False}, headers=sam)
    ).status_code == 201


async def test_recent_chats_list_only_this_customers_conversations_on_this_widget(
    frame: httpx.AsyncClient, tenant: Tenant, admin_pool: Pool
) -> None:
    sam = await identified(frame, tenant)
    first = await start(frame, sam)
    await ask(frame, sam, first, "how are annual plans   refunded")
    second = await start(frame, sam, new=True)
    await ask(frame, sam, second, "talk to a human")
    await start(frame, sam, new=True)  # never written in: not listed

    listed = (await frame.get("/v1/widget/conversations", headers=sam)).json()
    assert [c["id"] for c in listed] == [second["id"], first["id"]]
    assert [c["title"] for c in listed] == ["talk to a human", "how are annual plans refunded"]
    assert listed[0]["status"] == "escalated"
    assert set(listed[0]) == {"id", "status", "title", "started_at", "last_message_at"}

    # Another customer of the same widget, an anonymous visitor, and the same
    # customer on another widget of the same company all see none of them.
    ana = await identified(frame, tenant, sub="user_9000")
    visitor = await anonymous(frame, tenant)
    other = await second_widget(tenant, admin_pool)
    sam_elsewhere = await identified(frame, other)
    for headers in (ana, visitor, sam_elsewhere):
        assert (await frame.get("/v1/widget/conversations", headers=headers)).json() == []
    # Their own chats stay their own.
    theirs = await start(frame, ana)
    await ask(frame, ana, theirs, "talk to a human please")
    assert [c["id"] for c in (await frame.get("/v1/widget/conversations", headers=ana)).json()] == [
        theirs["id"]
    ]
    assert len((await frame.get("/v1/widget/conversations", headers=sam)).json()) == 2
    assert (await frame.get("/v1/widget/conversations")).status_code == 401


async def test_customers_cannot_open_or_continue_other_conversations(
    frame: httpx.AsyncClient, tenant: Tenant, admin_pool: Pool
) -> None:
    sam = await identified(frame, tenant)
    mine = await start(frame, sam)
    await ask(frame, sam, mine, "how are annual plans refunded")
    url = f"/v1/widget/conversations/{mine['id']}"
    assert (await frame.get(url, headers=sam)).json()["id"] == mine["id"]

    ana = await identified(frame, tenant, sub="user_9000")
    visitor = await anonymous(frame, tenant)
    sam_elsewhere = await identified(frame, await second_widget(tenant, admin_pool))
    for headers in (ana, visitor, sam_elsewhere):
        assert (await frame.get(url, headers=headers)).status_code == 404
        sent = await frame.post(f"{url}/messages", json={"content": "hello"}, headers=headers)
        assert sent.status_code == 404
        # Asking for a new conversation never hands over someone else's.
        assert (await start(frame, headers, new=True))["id"] != mine["id"]
    assert (
        await frame.get(f"/v1/widget/conversations/{uuid.uuid4()}", headers=sam)
    ).status_code == 404

    # Closed by the team: still readable, never continued or resumed.
    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update conversations set status = 'closed', closed_at = now() where id = $1",
            uuid.UUID(mine["id"]),
        )
    assert (await frame.get(url, headers=sam)).json()["status"] == "closed"
    closed = await frame.post(f"{url}/messages", json={"content": "one more thing"}, headers=sam)
    assert closed.status_code == 409
    assert closed.json()["error"]["code"] == "conversation_closed"
    lookup = await frame.post("/v1/widget/conversations", json={"create": False}, headers=sam)
    assert lookup.status_code == 404

    # The same holds for an anonymous visitor's stored conversation id.
    theirs = await start(frame, visitor)
    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update conversations set status = 'closed' where id = $1", uuid.UUID(theirs["id"])
        )
    resumed = await frame.post(
        "/v1/widget/conversations",
        json={"resume_id": theirs["id"], "create": False},
        headers=visitor,
    )
    assert resumed.status_code == 404
    assert resumed.json()["error"]["code"] == "no_conversation"
