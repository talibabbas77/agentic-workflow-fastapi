"""Plan changes: the current period, scheduled downgrades, cancellation, refunds.

- current_period_start: with current_period_end, the period a proration is
  measured against.
- scheduled_plan_id, scheduled_change_at, provider_schedule_id: a downgrade
  waiting for the end of the paid period (a Stripe subscription schedule).
- cancel_at_period_end: the customer canceled; the plan stays until the end of
  the paid period, and they can resume until then.
- first_paid_at, refunded_at: the 14 day money-back window starts at the first
  payment, and a workspace is refunded at most once.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-14
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table subscriptions
          add column current_period_start timestamptz,
          add column cancel_at_period_end boolean not null default false,
          add column scheduled_plan_id text,
          add column scheduled_change_at timestamptz,
          add column provider_schedule_id text,
          add column first_paid_at timestamptz,
          add column refunded_at timestamptz;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table subscriptions
          drop column current_period_start, drop column cancel_at_period_end,
          drop column scheduled_plan_id, drop column scheduled_change_at,
          drop column provider_schedule_id, drop column first_paid_at,
          drop column refunded_at;
        """
    )
