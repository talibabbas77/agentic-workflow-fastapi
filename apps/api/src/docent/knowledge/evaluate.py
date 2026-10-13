"""Retrieval quality check against the golden corpus in fixtures/golden.

Ingests each company's documents through the real pipeline and embedding model,
asks every question, and reports recall at 8, the evidence threshold that best
separates answerable from unanswerable questions, embedding throughput, and
storage per chunk. Creates its own tenants and removes them afterwards.
"""

import json
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from docent.config import Settings
from docent.db.pool import Pool, create_pool, set_context, transaction
from docent.jobs import queue
from docent.jobs.worker import Worker
from docent.knowledge import repo
from docent.knowledge.embeddings import OllamaEmbedder
from docent.knowledge.fetch import guarded_client
from docent.knowledge.pipeline import SYNC_SOURCE, KnowledgeDeps, make_knowledge_handlers
from docent.knowledge.search import search
from docent.security.passwords import hash_password
from docent.services import accounts, tenants
from docent.storage import ObjectStore

TOP_K = 8


@dataclass(frozen=True)
class Company:
    name: str
    spec: dict[str, Any]
    documents: list[tuple[str, bytes]]


def load_corpus(fixtures: Path) -> list[Company]:
    return [
        Company(
            name=folder.name,
            spec=json.loads((folder / "questions.json").read_text()),
            documents=[(p.name, p.read_bytes()) for p in sorted(folder.glob("*.md"))],
        )
        for folder in sorted(fixtures.iterdir())
        if (folder / "questions.json").is_file()
    ]


@dataclass
class CompanyResult:
    name: str
    questions: int = 0
    doc_hits: int = 0
    section_hits: int = 0
    reciprocal_ranks: list[float] = field(default_factory=list)
    misses: list[dict[str, Any]] = field(default_factory=list)
    answerable_top: list[float] = field(default_factory=list)
    unanswerable_top: list[float] = field(default_factory=list)


async def run(settings: Settings, companies: list[Company]) -> dict[str, Any]:
    app_pool = await create_pool(settings.database_url, max_size=4)
    worker_pool = await create_pool(settings.worker_database_url, max_size=4)
    store = ObjectStore.from_url("memory://")
    async with httpx.AsyncClient() as ollama, guarded_client(user_agent="eval", timeout=5) as http:
        embedder = OllamaEmbedder(
            ollama,
            settings.ollama_base_url,
            settings.embedding_model,
            settings.embedding_dims,
            settings.embedding_timeout_seconds,
        )
        deps = KnowledgeDeps(settings=settings, store=store, embedder=embedder, http=http)
        worker = Worker(
            worker_pool, make_knowledge_handlers(deps), idle_poll_seconds=60, lease_seconds=600
        )
        owner_id = await _eval_user(app_pool)
        tenant_ids: dict[str, uuid.UUID] = {}
        try:
            for company in companies:
                tenant_ids[company.name] = await _ingest(app_pool, store, owner_id, company)
            started = time.perf_counter()
            await worker.drain()
            elapsed = time.perf_counter() - started
            results = [await _ask(app_pool, embedder, tenant_ids[c.name], c) for c in companies]
            chunks, bytes_per_chunk = await _storage(app_pool, list(tenant_ids.values()))
        finally:
            await _cleanup(app_pool, owner_id, list(tenant_ids.values()))
            await app_pool.close()
            await worker_pool.close()
    return _report(settings, results, chunks, elapsed, bytes_per_chunk)


async def _eval_user(pool: Pool) -> uuid.UUID:
    async with transaction(pool) as conn:
        return await accounts.create_user(
            conn,
            email=f"eval-{uuid.uuid4().hex[:12]}@docent.invalid",
            name="Retrieval eval",
            password_hash=await hash_password(uuid.uuid4().hex),
            verified=True,
        )


async def _ingest(
    pool: Pool, store: ObjectStore, owner_id: uuid.UUID, company: Company
) -> uuid.UUID:
    identified = set(company.spec.get("identified_only", []))
    async with transaction(pool) as conn:
        tenant_id = await tenants.create_tenant(
            conn, name=f"Eval {company.name}", owner_id=owner_id
        )
        for filename, data in company.documents:
            source_id = await repo.create_source(
                conn,
                tenant_id=tenant_id,
                kind="upload",
                title=filename.removesuffix(".md"),
                uri=filename,
                audience="identified" if filename in identified else "public",
                page_limit=1,
                created_by=owner_id,
            )
            key = f"{tenant_id}/{source_id}/{filename}"
            await store.put(key, data)
            await repo.create_document(
                conn,
                tenant_id=tenant_id,
                source_id=source_id,
                locator=filename,
                title=filename.removesuffix(".md"),
                url=None,
                mime="text/markdown",
                object_key=key,
            )
            await queue.enqueue(
                conn, SYNC_SOURCE, {"source_id": str(source_id)}, tenant_id=tenant_id
            )
    return tenant_id


async def _ask(
    pool: Pool, embedder: OllamaEmbedder, tenant_id: uuid.UUID, company: Company
) -> CompanyResult:
    spec = company.spec
    result = CompanyResult(company.name)
    async with transaction(pool, tenant_id=tenant_id) as conn:
        locators = {
            r["id"]: r["locator"] for r in await conn.fetch("select id, locator from documents")
        }

    async def top_hits(question: str) -> list[Any]:
        vector = await embedder.embed_query(question)
        async with transaction(pool, tenant_id=tenant_id) as conn:
            return await search(
                conn, query=question, query_vector=vector, audience="identified", limit=TOP_K
            )

    for item in spec["questions"]:
        hits = await top_hits(item["q"])
        result.questions += 1
        rank = next(
            (
                i
                for i, h in enumerate(hits, start=1)
                if locators.get(h.document_id) == item["doc"]
                and h.heading_path.split(" > ")[-1] == item["section"]
            ),
            None,
        )
        doc_rank = next(
            (i for i, h in enumerate(hits, 1) if locators.get(h.document_id) == item["doc"]), None
        )
        result.doc_hits += doc_rank is not None
        result.section_hits += rank is not None
        result.reciprocal_ranks.append(1 / rank if rank else 0.0)
        if hits and hits[0].similarity is not None:
            result.answerable_top.append(hits[0].similarity)
        if rank is None:
            result.misses.append(
                {
                    "q": item["q"],
                    "expected": f"{item['doc']} > {item['section']}",
                    "got": [f"{locators.get(h.document_id)} > {h.heading_path}" for h in hits[:3]],
                }
            )
    for question in spec.get("unanswerable", []):
        hits = await top_hits(question)
        if hits and hits[0].similarity is not None:
            result.unanswerable_top.append(hits[0].similarity)
    return result


async def _storage(pool: Pool, tenant_ids: list[uuid.UUID]) -> tuple[int, float]:
    """Chunk count and bytes per chunk: exact row size plus this table's index share."""
    chunks, row_bytes = 0, 0
    async with transaction(pool) as conn:
        for tenant_id in tenant_ids:
            await set_context(conn, tenant_id=tenant_id)
            row = await conn.fetchrow(
                "select count(*) as n, coalesce(sum(pg_column_size(c.*)), 0) as size from chunks c"
            )
            assert row is not None
            chunks, row_bytes = chunks + row["n"], row_bytes + row["size"]
        index_bytes = int(await conn.fetchval("select pg_indexes_size('chunks')"))
        rows = int(
            await conn.fetchval("select reltuples::bigint from pg_class where relname = 'chunks'")
        )
    per_row_index = index_bytes / max(rows, chunks, 1)
    return chunks, row_bytes / max(chunks, 1) + per_row_index


async def _cleanup(pool: Pool, owner_id: uuid.UUID, tenant_ids: list[uuid.UUID]) -> None:
    async with transaction(pool) as conn:
        for tenant_id in tenant_ids:
            await set_context(conn, tenant_id=tenant_id)
            await conn.execute("delete from tenants where id = $1", tenant_id)
        await set_context(conn)
        await conn.execute("delete from users where id = $1", owner_id)


def _threshold(answerable: list[float], unanswerable: list[float]) -> dict[str, float]:
    """The similarity cut that best separates the two groups (balanced accuracy)."""
    best = {"threshold": 0.0, "answerable_kept": 1.0, "unanswerable_rejected": 0.0}
    best_score = -1.0
    for t in sorted(set(answerable + unanswerable)):
        kept = sum(s >= t for s in answerable) / max(len(answerable), 1)
        rejected = sum(s < t for s in unanswerable) / max(len(unanswerable), 1)
        if (score := kept + rejected) > best_score:
            best_score = score
            best = {
                "threshold": round(t, 4),
                "answerable_kept": kept,
                "unanswerable_rejected": rejected,
            }
    return best


def _report(
    settings: Settings,
    results: list[CompanyResult],
    chunks: int,
    seconds: float,
    bytes_per_chunk: float,
) -> dict[str, Any]:
    questions = sum(r.questions for r in results)
    answerable = [s for r in results for s in r.answerable_top]
    unanswerable = [s for r in results for s in r.unanswerable_top]
    return {
        "model": settings.embedding_model,
        "questions": questions,
        "section_recall_at_8": round(sum(r.section_hits for r in results) / max(questions, 1), 4),
        "document_recall_at_8": round(sum(r.doc_hits for r in results) / max(questions, 1), 4),
        "mrr": round(sum(sum(r.reciprocal_ranks) for r in results) / max(questions, 1), 4),
        "evidence_threshold": _threshold(answerable, unanswerable),
        "chunks": chunks,
        "embedding_seconds": round(seconds, 1),
        "chunks_per_second": round(chunks / seconds, 2) if seconds else None,
        "bytes_per_chunk": round(bytes_per_chunk),
        "companies": [
            {
                "name": r.name,
                "questions": r.questions,
                "section_recall_at_8": round(r.section_hits / max(r.questions, 1), 4),
                "misses": r.misses,
            }
            for r in results
        ],
    }
