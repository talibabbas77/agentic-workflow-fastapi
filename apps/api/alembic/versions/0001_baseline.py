"""Baseline: tenancy, staff auth, audit log, job queue.

Every tenant table gets RLS enabled and forced in the same migration that
creates it. The catalog test in tests/test_rls_catalog.py enforces this.

Revision ID: 0001
Revises:
Create Date: 2026-10-14
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- RLS context helpers. Unset or empty settings yield null, so policies fail closed.
        create function app_current_tenant() returns uuid
          language sql stable parallel safe
          as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

        create function app_current_user() returns uuid
          language sql stable parallel safe
          as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

        create function app_current_invite_token() returns bytea
          language sql stable parallel safe
          as $$ select decode(nullif(current_setting('app.invite_token', true), ''), 'hex') $$;

        create table tenants (
          id          uuid primary key,
          name        text not null check (char_length(name) between 1 and 120),
          slug        text not null unique
                      check (slug ~ '^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$'),
          status      text not null default 'active'
                      check (status in ('active', 'suspended', 'deleted')),
          plan_id     text,
          settings    jsonb not null default '{}',
          created_at  timestamptz not null default now(),
          updated_at  timestamptz not null default now(),
          deleted_at  timestamptz
        );

        create table users (
          id                 uuid primary key,
          email              text not null check (char_length(email) between 3 and 254),
          password_hash      text not null,
          name               text not null check (char_length(name) between 1 and 120),
          email_verified_at  timestamptz,
          last_login_at      timestamptz,
          created_at         timestamptz not null default now(),
          updated_at         timestamptz not null default now()
        );
        create unique index users_email_key on users (lower(email));

        create table memberships (
          tenant_id   uuid not null references tenants (id) on delete cascade,
          user_id     uuid not null references users (id) on delete cascade,
          role        text not null check (role in ('owner', 'admin', 'agent')),
          created_at  timestamptz not null default now(),
          primary key (tenant_id, user_id)
        );
        create index memberships_user_idx on memberships (user_id);

        create table user_sessions (
          token_hash        bytea primary key,
          user_id           uuid not null references users (id) on delete cascade,
          active_tenant_id  uuid references tenants (id) on delete set null,
          ip_hash           text,
          user_agent        text,
          created_at        timestamptz not null default now(),
          last_seen_at      timestamptz not null default now(),
          expires_at        timestamptz not null,
          revoked_at        timestamptz
        );
        create index user_sessions_user_idx on user_sessions (user_id);

        create table auth_tokens (
          token_hash  bytea primary key,
          user_id     uuid not null references users (id) on delete cascade,
          purpose     text not null check (purpose in ('verify_email', 'reset_password')),
          created_at  timestamptz not null default now(),
          expires_at  timestamptz not null,
          used_at     timestamptz
        );
        create index auth_tokens_user_idx on auth_tokens (user_id, purpose);

        create table invitations (
          id           uuid primary key,
          tenant_id    uuid not null references tenants (id) on delete cascade,
          email        text not null check (char_length(email) between 3 and 254),
          role         text not null check (role in ('owner', 'admin', 'agent')),
          token_hash   bytea not null unique,
          invited_by   uuid references users (id) on delete set null,
          created_at   timestamptz not null default now(),
          expires_at   timestamptz not null,
          accepted_at  timestamptz,
          revoked_at   timestamptz
        );
        create index invitations_open_idx on invitations (tenant_id, lower(email))
          where accepted_at is null and revoked_at is null;

        create table audit_log (
          id             uuid primary key,
          tenant_id      uuid not null references tenants (id) on delete cascade,
          actor_user_id  uuid references users (id) on delete set null,
          action         text not null,
          target_type    text,
          target_id      text,
          metadata       jsonb not null default '{}',
          created_at     timestamptz not null default now()
        );
        create index audit_log_tenant_idx on audit_log (tenant_id, created_at desc);

        -- Durable job queue. System table: no RLS, tenant context is set per job.
        create table jobs (
          id            bigint generated always as identity primary key,
          tenant_id     uuid references tenants (id) on delete cascade,
          kind          text not null,
          payload       jsonb not null default '{}',
          status        text not null default 'queued'
                        check (status in ('queued', 'running', 'succeeded', 'failed', 'dead')),
          priority      smallint not null default 100,
          run_at        timestamptz not null default now(),
          attempts      int not null default 0,
          max_attempts  int not null default 5,
          locked_by     text,
          lease_until   timestamptz,
          last_error    text,
          dedupe_key    text,
          created_at    timestamptz not null default now(),
          finished_at   timestamptz
        );
        create index jobs_ready_idx on jobs (priority, run_at) where status = 'queued';
        create index jobs_lease_idx on jobs (lease_until) where status = 'running';
        create unique index jobs_dedupe_idx on jobs (dedupe_key)
          where dedupe_key is not null and status in ('queued', 'running');

        -- Row-level security
        alter table tenants enable row level security;
        alter table tenants force row level security;
        create policy tenant_isolation on tenants
          using (id = app_current_tenant()) with check (id = app_current_tenant());
        create policy member_read on tenants for select
          using (id in (select m.tenant_id from memberships m where m.user_id = app_current_user()));
        create policy invite_read on tenants for select
          using (id in (select i.tenant_id from invitations i
                        where i.token_hash = app_current_invite_token()));

        alter table memberships enable row level security;
        alter table memberships force row level security;
        create policy tenant_isolation on memberships
          using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
        create policy own_read on memberships for select
          using (user_id = app_current_user());

        alter table invitations enable row level security;
        alter table invitations force row level security;
        create policy tenant_isolation on invitations
          using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
        create policy token_read on invitations for select
          using (token_hash = app_current_invite_token());

        alter table audit_log enable row level security;
        alter table audit_log force row level security;
        create policy tenant_isolation on audit_log
          using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());

        -- Grants. Least privilege, explicit per table.
        grant select, insert, update, delete on tenants, users, memberships, user_sessions,
          auth_tokens, invitations to docent_app;
        grant select, insert on audit_log to docent_app;
        grant select, insert on jobs to docent_app;
        grant select, insert, update, delete on jobs to docent_worker;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop table if exists jobs, audit_log, invitations, auth_tokens, user_sessions,
          memberships, users, tenants cascade;
        drop function if exists app_current_invite_token();
        drop function if exists app_current_user();
        drop function if exists app_current_tenant();
        """
    )
