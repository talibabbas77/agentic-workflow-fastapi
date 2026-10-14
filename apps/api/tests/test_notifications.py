"""The bell and the Inbox badge in the admin app: in-app notifications per member."""

import uuid
from typing import Any

import httpx
import pytest

from docent.db.pool import Pool
from tests.conftest import ClientFactory, Drain, verified_owner
from tests.inbox_helpers import handoff, join


@pytest.fixture
async def owner(client_factory: ClientFactory, drain: Drain) -> httpx.AsyncClient:
    client = client_factory()
    await verified_owner(client, drain, "Lumen Notes")
    return client


async def bell(client: httpx.AsyncClient) -> dict[str, Any]:
    response = await client.get("/v1/notifications")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def customer_handoff(
    client: httpx.AsyncClient, admin_pool: Pool, drain: Drain, topic: str
) -> dict[str, Any]:
    """A handoff as if from the widget: with no routing, owners and admins hear about it."""
    made = await handoff(client, topic)
    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update conversations set channel = 'widget' where id = $1",
            uuid.UUID(made["conversation_id"]),
        )
    await drain()  # the summary job routes it and notifies
    return made


async def test_the_bell_lists_handoffs_for_you_and_the_badge_counts_unread(
    owner: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain, admin_pool: Pool
) -> None:
    agent, agent_me = await join(owner, client_factory, drain, name="Robin Park")
    first = await customer_handoff(owner, admin_pool, drain, "a refund for my order")

    mine = await bell(owner)
    assert [(n["kind"], n["escalation_id"]) for n in mine["items"]] == [
        ("new_handoff", first["id"])
    ]
    assert mine["items"][0]["issue"] == "Customer asked for a person."
    assert mine["items"][0]["read_at"] is None
    assert (mine["unread"], mine["inbox_unread"]) == (1, 1)
    # Same rule as the inbox list.
    assert (await owner.get("/v1/inbox")).json()["counts"]["unread"] == 1

    # The agent was not told by email, so the bell is empty; the inbox still shows it unread.
    theirs = await bell(agent)
    assert (theirs["items"], theirs["unread"], theirs["inbox_unread"]) == ([], 0, 1)

    # Assigned by a teammate: in the bell even with assignment emails turned off.
    off = {"daily_digest": True, "assigned_email": False}
    assert (await agent.put("/v1/inbox/preferences", json=off)).status_code == 200
    assigned = await owner.patch(
        f"/v1/inbox/{first['id']}", json={"assignee_user_id": agent_me["user"]["id"]}
    )
    assert assigned.status_code == 200, assigned.text
    theirs = await bell(agent)
    note = theirs["items"][0]
    assert (note["kind"], note["detail"], theirs["unread"]) == (
        "assigned",
        "Assigned by Sam Ortiz",
        1,
    )
    # Mark one as read; someone else's cannot be touched.
    assert (await owner.post(f"/v1/notifications/{note['id']}/read")).status_code == 404
    assert (await agent.post(f"/v1/notifications/{note['id']}/read")).status_code == 204
    theirs = await bell(agent)
    assert theirs["unread"] == 0
    assert theirs["items"][0]["read_at"] is not None
    assert (await agent.post(f"/v1/notifications/{note['id']}/read")).status_code == 204

    # Assigning it was the owner's own change, which read it for them, notification too.
    mine = await bell(owner)
    assert (mine["unread"], mine["inbox_unread"]) == (0, 0)

    # Opening a handoff reads it and its notifications.
    second = await customer_handoff(owner, admin_pool, drain, "my invoice")
    await customer_handoff(owner, admin_pool, drain, "exporting notes")
    mine = await bell(owner)
    assert (mine["unread"], mine["inbox_unread"]) == (2, 2)
    assert (await owner.post(f"/v1/inbox/{second['id']}/read")).status_code == 204
    mine = await bell(owner)
    assert (mine["unread"], mine["inbox_unread"]) == (1, 1)
    assert next(n for n in mine["items"] if n["escalation_id"] == second["id"])["read_at"]

    # Mark all as read: the bell is clear, and the handoff itself stays unread in the inbox.
    assert (await owner.post("/v1/notifications/read")).status_code == 204
    mine = await bell(owner)
    assert (mine["unread"], mine["inbox_unread"]) == (0, 1)
    # Taking a handoff yourself never notifies you.
    me = (await owner.get("/v1/auth/me")).json()["user"]
    await owner.patch(f"/v1/inbox/{second['id']}", json={"assignee_user_id": me["id"]})
    assert (await bell(owner))["unread"] == 0
    assert (await owner.get("/v1/notifications", params={"limit": 0})).status_code == 422


async def test_a_rule_that_assigns_says_so_in_the_bell(
    owner: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain, admin_pool: Pool
) -> None:
    agent, agent_me = await join(owner, client_factory, drain, name="Robin Park")
    rule = await owner.post(
        "/v1/automation/rules",
        json={"name": "Refunds to Robin", "assign_user_id": agent_me["user"]["id"]},
    )
    assert rule.status_code == 201, rule.text
    made = await customer_handoff(owner, admin_pool, drain, "a refund")
    theirs = await bell(agent)
    assert [(n["kind"], n["escalation_id"], n["detail"]) for n in theirs["items"]] == [
        ("assigned", made["id"], "Routed by the rule Refunds to Robin")
    ]
    # The rule routed it to someone, so owners and admins are not told as a fallback.
    assert (await bell(owner))["items"] == []


async def test_notifications_stay_in_their_workspace(
    owner: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain, admin_pool: Pool
) -> None:
    await customer_handoff(owner, admin_pool, drain, "a refund")
    note = (await bell(owner))["items"][0]
    other = client_factory()
    await verified_owner(other, drain, "Parcelwise")
    theirs = await bell(other)
    assert (theirs["items"], theirs["unread"], theirs["inbox_unread"]) == ([], 0, 0)
    assert (await other.post(f"/v1/notifications/{note['id']}/read")).status_code == 404
    assert (await other.post("/v1/notifications/read")).status_code == 204
    assert (await bell(owner))["unread"] == 1
    assert (await client_factory().get("/v1/notifications")).status_code == 401
