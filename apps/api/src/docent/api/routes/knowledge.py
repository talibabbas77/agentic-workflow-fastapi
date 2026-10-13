"""Knowledge sources: upload files, add pages and sitemaps, search what the agent knows."""

import re
import time
import uuid
from dataclasses import asdict
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, File, Form, UploadFile, status

from docent.api.deps import AdminMember, CurrentMember, Member, State, enforce
from docent.api.errors import AppError, not_found
from docent.api.schemas import (
    DocumentOut,
    ErrorOut,
    SearchHitOut,
    SearchIn,
    SearchOut,
    SourceCreateIn,
    SourceDetailOut,
    SourceOut,
    SourcesOut,
    SourceUpdateIn,
)
from docent.db.pool import Connection, transaction
from docent.ids import new_id
from docent.jobs import queue
from docent.knowledge import repo
from docent.knowledge.embeddings import EmbeddingError
from docent.knowledge.extract import UnsupportedDocument, detect_mime
from docent.knowledge.fetch import FetchError, check_url
from docent.knowledge.pipeline import DELETE_SOURCE, SYNC_SOURCE, object_prefix
from docent.knowledge.search import search as run_search
from docent.security import ratelimit
from docent.services import audit

router = APIRouter(
    prefix="/v1/knowledge",
    tags=["knowledge"],
    responses={403: {"model": ErrorOut}, 404: {"model": ErrorOut}, 422: {"model": ErrorOut}},
)


@router.get("/sources")
async def list_sources(member: CurrentMember, state: State) -> SourcesOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        rows = await repo.list_sources(conn)
        documents = await repo.tenant_document_count(conn)
    sources = [SourceOut(**dict(r)) for r in rows]
    return SourcesOut(
        sources=sources,
        document_total=documents,
        chunk_total=sum(s.chunk_count for s in sources),
        document_limit=state.settings.tenant_max_documents,
    )


@router.post("/sources", status_code=status.HTTP_201_CREATED)
async def create_source(body: SourceCreateIn, member: AdminMember, state: State) -> SourceOut:
    try:
        url = check_url(body.url)
    except FetchError as exc:
        raise AppError(422, "invalid_request", str(exc), {"url": str(exc)}) from None
    limit = min(body.page_limit, state.settings.crawl_max_pages) if body.kind == "sitemap" else 1
    title = body.title or _title_from_url(url, body.kind)
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _check_capacity(conn, state.settings.tenant_max_documents, limit)
        source_id = await repo.create_source(
            conn,
            tenant_id=member.tenant_id,
            kind=body.kind,
            title=title,
            uri=url,
            audience=body.audience,
            page_limit=limit,
            created_by=member.user_id,
        )
        await _queue_sync(conn, member, source_id)
        source = await _source_out(conn, source_id)
    await state.waker.wake()
    return source


@router.post("/uploads", status_code=status.HTTP_201_CREATED, responses={413: {"model": ErrorOut}})
async def upload(
    file: Annotated[UploadFile, File()],
    member: AdminMember,
    state: State,
    audience: Annotated[Literal["public", "identified"], Form()] = "public",
) -> SourceOut:
    limit = state.settings.max_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise AppError(413, "file_too_large", f"Files can be up to {limit // 1_000_000} MB.")
    filename = _safe_filename(file.filename or "document")
    try:
        mime = detect_mime(filename, data)
    except UnsupportedDocument as exc:
        raise AppError(415, "unsupported_file", str(exc)) from None

    source_id, document_id = new_id(), new_id()
    key = f"{object_prefix(member.tenant_id, source_id)}{document_id}/{filename}"
    await state.store.put(key, data)
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _check_capacity(conn, state.settings.tenant_max_documents, 1)
        await repo.create_source(
            conn,
            source_id=source_id,
            tenant_id=member.tenant_id,
            kind="upload",
            title=filename.rsplit(".", 1)[0][:200] or filename,
            uri=filename,
            audience=audience,
            page_limit=1,
            created_by=member.user_id,
        )
        await repo.create_document(
            conn,
            document_id=document_id,
            tenant_id=member.tenant_id,
            source_id=source_id,
            locator=filename,
            title=filename,
            url=None,
            mime=mime,
            object_key=key,
            byte_size=len(data),
        )
        await _queue_sync(conn, member, source_id)
        source = await _source_out(conn, source_id)
    await state.waker.wake()
    return source


@router.get("/sources/{source_id}")
async def get_source(source_id: uuid.UUID, member: CurrentMember, state: State) -> SourceDetailOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        source = await _source_out(conn, source_id)
        documents = await repo.list_documents(conn, source_id)
    return SourceDetailOut(source=source, documents=[DocumentOut(**dict(d)) for d in documents])


@router.patch("/sources/{source_id}")
async def update_source(
    source_id: uuid.UUID, body: SourceUpdateIn, member: AdminMember, state: State
) -> SourceOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _source_out(conn, source_id)
        await repo.update_source(conn, source_id, title=body.title, audience=body.audience)
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="knowledge.source_updated",
            target_type="knowledge_source",
            target_id=source_id,
            metadata=body.model_dump(exclude_none=True),
        )
        return await _source_out(conn, source_id)


@router.post("/sources/{source_id}/sync", status_code=status.HTTP_202_ACCEPTED)
async def sync_source(source_id: uuid.UUID, member: AdminMember, state: State) -> SourceOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        current = await _source_out(conn, source_id)
        if current.status == "deleting":
            raise AppError(409, "source_deleting", "This source is being deleted.")
        await repo.set_source_status(conn, source_id, "queued")
        await _queue_sync(conn, member, source_id)
        source = await _source_out(conn, source_id)
    await state.waker.wake()
    return source


@router.delete("/sources/{source_id}", status_code=status.HTTP_202_ACCEPTED)
async def delete_source(source_id: uuid.UUID, member: AdminMember, state: State) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await _source_out(conn, source_id)
        await repo.set_source_status(conn, source_id, "deleting")
        await queue.enqueue(
            conn,
            DELETE_SOURCE,
            {"source_id": str(source_id)},
            tenant_id=member.tenant_id,
            dedupe_key=f"delete:{source_id}",
        )
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="knowledge.source_deleted",
            target_type="knowledge_source",
            target_id=source_id,
        )
    await state.waker.wake()


@router.post("/search", responses={429: {"model": ErrorOut}})
async def search(body: SearchIn, member: CurrentMember, state: State) -> SearchOut:
    await enforce(state, ratelimit.SEARCH_PER_USER, str(member.user_id))
    started = time.perf_counter()
    try:
        vector: list[float] | None = await state.embedder.embed_query(body.query)
    except EmbeddingError:
        vector = None  # keyword search still works while the embedding service is down
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        hits = await run_search(
            conn,
            query=body.query,
            query_vector=vector,
            audience=body.audience,
            limit=body.limit,
        )
    return SearchOut(
        hits=[SearchHitOut(**asdict(h)) for h in hits],
        took_ms=round((time.perf_counter() - started) * 1000),
        mode="hybrid" if vector is not None else "keyword",
    )


async def _source_out(conn: Connection, source_id: uuid.UUID) -> SourceOut:
    row = await repo.get_source(conn, source_id)
    if row is None:
        raise not_found("Source")
    return SourceOut(**dict(row))


async def _queue_sync(conn: Connection, member: Member, source_id: uuid.UUID) -> None:
    await queue.enqueue(
        conn,
        SYNC_SOURCE,
        {"source_id": str(source_id)},
        tenant_id=member.tenant_id,
        dedupe_key=f"sync:{source_id}",
    )


async def _check_capacity(conn: Connection, limit: int, adding: int) -> None:
    if await repo.tenant_document_count(conn) + adding > limit:
        raise AppError(
            409,
            "document_limit",
            f"This workspace can hold {limit} documents. Remove a source to add more.",
        )


def _safe_filename(name: str) -> str:
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "_", base).strip(" ._") or "document"
    return cleaned[:120]


def _title_from_url(url: str, kind: str) -> str:
    parts = urlsplit(url)
    host = (parts.hostname or url).removeprefix("www.")
    path = parts.path.rstrip("/")
    title = f"{host}{path}" if kind == "url" and path else host
    return title[:200]
