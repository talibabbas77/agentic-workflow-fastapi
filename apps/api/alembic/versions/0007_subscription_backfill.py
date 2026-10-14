"""Give every tenant a subscription row.

0005 read tenants to start existing workspaces on a trial, but tenants forces
row-level security even for its owner, so that read saw no rows and those
workspaces were left without a subscription. This adds the missing rows.
Running it twice changes nothing.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-14
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table tenants no force row level security;
        alter table subscriptions no force row level security;
        insert into subscriptions (tenant_id, plan_id, status, trial_ends_at)
        select t.id, 'trial', 'trialing', greatest(t.created_at + interval '14 days', now())
        from tenants t
        where not exists (select 1 from subscriptions s where s.tenant_id = t.id);
        alter table subscriptions force row level security;
        alter table tenants force row level security;
        """
    )


def downgrade() -> None:
    """Nothing to undo: the rows are what 0005 meant to create."""
