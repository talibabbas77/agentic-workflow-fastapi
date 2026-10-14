"""Knowledge gaps: product questions the agent could not answer from what it knows.

Each one is stored with the query vector that retrieval already computed, so no
extra embedding call is made. Similar questions are grouped when the team looks
at them: the open gaps of a workspace are a few hundred at most, so a greedy
pass over the newest ones is enough and needs no clustering service.
"""

import math
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from docent.db.pool import Connection
from docent.ids import new_id
from docent.knowledge.embeddings import to_pgvector

# Two questions this close in meaning are treated as the same gap.
SAME_GAP = 0.8
MAX_OPEN = 500


@dataclass(slots=True)
class GapGroup:
    ids: list[uuid.UUID]
    question: str
    examples: list[str]
    last_asked_at: datetime
    vector: list[float] | None = field(default=None, repr=False)

    @property
    def count(self) -> int:
        return len(self.ids)


async def record(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    question: str,
    vector: list[float] | None,
    conversation_id: uuid.UUID,
) -> None:
    await conn.execute(
        """
        insert into knowledge_gaps (id, tenant_id, question, embedding, conversation_id)
        values ($1, $2, $3, $4::halfvec, $5)
        """,
        new_id(),
        tenant_id,
        question[:2000],
        to_pgvector(vector) if vector else None,
        conversation_id,
    )


async def open_groups(conn: Connection) -> list[GapGroup]:
    """Open gaps of the tenant in context, grouped by meaning, largest group first."""
    rows = await conn.fetch(
        """
        select id, question, embedding::text as embedding, created_at from knowledge_gaps
        where answered_by is null and dismissed_at is null
        order by created_at desc limit $1
        """,
        MAX_OPEN,
    )
    groups: list[GapGroup] = []
    for row in rows:
        vector = _parse(row["embedding"])
        group = _closest(groups, vector, row["question"])
        if group is None:
            groups.append(
                GapGroup(
                    ids=[row["id"]],
                    question=row["question"],
                    examples=[],
                    last_asked_at=row["created_at"],
                    vector=vector,
                )
            )
            continue
        group.ids.append(row["id"])
        if len(group.examples) < 3 and row["question"] != group.question:
            group.examples.append(row["question"])
    return sorted(groups, key=lambda g: (-g.count, -g.last_asked_at.timestamp()))


async def close(conn: Connection, ids: list[uuid.UUID], *, answered_by: uuid.UUID | None) -> int:
    """Mark gaps answered by a team answer, or dismissed when answered_by is None."""
    status = await conn.execute(
        """
        update knowledge_gaps
        set answered_by = $2, dismissed_at = case when $2::uuid is null then now() end
        where id = any($1::uuid[]) and answered_by is null and dismissed_at is null
        """,
        ids,
        answered_by,
    )
    return int(status.rsplit(" ", 1)[-1])


def _closest(groups: list[GapGroup], vector: list[float] | None, question: str) -> GapGroup | None:
    if vector is None:
        key = " ".join(question.casefold().split())
        return next((g for g in groups if " ".join(g.question.casefold().split()) == key), None)
    best, best_score = None, SAME_GAP
    for group in groups:
        if group.vector is None:
            continue
        score = _cosine(vector, group.vector)
        if score >= best_score:
            best, best_score = group, score
    return best


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


def _parse(text: str | None) -> list[float] | None:
    return [float(x) for x in text.strip("[]").split(",")] if text else None
