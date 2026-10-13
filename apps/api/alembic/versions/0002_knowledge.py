"""Knowledge: sources, documents, and chunks with vector and keyword indexes.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-14
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table knowledge_sources (
          id              uuid primary key,
          tenant_id       uuid not null references tenants (id) on delete cascade,
          kind            text not null check (kind in ('upload', 'url', 'sitemap')),
          title           text not null check (char_length(title) between 1 and 200),
          uri             text check (char_length(uri) <= 2048),
          audience        text not null default 'public'
                          check (audience in ('public', 'identified')),
          status          text not null default 'queued'
                          check (status in ('queued', 'syncing', 'ready', 'failed', 'deleting')),
          last_error      text,
          page_limit      int not null default 50 check (page_limit between 1 and 1000),
          document_count  int not null default 0,
          chunk_count     int not null default 0,
          created_by      uuid references users (id) on delete set null,
          created_at      timestamptz not null default now(),
          updated_at      timestamptz not null default now(),
          last_synced_at  timestamptz
        );
        create index knowledge_sources_tenant_idx on knowledge_sources (tenant_id, created_at desc);

        create table documents (
          id            uuid primary key,
          tenant_id     uuid not null references tenants (id) on delete cascade,
          source_id     uuid not null references knowledge_sources (id) on delete cascade,
          locator       text not null check (char_length(locator) between 1 and 2048),
          title         text not null default '',
          url           text,
          mime          text not null,
          object_key    text,
          byte_size     bigint,
          content_hash  bytea,
          status        text not null default 'queued'
                        check (status in ('queued', 'parsing', 'embedding', 'ready', 'failed')),
          last_error    text,
          page_count    int,
          char_count    int,
          chunk_count   int not null default 0,
          created_at    timestamptz not null default now(),
          updated_at    timestamptz not null default now(),
          unique (source_id, locator)
        );
        create index documents_source_idx on documents (tenant_id, source_id);

        create table chunks (
          id               uuid primary key,
          tenant_id        uuid not null references tenants (id) on delete cascade,
          source_id        uuid not null references knowledge_sources (id) on delete cascade,
          document_id      uuid not null references documents (id) on delete cascade,
          ordinal          int not null,
          heading_path     text not null default '',
          content          text not null check (char_length(content) between 1 and 8000),
          token_count      int not null,
          page_from        int,
          page_to          int,
          audience         text not null check (audience in ('public', 'identified')),
          embedding        halfvec(768),
          embedding_model  text,
          tsv              tsvector generated always as
                           (to_tsvector('simple', heading_path || ' ' || content)) stored,
          created_at       timestamptz not null default now(),
          unique (document_id, ordinal)
        );
        create index chunks_document_idx on chunks (tenant_id, document_id);
        create index chunks_embedding_idx on chunks using hnsw (embedding halfvec_cosine_ops);
        create index chunks_tsv_idx on chunks using gin (tsv);

        alter table knowledge_sources enable row level security;
        alter table knowledge_sources force row level security;
        create policy tenant_isolation on knowledge_sources
          using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());

        alter table documents enable row level security;
        alter table documents force row level security;
        create policy tenant_isolation on documents
          using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());

        alter table chunks enable row level security;
        alter table chunks force row level security;
        create policy tenant_isolation on chunks
          using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());

        -- The API creates and edits sources and registers uploaded files; the
        -- worker does all parsing, chunking, embedding, and deletion.
        grant select, insert, update on knowledge_sources to docent_app;
        grant select, insert on documents to docent_app;
        grant select on chunks to docent_app;
        grant update (audience) on chunks to docent_app;
        grant select, insert, update, delete on knowledge_sources, documents, chunks
          to docent_worker;
        """
    )


def downgrade() -> None:
    op.execute("drop table if exists chunks, documents, knowledge_sources cascade;")
