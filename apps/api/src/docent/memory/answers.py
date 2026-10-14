"""Team answers: the team teaches the agent one question at a time.

Each answer is a knowledge source of kind 'answer' holding one Markdown file,
so the normal pipeline chunks, embeds, and indexes it, and the agent cites it
like any help article. Editing rewrites the file and re-syncs; deleting goes
through the same delete job as any source.
"""

import uuid

from docent.db.pool import Connection
from docent.ids import new_id
from docent.jobs import queue
from docent.knowledge import repo
from docent.knowledge.pipeline import DELETE_SOURCE, SYNC_SOURCE, object_prefix
from docent.storage import ObjectStore

FILENAME = "answer.md"


def markdown(question: str, answer: str) -> bytes:
    return f"# {question.strip()}\n\n{answer.strip()}\n".encode()


def object_key(tenant_id: uuid.UUID, source_id: uuid.UUID, document_id: uuid.UUID) -> str:
    return f"{object_prefix(tenant_id, source_id)}{document_id}/{FILENAME}"


async def create(
    conn: Connection,
    store: ObjectStore,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    question: str,
    answer: str,
    audience: str,
) -> uuid.UUID:
    answer_id, source_id, document_id = new_id(), new_id(), new_id()
    body = markdown(question, answer)
    key = object_key(tenant_id, source_id, document_id)
    await store.put(key, body)
    await repo.create_source(
        conn,
        source_id=source_id,
        tenant_id=tenant_id,
        kind="answer",
        title=question[:200],
        uri=None,
        audience=audience,
        page_limit=1,
        created_by=user_id,
    )
    await repo.create_document(
        conn,
        document_id=document_id,
        tenant_id=tenant_id,
        source_id=source_id,
        locator=FILENAME,
        title=question[:200],
        url=None,
        mime="text/markdown",
        object_key=key,
        byte_size=len(body),
    )
    await conn.execute(
        """
        insert into team_answers (id, tenant_id, source_id, question, answer, created_by)
        values ($1, $2, $3, $4, $5, $6)
        """,
        answer_id,
        tenant_id,
        source_id,
        question,
        answer,
        user_id,
    )
    await _sync(conn, tenant_id, source_id)
    return answer_id


async def update(
    conn: Connection,
    store: ObjectStore,
    *,
    tenant_id: uuid.UUID,
    answer_id: uuid.UUID,
    question: str,
    answer: str,
    audience: str,
) -> bool:
    row = await conn.fetchrow(
        """
        select a.source_id, d.object_key from team_answers a
        join documents d on d.source_id = a.source_id
        where a.id = $1
        """,
        answer_id,
    )
    if row is None:
        return False
    await store.put(row["object_key"], markdown(question, answer))
    await conn.execute(
        "update team_answers set question = $2, answer = $3, updated_at = now() where id = $1",
        answer_id,
        question,
        answer,
    )
    await repo.update_source(conn, row["source_id"], title=question[:200], audience=audience)
    await _sync(conn, tenant_id, row["source_id"])
    return True


async def delete(conn: Connection, *, tenant_id: uuid.UUID, answer_id: uuid.UUID) -> bool:
    source_id: uuid.UUID | None = await conn.fetchval(
        "select source_id from team_answers where id = $1", answer_id
    )
    if source_id is None:
        return False
    await repo.set_source_status(conn, source_id, "deleting")
    await queue.enqueue(
        conn,
        DELETE_SOURCE,
        {"source_id": str(source_id)},
        tenant_id=tenant_id,
        dedupe_key=f"delete:{source_id}",
    )
    return True


async def _sync(conn: Connection, tenant_id: uuid.UUID, source_id: uuid.UUID) -> None:
    await queue.enqueue(
        conn,
        SYNC_SOURCE,
        {"source_id": str(source_id)},
        tenant_id=tenant_id,
        dedupe_key=f"sync:{source_id}",
    )
