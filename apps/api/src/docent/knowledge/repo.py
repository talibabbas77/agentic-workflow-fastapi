"""SQL for knowledge sources, documents, and chunks. Callers set tenant context."""

import uuid
from collections.abc import Sequence

import asyncpg

from docent.db.pool import Connection
from docent.ids import new_id
from docent.knowledge.chunking import Passage
from docent.knowledge.embeddings import to_pgvector

SOURCE_COLUMNS = """
    id, kind, title, uri, audience, status, last_error, page_limit, document_count,
    chunk_count, created_at, updated_at, last_synced_at
"""
BUSY = ("queued", "parsing", "embedding")


async def create_source(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    kind: str,
    title: str,
    uri: str | None,
    audience: str,
    page_limit: int,
    created_by: uuid.UUID,
    source_id: uuid.UUID | None = None,
) -> uuid.UUID:
    source_id = source_id or new_id()
    await conn.execute(
        """
        insert into knowledge_sources (id, tenant_id, kind, title, uri, audience, page_limit,
                                       created_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        source_id,
        tenant_id,
        kind,
        title,
        uri,
        audience,
        page_limit,
        created_by,
    )
    return source_id


async def get_source(conn: Connection, source_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        f"select {SOURCE_COLUMNS} from knowledge_sources where id = $1",  # noqa: S608
        source_id,
    )


async def list_sources(conn: Connection) -> list[asyncpg.Record]:
    """Help articles and pages. Team answers live under memory, not here."""
    return await conn.fetch(
        f"select {SOURCE_COLUMNS} from knowledge_sources"  # noqa: S608
        " where kind <> 'answer' order by created_at desc"
    )


async def bump_knowledge_version(conn: Connection) -> None:
    """What the agent can find changed, so answers cached under the old version expire."""
    await conn.execute(
        """
        insert into knowledge_versions (tenant_id, version) values (app_current_tenant(), 1)
        on conflict (tenant_id) do update set version = knowledge_versions.version + 1
        """
    )


async def knowledge_version(conn: Connection) -> int:
    return int(await conn.fetchval("select coalesce(max(version), 0) from knowledge_versions"))


async def update_source(
    conn: Connection, source_id: uuid.UUID, *, title: str | None, audience: str | None
) -> None:
    await conn.execute(
        """
        update knowledge_sources
        set title = coalesce($2, title), audience = coalesce($3, audience), updated_at = now()
        where id = $1
        """,
        source_id,
        title,
        audience,
    )
    await bump_knowledge_version(conn)
    if audience is not None:
        await conn.execute(
            "update chunks set audience = $2 where source_id = $1 and audience <> $2",
            source_id,
            audience,
        )


async def set_source_status(
    conn: Connection, source_id: uuid.UUID, status: str, error: str | None = None
) -> None:
    await conn.execute(
        """
        update knowledge_sources set status = $2, last_error = $3, updated_at = now()
        where id = $1
        """,
        source_id,
        status,
        error,
    )


async def tenant_document_count(conn: Connection) -> int:
    return int(await conn.fetchval("select count(*) from documents"))


async def create_document(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    source_id: uuid.UUID,
    locator: str,
    title: str,
    url: str | None,
    mime: str,
    object_key: str | None = None,
    byte_size: int | None = None,
    document_id: uuid.UUID | None = None,
) -> uuid.UUID:
    document_id = document_id or new_id()
    await conn.execute(
        """
        insert into documents (id, tenant_id, source_id, locator, title, url, mime, object_key,
                               byte_size)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """,
        document_id,
        tenant_id,
        source_id,
        locator,
        title,
        url,
        mime,
        object_key,
        byte_size,
    )
    return document_id


async def sync_url_documents(
    conn: Connection, *, tenant_id: uuid.UUID, source_id: uuid.UUID, urls: Sequence[str]
) -> list[uuid.UUID]:
    """Make the source's documents match the URL list. Returns ids to parse."""
    await conn.execute(
        "delete from documents where source_id = $1 and not (locator = any($2::text[]))",
        source_id,
        list(urls),
    )
    ids: list[uuid.UUID] = []
    for url in urls:
        document_id: uuid.UUID = await conn.fetchval(
            """
            insert into documents (id, tenant_id, source_id, locator, url, mime, status)
            values ($1, $2, $3, $4, $4, 'text/html', 'queued')
            on conflict (source_id, locator) do update
              set status = 'queued', last_error = null, updated_at = now()
            returning id
            """,
            new_id(),
            tenant_id,
            source_id,
            url,
        )
        ids.append(document_id)
    return ids


async def queue_source_documents(conn: Connection, source_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await conn.fetch(
        """
        update documents set status = 'queued', last_error = null, updated_at = now()
        where source_id = $1 returning id
        """,
        source_id,
    )
    return [r["id"] for r in rows]


async def get_document(conn: Connection, document_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        """
        select d.id, d.tenant_id, d.source_id, d.locator, d.title, d.url, d.mime, d.object_key,
               d.content_hash, d.status, s.kind as source_kind, s.audience, s.uri as source_uri,
               s.status as source_status
        from documents d join knowledge_sources s on s.id = d.source_id
        where d.id = $1
        """,
        document_id,
    )


async def list_documents(conn: Connection, source_id: uuid.UUID) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        select id, locator, title, url, mime, byte_size, status, last_error, page_count,
               char_count, chunk_count, updated_at
        from documents where source_id = $1
        order by title, locator
        """,
        source_id,
    )


async def set_document_status(
    conn: Connection, document_id: uuid.UUID, status: str, error: str | None = None
) -> None:
    await conn.execute(
        """
        update documents set status = $2, last_error = $3, updated_at = now()
        where id = $1
        """,
        document_id,
        status,
        error,
    )


async def is_fully_embedded(conn: Connection, document_id: uuid.UUID, model: str) -> bool:
    row = await conn.fetchrow(
        """
        select count(*) as total,
               count(*) filter (where embedding is not null and embedding_model = $2) as done
        from chunks where document_id = $1
        """,
        document_id,
        model,
    )
    assert row is not None
    return bool(row["total"]) and row["total"] == row["done"]


async def replace_chunks(
    conn: Connection,
    *,
    document: asyncpg.Record,
    title: str,
    passages: list[Passage],
    content_hash: bytes,
    page_count: int | None,
    char_count: int,
) -> None:
    """Swap a document's chunks in one transaction, so readers never see half a document."""
    await conn.execute("delete from chunks where document_id = $1", document["id"])
    await conn.executemany(
        """
        insert into chunks (id, tenant_id, source_id, document_id, ordinal, heading_path, content,
                            token_count, page_from, page_to, audience)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)
        """,
        [
            (
                new_id(),
                document["tenant_id"],
                document["source_id"],
                document["id"],
                p.ordinal,
                p.heading_path,
                p.content,
                p.token_count,
                p.page,
                document["audience"],
            )
            for p in passages
        ],
    )
    await conn.execute(
        """
        update documents
        set title = $2, content_hash = $3, page_count = $4, char_count = $5, chunk_count = $6,
            status = 'embedding', last_error = null, updated_at = now()
        where id = $1
        """,
        document["id"],
        title,
        content_hash,
        page_count,
        char_count,
        len(passages),
    )


async def chunks_to_embed(
    conn: Connection, document_id: uuid.UUID, limit: int
) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        select c.id, c.heading_path, c.content, d.title
        from chunks c join documents d on d.id = c.document_id
        where c.document_id = $1 and c.embedding is null
        order by c.ordinal
        limit $2
        """,
        document_id,
        limit,
    )


async def store_embeddings(
    conn: Connection, model: str, rows: list[tuple[uuid.UUID, list[float]]]
) -> None:
    await conn.executemany(
        "update chunks set embedding = $2::halfvec, embedding_model = $3 where id = $1",
        [(chunk_id, to_pgvector(vector), model) for chunk_id, vector in rows],
    )


async def refresh_source(conn: Connection, source_id: uuid.UUID) -> str:
    """Recompute counts and status from the source's documents. Returns the status."""
    row = await conn.fetchrow(
        """
        select count(*) as total,
               count(*) filter (where status = any($2::text[])) as busy,
               count(*) filter (where status = 'failed') as failed,
               coalesce(sum(chunk_count) filter (where status = 'ready'), 0) as chunks
        from documents where source_id = $1
        """,
        source_id,
        list(BUSY),
    )
    assert row is not None
    total, busy, failed = row["total"], row["busy"], row["failed"]
    if busy:
        status, error = "syncing", None
    elif total == 0:
        status, error = "failed", "No pages were found."
    elif failed == total:
        status, error = "failed", "None of the documents could be read."
    else:
        status = "ready"
        error = f"{failed} of {total} documents could not be read." if failed else None
    await conn.execute(
        """
        update knowledge_sources
        set status = $2, last_error = $3, document_count = $4, chunk_count = $5,
            updated_at = now(), last_synced_at = case when $2 = 'syncing' then last_synced_at
                                                      else now() end
        where id = $1 and status <> 'deleting'
        """,
        source_id,
        status,
        error,
        total,
        row["chunks"],
    )
    if status == "ready":
        await bump_knowledge_version(conn)
    return status


async def help_topics(conn: Connection, *, identified: bool, limit: int = 4) -> list[str]:
    """Titles of the help articles customers ask about most, for "what can you help with".

    Ranked by how often answers cited them, then by age. Team answers are not
    topics, and anonymous visitors never see the title of a signed-in-only article.
    """
    rows = await conn.fetch(
        """
        select d.title
        from documents d
        join knowledge_sources s on s.id = d.source_id
        left join (
          select document_title, count(*) as n from message_citations group by document_title
        ) cited on cited.document_title = d.title
        where d.status = 'ready' and s.status = 'ready' and s.kind <> 'answer'
          and ($1 or s.audience = 'public') and char_length(d.title) between 2 and 80
        group by d.title
        order by max(coalesce(cited.n, 0)) desc, min(d.created_at), d.title
        limit $2
        """,
        identified,
        limit,
    )
    return [row["title"] for row in rows]


async def ready_source_exists(conn: Connection) -> bool:
    return bool(
        await conn.fetchval(
            "select exists(select 1 from knowledge_sources where status = 'ready'"
            " and chunk_count > 0)"
        )
    )
