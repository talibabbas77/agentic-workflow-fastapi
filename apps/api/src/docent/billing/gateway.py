"""Stripe, behind the small interface the API and the tests share.

Stripe hosts checkout and the customer portal, so card data never reaches us.
Prices are found by lookup key (`docent_<plan>_monthly`), which
`docent billing sync-stripe` creates from the plan catalog.
"""

import json
import uuid
from collections.abc import Awaitable
from datetime import datetime, timedelta
from typing import Any, Protocol

import stripe

from docent.billing.plans import PAID_PLANS, Plan, price_lookup_key
from docent.config import Settings

WEBHOOK_TOLERANCE_SECONDS = 300


class BillingError(Exception):
    """Stripe refused a request, or the catalog is not set up."""


class InvalidSignature(Exception):
    """The webhook was not signed by Stripe with our secret, or is too old."""


class BillingGateway(Protocol):
    async def create_customer(self, *, tenant_id: uuid.UUID, name: str, email: str) -> str: ...

    async def checkout_url(
        self,
        *,
        customer_id: str,
        tenant_id: uuid.UUID,
        plan: Plan,
        success_url: str,
        cancel_url: str,
    ) -> str: ...

    async def portal_url(self, *, customer_id: str, return_url: str) -> str: ...

    def verify_event(self, payload: bytes, signature: str) -> dict[str, Any]: ...

    async def preview_upgrade(self, *, customer_id: str, subscription_id: str, plan: Plan) -> int:
        """Stripe's own figure for what an upgrade charges today, in cents."""
        ...

    async def upgrade(self, *, subscription_id: str, plan: Plan) -> None:
        """Switch now, invoice the prorated difference, keep the renewal date."""
        ...

    async def schedule_downgrade(self, *, subscription_id: str, plan: Plan) -> str:
        """Switch when the current period ends. Returns the schedule id."""
        ...

    async def release_schedule(self, *, schedule_id: str) -> None: ...

    async def set_cancel_at_period_end(self, *, subscription_id: str, cancel: bool) -> None: ...

    async def refundable_cents(self, *, customer_id: str, since: datetime) -> int:
        """What the customer has paid since `since` and not had back, in cents."""
        ...

    async def refund_and_cancel(
        self, *, customer_id: str, subscription_id: str, since: datetime
    ) -> int:
        """Refund every payment since `since` and end the subscription now. Returns cents."""
        ...


def verify_event(payload: bytes, signature: str, secret: str | None) -> dict[str, Any]:
    """Check Stripe's signature header over the raw body, then parse the event."""
    if not secret:
        raise InvalidSignature("STRIPE_WEBHOOK_SECRET is not set")
    try:
        stripe.WebhookSignature.verify_header(payload, signature, secret, WEBHOOK_TOLERANCE_SECONDS)
    except stripe.SignatureVerificationError as exc:
        raise InvalidSignature(str(exc)) from None
    event: dict[str, Any] = json.loads(payload)
    return event


def stripe_gateway(settings: Settings) -> StripeGateway | None:
    """The Stripe gateway, or None when this server has no Stripe key yet."""
    key = settings.stripe_secret_key.get_secret_value() if settings.stripe_secret_key else ""
    if not key:
        return None
    secret = settings.stripe_webhook_secret
    return StripeGateway(
        key,
        (secret.get_secret_value() or None) if secret else None,
        api_base=settings.stripe_api_base,
        automatic_tax=settings.stripe_automatic_tax,
    )


class StripeGateway:
    def __init__(
        self,
        secret_key: str,
        webhook_secret: str | None,
        *,
        api_base: str | None = None,
        automatic_tax: bool = False,
    ) -> None:
        self._client = stripe.StripeClient(
            secret_key,
            http_client=stripe.HTTPXClient(),
            base_addresses={"api": api_base} if api_base else None,
            max_network_retries=2,
        )
        self._webhook_secret = webhook_secret
        self._automatic_tax = automatic_tax
        self._prices: dict[str, str] = {}

    async def create_customer(self, *, tenant_id: uuid.UUID, name: str, email: str) -> str:
        customer = await self._call(
            self._client.v1.customers.create_async(
                {"name": name, "email": email, "metadata": {"tenant_id": str(tenant_id)}}
            )
        )
        return str(customer.id)

    async def checkout_url(
        self,
        *,
        customer_id: str,
        tenant_id: uuid.UUID,
        plan: Plan,
        success_url: str,
        cancel_url: str,
    ) -> str:
        metadata = {"tenant_id": str(tenant_id), "plan_id": plan.id}
        session = await self._call(
            self._client.v1.checkout.sessions.create_async(
                {
                    "mode": "subscription",
                    "customer": customer_id,
                    "client_reference_id": str(tenant_id),
                    "line_items": [{"price": await self._price_id(plan), "quantity": 1}],
                    "subscription_data": {"metadata": metadata},
                    "metadata": metadata,
                    "allow_promotion_codes": True,
                    "automatic_tax": {"enabled": self._automatic_tax},
                    **({"customer_update": {"address": "auto"}} if self._automatic_tax else {}),
                    "success_url": success_url,
                    "cancel_url": cancel_url,
                }
            )
        )
        if not session.url:
            raise BillingError("Stripe returned a checkout session without a URL.")
        return session.url

    async def portal_url(self, *, customer_id: str, return_url: str) -> str:
        session = await self._call(
            self._client.v1.billing_portal.sessions.create_async(
                {"customer": customer_id, "return_url": return_url}
            )
        )
        return session.url

    def verify_event(self, payload: bytes, signature: str) -> dict[str, Any]:
        return verify_event(payload, signature, self._webhook_secret)

    async def preview_upgrade(self, *, customer_id: str, subscription_id: str, plan: Plan) -> int:
        item_id = await self._item_id(subscription_id)
        invoice = await self._call(
            self._client.v1.invoices.create_preview_async(
                {
                    "customer": customer_id,
                    "subscription": subscription_id,
                    "subscription_details": {
                        "items": [{"id": item_id, "price": await self._price_id(plan)}],
                        "proration_behavior": "always_invoice",
                    },
                }
            )
        )
        return int(invoice.amount_due)

    async def upgrade(self, *, subscription_id: str, plan: Plan) -> None:
        item_id = await self._item_id(subscription_id)
        await self._call(
            self._client.v1.subscriptions.update_async(
                subscription_id,
                {
                    "items": [{"id": item_id, "price": await self._price_id(plan)}],
                    "proration_behavior": "always_invoice",
                    # The upgrade only happens if its prorated invoice is paid.
                    "payment_behavior": "pending_if_incomplete",
                },
            )
        )

    async def schedule_downgrade(self, *, subscription_id: str, plan: Plan) -> str:
        subscription = await self._call(
            self._client.v1.subscriptions.retrieve_async(subscription_id)
        )
        existing = subscription.schedule
        schedule_id = existing if isinstance(existing, str) else existing.id if existing else None
        if schedule_id is None:
            created = await self._call(
                self._client.v1.subscription_schedules.create_async(
                    {"from_subscription": subscription_id}
                )
            )
            schedule_id = created.id
        item = subscription["items"]["data"][0]
        price = item["price"]["id"]
        await self._call(
            self._client.v1.subscription_schedules.update_async(
                schedule_id,
                {
                    "end_behavior": "release",
                    "phases": [
                        {
                            "items": [{"price": price, "quantity": 1}],
                            "start_date": item["current_period_start"],
                            "end_date": item["current_period_end"],
                        },
                        {
                            "items": [{"price": await self._price_id(plan), "quantity": 1}],
                            "duration": {"interval": "month", "interval_count": 1},
                        },
                    ],
                },
            )
        )
        return schedule_id

    async def release_schedule(self, *, schedule_id: str) -> None:
        await self._call(self._client.v1.subscription_schedules.release_async(schedule_id))

    async def set_cancel_at_period_end(self, *, subscription_id: str, cancel: bool) -> None:
        await self._call(
            self._client.v1.subscriptions.update_async(
                subscription_id, {"cancel_at_period_end": cancel}
            )
        )

    async def refundable_cents(self, *, customer_id: str, since: datetime) -> int:
        return sum(left for _, left in await self._refundable(customer_id, since))

    async def refund_and_cancel(
        self, *, customer_id: str, subscription_id: str, since: datetime
    ) -> int:
        charges = await self._refundable(customer_id, since)
        if not charges:
            raise BillingError("There is no payment to refund.")
        total = 0
        for charge_id, left in charges:  # the first payment, then any upgrade charges
            refund = await self._call(
                self._client.v1.refunds.create_async(
                    {"charge": charge_id, "amount": left, "reason": "requested_by_customer"},
                    {"idempotency_key": f"docent-refund-{charge_id}"},
                )
            )
            total += int(refund.amount)
        await self._call(self._client.v1.subscriptions.cancel_async(subscription_id))
        return total

    async def _refundable(self, customer_id: str, since: datetime) -> list[tuple[str, int]]:
        """Paid charges since `since`, each with the part not yet refunded."""
        # The first invoice.paid event lands a moment after its charge, so look a day earlier.
        start = int((since - timedelta(days=1)).timestamp())
        charges = await self._call(
            self._client.v1.charges.list_async(
                {"customer": customer_id, "created": {"gte": start}, "limit": 100}
            )
        )
        return [
            (charge.id, charge.amount - charge.amount_refunded)
            for charge in charges.data
            if charge.paid
            and charge.status == "succeeded"
            and charge.amount > charge.amount_refunded
        ]

    async def _item_id(self, subscription_id: str) -> str:
        subscription = await self._call(
            self._client.v1.subscriptions.retrieve_async(subscription_id)
        )
        return str(subscription["items"]["data"][0]["id"])

    async def sync_catalog(self) -> list[str]:
        """Create or update one product and one monthly price per paid plan. Safe to rerun."""
        lines = []
        for plan in PAID_PLANS:
            product_id = f"docent_{plan.id}"
            try:
                await self._client.v1.products.retrieve_async(product_id)
            except stripe.InvalidRequestError:
                await self._call(
                    self._client.v1.products.create_async(
                        {
                            "id": product_id,
                            "name": f"Docent {plan.name}",
                            "description": plan.summary,
                            "metadata": {"plan_id": plan.id},
                        }
                    )
                )
            key = price_lookup_key(plan)
            amount = plan.price_usd_month * 100
            existing = await self._find_price(key)
            if existing and existing.unit_amount == amount and existing.currency == "usd":
                lines.append(f"{plan.name}: price {existing.id} is current")
                continue
            price = await self._call(
                self._client.v1.prices.create_async(
                    {
                        "product": product_id,
                        "currency": "usd",
                        "unit_amount": amount,
                        "recurring": {"interval": "month"},
                        "lookup_key": key,
                        "transfer_lookup_key": True,
                        "metadata": {"plan_id": plan.id},
                    }
                )
            )
            if existing:
                await self._call(
                    self._client.v1.prices.update_async(existing.id, {"active": False})
                )
            self._prices[key] = price.id
            lines.append(f"{plan.name}: created price {price.id} at ${plan.price_usd_month}/month")
        return lines

    async def _price_id(self, plan: Plan) -> str:
        key = price_lookup_key(plan)
        if key not in self._prices:
            price = await self._find_price(key)
            if price is None:
                raise BillingError(
                    f"No Stripe price with lookup key {key}. Run: docent billing sync-stripe"
                )
            self._prices[key] = price.id
        return self._prices[key]

    async def _find_price(self, key: str) -> stripe.Price | None:
        found = await self._call(
            self._client.v1.prices.list_async({"lookup_keys": [key], "active": True, "limit": 1})
        )
        return found.data[0] if found.data else None

    @staticmethod
    async def _call[T](request: Awaitable[T]) -> T:
        try:
            return await request
        except stripe.StripeError as exc:
            raise BillingError(exc.user_message or str(exc)) from exc
