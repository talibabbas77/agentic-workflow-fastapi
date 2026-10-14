"""Top-up packs: extra AI replies for the current month, bought by hand.

The rules (ARCHITECTURE section 10):
- An owner buys a pack with Stripe Checkout in payment mode. The packs on offer
  are the current plan's (plans.py), at that plan's own price per reply.
- A pack adds to a plan that is on. On the trial, or in escalate-only mode, the
  owner chooses a plan instead, so a pack never turns answers back on by itself.
- Only Stripe's signed checkout webhook credits a pack, once per checkout
  session however often the event arrives. Leaving checkout credits nothing.
- The replies go to the calendar month in which the payment went through and
  end with it, used or not. A pack never renews, never carries over, and is
  never refunded in part. The 14 day money-back guarantee, which refunds
  everything paid since the first payment, covers a pack bought in that window.
"""

import logging
import uuid
from datetime import datetime
from typing import Any, Literal

import asyncpg

from docent.billing import subscriptions
from docent.billing.plans import TOPUP_PACK_BY_ID, TopupPack
from docent.billing.subscriptions import Entitlement
from docent.db.pool import Connection
from docent.ids import new_id

log = logging.getLogger(__name__)

# Checkout reports a card payment as paid at once; slower methods report later.
CHECKOUT_EVENTS = {"checkout.session.completed", "checkout.session.async_payment_succeeded"}
KIND = "topup"


class TopupError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def pack_to_buy(current: Entitlement, pack_id: str) -> TopupPack:
    """The pack, if this workspace may buy it now. Raises TopupError with the reason."""
    pack = TOPUP_PACK_BY_ID.get(pack_id)
    if pack is None:
        raise TopupError(422, "invalid_pack", "There is no top-up pack with that id.")
    if not current.plan.topup_packs:
        raise TopupError(
            409,
            "topup_needs_plan",
            "Top-up packs add replies to a paid plan. Choose a plan to get more replies.",
        )
    if not current.active:
        raise TopupError(
            409,
            "topup_needs_plan",
            "The plan is not on, so a top-up would not turn answers back on. Choose a plan first.",
        )
    if pack.plan_id != current.plan.id:
        raise TopupError(
            409,
            "topup_plan_changed",
            f"That pack is for another plan. This workspace is on {current.plan.name} now; "
            "reload the page to see its packs.",
        )
    return pack


def metadata(tenant_id: uuid.UUID, pack: TopupPack) -> dict[str, str]:
    """What the checkout session carries, so its webhook knows which pack was paid for."""
    return {
        "tenant_id": str(tenant_id),
        "kind": KIND,
        "pack_id": pack.id,
        "replies": str(pack.replies),
    }


async def credit(
    conn: Connection, tenant_id: uuid.UUID, session: dict[str, Any], paid_at: datetime
) -> Literal["applied", "ignored"]:
    """Add a paid pack's replies to the month it was paid in. Runs in the tenant's context.

    The caller already knows the tenant from the Stripe customer (never from metadata).
    Metadata only says which pack: it is ours, set when the session was created.
    """
    meta = session.get("metadata") or {}
    if session.get("mode") != "payment" or meta.get("kind") != KIND:
        return "ignored"  # a subscription checkout: its subscription events do the work
    if session.get("payment_status") != "paid":
        return "ignored"  # a slower payment method: async_payment_succeeded follows
    pack = TOPUP_PACK_BY_ID.get(str(meta.get("pack_id")))
    if pack is None:
        log.warning("paid checkout for an unknown pack", extra={"session": session.get("id")})
        return "ignored"
    amount = session.get("amount_subtotal")
    period_start = await conn.fetchval(
        """
        insert into topups (id, tenant_id, pack_id, replies, amount_cents, provider_order_id,
                            period_start)
        values ($1, $2, $3, $4, $5, $6, date_trunc('month', $7::timestamptz)::date)
        on conflict (provider_order_id) do nothing
        returning period_start
        """,
        new_id(),
        tenant_id,
        pack.id,
        pack.replies,
        amount if isinstance(amount, int) else pack.price_cents,
        str(session["id"]),
        paid_at,
    )
    if period_start is None:
        return "ignored"  # this checkout session was credited already
    cap = await subscriptions.reply_cap(conn, tenant_id)
    # A month's 80 and 100 percent notices start over when the pack lifts usage under them.
    await conn.execute(
        """
        insert into usage_periods (tenant_id, period_start, period_end, replies_cap, replies_topup)
        values ($1, $2::date, ($2::date + interval '1 month')::date, $3, $4)
        on conflict (tenant_id, period_start) do update
        set replies_topup = usage_periods.replies_topup + excluded.replies_topup,
            notified_80_at = case
              when usage_periods.replies_used * 5 >= (usage_periods.replies_cap
                   + usage_periods.replies_topup + excluded.replies_topup) * 4
              then usage_periods.notified_80_at end,
            notified_100_at = case
              when usage_periods.replies_used >= usage_periods.replies_cap
                   + usage_periods.replies_topup + excluded.replies_topup
              then usage_periods.notified_100_at end
        """,
        tenant_id,
        period_start,
        cap,
        pack.replies,
    )
    return "applied"


async def this_month(conn: Connection) -> tuple[int, list[asyncpg.Record]]:
    """Replies top-ups added to this month for the tenant in context, and the packs bought."""
    added: int = await conn.fetchval(
        """
        select coalesce((select replies_topup from usage_periods
                         where period_start = date_trunc('month', now())::date), 0)
        """
    )
    bought = await conn.fetch(
        """
        select id, pack_id, replies, amount_cents, created_at from topups
        where period_start = date_trunc('month', now())::date
        order by created_at, id
        """
    )
    return added, bought
