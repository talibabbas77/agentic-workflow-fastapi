"""A credential for tenant A can never reach tenant B's resources. Answers are 404, not 403."""

import httpx

from tests.conftest import ClientFactory, Drain, token_from, unique_email, verified_owner


async def test_cross_tenant_access_is_not_found(
    client_factory: ClientFactory, drain: Drain
) -> None:
    a: httpx.AsyncClient = client_factory()
    b: httpx.AsyncClient = client_factory()
    await verified_owner(a, drain, "Tenant A")
    b_me = await verified_owner(b, drain, "Tenant B")

    b_invite = await b.post("/v1/invitations", json={"email": unique_email()})
    b_invitation_id = b_invite.json()["id"]
    await drain()
    b_user_id = b_me["user"]["id"]
    b_tenant_id = b_me["active_tenant"]["id"]

    checks = [
        ("DELETE", f"/v1/invitations/{b_invitation_id}", None),
        ("PATCH", f"/v1/members/{b_user_id}", {"role": "agent"}),
        ("DELETE", f"/v1/members/{b_user_id}", None),
        ("POST", "/v1/auth/switch-tenant", {"tenant_id": b_tenant_id}),
    ]
    for method, path, body in checks:
        response = await a.request(method, path, json=body)
        assert response.status_code == 404, (method, path, response.text)

    listing = (await a.get("/v1/members")).json()
    assert b_user_id not in {m["user_id"] for m in listing["members"]}
    assert b_invitation_id not in {i["id"] for i in listing["invitations"]}
    assert (await a.get("/v1/tenant")).json()["name"] == "Tenant A"
    # B's invitation is untouched.
    b_listing = (await b.get("/v1/members")).json()
    assert [i["id"] for i in b_listing["invitations"]] == [b_invitation_id]


async def test_invitation_token_grants_only_its_invitation(
    client_factory: ClientFactory, drain: Drain
) -> None:
    a = client_factory()
    b = client_factory()
    await verified_owner(a, drain, "Tenant A")
    await verified_owner(b, drain, "Tenant B")
    await a.post("/v1/invitations", json={"email": unique_email()})
    a_token = token_from((await drain())[0])
    await b.post("/v1/invitations", json={"email": unique_email()})
    await drain()
    lookup = await client_factory().get("/v1/invitations/lookup", params={"token": a_token})
    assert lookup.json()["workspace_name"] == "Tenant A"
