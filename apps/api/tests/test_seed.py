"""Demo seed: creates the walkthrough data, runs twice safely, refuses outside local/test."""

import json
import time
import uuid
from pathlib import Path

import httpx
import jwt
import pytest
from jwt.algorithms import ECAlgorithm

from docent.config import Settings
from docent.seed import DEMO_HOST_ORIGIN, DEMO_PASSWORD, WORKSPACES, install_widget, seed
from tests.conftest import ClientFactory, make_settings

OWNER = "owner.demo@example.com"
OWNER_PASSWORD = "an owner password"


async def test_seed_creates_walkthrough_and_is_repeatable(
    settings: Settings, client_factory: ClientFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SEED_OWNER_PASSWORD", OWNER_PASSWORD)
    first = await seed(settings, OWNER, "Demo Owner")
    assert first[0].startswith("Lumen Notes: created")
    second = await seed(settings, OWNER, "Demo Owner")
    assert second[0] == "Lumen Notes: already seeded"

    client: httpx.AsyncClient = client_factory()
    login = await client.post("/v1/auth/login", json={"email": OWNER, "password": OWNER_PASSWORD})
    assert login.status_code == 200
    me = login.json()
    roles = {t["name"]: t["role"] for t in me["tenants"]}
    assert roles == {
        "Lumen Notes": "owner",
        "Parcelwise": "admin",
        "Tallyfox": "agent",
        "Fernway Studio": "owner",
    }
    assert me["user"]["email_verified"] is True

    listing = (await client.get("/v1/members")).json()
    assert [m["role"] for m in listing["members"]] == ["owner", "admin", "agent", "agent"]
    assert {i["email"] for i in listing["invitations"]} == {
        "docent-jordan.lee@mailinator.com",
        "docent-ava.brooks@mailinator.com",
    }
    plans = {}
    for tenant in me["tenants"]:
        await client.post("/v1/auth/switch-tenant", json={"tenant_id": tenant["id"]})
        billing = (await client.get("/v1/billing")).json()
        plans[tenant["name"]] = (billing["plan"]["id"], billing["status"], billing["active"])
    assert plans == {
        "Lumen Notes": ("growth", "active", True),
        "Parcelwise": ("scale", "active", True),
        "Tallyfox": ("starter", "past_due", True),  # inside its grace period
        "Fernway Studio": ("trial", "trialing", True),
    }

    teammate = await client_factory().post(
        "/v1/auth/login",
        json={"email": "docent-omar.haddad@mailinator.com", "password": DEMO_PASSWORD},
    )
    assert teammate.status_code == 200
    assert teammate.json()["active_tenant"]["role"] == "agent"


async def test_seed_refuses_outside_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SEED_OWNER_PASSWORD", OWNER_PASSWORD)
    staging = make_settings(
        env="staging",
        secret_key="s" * 40,
        internal_token="t" * 40,
    )
    with pytest.raises(SystemExit, match="Refusing"):
        await seed(staging, OWNER, "Demo Owner")


async def test_seed_reset_rebuilds(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SEED_OWNER_PASSWORD", OWNER_PASSWORD)
    await seed(settings, OWNER, "Demo Owner")
    rebuilt = await seed(settings, OWNER, "Demo Owner", reset=True)
    assert rebuilt[0].startswith("Lumen Notes: created")


async def test_seed_installs_widget_the_demo_host_can_sign_for(
    settings: Settings,
    client_factory: ClientFactory,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("SEED_OWNER_PASSWORD", OWNER_PASSWORD)
    await seed(settings, OWNER, "Demo Owner")
    api = client_factory()
    login = await api.post("/v1/auth/login", json={"email": OWNER, "password": OWNER_PASSWORD})
    assert login.status_code == 200
    lumen = WORKSPACES[0]

    assert (await install_widget(api, lumen, tmp_path)).endswith(f"installed on {DEMO_HOST_ORIGIN}")
    assert (await install_widget(api, lumen, tmp_path)).endswith(
        "already installed on the demo host"
    )
    key_file = tmp_path / "lumen-notes.json"
    assert key_file.stat().st_mode & 0o777 == 0o600

    # A lost key file means a fresh key; the oldest is retired so two stay active at most.
    for _ in range(2):
        key_file.unlink()
        await install_widget(api, lumen, tmp_path)
    (widget,) = (await api.get("/v1/widgets")).json()
    assert [k["status"] for k in widget["keys"]].count("active") == 2
    assert widget["allowed_origins"] == [DEMO_HOST_ORIGIN]

    saved = json.loads(key_file.read_text())
    now = int(time.time())
    token = jwt.encode(
        {
            "iss": saved["widget"],
            "aud": "docent",
            "sub": "customer-1",
            "iat": now,
            "exp": now + 300,
            "jti": uuid.uuid4().hex,
            "ctx": {"plan": "Team"},
        },
        ECAlgorithm.from_jwk(json.dumps(saved["private_jwk"])),
        algorithm="ES256",
        headers={"kid": saved["kid"]},
    )
    session = await client_factory(origin=settings.widget_origin).post(
        "/v1/widget/sessions",
        json={"widget": saved["widget"], "parent_origin": DEMO_HOST_ORIGIN, "token": token},
    )
    assert session.status_code == 201, session.text
    assert session.json()["mode"] == "identified"


async def test_seed_widget_settings_follow_the_catalog(
    settings: Settings,
    client_factory: ClientFactory,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("SEED_OWNER_PASSWORD", OWNER_PASSWORD)
    await seed(settings, OWNER, "Demo Owner")
    parcelwise = next(ws for ws in WORKSPACES if ws.slug == "parcelwise")
    # Parcelwise is a signed-in dashboard; the other help centers take anonymous visitors.
    assert parcelwise.anonymous_enabled is False
    assert all(ws.anonymous_enabled for ws in WORKSPACES if ws is not parcelwise)

    api = client_factory()
    login = await api.post("/v1/auth/login", json={"email": OWNER, "password": OWNER_PASSWORD})
    tenant = next(t for t in login.json()["tenants"] if t["name"] == "Parcelwise")
    switched = await api.post("/v1/auth/switch-tenant", json={"tenant_id": tenant["id"]})
    assert switched.status_code == 200

    await install_widget(api, parcelwise, tmp_path)
    (widget,) = (await api.get("/v1/widgets")).json()
    assert widget["anonymous_enabled"] is False
    assert widget["allowed_claims"] == list(parcelwise.claims)

    # An admin turns anonymous chat on, edits the greeting, renames the widget,
    # and adds an origin. A rerun puts back what the catalog owns and keeps the rest.
    drifted = {
        "name": "Dashboard chat",
        "allowed_origins": ["https://app.parcelwise.example"],
        "anonymous_enabled": True,
        "anonymous_daily_cap": 50,
        "allowed_claims": ["plan"],
        "greeting": "Hello there",
    }
    assert (await api.put(f"/v1/widgets/{widget['id']}", json=drifted)).status_code == 200
    line = await install_widget(api, parcelwise, tmp_path)
    assert line.endswith("settings updated, already installed on the demo host")
    (widget,) = (await api.get("/v1/widgets")).json()
    assert widget["anonymous_enabled"] is False
    assert widget["allowed_claims"] == list(parcelwise.claims)
    assert widget["greeting"] == parcelwise.greeting
    assert sorted(widget["allowed_origins"]) == [DEMO_HOST_ORIGIN, "https://app.parcelwise.example"]
    assert (widget["name"], widget["anonymous_daily_cap"]) == ("Dashboard chat", 50)

    # Converged: the next run changes nothing.
    line = await install_widget(api, parcelwise, tmp_path)
    assert line == f"Parcelwise: widget {widget['public_id']} already installed on the demo host"

    # Even a session asked for directly, without a signed token, is refused.
    session = await client_factory(origin=settings.widget_origin).post(
        "/v1/widget/sessions",
        json={"widget": widget["public_id"], "parent_origin": DEMO_HOST_ORIGIN},
    )
    assert session.status_code == 403
    assert session.json()["error"]["code"] == "anonymous_disabled"
