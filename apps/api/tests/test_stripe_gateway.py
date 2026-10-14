"""The real Stripe gateway against stripe-mock, which validates every request against
Stripe's OpenAPI spec. Catches wrong parameter names and shapes without real keys.

Run with: docker compose --profile stripe-mock up -d, then STRIPE_MOCK_URL=http://localhost:12111
"""

import os
import uuid

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
