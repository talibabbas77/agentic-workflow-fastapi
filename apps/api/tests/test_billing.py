"""Billing: trials, Stripe checkout and portal, signed webhooks, entitlements, and plan limits."""

import hashlib
import hmac
import json
import time
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from docent.db.pool import Pool
from tests.conftest import (
    PASSWORD,
    ClientFactory,
    Drain,
    set_plan,
    token_from,
    unique_email,
    verified_owner,
)
from tests.fakes import FakeBilling


@pytest.fixture
async def billing(app: FastAPI) -> AsyncIterator[FakeBilling]:
    fake = FakeBilling()
    app.state.docent.billing = fake
    yield fake
    app.state.docent.billing = None


@pytest.fixture
async def owner(client_factory: ClientFactory, drain: Drain) -> httpx.AsyncClient:
    client = client_factory()
    await verified_owner(client, drain, "Billing Co")
    return client


def signature(payload: bytes, secret: str = FakeBilling.webhook_secret, at: int = 0) -> str:
    timestamp = at or int(time.time())
    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256)
    return f"t={timestamp},v1={mac.hexdigest()}"


def subscription_event(
    customer: str,
    *,
    plan: str = "growth",
    status: str = "active",
    kind: str = "customer.subscription.updated",
    created: int = 0,
    subscription: str = "sub_test1",
) -> dict[str, Any]:
    now = int(time.time())
    return {
        "id": f"evt_{uuid.uuid4().hex}",
        "type": kind,
        "created": created or now,
        "data": {
            "object": {
                "id": subscription,
                "object": "subscription",
                "customer": customer,
                "status": status,
                "cancel_at": None,
                "trial_end": None,
                "items": {
                    "data": [
                        {
                            "current_period_end": now + 30 * 86400,
                            "price": {"lookup_key": f"docent_{plan}_monthly"},
                        }
                    ]
                },
            }
        },
    }


async def deliver(client: httpx.AsyncClient, event: dict[str, Any]) -> httpx.Response:
    payload = json.dumps(event).encode()
    return await client.post(
        "/v1/webhooks/stripe",
        content=payload,
        headers={"stripe-signature": signature(payload), "content-type": "application/json"},
    )


async def start_checkout(owner: httpx.AsyncClient, billing: FakeBilling) -> str:
    """Run checkout and return the Stripe customer it created or reused."""
    response = await owner.post("/v1/billing/checkout", json={"plan_id": "growth"})
    assert response.status_code == 200, response.text
    return str(billing.checkouts[-1]["customer_id"])


async def billing_state(owner: httpx.AsyncClient) -> dict[str, Any]:
    data: dict[str, Any] = (await owner.get("/v1/billing")).json()
    return data


async def ask(owner: httpx.AsyncClient, text: str = "zebra migration patterns") -> dict[str, Any]:
    cid = (await owner.post("/v1/agent/conversations", json={})).json()["id"]
    response = await owner.post(f"/v1/agent/conversations/{cid}/messages", json={"content": text})
    block = response.text.strip().split("\n\n")[-1]
    message: dict[str, Any] = json.loads(block.split("data: ", 1)[1])
    return message


async def test_new_workspace_starts_a_fourteen_day_trial(
    owner: httpx.AsyncClient, billing: FakeBilling
) -> None:
    data = await billing_state(owner)
    assert (data["plan"]["id"], data["status"], data["active"]) == ("trial", "trialing", True)
    assert (data["provider"], data["billing_enabled"], data["can_manage"]) == ("manual", True, True)
    assert data["usage"]["replies"] == {"used": 0, "limit": 100}
    assert data["usage"]["seats"] == {"used": 1, "limit": 2}
    days_left = (datetime.fromisoformat(data["trial_ends_at"]).timestamp() - time.time()) / 86400
    assert 13.9 < days_left <= 14


async def test_checkout_is_for_owners_and_makes_one_customer(
    owner: httpx.AsyncClient, billing: FakeBilling, client_factory: ClientFactory, drain: Drain
) -> None:
    first = await owner.post("/v1/billing/checkout", json={"plan_id": "growth"})
    assert first.json()["url"].startswith("https://checkout.stripe.test/")
    await owner.post("/v1/billing/checkout", json={"plan_id": "scale"})
    assert len(billing.customers) == 1  # the second checkout reuses the customer
    assert billing.customers[0]["name"] == "Billing Co"
    assert [c["plan"] for c in billing.checkouts] == ["growth", "scale"]
    assert (await owner.post("/v1/billing/checkout", json={"plan_id": "trial"})).status_code == 422

    await owner.post("/v1/invitations", json={"email": unique_email(), "role": "admin"})
    admin = client_factory()
    token = token_from((await drain())[-1])
    joined = await admin.post(
        "/v1/invitations/accept", json={"token": token, "name": "Ada", "password": PASSWORD}
    )
    assert joined.status_code == 200, joined.text
    refused = await admin.post("/v1/billing/checkout", json={"plan_id": "growth"})
    assert refused.status_code == 403
    assert (await billing_state(admin))["can_manage"] is False


async def test_without_stripe_keys_checkout_is_unavailable(owner: httpx.AsyncClient) -> None:
    response = await owner.post("/v1/billing/checkout", json={"plan_id": "growth"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "billing_not_configured"
    assert (await billing_state(owner))["billing_enabled"] is False


async def test_signed_subscription_event_moves_the_workspace_to_its_plan(
    owner: httpx.AsyncClient, billing: FakeBilling, client_factory: ClientFactory
) -> None:
    customer = await start_checkout(owner, billing)
    stripe = client_factory(origin=None)
    event = subscription_event(customer, kind="customer.subscription.created")
    assert (await deliver(stripe, event)).json() == {"outcome": "applied"}
    data = await billing_state(owner)
    assert (data["plan"]["id"], data["status"], data["provider"]) == ("growth", "active", "stripe")
    assert data["usage"]["replies"]["limit"] == 5_000
    assert (await deliver(stripe, event)).json() == {"outcome": "duplicate"}

    again = await owner.post("/v1/billing/checkout", json={"plan_id": "scale"})
    assert again.status_code == 409  # plan changes go through the portal now
    portal = await owner.post("/v1/billing/portal")
    assert portal.json()["url"] == f"https://billing.stripe.test/p/{customer}"


async def test_webhook_signature_is_required(
    owner: httpx.AsyncClient, billing: FakeBilling, client_factory: ClientFactory
) -> None:
    customer = await start_checkout(owner, billing)
    payload = json.dumps(subscription_event(customer)).encode()
    stripe = client_factory(origin=None)
    for header in (
        signature(payload, secret="whsec_someone_else"),
        signature(payload, at=int(time.time()) - 3600),  # replayed an hour later
        "t=1,v1=deadbeef",
        "",
    ):
        response = await stripe.post(
            "/v1/webhooks/stripe", content=payload, headers={"stripe-signature": header}
        )
        assert response.status_code == 400, header
    assert (await billing_state(owner))["plan"]["id"] == "trial"


async def test_out_of_order_and_foreign_events_change_nothing(
    owner: httpx.AsyncClient, billing: FakeBilling, client_factory: ClientFactory
) -> None:
    customer = await start_checkout(owner, billing)
    stripe = client_factory(origin=None)
    now = int(time.time())
    await deliver(stripe, subscription_event(customer, plan="scale", created=now))
    late = subscription_event(customer, plan="starter", created=now - 60)
    assert (await deliver(stripe, late)).json() == {"outcome": "stale"}
    old_sub = subscription_event(
        customer, status="canceled", subscription="sub_old", kind="customer.subscription.deleted"
    )
    assert (await deliver(stripe, old_sub)).json() == {"outcome": "stale"}
    assert (await billing_state(owner))["plan"]["id"] == "scale"

    stranger = subscription_event("cus_not_ours")
    assert (await deliver(stripe, stranger)).json() == {"outcome": "unknown_customer"}
    other = {"id": "evt_x", "type": "charge.refunded", "created": now, "data": {"object": {}}}
    assert (await deliver(stripe, other)).json() == {"outcome": "ignored"}


async def test_failed_payment_gets_a_grace_period_then_escalate_only(
    owner: httpx.AsyncClient,
    billing: FakeBilling,
    client_factory: ClientFactory,
    admin_pool: Pool,
    chat: Any,
) -> None:
    customer = await start_checkout(owner, billing)
    stripe = client_factory(origin=None)
    await deliver(stripe, subscription_event(customer, status="active"))
    failed = {
        "id": "evt_failed",
        "type": "invoice.payment_failed",
        "created": int(time.time()),
        "data": {"object": {"customer": customer}},
    }
    await deliver(stripe, failed)
    await deliver(stripe, subscription_event(customer, status="past_due"))
    data = await billing_state(owner)
    assert (data["status"], data["active"]) == ("past_due", True)
    assert data["grace_ends_at"] is not None

    async with admin_pool.acquire() as conn:
        await conn.execute("update subscriptions set past_due_since = now() - interval '8 days'")
    data = await billing_state(owner)
    assert data["active"] is False
    assert data["usage"]["replies"]["limit"] == 0
    reply = await ask(owner)
    assert reply["decision"]["reason"] == "cap_reached"
    assert chat.calls == []

    paid = {
        "id": "evt_paid",
        "type": "invoice.paid",
        "created": int(time.time()),
        "data": {"object": {"customer": customer}},
    }
    await deliver(stripe, paid)
    await deliver(stripe, subscription_event(customer, status="active"))
    assert (await billing_state(owner))["active"] is True


async def test_expired_trial_and_canceled_plan_hand_every_message_off(
    owner: httpx.AsyncClient, billing: FakeBilling, client_factory: ClientFactory, admin_pool: Pool
) -> None:
    async with admin_pool.acquire() as conn:
        await conn.execute("update subscriptions set trial_ends_at = now() - interval '1 day'")
    assert (await billing_state(owner))["active"] is False
    assert (await ask(owner))["decision"]["reason"] == "cap_reached"

    customer = await start_checkout(owner, billing)
    stripe = client_factory(origin=None)
    await deliver(stripe, subscription_event(customer, status="active"))
    assert (await billing_state(owner))["active"] is True
    canceled = subscription_event(customer, status="canceled", kind="customer.subscription.deleted")
    await deliver(stripe, canceled)
    data = await billing_state(owner)
    assert (data["status"], data["active"]) == ("canceled", False)


async def test_an_upgrade_raises_the_reply_cap_at_once(
    owner: httpx.AsyncClient, billing: FakeBilling, client_factory: ClientFactory, admin_pool: Pool
) -> None:
    await ask(owner)
    async with admin_pool.acquire() as conn:
        assert await conn.fetchval("select replies_cap from usage_periods") == 100
        await conn.execute("update usage_periods set replies_used = 100")
    assert (await ask(owner))["decision"]["reason"] == "cap_reached"

    customer = await start_checkout(owner, billing)
    await deliver(client_factory(origin=None), subscription_event(customer, plan="starter"))
    assert (await ask(owner))["decision"]["reason"] == "no_source"  # answered again
    async with admin_pool.acquire() as conn:
        assert await conn.fetchval("select replies_cap from usage_periods") == 1_000


async def test_usage_emails_at_eighty_and_one_hundred_percent(
    owner: httpx.AsyncClient, admin_pool: Pool, drain: Drain
) -> None:
    await ask(owner)
    await drain()
    async with admin_pool.acquire() as conn:
        await conn.execute("update usage_periods set replies_used = 78")
    await ask(owner)  # 79 of 100
    assert await drain() == []
    await ask(owner)  # 80 of 100
    sent = await drain()
    assert [e.subject for e in sent] == [
        "Billing Co has used 80 percent of this month's AI replies"
    ]
    await ask(owner)
    assert await drain() == []  # once per threshold per month

    async with admin_pool.acquire() as conn:
        await conn.execute("update usage_periods set replies_used = 99")
    await ask(owner)
    sent = await drain()
    assert [e.subject for e in sent] == ["Billing Co has used all of this month's AI replies"]
    assert "/app/billing" in sent[0].text


async def test_plan_limits_on_widgets_and_seats(owner: httpx.AsyncClient, admin_pool: Pool) -> None:
    widget = {"name": "Help", "allowed_origins": ["https://app.example.com"]}
    assert (await owner.post("/v1/widgets", json=widget)).status_code == 201
    second = await owner.post("/v1/widgets", json=widget)
    assert second.status_code == 403
    assert second.json()["error"]["code"] == "plan_limit"
    assert "Trial plan includes 1 widgets" in second.json()["error"]["message"]

    email = unique_email()
    assert (await owner.post("/v1/invitations", json={"email": email})).status_code == 201
    again = await owner.post("/v1/invitations", json={"email": email, "role": "admin"})
    assert again.status_code == 201  # a re-invite replaces the open one, no extra seat
    third = await owner.post("/v1/invitations", json={"email": unique_email()})
    assert third.status_code == 403

    await set_plan(owner, admin_pool, "growth")
    assert (await owner.post("/v1/widgets", json=widget)).status_code == 201
    assert (await owner.post("/v1/invitations", json={"email": unique_email()})).status_code == 201
