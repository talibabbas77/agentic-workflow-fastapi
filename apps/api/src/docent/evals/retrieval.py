"""Retrieval quality on the golden corpus.

Reports recall at 8, mean reciprocal rank, the evidence threshold that best
separates answerable from unanswerable questions, embedding throughput, and
storage per chunk.
"""

import uuid
from dataclasses import dataclass, field
from typing import Any

from docent.config import Settings
from docent.db.pool import Pool, set_context, transaction
from docent.evals.corpus import Company, ingested
from docent.knowledge.embeddings import OllamaEmbedder
from docent.knowledge.search import Hit, search

TOP_K = 8


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
    async with ingested(settings, companies) as corpus:
        results = [
            await _ask(corpus.pool, corpus.embedder, corpus.tenant_ids[c.name], c)
            for c in companies
        ]
        chunks, bytes_per_chunk = await _storage(corpus.pool, list(corpus.tenant_ids.values()))
        seconds = corpus.embedding_seconds
    questions = sum(r.questions for r in results)
    answerable = [s for r in results for s in r.answerable_top]
    unanswerable = [s for r in results for s in r.unanswerable_top]
    return {
        "model": settings.embedding_model,
        "questions": questions,
        "section_recall_at_8": round(sum(r.section_hits for r in results) / max(questions, 1), 4),
        "document_recall_at_8": round(sum(r.doc_hits for r in results) / max(questions, 1), 4),
        "mrr": round(sum(sum(r.reciprocal_ranks) for r in results) / max(questions, 1), 4),
        "evidence_threshold": best_threshold(answerable, unanswerable),
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


async def _ask(
    pool: Pool, embedder: OllamaEmbedder, tenant_id: uuid.UUID, company: Company
) -> CompanyResult:
    result = CompanyResult(company.name)
    async with transaction(pool, tenant_id=tenant_id) as conn:
        locators = {
            r["id"]: r["locator"] for r in await conn.fetch("select id, locator from documents")
        }

    async def top_hits(question: str) -> list[Hit]:
        vector = await embedder.embed_query(question)
        async with transaction(pool, tenant_id=tenant_id) as conn:
            return await search(
                conn, query=question, query_vector=vector, audience="identified", limit=TOP_K
            )

    for item in company.spec["questions"]:
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
    for question in company.spec.get("unanswerable", []):
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
    return chunks, row_bytes / max(chunks, 1) + index_bytes / max(rows, chunks, 1)


def best_threshold(answerable: list[float], unanswerable: list[float]) -> dict[str, float]:
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
