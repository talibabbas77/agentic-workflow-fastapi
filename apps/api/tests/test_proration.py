"""The plan change arithmetic, checked by hand."""

from datetime import UTC, datetime, timedelta

from docent.billing.plans import PLAN_BY_ID
from docent.billing.proration import money, preview

START = datetime(2026, 10, 1, tzinfo=UTC)
END = datetime(2026, 10, 31, tzinfo=UTC)  # a 30 day period
STARTER, GROWTH, SCALE = PLAN_BY_ID["starter"], PLAN_BY_ID["growth"], PLAN_BY_ID["scale"]


def test_an_upgrade_halfway_charges_half_the_difference_today() -> None:
    result = preview(
        STARTER, GROWTH, period_start=START, period_end=END, now=START + timedelta(days=15)
    )
    # Growth $99 for half the period = $49.50, less half of Starter $29 = $14.50.
    assert [line.amount_cents for line in result.lines] == [4950, -1450]
    assert result.due_now_cents == 3500
    assert result.effective_at == START + timedelta(days=15)
    assert result.next_renewal_cents == 9900
    assert "$49.50 for Growth, less $14.50 for the Starter time" in result.explanation[1]
    assert "15 of 30 days" in result.lines[0].label


def test_upgrade_cost_scales_with_the_time_left() -> None:
    first = preview(STARTER, SCALE, period_start=START, period_end=END, now=START)
    assert first.due_now_cents == 29900 - 2900
    last = preview(
        STARTER, SCALE, period_start=START, period_end=END, now=END - timedelta(hours=12)
    )
    assert last.due_now_cents == round(29900 / 60) - round(2900 / 60)  # half a day of 30


def test_a_downgrade_waits_for_renewal_and_charges_nothing() -> None:
    result = preview(
        SCALE, STARTER, period_start=START, period_end=END, now=START + timedelta(days=3)
    )
    assert (result.kind, result.due_now_cents, result.lines) == ("downgrade", 0, [])
    assert result.effective_at == END
    assert result.next_renewal_cents == 2900
    assert result.explanation[0].startswith("You keep Scale and its limits until Oct 31")


def test_the_same_plan_is_not_a_change() -> None:
    assert preview(GROWTH, GROWTH, period_start=START, period_end=END, now=START).kind == "same"


def test_money_formatting() -> None:
    assert (money(3500), money(-1450), money(129900)) == ("$35.00", "-$14.50", "$1,299.00")
