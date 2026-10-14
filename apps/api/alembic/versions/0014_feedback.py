"""Customer feedback on answers, in-app notifications, delivery log retention, digest time zones.

- message_feedback: a visitor's "Was this helpful?" vote on one agent answer,
  up or down, with an optional note on what was wrong (500 characters at most).
  One row per answer: a message belongs to one conversation, which belongs to
  one visitor, so one vote per answer per visitor. Changing the vote updates
  the row; taking it back deletes it.
- notifications.channel gains 'in_app': the rows behind the bell in the admin
  app (a new handoff routed to a member, a handoff assigned to them). read_at
  is when the member read one. A partial index serves the unread count.
- Indexes on (tenant_id, created_at) for email_deliveries, webhook_deliveries,
  and notifications, so the daily retention job deletes old rows per workspace
  without scanning everything. The worker gains delete on those three tables.
- tenants.timezone: the workspace's IANA time zone (validated by the API with
  zoneinfo), UTC by default. The daily digest goes out at 08:00 there. The
  tenant_profiles view gains the column, so the digest scheduler reads it with
  the same app.scheduler capability as before.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-14
"""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table message_feedback (
          id               uuid primary key,
          tenant_id        uuid not null references tenants (id) on delete cascade,
          conversation_id  uuid not null references conversations (id) on delete cascade,
          message_id       uuid not null references messages (id) on delete cascade,
          end_user_id      uuid references end_users (id) on delete set null,
          visitor_id       text,
          vote             text not null check (vote in ('up', 'down')),
          comment          text not null default '' check (char_length(comment) <= 500),
          created_at       timestamptz not null default now(),
          updated_at       timestamptz not null default now(),
          unique (message_id),
          -- A note says what was wrong, so only a thumbs down carries one.
          check (vote = 'down' or comment = '')
        );
        create index message_feedback_conversation_idx
          on message_feedback (tenant_id, conversation_id);
        create index message_feedback_updated_idx on message_feedback (tenant_id, updated_at desc);

        alter table message_feedback enable row level security;
        alter table message_feedback force row level security;
        create policy tenant_isolation on message_feedback
          using (tenant_id = app_current_tenant())
          with check (tenant_id = app_current_tenant());

        alter table notifications drop constraint notifications_channel_check;
        alter table notifications add constraint notifications_channel_check
          check (channel in ('email', 'slack', 'in_app'));
        create index notifications_unread_idx on notifications (tenant_id, user_id)
          where channel = 'in_app' and read_at is null;
        create index notifications_created_idx on notifications (tenant_id, created_at);
        create index email_deliveries_created_idx on email_deliveries (tenant_id, created_at);
        create index webhook_deliveries_created_idx on webhook_deliveries (tenant_id, created_at);

        alter table tenants add column timezone text not null default 'UTC'
          check (char_length(timezone) between 1 and 64);
        create or replace view tenant_profiles as
          select id, name, status, timezone from tenants;

        -- The widget API records votes; the admin app reads them. The worker needs none.
        grant select, insert, update, delete on message_feedback to docent_app;
        -- Retention: the worker deletes old delivery logs and notifications.
        grant delete on email_deliveries, webhook_deliveries, notifications to docent_worker;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        revoke delete on email_deliveries, webhook_deliveries, notifications from docent_worker;

        drop view tenant_profiles;
        create view tenant_profiles as select id, name, status from tenants;
        grant select on tenant_profiles to docent_app, docent_worker;
        alter table tenants drop column timezone;

        drop index if exists webhook_deliveries_created_idx;
        drop index if exists email_deliveries_created_idx;
        drop index if exists notifications_created_idx;
        drop index if exists notifications_unread_idx;
        -- Forced row-level security filters even the owner: lift it for this one delete.
        alter table notifications no force row level security;
        delete from notifications where channel = 'in_app';
        alter table notifications force row level security;
        alter table notifications drop constraint notifications_channel_check;
        alter table notifications add constraint notifications_channel_check
          check (channel in ('email', 'slack'));

        drop table if exists message_feedback;
        """
    )
