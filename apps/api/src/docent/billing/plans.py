"""The plan catalog: one source for the pricing page, caps, and Stripe prices.

Prices and limits are the starting proposal in docs/ARCHITECTURE.md section 10.
`docent billing sync-stripe` creates the matching Stripe products and prices,
found again by their lookup key, so Stripe never becomes a second catalog.
"""

from pydantic import BaseModel


class Plan(BaseModel):
    id: str
    name: str
    price_usd_month: int
    replies_per_month: int
    pages: int
    widgets: int
    seats: int
    anonymous_mode: bool
    identified_mode: bool
    trial_days: int | None = None
    summary: str


PLANS: tuple[Plan, ...] = (
    Plan(
        id="trial",
        name="Trial",
        price_usd_month=0,
        replies_per_month=100,
        pages=200,
        widgets=1,
        seats=2,
        anonymous_mode=True,
        identified_mode=True,
        trial_days=14,
        summary="Teach the agent and test it on your own site before you pay.",
    ),
    Plan(
        id="starter",
        name="Starter",
        price_usd_month=29,
        replies_per_month=1_000,
        pages=2_000,
        widgets=1,
        seats=3,
        anonymous_mode=True,
        identified_mode=True,
        summary="One product, one help center, a small support team.",
    ),
    Plan(
        id="growth",
        name="Growth",
        price_usd_month=99,
        replies_per_month=5_000,
        pages=10_000,
        widgets=3,
        seats=10,
        anonymous_mode=True,
        identified_mode=True,
        summary="Several products or languages and a growing team.",
    ),
    Plan(
        id="scale",
        name="Scale",
        price_usd_month=299,
        replies_per_month=20_000,
        pages=50_000,
        widgets=10,
        seats=25,
        anonymous_mode=True,
        identified_mode=True,
        summary="High volume support with room for every team.",
    ),
)

PLAN_BY_ID: dict[str, Plan] = {plan.id: plan for plan in PLANS}
TRIAL = PLAN_BY_ID["trial"]
PAID_PLANS: tuple[Plan, ...] = tuple(plan for plan in PLANS if plan.price_usd_month > 0)


def price_lookup_key(plan: Plan) -> str:
    return f"docent_{plan.id}_monthly"


def plan_for_lookup_key(key: str | None) -> Plan | None:
    return next((plan for plan in PAID_PLANS if price_lookup_key(plan) == key), None)
