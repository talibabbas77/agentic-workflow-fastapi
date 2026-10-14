"""The money-back guarantee: a full refund within 14 days of the first payment.

The refund covers everything paid in that time, so an owner who upgraded in
the first week gets the upgrade charge back too. After that window there are
no refunds for partial months. A downgrade or a cancellation takes effect at
the end of the paid period instead, so the customer keeps what they paid for.
A workspace is refunded at most once.
"""

from datetime import UTC, datetime, timedelta

from docent.billing.subscriptions import Entitlement

WINDOW = timedelta(days=14)


def window_end(current: Entitlement) -> datetime | None:
    """The end of the money-back window, while the workspace can still use it."""
    if current.provider != "stripe" or current.first_paid_at is None or current.refunded_at:
        return None
    end = current.first_paid_at + WINDOW
    return end if datetime.now(UTC) < end else None


def reason(current: Entitlement) -> str:
    """Why a refund is or is not available, in plain words."""
    if current.refunded_at:
        return "This workspace was already refunded."
    if current.provider != "stripe" or current.first_paid_at is None:
        return "There is no payment to refund yet."
    end = current.first_paid_at + WINDOW
    if datetime.now(UTC) >= end:
        return (
            f"The 14 day money-back window ended on {end:%b} {end.day}. Cancel to stop the "
            "plan at the end of the period you paid for."
        )
    return (
        f"Full refund of everything paid so far, until {end:%b} {end.day}. The plan ends "
        "right away and every message goes to your team."
    )
