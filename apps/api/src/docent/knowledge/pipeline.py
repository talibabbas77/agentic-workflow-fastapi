"""Background jobs that turn sources into searchable chunks.

sync_source      register what a source contains (upload, page, or sitemap pages)
parse_document   read one document, split it into chunks (skipped if unchanged)
embed_document   embed the chunks that have no vector yet, in batches
delete_source    remove stored files, then the rows

Every handler is safe to run twice. A crash mid-embedding resumes where it
stopped, because only chunks without a vector are picked up.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import urljoin

import asyncpg
import httpx
from defusedxml import ElementTree

from docent.config import Settings
from docent.db.pool import transaction
from docent.jobs import queue
from docent.jobs.worker import Handler, JobContext, PermanentJobError
from docent.knowledge import repo
from docent.knowledge.chunking import chunk
from docent.knowledge.embeddings import Embedder
from docent.knowledge.extract import UnsupportedDocument, extract
from docent.knowledge.fetch import FetchError, RobotsRules, fetch, same_site
from docent.storage import ObjectStore

SYNC_SOURCE = "sync_source"
PARSE_DOCUMENT = "parse_document"
EMBED_DOCUMENT = "embed_document"
DELETE_SOURCE = "delete_source"

_SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
FETCHABLE_MIMES = {
    "text/html",
    "application/xhtml+xml",
    "text/plain",
    "text/markdown",
    "application/pdf",
}


@dataclass(frozen=True, slots=True)
class KnowledgeDeps:
    settings: Settings
    store: ObjectStore
    embedder: Embedder
    http: httpx.AsyncClient


def object_prefix(tenant_id: uuid.UUID, source_id: uuid.UUID) -> str:
    return f"{tenant_id}/{source_id}/"


def make_knowledge_handlers(deps: KnowledgeDeps) -> dict[str, Handler]:
    s = deps.settings

    async def sync_source(ctx: JobContext) -> None:
        source_id = uuid.UUID(ctx.job.payload["source_id"])
        tenant_id = ctx.job.tenant_id
        async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
            source = await repo.get_source(conn, source_id)
            if source is None or source["status"] == "deleting":
                return
            await repo.set_source_status(conn, source_id, "syncing")
        assert tenant_id is not None

        urls: list[str] = []
        if source["kind"] == "url":
            urls = [source["uri"]]
        elif source["kind"] == "sitemap":
            try:
                urls = await _sitemap_urls(deps, source["uri"], source["page_limit"])
            except (FetchError, ElementTree.ParseError) as exc:
                async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
                    await repo.set_source_status(conn, source_id, "failed", _message(exc))
                raise PermanentJobError(str(exc)) from exc

        async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
            if source["kind"] == "upload":
                document_ids = await repo.queue_source_documents(conn, source_id)
            else:
                document_ids = await repo.sync_url_documents(
                    conn, tenant_id=tenant_id, source_id=source_id, urls=urls
                )
            for document_id in document_ids:
                await queue.enqueue(
                    conn,
                    PARSE_DOCUMENT,
                    {"document_id": str(document_id)},
                    tenant_id=tenant_id,
                    dedupe_key=f"parse:{document_id}",
                )
            await repo.refresh_source(conn, source_id)

    async def parse_document(ctx: JobContext) -> None:
        document_id = uuid.UUID(ctx.job.payload["document_id"])
        async with _document_failures(ctx, document_id):
            async with transaction(ctx.pool, tenant_id=ctx.job.tenant_id) as conn:
                document = await repo.get_document(conn, document_id)
                if document is None or document["source_status"] == "deleting":
                    return
                await repo.set_document_status(conn, document_id, "parsing")

            data, mime, title_hint = await _load(deps, document)
            extracted = await asyncio.to_thread(extract, data, mime, title_hint)
            passages = chunk(extracted.sections)

            async with transaction(ctx.pool, tenant_id=ctx.job.tenant_id) as conn:
                unchanged = document["content_hash"] == extracted.content_hash
                if unchanged and await repo.is_fully_embedded(
                    conn, document_id, deps.embedder.model
                ):
                    await repo.set_document_status(conn, document_id, "ready")
                    await repo.refresh_source(conn, document["source_id"])
                    return
                await repo.replace_chunks(
                    conn,
                    document=document,
                    title=extracted.title,
                    passages=passages,
                    content_hash=extracted.content_hash,
                    page_count=extracted.page_count,
                    char_count=len(extracted.text),
                )
                await queue.enqueue(
                    conn,
                    EMBED_DOCUMENT,
                    {"document_id": str(document_id)},
                    tenant_id=ctx.job.tenant_id,
                    dedupe_key=f"embed:{document_id}",
                )

    async def embed_document(ctx: JobContext) -> None:
        document_id = uuid.UUID(ctx.job.payload["document_id"])
        async with _document_failures(ctx, document_id):
            while True:
                async with transaction(ctx.pool, tenant_id=ctx.job.tenant_id) as conn:
                    document = await repo.get_document(conn, document_id)
                    if document is None or document["source_status"] == "deleting":
                        return  # deleted mid-way: stop instead of embedding for nothing
                    rows = await repo.chunks_to_embed(conn, document_id, s.embedding_batch_size)
                if not rows:
                    break
                vectors = await deps.embedder.embed_documents(
                    [(_embed_title(r["title"], r["heading_path"]), r["content"]) for r in rows]
                )
                async with transaction(ctx.pool, tenant_id=ctx.job.tenant_id) as conn:
                    await repo.store_embeddings(
                        conn,
                        deps.embedder.model,
                        [(r["id"], v) for r, v in zip(rows, vectors, strict=True)],
                    )
            async with transaction(ctx.pool, tenant_id=ctx.job.tenant_id) as conn:
                document = await repo.get_document(conn, document_id)
                if document is None:
                    return
                await repo.set_document_status(conn, document_id, "ready")
                await repo.refresh_source(conn, document["source_id"])

    async def delete_source(ctx: JobContext) -> None:
        source_id = uuid.UUID(ctx.job.payload["source_id"])
        assert ctx.job.tenant_id is not None
        await deps.store.delete_prefix(object_prefix(ctx.job.tenant_id, source_id))
        async with transaction(ctx.pool, tenant_id=ctx.job.tenant_id) as conn:
            await conn.execute("delete from knowledge_sources where id = $1", source_id)

    return {
        SYNC_SOURCE: sync_source,
        PARSE_DOCUMENT: parse_document,
        EMBED_DOCUMENT: embed_document,
        DELETE_SOURCE: delete_source,
    }


@asynccontextmanager
async def _document_failures(ctx: JobContext, document_id: uuid.UUID) -> AsyncIterator[None]:
    """Record a document's failure when retrying will not help or no retries are left."""
    try:
        yield
    except Exception as exc:
        permanent = isinstance(exc, (UnsupportedDocument, FetchError, PermanentJobError))
        if permanent or ctx.job.attempts >= ctx.job.max_attempts:
            async with transaction(ctx.pool, tenant_id=ctx.job.tenant_id) as conn:
                document = await repo.get_document(conn, document_id)
                if document is not None:
                    await repo.set_document_status(conn, document_id, "failed", _message(exc))
                    await repo.refresh_source(conn, document["source_id"])
        if permanent and not isinstance(exc, PermanentJobError):
            raise PermanentJobError(str(exc)) from exc
        raise


async def _load(deps: KnowledgeDeps, document: asyncpg.Record) -> tuple[bytes, str, str]:
    """Bytes, content type, and a fallback title for a document."""
    if document["object_key"]:
        data = await deps.store.get(document["object_key"])
        return data, document["mime"], document["locator"].rsplit(".", 1)[0]
    url: str = document["url"]
    if document["source_kind"] == "url":  # sitemap pages were checked when listed
        robots = RobotsRules(deps.http, deps.settings.crawl_user_agent)
        if not await robots.allowed(url):
            raise FetchError("This page asks crawlers not to read it (robots.txt).")
    fetched = await fetch(deps.http, url, max_bytes=deps.settings.crawl_max_page_bytes)
    await asyncio.sleep(deps.settings.crawl_delay_seconds)
    if not same_site(fetched.url, url):
        raise FetchError("The page redirected to a different site.")
    mime = fetched.content_type or "text/html"
    if mime not in FETCHABLE_MIMES:
        raise FetchError(f"Pages of type {mime} are not supported.")
    return fetched.body, mime, url


async def _sitemap_urls(deps: KnowledgeDeps, sitemap_url: str, limit: int) -> list[str]:
    """Page URLs from a sitemap or sitemap index, same site only, robots.txt respected."""
    s = deps.settings
    robots = RobotsRules(deps.http, s.crawl_user_agent)
    pending, seen_maps, pages = [sitemap_url], set[str](), list[str]()
    while pending and len(pages) < limit and len(seen_maps) < 20:
        current = pending.pop(0)
        if current in seen_maps:
            continue
        seen_maps.add(current)
        fetched = await fetch(deps.http, current, max_bytes=s.crawl_max_page_bytes)
        root = ElementTree.fromstring(fetched.body)
        for loc in root.iter(f"{_SITEMAP_NS}loc"):
            url = urljoin(current, (loc.text or "").strip())
            if not url or not same_site(url, sitemap_url):
                continue
            if root.tag == f"{_SITEMAP_NS}sitemapindex":
                pending.append(url)
            elif url not in pages and await robots.allowed(url):
                pages.append(url)
                if len(pages) >= limit:
                    break
        await asyncio.sleep(s.crawl_delay_seconds)
    if not pages:
        raise FetchError("The sitemap lists no pages on this site.")
    return pages


def _embed_title(document_title: str, heading_path: str) -> str:
    return f"{document_title} > {heading_path}" if heading_path else document_title


def _message(exc: BaseException) -> str:
    return str(exc)[:500] or type(exc).__name__
