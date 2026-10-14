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
                "cancel_at_period_end": False,
                "items": {
                    "data": [
                        {
                            "current_period_start": now - 15 * 86400,
                            "current_period_end": now + 15 * 86400,
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
    other = {"id": "evt_x", "type": "customer.created", "created": now, "data": {"object": {}}}
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


async def test_the_usage_page_reconciles_with_usage_events(
    owner: httpx.AsyncClient, admin_pool: Pool
) -> None:
    """Phase 7 check 7: the billing page's reply count is the ai_reply ledger, exactly."""
    for text in ("zebra migration patterns", "hello", "talk to a human", "thanks"):
        await ask(owner, text)
    tenant_id = uuid.UUID((await owner.get("/v1/tenant")).json()["id"])
    async with admin_pool.acquire() as conn:
        billed = await conn.fetchval(
            "select count(*) from usage_events where tenant_id = $1 and kind = 'ai_reply'"
            " and occurred_at >= date_trunc('month', now())",
            tenant_id,
        )
        period = await conn.fetchrow(
            "select replies_used, replies_reserved, cost_micros from usage_periods"
            " where tenant_id = $1",
            tenant_id,
        )
        cost = await conn.fetchval(
            "select coalesce(sum(cost_micros), 0) from usage_events where tenant_id = $1",
            tenant_id,
        )
    assert period is not None
    assert billed == 2  # two handoff messages; the greeting and the thanks are not replies
    assert (await billing_state(owner))["usage"]["replies"]["used"] == billed
    assert (period["replies_used"], period["replies_reserved"]) == (billed, 0)
    assert period["cost_micros"] == cost


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
    assert "Trial plan includes 1 widget." in second.json()["error"]["message"]

    email = unique_email()
    assert (await owner.post("/v1/invitations", json={"email": email})).status_code == 201
    again = await owner.post("/v1/invitations", json={"email": email, "role": "admin"})
    assert again.status_code == 201  # a re-invite replaces the open one, no extra seat
    third = await owner.post("/v1/invitations", json={"email": unique_email()})
    assert third.status_code == 403

    await set_plan(owner, admin_pool, "growth")
    assert (await owner.post("/v1/widgets", json=widget)).status_code == 201
    assert (await owner.post("/v1/invitations", json={"email": unique_email()})).status_code == 201


async def test_a_workspace_missing_its_subscription_starts_a_trial_instead_of_failing(
    owner: httpx.AsyncClient, admin_pool: Pool
) -> None:
    async with admin_pool.acquire() as conn:
        await conn.execute("delete from subscriptions")
    data = await billing_state(owner)
    assert (data["plan"]["id"], data["status"], data["active"]) == ("trial", "trialing", True)
    assert (await ask(owner))["decision"]["type"] == "escalate"  # the agent still replies


async def subscribed(
    owner: httpx.AsyncClient, billing: FakeBilling, client_factory: ClientFactory, plan: str
) -> httpx.AsyncClient:
    """A workspace that paid for `plan` today, halfway through a 30 day period."""
    customer = await start_checkout(owner, billing)
    stripe = client_factory(origin=None)
    await deliver(stripe, subscription_event(customer, plan=plan))
    paid = {
        "id": f"evt_{uuid.uuid4().hex}",
        "type": "invoice.paid",
        "created": int(time.time()),
        "data": {"object": {"customer": customer}},
    }
    await deliver(stripe, paid)
    return stripe


async def test_previews_explain_upgrades_and_downgrades_line_by_line(
    owner: httpx.AsyncClient, billing: FakeBilling, client_factory: ClientFactory
) -> None:
    await subscribed(owner, billing, client_factory, "growth")
    up = (await owner.get("/v1/billing/preview", params={"plan_id": "scale"})).json()
    assert up["kind"] == "upgrade"
    # Halfway through: $299 / 2 for Scale less $99 / 2 of unused Growth = $100 today.
    assert [line["amount_cents"] for line in up["lines"]] == [14950, -4950]
    assert up["due_now_cents"] == 10000
    assert up["stripe_due_now_cents"] == 3500  # Stripe's own figure is shown beside ours
    assert up["next_renewal_cents"] == 29900
    assert up["blockers"] == []

    down = (await owner.get("/v1/billing/preview", params={"plan_id": "starter"})).json()
    assert (down["kind"], down["due_now_cents"], down["lines"]) == ("downgrade", 0, [])
    billing_data = await billing_state(owner)
    assert down["effective_at"] == billing_data["current_period_end"]
    assert "Nothing is charged or refunded today." in down["explanation"][1]


async def test_upgrade_now_downgrade_at_renewal_and_cancel_a_waiting_downgrade(
    owner: httpx.AsyncClient, billing: FakeBilling, client_factory: ClientFactory
) -> None:
    stripe = await subscribed(owner, billing, client_factory, "growth")
    customer = str(billing.checkouts[-1]["customer_id"])

    upgraded = await owner.post("/v1/billing/change", json={"plan_id": "scale"})
    assert upgraded.status_code == 200, upgraded.text
    assert billing.calls[-1] == ("upgrade", "scale")
    await deliver(stripe, subscription_event(customer, plan="scale"))  # Stripe confirms
    assert (await billing_state(owner))["plan"]["id"] == "scale"

    scheduled = (await owner.post("/v1/billing/change", json={"plan_id": "starter"})).json()
    assert scheduled["plan"]["id"] == "scale"  # still Scale until the period ends
    assert scheduled["scheduled_plan"]["id"] == "starter"
    assert scheduled["scheduled_change_at"] == scheduled["current_period_end"]

    kept = (await owner.delete("/v1/billing/change")).json()
    assert kept["scheduled_plan"] is None
    assert billing.calls[-1] == ("release_schedule", "sub_sched_test")

    await owner.post("/v1/billing/change", json={"plan_id": "starter"})
    await deliver(stripe, subscription_event(customer, plan="starter"))  # renewal applies it
    after = await billing_state(owner)
    assert (after["plan"]["id"], after["scheduled_plan"]) == ("starter", None)


async def test_a_downgrade_is_refused_while_the_workspace_uses_more_than_it_allows(
    owner: httpx.AsyncClient, billing: FakeBilling, client_factory: ClientFactory
) -> None:
    await subscribed(owner, billing, client_factory, "growth")
    widget = {"name": "Help", "allowed_origins": ["https://app.example.com"]}
    for _ in range(2):
        assert (await owner.post("/v1/widgets", json=widget)).status_code == 201
    preview = (await owner.get("/v1/billing/preview", params={"plan_id": "starter"})).json()
    assert preview["blockers"] == [
        "Starter includes 1 widget and this workspace uses 2. Remove 1 first."
    ]
    refused = await owner.post("/v1/billing/change", json={"plan_id": "starter"})
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "plan_change_blocked"
    assert ("schedule_downgrade", "starter") not in billing.calls


async def test_cancel_at_period_end_and_resume(
    owner: httpx.AsyncClient, billing: FakeBilling, client_factory: ClientFactory
) -> None:
    await subscribed(owner, billing, client_factory, "growth")
    canceled = (await owner.post("/v1/billing/cancel")).json()
    assert canceled["cancel_at_period_end"] is True
    assert canceled["active"] is True  # still answering until the period ends
    blocked = await owner.post("/v1/billing/change", json={"plan_id": "scale"})
    assert (
        blocked.json()["error"]["message"]
        == "The plan is canceled. Resume it before changing plan."
    )
    resumed = (await owner.post("/v1/billing/resume")).json()
    assert resumed["cancel_at_period_end"] is False
    assert billing.calls[-2:] == [
        ("cancel_at_period_end", "True"),
        ("cancel_at_period_end", "False"),
    ]


async def test_money_back_within_fourteen_days_once(
    owner: httpx.AsyncClient,
    billing: FakeBilling,
    client_factory: ClientFactory,
    admin_pool: Pool,
) -> None:
    await subscribed(owner, billing, client_factory, "growth")
    offer = (await owner.get("/v1/billing/refund")).json()
    assert (offer["eligible"], offer["amount_cents"]) == (True, 9900)
    assert offer["reason"].startswith("Full refund of everything paid so far, until")

    refunded = (await owner.post("/v1/billing/refund")).json()
    assert refunded["amount_cents"] == 9900
    data = await billing_state(owner)
    assert (data["status"], data["active"]) == ("canceled", False)
    again = await owner.post("/v1/billing/refund")
    assert again.status_code == 409
    assert again.json()["error"]["message"] == "This workspace was already refunded."


async def test_no_refund_after_the_window(
    owner: httpx.AsyncClient,
    billing: FakeBilling,
    client_factory: ClientFactory,
    admin_pool: Pool,
) -> None:
    await subscribed(owner, billing, client_factory, "growth")
    async with admin_pool.acquire() as conn:
        await conn.execute("update subscriptions set first_paid_at = now() - interval '15 days'")
    offer = (await owner.get("/v1/billing/refund")).json()
    assert offer["eligible"] is False
    assert "money-back window ended" in offer["reason"]
    assert (await owner.post("/v1/billing/refund")).status_code == 409


async def test_plan_changes_need_a_paid_subscription_and_an_owner(
    owner: httpx.AsyncClient, billing: FakeBilling, client_factory: ClientFactory, drain: Drain
) -> None:
    preview = (await owner.get("/v1/billing/preview", params={"plan_id": "growth"})).json()
    assert preview["blockers"] == [
        "Plan changes need a paid subscription. Choose a plan to start one."
    ]
    assert (await owner.post("/v1/billing/change", json={"plan_id": "growth"})).status_code == 409

    await owner.post("/v1/invitations", json={"email": unique_email(), "role": "agent"})
    agent = client_factory()
    token = token_from((await drain())[-1])
    await agent.post(
        "/v1/invitations/accept", json={"token": token, "name": "Robin", "password": PASSWORD}
    )
    for method, path in (("post", "/v1/billing/change"), ("post", "/v1/billing/refund")):
        response = await getattr(agent, method)(path, json={"plan_id": "growth"})
        assert response.status_code == 403, path


# Top-up packs: extra replies for the current month, credited only by the signed webhook.


def checkout_event(
    customer: str,
    metadata: dict[str, str],
    *,
    session: str = "cs_test_topup1",
    kind: str = "checkout.session.completed",
    paid: bool = True,
    mode: str = "payment",
    amount: int = 1450,
    created: int = 0,
) -> dict[str, Any]:
    return {
        "id": f"evt_{uuid.uuid4().hex}",
        "type": kind,
        "created": created or int(time.time()),
        "data": {
            "object": {
                "id": session,
                "object": "checkout.session",
                "customer": customer,
                "mode": mode,
                "payment_status": "paid" if paid else "unpaid",
                "metadata": metadata,
                "amount_subtotal": amount,
                "amount_total": amount,
            }
        },
    }


async def buy_topup(
    owner: httpx.AsyncClient, billing: FakeBilling, pack_id: str = "starter_500"
) -> dict[str, Any]:
    """Start checkout for a pack and return the checkout the fake Stripe recorded."""
    response = await owner.post("/v1/billing/topups/checkout", json={"pack_id": pack_id})
    assert response.status_code == 200, response.text
    assert response.json()["url"].startswith("https://checkout.stripe.test/")
    started: dict[str, Any] = billing.checkouts[-1]
    assert (started["mode"], started["pack"]) == ("payment", pack_id)
    return started


async def at_usage(admin_pool: Pool, used: int) -> None:
    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update usage_periods set replies_used = $1"
            " where period_start = date_trunc('month', now())::date",
            used,
        )


async def test_top_up_packs_come_from_the_plan_catalog(client: httpx.AsyncClient) -> None:
    plans = {p["id"]: p for p in (await client.get("/v1/public/plans")).json()}
    assert plans["trial"]["topup_packs"] == []
    assert plans["starter"]["topup_packs"] == [
        {"id": "starter_500", "plan_id": "starter", "replies": 500, "price_cents": 1450},
        {"id": "starter_1000", "plan_id": "starter", "replies": 1000, "price_cents": 2900},
    ]
    for plan in (plans["starter"], plans["growth"], plans["scale"]):
        per_reply = plan["price_usd_month"] * 100 / plan["replies_per_month"]
        for pack in plan["topup_packs"]:  # never cheaper or dearer per reply than the plan
            assert pack["price_cents"] / pack["replies"] == pytest.approx(per_reply)


async def test_a_paid_top_up_raises_this_months_cap_once_however_often_it_arrives(
    owner: httpx.AsyncClient,
    billing: FakeBilling,
    client_factory: ClientFactory,
    admin_pool: Pool,
) -> None:
    stripe = await subscribed(owner, billing, client_factory, "starter")
    customer = str(billing.checkouts[-1]["customer_id"])
    await ask(owner)
    await at_usage(admin_pool, 1_000)
    assert (await ask(owner))["decision"]["reason"] == "cap_reached"

    started = await buy_topup(owner, billing)
    assert started["customer_id"] == customer
    assert started["metadata"]["pack_id"] == "starter_500"
    # Leaving checkout, or coming back from it, credits nothing: only the webhook does.
    assert (await billing_state(owner))["usage"]["replies"]["limit"] == 1_000

    event = checkout_event(customer, started["metadata"])
    assert (await deliver(stripe, event)).json() == {"outcome": "applied"}
    assert (await deliver(stripe, event)).json() == {"outcome": "duplicate"}
    # The same session again under another event id (a slow payment's second event).
    late = checkout_event(
        customer, started["metadata"], kind="checkout.session.async_payment_succeeded"
    )
    assert (await deliver(stripe, late)).json() == {"outcome": "ignored"}

    data = await billing_state(owner)
    assert data["usage"]["replies"] == {"used": 1_000, "limit": 1_500}
    assert data["topups"]["replies"] == 500
    bought = [(t["pack_id"], t["replies"], t["amount_cents"]) for t in data["topups"]["bought"]]
    assert bought == [("starter_500", 500, 1450)]
    assert (await ask(owner))["decision"]["reason"] != "cap_reached"  # answering again
    async with admin_pool.acquire() as conn:
        assert await conn.fetchval("select count(*) from topups") == 1
        assert await conn.fetchval("select replies_topup from usage_periods") == 500


async def test_a_top_up_counts_for_the_month_it_was_paid_in_only(
    owner: httpx.AsyncClient,
    billing: FakeBilling,
    client_factory: ClientFactory,
    admin_pool: Pool,
) -> None:
    stripe = await subscribed(owner, billing, client_factory, "starter")
    customer = str(billing.checkouts[-1]["customer_id"])
    await ask(owner)
    # A payment that went through last month tops up last month, not this one.
    last_month = int(time.time()) - 40 * 86400
    old = await buy_topup(owner, billing)
    paid_late = checkout_event(customer, old["metadata"], session="cs_old", created=last_month)
    assert (await deliver(stripe, paid_late)).json() == {"outcome": "applied"}
    assert (await billing_state(owner))["usage"]["replies"]["limit"] == 1_000

    this = await buy_topup(owner, billing, "starter_1000")
    await deliver(stripe, checkout_event(customer, this["metadata"], session="cs_new", amount=2900))
    assert (await billing_state(owner))["usage"]["replies"]["limit"] == 2_000

    # When the month turns, the pack ends with it: the new month has the plan's cap only.
    async with admin_pool.acquire() as conn:
        for table in ("usage_periods", "topups"):
            await conn.execute(
                f"delete from {table} where period_start < date_trunc('month', now())"  # noqa: S608
            )
        await conn.execute(
            "update usage_periods set period_start = period_start - interval '1 month'"
        )
        await conn.execute("update topups set period_start = period_start - interval '1 month'")
    data = await billing_state(owner)
    assert data["usage"]["replies"]["limit"] == 1_000
    assert data["topups"] == {"replies": 0, "bought": []}
    await ask(owner)
    async with admin_pool.acquire() as conn:
        row = await conn.fetchrow(
            "select replies_cap, replies_topup from usage_periods"
            " where period_start = date_trunc('month', now())::date"
        )
    assert row is not None
    assert (row["replies_cap"], row["replies_topup"]) == (1_000, 0)


async def test_a_top_up_starts_the_months_notices_over(
    owner: httpx.AsyncClient,
    billing: FakeBilling,
    client_factory: ClientFactory,
    admin_pool: Pool,
    drain: Drain,
) -> None:
    stripe = await subscribed(owner, billing, client_factory, "starter")
    customer = str(billing.checkouts[-1]["customer_id"])
    await ask(owner)
    await drain()
    await at_usage(admin_pool, 999)
    await ask(owner)  # 1,000 of 1,000
    assert [e.subject for e in await drain()] == [
        "Billing Co has used all of this month's AI replies"
    ]
    started = await buy_topup(owner, billing)
    await deliver(stripe, checkout_event(customer, started["metadata"]))
    async with admin_pool.acquire() as conn:
        notified = await conn.fetchrow("select notified_80_at, notified_100_at from usage_periods")
    assert notified is not None
    assert (notified["notified_80_at"], notified["notified_100_at"]) == (None, None)
    await at_usage(admin_pool, 1_499)
    await ask(owner)  # 1,500 of 1,500: the new allowance is used up, and the owners hear so
    assert [e.subject for e in await drain()] == [
        "Billing Co has used all of this month's AI replies"
    ]


async def test_a_top_up_needs_an_owner_a_paid_plan_that_is_on_and_its_own_pack(
    owner: httpx.AsyncClient,
    billing: FakeBilling,
    client_factory: ClientFactory,
    admin_pool: Pool,
    drain: Drain,
) -> None:
    trial = await owner.post("/v1/billing/topups/checkout", json={"pack_id": "starter_500"})
    assert trial.status_code == 409
    assert trial.json()["error"]["code"] == "topup_needs_plan"

    await subscribed(owner, billing, client_factory, "growth")
    unknown = await owner.post("/v1/billing/topups/checkout", json={"pack_id": "growth_7"})
    assert unknown.status_code == 422
    other = await owner.post("/v1/billing/topups/checkout", json={"pack_id": "starter_500"})
    assert other.status_code == 409
    assert other.json()["error"]["code"] == "topup_plan_changed"
    await buy_topup(owner, billing, "growth_2500")

    await owner.post("/v1/invitations", json={"email": unique_email(), "role": "admin"})
    admin = client_factory()
    token = token_from((await drain())[-1])
    await admin.post(
        "/v1/invitations/accept", json={"token": token, "name": "Ada", "password": PASSWORD}
    )
    refused = await admin.post("/v1/billing/topups/checkout", json={"pack_id": "growth_2500"})
    assert refused.status_code == 403

    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update subscriptions set status = 'past_due',"
            " past_due_since = now() - interval '8 days'"
        )
    off = await owner.post("/v1/billing/topups/checkout", json={"pack_id": "growth_2500"})
    assert off.status_code == 409
    assert off.json()["error"]["code"] == "topup_needs_plan"


async def test_a_top_up_does_not_turn_answers_back_on_while_the_plan_is_off(
    owner: httpx.AsyncClient,
    billing: FakeBilling,
    client_factory: ClientFactory,
) -> None:
    stripe = await subscribed(owner, billing, client_factory, "starter")
    customer = str(billing.checkouts[-1]["customer_id"])
    started = await buy_topup(owner, billing)
    await deliver(stripe, checkout_event(customer, started["metadata"]))
    canceled = subscription_event(
        customer, plan="starter", status="canceled", kind="customer.subscription.deleted"
    )
    await deliver(stripe, canceled)
    data = await billing_state(owner)
    assert (data["active"], data["usage"]["replies"]["limit"], data["topups"]["replies"]) == (
        False,
        0,
        500,
    )
    assert (await ask(owner))["decision"]["reason"] == "cap_reached"


async def test_only_a_paid_top_up_checkout_credits_replies(
    owner: httpx.AsyncClient,
    billing: FakeBilling,
    client_factory: ClientFactory,
) -> None:
    stripe = await subscribed(owner, billing, client_factory, "starter")
    customer = str(billing.checkouts[-1]["customer_id"])
    started = await buy_topup(owner, billing)
    plan_checkout = checkout_event(customer, {}, session="cs_plan", mode="subscription")
    assert (await deliver(stripe, plan_checkout)).json() == {"outcome": "ignored"}
    # A bank debit completes checkout unpaid; the replies come when the money does.
    unpaid = checkout_event(customer, started["metadata"], session="cs_debit", paid=False)
    assert (await deliver(stripe, unpaid)).json() == {"outcome": "ignored"}
    assert (await billing_state(owner))["topups"]["replies"] == 0
    succeeded = checkout_event(
        customer,
        started["metadata"],
        session="cs_debit",
        kind="checkout.session.async_payment_succeeded",
    )
    assert (await deliver(stripe, succeeded)).json() == {"outcome": "applied"}
    stranger = checkout_event("cus_not_ours", started["metadata"], session="cs_x")
    assert (await deliver(stripe, stranger)).json() == {"outcome": "unknown_customer"}
    bad_pack = checkout_event(customer, {"kind": "topup", "pack_id": "nope"}, session="cs_y")
    assert (await deliver(stripe, bad_pack)).json() == {"outcome": "ignored"}
    assert (await billing_state(owner))["topups"]["replies"] == 500
