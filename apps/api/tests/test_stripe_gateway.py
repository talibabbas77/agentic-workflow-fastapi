"""The real Stripe gateway against stripe-mock, which validates every request against
Stripe's OpenAPI spec. Catches wrong parameter names and shapes without real keys.

Run with: docker compose --profile stripe-mock up -d, then STRIPE_MOCK_URL=http://localhost:12111
"""

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from docent.billing.gateway import StripeGateway
from docent.billing.plans import PLAN_BY_ID

STRIPE_MOCK_URL = os.environ.get("STRIPE_MOCK_URL")

pytestmark = pytest.mark.skipif(
    not STRIPE_MOCK_URL, reason="set STRIPE_MOCK_URL to run against stripe-mock"
)


@pytest.mark.parametrize("automatic_tax", [False, True])
async def test_checkout_portal_and_catalog_requests_are_valid(automatic_tax: bool) -> None:
    gateway = StripeGateway(
        "sk_test_123", None, api_base=STRIPE_MOCK_URL, automatic_tax=automatic_tax
    )
    tenant_id = uuid.uuid4()
    customer = await gateway.create_customer(
        tenant_id=tenant_id, name="Lumen Notes", email="owner@example.com"
    )
    assert customer.startswith("cus_")
    checkout = await gateway.checkout_url(
        customer_id=customer,
        tenant_id=tenant_id,
        plan=PLAN_BY_ID["growth"],
        success_url="http://localhost:3000/app/billing?checkout=success",
        cancel_url="http://localhost:3000/app/billing?checkout=canceled",
    )
    assert checkout.startswith("https://")
    portal = await gateway.portal_url(
        customer_id=customer, return_url="http://localhost:3000/app/billing"
    )
    assert portal.startswith("https://")
    lines = await gateway.sync_catalog()
    assert len(lines) == 3


async def test_plan_change_requests_are_valid() -> None:
    gateway = StripeGateway("sk_test_123", None, api_base=STRIPE_MOCK_URL)
    await gateway.sync_catalog()
    growth, starter = PLAN_BY_ID["growth"], PLAN_BY_ID["starter"]
    due = await gateway.preview_upgrade(
        customer_id="cus_123", subscription_id="sub_123", plan=growth
    )
    assert isinstance(due, int)
    await gateway.upgrade(subscription_id="sub_123", plan=growth)
    schedule = await gateway.schedule_downgrade(subscription_id="sub_123", plan=starter)
    assert schedule.startswith("sub_sched_")
    await gateway.release_schedule(schedule_id=schedule)
    await gateway.set_cancel_at_period_end(subscription_id="sub_123", cancel=True)
    since = datetime.now(UTC) - timedelta(days=3)
    owed = await gateway.refundable_cents(customer_id="cus_123", since=since)
    refunded = await gateway.refund_and_cancel(
        customer_id="cus_123", subscription_id="sub_123", since=since
    )
    assert owed >= 0
    assert refunded >= 0
