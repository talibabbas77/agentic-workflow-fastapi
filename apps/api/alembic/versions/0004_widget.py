"""Widget: widgets, signing keys, end users, widget sessions.

Two capability settings let unauthenticated widget requests read exactly one
row before the tenant is known: app.widget_public_id (one widget and its keys)
and app.widget_session (one session by token hash). Nothing bypasses RLS.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-14
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create function app_current_widget() returns text
          language sql stable parallel safe
          as $$ select nullif(current_setting('app.widget_public_id', true), '') $$;

        create function app_current_widget_session() returns bytea
          language sql stable parallel safe
          as $$ select decode(nullif(current_setting('app.widget_session', true), ''), 'hex') $$;

        create table widgets (
          id                   uuid primary key,
          public_id            text not null unique check (public_id ~ '^wid_[A-Za-z0-9]{16}$'),
          tenant_id            uuid not null references tenants (id) on delete cascade,
          name                 text not null check (char_length(name) between 1 and 80),
          allowed_origins      text[] not null default '{}',
          anonymous_enabled    boolean not null default true,
          anonymous_daily_cap  int not null default 200 check (anonymous_daily_cap >= 0),
          allowed_claims       text[] not null default '{}',
          greeting             text not null default '' check (char_length(greeting) <= 200),
          created_at           timestamptz not null default now(),
          updated_at           timestamptz not null default now()
        );
        create index widgets_tenant_idx on widgets (tenant_id);

        create table signing_keys (
          kid         text primary key check (kid ~ '^key_[A-Za-z0-9]{12}$'),
          tenant_id   uuid not null references tenants (id) on delete cascade,
          widget_id   uuid not null references widgets (id) on delete cascade,
          public_jwk  jsonb not null,
          status      text not null default 'active' check (status in ('active', 'retired')),
          created_at  timestamptz not null default now(),
          retired_at  timestamptz
        );
        create index signing_keys_widget_idx on signing_keys (widget_id);

        create table end_users (
          id             uuid primary key,
          tenant_id      uuid not null references tenants (id) on delete cascade,
          external_id    text not null check (char_length(external_id) between 1 and 255),
          email          text,
          name           text,
          claims         jsonb not null default '{}',
          first_seen_at  timestamptz not null default now(),
          last_seen_at   timestamptz not null default now(),
          unique (tenant_id, external_id)
        );

        create table widget_sessions (
          token_hash     bytea primary key,
          tenant_id      uuid not null references tenants (id) on delete cascade,
          widget_id      uuid not null references widgets (id) on delete cascade,
          mode           text not null check (mode in ('anonymous', 'identified')),
          end_user_id    uuid references end_users (id) on delete cascade,
          visitor_id     text,
          jti            text,
          parent_origin  text not null,
          ip_hash        text,
          created_at     timestamptz not null default now(),
          expires_at     timestamptz not null,
          revoked_at     timestamptz
        );
        create unique index widget_sessions_jti_key on widget_sessions (widget_id, jti)
          where jti is not null;
        create index widget_sessions_expiry_idx on widget_sessions (expires_at);

        alter table conversations
          add column widget_id uuid references widgets (id) on delete set null,
          add column end_user_id uuid references end_users (id) on delete set null;
        create index conversations_end_user_idx on conversations (tenant_id, end_user_id, last_message_at desc);
        create index conversations_visitor_idx on conversations (tenant_id, visitor_id);
        """
    )
    for table in ("widgets", "signing_keys", "end_users", "widget_sessions"):
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
        create policy public_id_read on widgets for select
          using (public_id = app_current_widget());
        create policy widget_keys_read on signing_keys for select
          using (widget_id in (select w.id from widgets w where w.public_id = app_current_widget()));
        create policy session_read on widget_sessions for select
          using (token_hash = app_current_widget_session());

        grant select, insert, update, delete on widgets, signing_keys to docent_app;
        grant select, insert, update on end_users, widget_sessions to docent_app;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table conversations drop column if exists widget_id, drop column if exists end_user_id;
        drop table if exists widget_sessions, end_users, signing_keys, widgets cascade;
        drop function if exists app_current_widget_session();
        drop function if exists app_current_widget();
        """
    )
