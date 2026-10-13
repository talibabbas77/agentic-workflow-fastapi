"""Hybrid retrieval: vector similarity and keyword match, merged by reciprocal rank fusion.

Runs inside a tenant transaction, so RLS limits every row to the tenant. Iterative
index scans keep the vector search returning enough rows after the tenant and
audience filters, even when one HNSW index serves every tenant.
"""

import uuid
from dataclasses import dataclass

from docent.db.pool import Connection
from docent.knowledge.embeddings import to_pgvector

CANDIDATES = 20
RRF_K = 60

_KEYWORD = """
    kw as (
      select id, row_number() over (order by rank desc) as r, rank
      from (
        select c.id, ts_rank_cd(c.tsv, q) as rank
        from chunks c, websearch_to_tsquery('simple', $1) q
        where c.tsv @@ q and c.audience = any($2::text[])
        order by rank desc
        limit $3
      ) k
    )
"""

_VECTOR = """
    vec as (
      select id, row_number() over (order by sim desc) as r, sim
      from (
        select c.id, 1 - (c.embedding <=> $5::halfvec) as sim
        from chunks c
        where c.embedding is not null and c.audience = any($2::text[])
        order by c.embedding <=> $5::halfvec
        limit $3
      ) v
    )
"""

_FUSE = """
    select f.score, f.sim, f.rank, c.id, c.document_id, c.source_id, c.heading_path, c.content,
           c.page_from, d.title, d.url
    from (
      select id, sum(1.0 / ({k} + r)) as score, max(sim) as sim, max(rank) as rank
      from ({parts}) u
      group by id
    ) f
    join chunks c on c.id = f.id
    join documents d on d.id = c.document_id
    order by f.score desc
    limit $4
"""


@dataclass(frozen=True, slots=True)
class Hit:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    source_id: uuid.UUID
    document_title: str
    url: str | None
    heading_path: str
    content: str
    page: int | None
    score: float
    similarity: float | None
    keyword_rank: float | None


def audiences_for(audience: str) -> list[str]:
    """Signed-in users see public and identified content; anonymous visitors only public."""
    return ["public", "identified"] if audience == "identified" else ["public"]


async def search(
    conn: Connection,
    *,
    query: str,
    query_vector: list[float] | None,
    audience: str,
    limit: int,
) -> list[Hit]:
    keyword_part = "select id, r, null::float8 as sim, rank::float8 from kw"
    args: list[object] = [query, audiences_for(audience), CANDIDATES, limit]
    if query_vector is None:
        sql = f"with {_KEYWORD} " + _FUSE.format(k=RRF_K, parts=keyword_part)
    else:
        await conn.execute("set local hnsw.ef_search = 100")
        await conn.execute("set local hnsw.iterative_scan = relaxed_order")
        vector_part = "select id, r, sim, null::float8 as rank from vec"
        sql = f"with {_KEYWORD}, {_VECTOR} " + _FUSE.format(
            k=RRF_K, parts=f"{vector_part} union all {keyword_part}"
        )
        args.append(to_pgvector(query_vector))
    rows = await conn.fetch(sql, *args)
    return [
        Hit(
            chunk_id=r["id"],
            document_id=r["document_id"],
            source_id=r["source_id"],
            document_title=r["title"],
            url=r["url"],
            heading_path=r["heading_path"],
            content=r["content"],
            page=r["page_from"],
            score=float(r["score"]),
            similarity=float(r["sim"]) if r["sim"] is not None else None,
            keyword_rank=float(r["rank"]) if r["rank"] is not None else None,
        )
        for r in rows
    ]
