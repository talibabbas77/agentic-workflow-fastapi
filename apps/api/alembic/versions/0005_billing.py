"""Billing: one subscription per tenant, provider events, cap notifications.

Every tenant has exactly one subscriptions row. It starts as a 14 day trial
(provider 'manual') and becomes a Stripe subscription after checkout. A billing
webhook knows only the provider's customer id, so the app.billing_customer
capability lets it read that one row to learn the tenant. Nothing bypasses RLS.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-14
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create function app_current_billing_customer() returns text
          language sql stable parallel safe
          as $$ select nullif(current_setting('app.billing_customer', true), '') $$;

        create table subscriptions (
          tenant_id                 uuid primary key references tenants (id) on delete cascade,
          plan_id                   text not null,
          status                    text not null check (status in (
                                      'trialing', 'active', 'past_due', 'canceled', 'unpaid',
                                      'incomplete', 'incomplete_expired', 'paused')),
          provider                  text not null default 'manual'
                                    check (provider in ('manual', 'stripe')),
          provider_customer_id      text unique,
          provider_subscription_id  text unique,
          trial_ends_at             timestamptz,
          current_period_end        timestamptz,
          cancel_at                 timestamptz,
          past_due_since            timestamptz,
          provider_event_at         timestamptz,
          updated_at                timestamptz not null default now()
        );

        -- Existing workspaces start their trial from the day they were created. tenants
        -- forces row-level security even for its owner, so lift it for this one read.
        alter table tenants no force row level security;
        insert into subscriptions (tenant_id, plan_id, status, trial_ends_at)
        select id, 'trial', 'trialing', created_at + interval '14 days' from tenants;
        alter table tenants force row level security;

        alter table tenants drop column plan_id;

        -- Global: one row per provider event, so a redelivered webhook is a no-op.
        create table billing_events (
          id           text primary key,
          provider     text not null,
          type         text not null,
          tenant_id    uuid references tenants (id) on delete set null,
          created_at   timestamptz not null,
          received_at  timestamptz not null default now()
        );

        alter table usage_periods
          add column notified_80_at timestamptz,
          add column notified_100_at timestamptz;

        alter table subscriptions enable row level security;
        alter table subscriptions force row level security;
        create policy tenant_isolation on subscriptions
          using (tenant_id = app_current_tenant())
          with check (tenant_id = app_current_tenant());
        create policy billing_customer_read on subscriptions for select
          using (provider_customer_id = app_current_billing_customer());

        grant select, insert, update on subscriptions to docent_app;
        grant select, insert on billing_events to docent_app;
        grant select on subscriptions to docent_worker;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table usage_periods drop column notified_80_at, drop column notified_100_at;
        drop table billing_events;
        alter table tenants add column plan_id text;
        drop table subscriptions;
        drop function app_current_billing_customer();
        """
    )
