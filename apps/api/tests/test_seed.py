"""Demo seed: creates the walkthrough data, runs twice safely, refuses outside local/test."""

import httpx
import pytest

from docent.config import Settings
from docent.seed import seed
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
    assert roles == {"Lumen Notes": "owner", "Parcelwise": "admin"}
    assert me["user"]["email_verified"] is True

    listing = (await client.get("/v1/members")).json()
    assert [m["role"] for m in listing["members"]] == ["owner", "admin", "agent", "agent"]
    assert {i["email"] for i in listing["invitations"]} == {
        "docent-jordan.lee@mailinator.com",
        "docent-ava.brooks@mailinator.com",
    }
    teammate = await client_factory().post(
        "/v1/auth/login",
        json={"email": "docent-omar.haddad@mailinator.com", "password": "docent-demo-password"},
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
