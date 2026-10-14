"""Plan changes and what they cost, worked out the way Stripe prorates.

The rules, chosen so a customer always gets what they paid for and is never
charged twice:

  Upgrade      Starts now. The rest of the current period is charged at the
               new price, minus the unused rest of the old price, and that
               difference is charged today. The renewal date does not move.
  Downgrade    Starts when the paid period ends. Nothing is charged or credited
               today; the current plan and its limits stay until then. It is
               refused while the workspace uses more than the smaller plan
               allows (pages, widgets, seats), so nothing breaks at renewal.
  Cancel       Takes effect when the paid period ends, and can be undone until
               then. No refund for the unused part of a month.
  Refund       The full first payment, within 14 days of it (billing/refunds.py).

Stripe prorates by the second, so this module does too. It explains the bill;
Stripe's invoice, also previewed when payments are set up, is the bill.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from docent.billing.plans import Plan

Kind = Literal["upgrade", "downgrade", "same"]


@dataclass(frozen=True, slots=True)
class Line:
    label: str
    amount_cents: int


@dataclass(frozen=True, slots=True)
class Preview:
    kind: Kind
    effective_at: datetime
    due_now_cents: int
    next_renewal_cents: int
    lines: list[Line] = field(default_factory=list)
    explanation: list[str] = field(default_factory=list)


def money(cents: int) -> str:
    return f"{'-' if cents < 0 else ''}${abs(cents) / 100:,.2f}"


def kind_of(current: Plan, target: Plan) -> Kind:
    if target.id == current.id:
        return "same"
    return "upgrade" if target.price_usd_month > current.price_usd_month else "downgrade"


def preview(
    current: Plan, target: Plan, *, period_start: datetime, period_end: datetime, now: datetime
) -> Preview:
    old, new = current.price_usd_month * 100, target.price_usd_month * 100
    kind = kind_of(current, target)
    renews = f"{period_end:%b} {period_end.day}"
    if kind == "same":
        return Preview(kind, now, 0, new, explanation=[f"You are already on {current.name}."])
    if kind == "downgrade":
        return Preview(
            kind,
            period_end,
            0,
            new,
            explanation=[
                f"You keep {current.name} and its limits until {renews}, the end of the period "
                "you paid for.",
                f"{target.name} starts on {renews} at {money(new)} a month. Nothing is charged "
                "or refunded today.",
                "You can cancel this change any time before then.",
            ],
        )

    total = (period_end - period_start).total_seconds()
    left = min(max((period_end - now).total_seconds(), 0.0), total)
    fraction = left / total if total > 0 else 0.0
    days_left, days_total = round(left / 86400), round(total / 86400)
    charge, credit = round(new * fraction), round(old * fraction)
    return Preview(
        kind,
        now,
        charge - credit,
        new,
        lines=[
            Line(
                f"{target.name} for the rest of this period ({days_left} of {days_total} days)",
                charge,
            ),
            Line(f"Unused {current.name} time ({days_left} of {days_total} days)", -credit),
        ],
        explanation=[
            f"{target.name} starts now, with {target.replies_per_month:,} AI replies a month "
            "and its higher limits.",
            f"You pay only the difference for the {days_left} days left in this period: "
            f"{money(charge)} for {target.name}, less {money(credit)} for the {current.name} "
            f"time you already paid for, so {money(charge - credit)} today.",
            f"From {renews}, you pay {money(new)} a month. Your renewal date stays the same.",
        ],
    )
