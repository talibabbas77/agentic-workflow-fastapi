"""Agent memory: team answers, knowledge gaps, customer memory, knowledge version.

- team_answers: question and answer pairs the team writes. Each one is a
  knowledge source of kind 'answer' with one document, so it is chunked,
  embedded, searched, and cited like any help article.
- knowledge_gaps: product questions the agent could not answer, with the query
  vector retrieval already computed, so similar gaps can be grouped.
- customer_memories: short facts about an identified customer, written by a
  worker job from their conversations, kept 90 days.
- knowledge_versions: one counter per tenant, bumped whenever what the agent
  can find changes, so answers cached under the old number expire at once. Its
  own table, so the worker needs no access to tenants.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-14
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table knowledge_versions (
          tenant_id  uuid primary key references tenants (id) on delete cascade,
          version    bigint not null default 0
        );

        alter table knowledge_sources drop constraint knowledge_sources_kind_check;
        alter table knowledge_sources add constraint knowledge_sources_kind_check
          check (kind in ('upload', 'url', 'sitemap', 'answer'));

        create table team_answers (
          id          uuid primary key,
          tenant_id   uuid not null references tenants (id) on delete cascade,
          source_id   uuid not null unique references knowledge_sources (id) on delete cascade,
          question    text not null check (char_length(question) between 3 and 300),
          answer      text not null check (char_length(answer) between 1 and 4000),
          created_by  uuid references users (id) on delete set null,
          created_at  timestamptz not null default now(),
          updated_at  timestamptz not null default now()
        );
        create index team_answers_tenant_idx on team_answers (tenant_id, updated_at desc);

        create table knowledge_gaps (
          id               uuid primary key,
          tenant_id        uuid not null references tenants (id) on delete cascade,
          question         text not null check (char_length(question) between 1 and 2000),
          embedding        halfvec(768),
          conversation_id  uuid references conversations (id) on delete set null,
          answered_by      uuid references team_answers (id) on delete set null,
          dismissed_at     timestamptz,
          created_at       timestamptz not null default now()
        );
        create index knowledge_gaps_tenant_idx on knowledge_gaps (tenant_id, created_at desc);

        create table customer_memories (
          id               uuid primary key,
          tenant_id        uuid not null references tenants (id) on delete cascade,
          end_user_id      uuid not null references end_users (id) on delete cascade,
          fact             text not null check (char_length(fact) between 3 and 300),
          kind             text not null check (kind in ('preference', 'context', 'issue')),
          conversation_id  uuid references conversations (id) on delete set null,
          created_at       timestamptz not null default now(),
          expires_at       timestamptz not null default now() + interval '90 days'
        );
        create index customer_memories_user_idx
          on customer_memories (tenant_id, end_user_id, created_at desc);
        """
    )
    for table in ("knowledge_versions", "team_answers", "knowledge_gaps", "customer_memories"):
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
        grant select, insert, update on knowledge_versions to docent_app, docent_worker;
        grant select, insert, update, delete on team_answers to docent_app;
        grant select, insert, update on knowledge_gaps to docent_app;
        grant select, delete on customer_memories to docent_app;

        grant select on end_users to docent_worker;
        grant select, insert, delete on customer_memories to docent_worker;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        revoke select on end_users from docent_worker;
        drop table customer_memories, knowledge_gaps, team_answers, knowledge_versions;
        delete from knowledge_sources where kind = 'answer';
        alter table knowledge_sources drop constraint knowledge_sources_kind_check;
        alter table knowledge_sources add constraint knowledge_sources_kind_check
          check (kind in ('upload', 'url', 'sitemap'));
        """
    )
