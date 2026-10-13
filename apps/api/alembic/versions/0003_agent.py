"""Agent: ticket types, conversations, messages, citations, escalations, usage metering.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-14
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table ticket_types (
          id             uuid primary key,
          tenant_id      uuid not null references tenants (id) on delete cascade,
          name           text not null check (char_length(name) between 1 and 80),
          description    text not null check (char_length(description) between 1 and 500),
          fields         jsonb not null default '[]',
          notify_emails  text[] not null default '{}',
          priority       text not null default 'normal'
                         check (priority in ('low', 'normal', 'high', 'urgent')),
          active         boolean not null default true,
          created_at     timestamptz not null default now(),
          updated_at     timestamptz not null default now()
        );
        create unique index ticket_types_name_key on ticket_types (tenant_id, lower(name));

        create table conversations (
          id                   uuid primary key,
          tenant_id            uuid not null references tenants (id) on delete cascade,
          channel              text not null check (channel in ('preview', 'widget')),
          mode                 text not null check (mode in ('anonymous', 'identified')),
          claims               jsonb not null default '{}',
          staff_user_id        uuid references users (id) on delete set null,
          visitor_id           text,
          status               text not null default 'open'
                               check (status in ('open', 'escalated', 'closed')),
          low_confidence_turns int not null default 0,
          started_at           timestamptz not null default now(),
          last_message_at      timestamptz not null default now(),
          closed_at            timestamptz
        );
        create index conversations_tenant_idx on conversations (tenant_id, last_message_at desc);

        create table messages (
          id               uuid primary key,
          tenant_id        uuid not null references tenants (id) on delete cascade,
          conversation_id  uuid not null references conversations (id) on delete cascade,
          role             text not null check (role in ('visitor', 'agent', 'human', 'system')),
          content          text not null check (char_length(content) between 1 and 8000),
          decision         jsonb,
          model            text,
          prompt_version   text,
          tokens_in        int,
          tokens_out       int,
          latency_ms       int,
          flagged_wrong    boolean not null default false,
          created_at       timestamptz not null default now()
        );
        create index messages_conversation_idx on messages (tenant_id, conversation_id, created_at);

        create table message_citations (
          id              uuid primary key,
          tenant_id       uuid not null references tenants (id) on delete cascade,
          message_id      uuid not null references messages (id) on delete cascade,
          marker          int not null,
          chunk_id        uuid references chunks (id) on delete set null,
          document_title  text not null,
          heading_path    text not null default '',
          url             text,
          excerpt         text not null,
          score           real
        );
        create index message_citations_message_idx on message_citations (tenant_id, message_id);

        create table escalations (
          id                 uuid primary key,
          tenant_id          uuid not null references tenants (id) on delete cascade,
          conversation_id    uuid not null references conversations (id) on delete cascade,
          ticket_type_id     uuid references ticket_types (id) on delete set null,
          reason             text not null check (reason in ('no_source', 'low_confidence',
                             'user_requested', 'restricted_topic', 'repeated_failure',
                             'cap_reached')),
          fields             jsonb not null default '{}',
          summary            jsonb,
          contact_email      text,
          status             text not null default 'open'
                             check (status in ('open', 'assigned', 'waiting', 'resolved')),
          assignee_user_id   uuid references users (id) on delete set null,
          created_at         timestamptz not null default now(),
          first_response_at  timestamptz,
          resolved_at        timestamptz
        );
        create index escalations_tenant_idx on escalations (tenant_id, status, created_at desc);

        create table usage_events (
          id               uuid primary key,
          tenant_id        uuid not null references tenants (id) on delete cascade,
          kind             text not null check (kind in ('ai_reply', 'llm_call', 'embedding')),
          quantity         int not null default 1,
          model            text,
          tokens_in        int not null default 0,
          tokens_out       int not null default 0,
          cost_micros      bigint not null default 0,
          conversation_id  uuid references conversations (id) on delete set null,
          message_id       uuid references messages (id) on delete set null,
          idempotency_key  text not null unique,
          occurred_at      timestamptz not null default now()
        );
        create index usage_events_tenant_idx on usage_events (tenant_id, occurred_at);

        create table usage_periods (
          tenant_id         uuid not null references tenants (id) on delete cascade,
          period_start      date not null,
          period_end        date not null,
          replies_cap       int not null,
          replies_used      int not null default 0,
          replies_reserved  int not null default 0,
          cost_micros       bigint not null default 0,
          primary key (tenant_id, period_start),
          check (replies_used >= 0 and replies_reserved >= 0)
        );

        -- Global: list prices per million tokens, in micro dollars.
        create table model_prices (
          model                   text not null,
          input_micros_per_mtok   bigint not null,
          output_micros_per_mtok  bigint not null,
          effective_from          timestamptz not null default now(),
          primary key (model, effective_from)
        );
        insert into model_prices (model, input_micros_per_mtok, output_micros_per_mtok,
                                  effective_from) values
          ('gemma4:cloud', 140000, 400000, '2026-01-01'),
          ('qwen3:1.7b', 0, 0, '2026-01-01'),
          ('embeddinggemma', 0, 0, '2026-01-01');
        """
    )
    for table in (
        "ticket_types",
        "conversations",
        "messages",
        "message_citations",
        "escalations",
        "usage_events",
        "usage_periods",
    ):
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
        grant select, insert, update, delete on ticket_types to docent_app;
        grant select, insert, update on conversations, messages, escalations, usage_periods
          to docent_app;
        grant select, insert on message_citations, usage_events to docent_app;
        grant select on model_prices to docent_app, docent_worker;
        grant select on ticket_types, conversations, messages, message_citations to docent_worker;
        grant select, update on escalations to docent_worker;
        grant select, insert on usage_events to docent_worker;
        grant select, update on usage_periods to docent_worker;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop table if exists model_prices, usage_periods, usage_events, escalations,
          message_citations, messages, conversations, ticket_types cascade;
        """
    )
