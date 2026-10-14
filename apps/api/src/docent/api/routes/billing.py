"""Plans and payments: what the workspace has, Stripe checkout and portal, and webhooks.

Everyone in a workspace can see its plan and usage; only owners change billing.
Checkout and the portal are hosted by Stripe, so card data never reaches us.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Header, Request

from docent.api.deps import CurrentMember, Member, OwnerMember, State
from docent.api.errors import AppError
from docent.api.schemas import (
    BillingOut,
    BillingUsage,
    CheckoutIn,
    ErrorOut,
    RedirectOut,
    UsageMeter,
)
from docent.billing import subscriptions, webhooks
from docent.billing.gateway import BillingError, BillingGateway, InvalidSignature
from docent.billing.plans import PLAN_BY_ID
from docent.db.pool import Connection, transaction
from docent.services import audit

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/v1/billing",
    tags=["billing"],
    responses={403: {"model": ErrorOut}, 503: {"model": ErrorOut}},
)
webhook_router = APIRouter(prefix="/v1/webhooks", include_in_schema=False)


@router.get("")
async def get_billing(member: CurrentMember, state: State) -> BillingOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        current = await subscriptions.entitlement(conn, member.tenant_id)
        counts = await subscriptions.usage_counts(conn)
        period = await conn.fetchrow(
            """
            select date_trunc('month', now())::date as period_start,
                   (date_trunc('month', now()) + interval '1 month')::date as period_end,
                   coalesce((select replies_used from usage_periods
                             where period_start = date_trunc('month', now())::date), 0) as used
            """
        )
    assert period is not None
    plan = current.plan
    return BillingOut(
        plan=plan,
        status=current.status,
        active=current.active,
        provider="stripe" if current.provider == "stripe" else "manual",
        trial_ends_at=current.trial_ends_at,
        current_period_end=current.current_period_end,
        cancel_at=current.cancel_at,
        grace_ends_at=current.grace_ends_at,
        billing_enabled=state.billing is not None,
        can_manage=member.role == "owner",
        usage=BillingUsage(
            period_start=period["period_start"],
            period_end=period["period_end"],
            replies=UsageMeter(
                used=period["used"], limit=plan.replies_per_month if current.active else 0
            ),
            documents=UsageMeter(used=counts["documents"], limit=plan.pages),
            widgets=UsageMeter(used=counts["widgets"], limit=plan.widgets),
            seats=UsageMeter(used=counts["seats"], limit=plan.seats),
        ),
    )


@router.post("/checkout", responses={409: {"model": ErrorOut}, 502: {"model": ErrorOut}})
async def checkout(body: CheckoutIn, member: OwnerMember, state: State) -> RedirectOut:
    """Start Stripe Checkout for a paid plan. An existing plan changes in the portal."""
    gateway = _gateway(state)
    plan = PLAN_BY_ID[body.plan_id]
    web = state.settings.web_origin.rstrip("/")
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        # One checkout at a time per workspace, so a double click makes one customer.
        await conn.execute(
            "select 1 from subscriptions where tenant_id = $1 for update", member.tenant_id
        )
        current = await subscriptions.entitlement(conn, member.tenant_id)
        if current.provider == "stripe" and current.status in webhooks.LIVE_STATUSES:
            raise AppError(
                409, "already_subscribed", "Change or cancel your plan in the billing portal."
            )
        customer_id = current.customer_id or await _new_customer(conn, gateway, member)
        try:
            url = await gateway.checkout_url(
                customer_id=customer_id,
                tenant_id=member.tenant_id,
                plan=plan,
                success_url=f"{web}/app/billing?checkout=success",
                cancel_url=f"{web}/app/billing?checkout=canceled",
            )
        except BillingError as exc:
            raise _upstream(exc) from None
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="billing.checkout_started",
            target_type="tenant",
            target_id=member.tenant_id,
            metadata={"plan_id": plan.id},
        )
    return RedirectOut(url=url)


@router.post("/portal", responses={409: {"model": ErrorOut}, 502: {"model": ErrorOut}})
async def portal(member: OwnerMember, state: State) -> RedirectOut:
    """Stripe's customer portal: change plan, update the card, download invoices, cancel."""
    gateway = _gateway(state)
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        current = await subscriptions.entitlement(conn, member.tenant_id)
    if current.customer_id is None:
        raise AppError(409, "no_billing_account", "Choose a plan first.")
    try:
        url = await gateway.portal_url(
            customer_id=current.customer_id,
            return_url=f"{state.settings.web_origin.rstrip('/')}/app/billing",
        )
    except BillingError as exc:
        raise _upstream(exc) from None
    return RedirectOut(url=url)


@webhook_router.post("/stripe")
async def stripe_webhook(
    request: Request, state: State, stripe_signature: Annotated[str, Header()] = ""
) -> dict[str, str]:
    gateway = _gateway(state)
    try:
        event = gateway.verify_event(await request.body(), stripe_signature)
    except InvalidSignature:
        raise AppError(400, "invalid_signature", "The webhook signature is not valid.") from None
    outcome = await webhooks.apply_event(state.pool, event)
    log.info(
        "stripe event", extra={"event": event["id"], "type": event["type"], "outcome": outcome}
    )
    return {"outcome": outcome}


async def _new_customer(conn: Connection, gateway: BillingGateway, member: Member) -> str:
    """Create the Stripe customer once and keep its id, which is how webhooks find us."""
    workspace = await conn.fetchval("select name from tenants where id = $1", member.tenant_id)
    try:
        customer_id = await gateway.create_customer(
            tenant_id=member.tenant_id, name=workspace, email=member.user.email
        )
    except BillingError as exc:
        raise _upstream(exc) from None
    await conn.execute(
        "update subscriptions set provider_customer_id = $2, updated_at = now()"
        " where tenant_id = $1",
        member.tenant_id,
        customer_id,
    )
    return customer_id


def _gateway(state: State) -> BillingGateway:
    if state.billing is None:
        raise AppError(503, "billing_not_configured", "Payments are not set up on this server yet.")
    return state.billing


def _upstream(exc: BillingError) -> AppError:
    log.warning("stripe request failed", extra={"error": str(exc)})
    return AppError(502, "billing_unavailable", "Stripe could not be reached. Try again shortly.")
