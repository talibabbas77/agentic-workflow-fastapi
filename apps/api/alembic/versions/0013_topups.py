"""Top-up packs, and the Redis command budget.

- topups: one paid pack of extra AI replies. An owner buys it with Stripe
  Checkout in payment mode; only the signed checkout webhook writes the row,
  once per checkout session (provider_order_id is unique). The pack adds its
  replies to one usage period, the calendar month the payment went through,
  and ends with it, used or not. The platform admin console reads the rows for
  this month's revenue, through the same select-only policy as 0011.
- usage_periods.replies_topup: the replies this period's packs added. Written
  in the same transaction as the topups row, so a reservation stays one
  conditional UPDATE of one row: used + reserved < cap + topup.
- redis_usage: the Redis commands Docent sent each calendar month, added up
  from every API process, with when the 80 and 90 percent alerts went out and
  when the app switched itself to local-only mode. Global and without RLS: it
  holds no tenant data, like jobs and billing_events.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-14
"""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table topups (
          id                 uuid primary key,
          tenant_id          uuid not null references tenants (id) on delete cascade,
          pack_id            text not null,
          replies            int not null check (replies > 0),
          amount_cents       int not null check (amount_cents >= 0),
          provider           text not null default 'stripe',
          provider_order_id  text not null unique,
          period_start       date not null,
          created_at         timestamptz not null default now()
        );
        create index topups_period_idx on topups (tenant_id, period_start);

        alter table topups enable row level security;
        alter table topups force row level security;
        create policy tenant_isolation on topups
          using (tenant_id = app_current_tenant())
          with check (tenant_id = app_current_tenant());
        create policy platform_admin_read on topups for select using (app_platform_admin());

        alter table usage_periods
          add column replies_topup int not null default 0 check (replies_topup >= 0);

        create table redis_usage (
          month             date primary key,
          commands          bigint not null default 0 check (commands >= 0),
          budget            bigint not null check (budget > 0),
          alerted_80_at     timestamptz,
          alerted_90_at     timestamptz,
          local_only_since  timestamptz,
          updated_at        timestamptz not null default now()
        );

        -- Only the signed webhook credits a pack, as the app role; nobody edits one.
        grant select, insert on topups to docent_app;
        grant select, insert, update on redis_usage to docent_app;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop table if exists redis_usage;
        alter table usage_periods drop column if exists replies_topup;
        drop table if exists topups;
        """
    )
