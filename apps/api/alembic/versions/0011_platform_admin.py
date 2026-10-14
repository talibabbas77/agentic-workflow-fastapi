"""Platform admin console: who may open it, what it reads, and what it may change.

- users.is_platform_admin: Docent's own operators. Granted and revoked only
  from the command line (`docent admin grant|revoke <email>`); no screen and no
  API route can set it.
- app.platform_admin: a capability setting, like app.billing_customer. The API
  sets it only after it checked that the signed-in user has the flag and a
  verified email. A select-only policy on each table the console reads honors
  it, so the console sees every workspace without BYPASSRLS. The setting never
  grants a write: a change to a workspace runs in that workspace's own tenant
  context and passes the usual tenant_isolation check.
- subscriptions.comped_until: a paid plan Docent gave by hand (provider
  'manual'), free of charge until this time. When it passes, the workspace
  stops answering, the same as an ended trial.
- billing_events.outcome: what applying a Stripe event did (applied, ignored,
  stale, unknown_customer). Events received before this migration have none.
- jobs: the API may put a dead job back in the queue, so it may update the
  columns a retry resets. It still cannot delete jobs.

Nothing here reads or backfills tenant rows, so forced RLS stays on throughout.

Revision ID: 0011
Revises: 0008
Create Date: 2026-10-14
"""

from alembic import op

revision = "0011"
down_revision = "0008"
branch_labels = None
depends_on = None

# Exactly the tables the console reads. Message, knowledge, and memory content
# tables are not here: the console shows counts and metadata only.
CONSOLE_TABLES = (
    "tenants",
    "memberships",
    "subscriptions",
    "usage_periods",
    "usage_events",
    "widgets",
    "knowledge_sources",
    "documents",
    "conversations",
    "escalations",
    "audit_log",
)


def upgrade() -> None:
    op.execute(
        """
        alter table users add column is_platform_admin boolean not null default false;

        -- Set to 'on' by the API for one transaction, after it verified the user.
        create function app_platform_admin() returns boolean
          language sql stable parallel safe
          as $$ select coalesce(current_setting('app.platform_admin', true), '') = 'on' $$;

        alter table subscriptions add column comped_until timestamptz;

        alter table billing_events add column outcome text
          check (outcome in ('applied', 'ignored', 'stale', 'unknown_customer'));
        grant update (outcome) on billing_events to docent_app;

        grant update (status, attempts, run_at, locked_by, finished_at) on jobs to docent_app;
        """
    )
    for table in CONSOLE_TABLES:
        op.execute(
            f"create policy platform_admin_read on {table} for select using (app_platform_admin());"
        )


def downgrade() -> None:
    for table in CONSOLE_TABLES:
        op.execute(f"drop policy platform_admin_read on {table};")
    op.execute(
        """
        revoke update (status, attempts, run_at, locked_by, finished_at) on jobs from docent_app;
        revoke update (outcome) on billing_events from docent_app;
        alter table billing_events drop column outcome;
        alter table subscriptions drop column comped_until;
        drop function app_platform_admin();
        alter table users drop column is_platform_admin;
        """
    )
