"""The plan catalog: one source for the pricing page, caps, and Stripe prices.

Prices and limits are the starting proposal in docs/ARCHITECTURE.md section 10.
`docent billing sync-stripe` creates the matching Stripe products and prices,
found again by their lookup key, so Stripe never becomes a second catalog.

Top-up packs come from the same numbers. Each paid plan offers two: half a
month's replies for half the monthly price, and a whole month's for the whole
price. A pack costs exactly the plan's own price per reply, so it is never a
worse deal than the plan, and never a better one than upgrading for a team that
needs more every month. A pack is bought by hand, adds its replies to the
current month only, and ends with it (ARCHITECTURE section 10).
"""

from pydantic import BaseModel, computed_field

# A pack is the plan's monthly replies and price divided by one of these.
TOPUP_DIVISORS = (2, 1)


class TopupPack(BaseModel):
    id: str
    plan_id: str
    replies: int
    price_cents: int


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

    @computed_field  # type: ignore[prop-decorator]
    @property
    def topup_packs(self) -> list[TopupPack]:
        """Extra replies an owner can buy for the current month. None on the trial."""
        if self.price_usd_month <= 0:
            return []
        return [
            TopupPack(
                id=f"{self.id}_{self.replies_per_month // divisor}",
                plan_id=self.id,
                replies=self.replies_per_month // divisor,
                price_cents=self.price_usd_month * 100 // divisor,
            )
            for divisor in TOPUP_DIVISORS
        ]


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


TOPUP_PACKS: tuple[TopupPack, ...] = tuple(pack for plan in PAID_PLANS for pack in plan.topup_packs)
TOPUP_PACK_BY_ID: dict[str, TopupPack] = {pack.id: pack for pack in TOPUP_PACKS}


def topup_lookup_key(pack: TopupPack) -> str:
    return f"docent_topup_{pack.id}"
