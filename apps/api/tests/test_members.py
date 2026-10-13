"""Members, roles, and invitations."""

import httpx

from docent.db.pool import Pool
from tests.conftest import (
    PASSWORD,
    ClientFactory,
    Drain,
    signup,
    token_from,
    unique_email,
    verified_owner,
)


async def _invite_and_join(
    owner: httpx.AsyncClient,
    client_factory: ClientFactory,
    drain: Drain,
    role: str = "agent",
) -> tuple[httpx.AsyncClient, dict[str, object]]:
    email = unique_email("teammate")
    r = await owner.post("/v1/invitations", json={"email": email, "role": role})
    assert r.status_code == 201, r.text
    token = token_from((await drain())[0])
    joiner = client_factory()
    accepted = await joiner.post(
        "/v1/invitations/accept", json={"token": token, "name": "Robin", "password": PASSWORD}
    )
    assert accepted.status_code == 200, accepted.text
    me: dict[str, object] = accepted.json()
    return joiner, me


async def test_unverified_owner_cannot_invite(client: httpx.AsyncClient) -> None:
    await signup(client)
    r = await client.post("/v1/invitations", json={"email": unique_email()})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "email_unverified"


async def test_invite_lookup_accept_new_account(
    client: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    await verified_owner(client, drain, "Acme")
    email = unique_email("new")
    r = await client.post("/v1/invitations", json={"email": email, "role": "admin"})
    assert r.status_code == 201
    assert r.json()["role"] == "admin"
    emails = await drain()
    assert emails[0].to == email
    assert "invited you to Acme" in emails[0].subject
    token = token_from(emails[0])

    guest = client_factory()
    lookup = await guest.get("/v1/invitations/lookup", params={"token": token})
    assert lookup.status_code == 200
    assert lookup.json() == {
        "workspace_name": "Acme",
        "email": email,
        "role": "admin",
        "inviter_name": "Sam Ortiz",
        "expired": False,
        "account_exists": False,
    }
    missing = await guest.post("/v1/invitations/accept", json={"token": token})
    assert missing.status_code == 422
    assert set(missing.json()["error"]["fields"]) == {"name", "password"}
    accepted = await guest.post(
        "/v1/invitations/accept", json={"token": token, "name": "Robin", "password": PASSWORD}
    )
    assert accepted.status_code == 200
    me = accepted.json()
    assert me["active_tenant"]["name"] == "Acme"
    assert me["active_tenant"]["role"] == "admin"
    assert me["user"]["email_verified"] is True
    again = await guest.post("/v1/invitations/accept", json={"token": token})
    assert again.status_code == 404

    listing = (await client.get("/v1/members")).json()
    assert [m["role"] for m in listing["members"]] == ["owner", "admin"]
    assert listing["invitations"] == []


async def test_agent_cannot_manage_members_or_settings(
    client: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    await verified_owner(client, drain)
    agent, _ = await _invite_and_join(client, client_factory, drain, role="agent")
    assert (await agent.get("/v1/tenant")).status_code == 200
    assert (await agent.get("/v1/members")).status_code == 403
    assert (await agent.patch("/v1/tenant", json={"name": "Mine now"})).status_code == 403
    invite = await agent.post("/v1/invitations", json={"email": unique_email()})
    assert invite.status_code == 403


async def test_owner_changes_roles_and_last_owner_is_protected(
    client: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    owner = await verified_owner(client, drain)
    _, agent_me = await _invite_and_join(client, client_factory, drain)
    agent_id = agent_me["user"]["id"]  # type: ignore[index]
    promoted = await client.patch(f"/v1/members/{agent_id}", json={"role": "admin"})
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "admin"
    demote_self = await client.patch(f"/v1/members/{owner['user']['id']}", json={"role": "admin"})
    assert demote_self.status_code == 409
    assert demote_self.json()["error"]["code"] == "last_owner"
    leave = await client.delete(f"/v1/members/{owner['user']['id']}")
    assert leave.status_code == 409


async def test_admin_can_remove_agents_but_not_admins(
    client: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    await verified_owner(client, drain)
    admin, _ = await _invite_and_join(client, client_factory, drain, role="admin")
    _, agent_me = await _invite_and_join(client, client_factory, drain, role="agent")
    _, other_admin = await _invite_and_join(client, client_factory, drain, role="admin")
    assert (await admin.get("/v1/members")).status_code == 200
    removed = await admin.delete(f"/v1/members/{agent_me['user']['id']}")  # type: ignore[index]
    assert removed.status_code == 204
    blocked = await admin.delete(f"/v1/members/{other_admin['user']['id']}")  # type: ignore[index]
    assert blocked.status_code == 403
    change = await admin.patch(
        f"/v1/members/{other_admin['user']['id']}",  # type: ignore[index]
        json={"role": "agent"},
    )
    assert change.status_code == 403


async def test_member_can_leave(
    client: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    await verified_owner(client, drain)
    agent, agent_me = await _invite_and_join(client, client_factory, drain)
    left = await agent.delete(f"/v1/members/{agent_me['user']['id']}")  # type: ignore[index]
    assert left.status_code == 204
    me = (await agent.get("/v1/auth/me")).json()
    assert me["active_tenant"] is None
    assert me["tenants"] == []
    gone = await agent.get("/v1/tenant")
    assert gone.status_code == 409
    assert gone.json()["error"]["code"] == "no_workspace"


async def test_cannot_invite_existing_member(client: httpx.AsyncClient, drain: Drain) -> None:
    owner = await verified_owner(client, drain)
    r = await client.post("/v1/invitations", json={"email": owner["user"]["email"]})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "already_member"


async def test_reinvite_replaces_and_revoke(
    client: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    await verified_owner(client, drain)
    email = unique_email()
    await client.post("/v1/invitations", json={"email": email})
    first = token_from((await drain())[0])
    second_resp = await client.post("/v1/invitations", json={"email": email, "role": "admin"})
    second = token_from((await drain())[0])
    guest = client_factory()
    assert (await guest.get("/v1/invitations/lookup", params={"token": first})).status_code == 404
    assert (await guest.get("/v1/invitations/lookup", params={"token": second})).status_code == 200
    invitations = (await client.get("/v1/members")).json()["invitations"]
    assert len(invitations) == 1
    revoke = await client.delete(f"/v1/invitations/{second_resp.json()['id']}")
    assert revoke.status_code == 204
    assert (await guest.get("/v1/invitations/lookup", params={"token": second})).status_code == 404


async def test_expired_invitation(
    client: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain, admin_pool: Pool
) -> None:
    await verified_owner(client, drain)
    await client.post("/v1/invitations", json={"email": unique_email()})
    token = token_from((await drain())[0])
    async with admin_pool.acquire() as conn:
        await conn.execute("update invitations set expires_at = now() - interval '1 minute'")
    guest = client_factory()
    lookup = await guest.get("/v1/invitations/lookup", params={"token": token})
    assert lookup.json()["expired"] is True
    accept = await guest.post(
        "/v1/invitations/accept", json={"token": token, "name": "X", "password": PASSWORD}
    )
    assert accept.status_code == 410


async def test_accept_requires_matching_login(
    client: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    await verified_owner(client, drain)
    existing_email = unique_email("existing")
    await signup(client_factory(), email=existing_email)
    await drain()
    await client.post("/v1/invitations", json={"email": existing_email})
    token = token_from((await drain())[0])
    anonymous = await client_factory().post(
        "/v1/invitations/accept", json={"token": token, "name": "X", "password": PASSWORD}
    )
    assert anonymous.status_code == 409
    assert anonymous.json()["error"]["code"] == "account_exists"
    stranger = client_factory()
    await signup(stranger)
    mismatch = await stranger.post("/v1/invitations/accept", json={"token": token})
    assert mismatch.status_code == 403
    assert mismatch.json()["error"]["code"] == "invitation_email_mismatch"


async def test_rename_workspace_and_audit(
    client: httpx.AsyncClient, drain: Drain, admin_pool: Pool
) -> None:
    await verified_owner(client, drain)
    renamed = await client.patch("/v1/tenant", json={"name": "  Acme Help  "})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Acme Help"
    async with admin_pool.acquire() as conn:
        actions = await conn.fetchval("select array_agg(action) from audit_log")
    assert actions == ["tenant.renamed"]


async def test_onboarding_progress(
    client: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    await signup(client)
    steps = (await client.get("/v1/onboarding")).json()
    status = {s["key"]: s["status"] for s in steps["steps"]}
    assert status == {
        "create_workspace": "done",
        "verify_email": "todo",
        "invite_team": "todo",
        "teach_agent": "todo",
        "install_widget": "todo",
        "first_answer": "todo",
    }
    assert steps["completed"] == 1
    token = token_from((await drain())[0])
    await client.post("/v1/auth/verify-email", json={"token": token})
    await client.post("/v1/invitations", json={"email": unique_email()})
    steps = (await client.get("/v1/onboarding")).json()
    assert steps["completed"] == 3
