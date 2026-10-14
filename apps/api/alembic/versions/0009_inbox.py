"""Inbox: read markers, notes, routing rules, notifications, email deliveries, webhooks.

- escalations gain a priority, updated_at (what "unread" compares against),
  routed_at (routing runs once), and the rule that routed them.
- messages gain the team member who wrote a human reply, and who marked an
  agent answer as wrong and why.
- escalation_reads: when each member last opened each handoff.
- escalation_notes: internal notes, never sent to the customer.
- routing_rules: ordered "when ... then ..." rules; the first match wins.
- notification_channels: Slack incoming webhooks. The URL is a secret, so it is
  stored encrypted (AES-GCM, key derived from SECRET_KEY) with a short hint.
- notifications: one row per recipient per event. Its unique dedupe key makes
  a second run of the same job send nothing (daily digests, new handoffs).
- email_deliveries: every email Docent sends for a workspace, with its status.
- webhooks, webhook_deliveries: outgoing signed events, with a delivery log.
  URL and signing secret are stored encrypted.
- notification_preferences: per member opt-outs.

Two views give the worker exactly what it needs from tenants and users without
any grant on those tables. Both are owned by docent_owner and read the tables
through their forced row-level security, so they show only the tenant in
app.tenant_id:

- tenant_profiles (id, name, status). The app.scheduler capability, honored by a
  policy that applies only through this view, lists every tenant's id and name
  so the digest scheduler can find the workspaces to summarize.
- member_contacts (tenant_id, user_id, email, name, role): the current tenant's
  members, never password hashes or other tenants.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-14
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

NEW_TABLES = (
    "escalation_reads",
    "escalation_notes",
    "notification_channels",
    "notifications",
    "email_deliveries",
    "routing_rules",
    "webhooks",
    "webhook_deliveries",
    "notification_preferences",
)


def upgrade() -> None:
    op.execute(
        """
        create function app_current_scheduler() returns boolean
          language sql stable parallel safe
          as $$ select coalesce(current_setting('app.scheduler', true) = 'digest', false) $$;

        alter table escalations
          add column priority text not null default 'normal'
            check (priority in ('low', 'normal', 'high', 'urgent')),
          add column updated_at timestamptz not null default now(),
          add column routed_at timestamptz;

        -- Existing handoffs: priority from their type, last change from their timeline,
        -- and marked as routed so nothing is sent for them now. Both tables force
        -- row-level security even for their owner, so lift it for this one update.
        alter table escalations no force row level security;
        alter table ticket_types no force row level security;
        update escalations e
        set priority = coalesce(
              (select t.priority from ticket_types t where t.id = e.ticket_type_id), 'normal'),
            updated_at = greatest(e.created_at, e.first_response_at, e.resolved_at),
            routed_at = e.created_at;
        alter table ticket_types force row level security;
        alter table escalations force row level security;
        create index escalations_updated_idx on escalations (tenant_id, updated_at desc);
        create index escalations_assignee_idx on escalations (tenant_id, assignee_user_id, status);
        -- The assignment and status history of one handoff comes from the audit log.
        create index audit_log_target_idx on audit_log (tenant_id, target_type, target_id);

        alter table messages
          add column author_user_id uuid references users (id) on delete set null,
          add column flag_reason text check (char_length(flag_reason) <= 500),
          add column flagged_by uuid references users (id) on delete set null,
          add column flagged_at timestamptz;
        create index messages_flagged_idx on messages (tenant_id, flagged_at)
          where flagged_wrong;

        create table escalation_reads (
          tenant_id      uuid not null references tenants (id) on delete cascade,
          user_id        uuid not null references users (id) on delete cascade,
          escalation_id  uuid not null references escalations (id) on delete cascade,
          read_at        timestamptz not null default now(),
          primary key (user_id, escalation_id)
        );
        create index escalation_reads_tenant_idx on escalation_reads (tenant_id, user_id);

        create table escalation_notes (
          id              uuid primary key,
          tenant_id       uuid not null references tenants (id) on delete cascade,
          escalation_id   uuid not null references escalations (id) on delete cascade,
          author_user_id  uuid references users (id) on delete set null,
          body            text not null check (char_length(body) between 1 and 4000),
          created_at      timestamptz not null default now()
        );
        create index escalation_notes_escalation_idx
          on escalation_notes (tenant_id, escalation_id, created_at);

        create table notification_channels (
          id                uuid primary key,
          tenant_id         uuid not null references tenants (id) on delete cascade,
          kind              text not null default 'slack_webhook'
                            check (kind in ('slack_webhook')),
          name              text not null check (char_length(name) between 1 and 80),
          target_encrypted  bytea not null,
          target_hint       text not null,
          events            text[] not null default '{escalation.created}',
          active            boolean not null default true,
          created_by        uuid references users (id) on delete set null,
          created_at        timestamptz not null default now(),
          updated_at        timestamptz not null default now()
        );
        create index notification_channels_tenant_idx on notification_channels (tenant_id);

        create table webhooks (
          id                uuid primary key,
          tenant_id         uuid not null references tenants (id) on delete cascade,
          description       text not null default '' check (char_length(description) <= 200),
          url_encrypted     bytea not null,
          url_hint          text not null,
          secret_encrypted  bytea not null,
          secret_hint       text not null,
          events            text[] not null default '{}',
          active            boolean not null default true,
          created_by        uuid references users (id) on delete set null,
          created_at        timestamptz not null default now(),
          updated_at        timestamptz not null default now()
        );
        create index webhooks_tenant_idx on webhooks (tenant_id);

        create table routing_rules (
          id                 uuid primary key,
          tenant_id          uuid not null references tenants (id) on delete cascade,
          name               text not null check (char_length(name) between 1 and 80),
          position           int not null,
          active             boolean not null default true,
          ticket_type_ids    uuid[] not null default '{}',
          reasons            text[] not null default '{}',
          claim_conditions   jsonb not null default '[]',
          assign_user_id     uuid references users (id) on delete set null,
          set_priority       text check (set_priority in ('low', 'normal', 'high', 'urgent')),
          notify_emails      text[] not null default '{}',
          notify_channel_id  uuid references notification_channels (id) on delete set null,
          webhook_id         uuid references webhooks (id) on delete set null,
          created_by         uuid references users (id) on delete set null,
          created_at         timestamptz not null default now(),
          updated_at         timestamptz not null default now()
        );
        create index routing_rules_order_idx on routing_rules (tenant_id, position);

        alter table escalations
          add column routed_by_rule_id uuid references routing_rules (id) on delete set null;

        create table email_deliveries (
          id                   uuid primary key,
          tenant_id            uuid not null references tenants (id) on delete cascade,
          escalation_id        uuid references escalations (id) on delete set null,
          message_id           uuid references messages (id) on delete set null,
          kind                 text not null check (kind in ('reply', 'notification', 'digest')),
          to_hash              text not null,
          to_hint              text not null,
          subject              text not null,
          status               text not null default 'queued'
                               check (status in ('queued', 'sent', 'retrying', 'dead')),
          attempts             int not null default 0,
          provider_message_id  text,
          last_error           text,
          created_at           timestamptz not null default now(),
          updated_at           timestamptz not null default now(),
          sent_at              timestamptz
        );
        create index email_deliveries_escalation_idx
          on email_deliveries (tenant_id, escalation_id, created_at);
        create index email_deliveries_message_idx on email_deliveries (message_id);

        create table notifications (
          id                 uuid primary key,
          tenant_id          uuid not null references tenants (id) on delete cascade,
          kind               text not null
                             check (kind in ('new_handoff', 'assigned', 'daily_digest', 'test')),
          channel            text not null check (channel in ('email', 'slack')),
          escalation_id      uuid references escalations (id) on delete cascade,
          user_id            uuid references users (id) on delete cascade,
          channel_id         uuid references notification_channels (id) on delete cascade,
          email_delivery_id  uuid references email_deliveries (id) on delete set null,
          dedupe_key         text not null,
          payload            jsonb not null default '{}',
          status             text not null default 'queued'
                             check (status in ('queued', 'sent', 'retrying', 'dead', 'skipped')),
          attempts           int not null default 0,
          last_error         text,
          created_at         timestamptz not null default now(),
          sent_at            timestamptz,
          read_at            timestamptz,
          unique (tenant_id, dedupe_key)
        );
        create index notifications_channel_idx on notifications (tenant_id, channel_id, created_at desc);
        create index notifications_user_idx on notifications (tenant_id, user_id, created_at desc);

        create table webhook_deliveries (
          id               uuid primary key,
          tenant_id        uuid not null references tenants (id) on delete cascade,
          webhook_id       uuid not null references webhooks (id) on delete cascade,
          event_id         text not null,
          event_type       text not null,
          escalation_id    uuid references escalations (id) on delete set null,
          payload          jsonb not null,
          status           text not null default 'queued'
                           check (status in ('queued', 'retrying', 'succeeded', 'dead')),
          attempts         int not null default 0,
          max_attempts     int not null default 5,
          response_status  int,
          response_ms      int,
          last_error       text,
          next_attempt_at  timestamptz,
          created_at       timestamptz not null default now(),
          updated_at       timestamptz not null default now(),
          delivered_at     timestamptz,
          unique (webhook_id, event_id)
        );
        create index webhook_deliveries_webhook_idx
          on webhook_deliveries (tenant_id, webhook_id, created_at desc);

        create table notification_preferences (
          tenant_id       uuid not null references tenants (id) on delete cascade,
          user_id         uuid not null references users (id) on delete cascade,
          daily_digest    boolean not null default true,
          assigned_email  boolean not null default true,
          updated_at      timestamptz not null default now(),
          primary key (tenant_id, user_id)
        );
        """
    )
    for table in NEW_TABLES:
        op.execute(
            f"""
            alter table {table} enable row level security;
            alter table {table} force row level security;
            create policy tenant_isolation on {table}
              using (tenant_id = app_current_tenant())
              with check (tenant_id = app_current_tenant());
            """
        )
    op.execute(
        """
        -- Read through the views below only: the policy names the view owner, so a
        -- role reading tenants directly never matches it.
        create policy scheduler_read on tenants for select to docent_owner
          using (app_current_scheduler());

        create view tenant_profiles as
          select id, name, status from tenants;

        create view member_contacts as
          select m.tenant_id, m.user_id, u.email, u.name, m.role
          from memberships m join users u on u.id = m.user_id;

        grant select on tenant_profiles, member_contacts to docent_app, docent_worker;

        grant select, insert, update, delete on escalation_reads, notification_channels,
          routing_rules, webhooks to docent_app;
        grant select, insert, delete on escalation_notes to docent_app;
        grant select, insert, update on notifications, email_deliveries, webhook_deliveries,
          notification_preferences to docent_app;

        -- The worker routes handoffs and sends email, Slack messages, and webhooks.
        grant select on routing_rules, notification_channels, webhooks,
          notification_preferences to docent_worker;
        grant select, insert, update on notifications, email_deliveries, webhook_deliveries
          to docent_worker;
        grant insert on audit_log to docent_worker;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        revoke insert on audit_log from docent_worker;
        drop view if exists member_contacts, tenant_profiles;
        drop policy if exists scheduler_read on tenants;
        alter table escalations drop column if exists routed_by_rule_id;
        drop table if exists notification_preferences, webhook_deliveries, notifications,
          email_deliveries, routing_rules, webhooks, notification_channels, escalation_notes,
          escalation_reads;
        drop index if exists messages_flagged_idx;
        alter table messages drop column if exists author_user_id,
          drop column if exists flag_reason, drop column if exists flagged_by,
          drop column if exists flagged_at;
        drop index if exists escalations_updated_idx;
        drop index if exists escalations_assignee_idx;
        drop index if exists audit_log_target_idx;
        alter table escalations drop column if exists priority,
          drop column if exists updated_at, drop column if exists routed_at;
        drop function if exists app_current_scheduler();
        """
    )
