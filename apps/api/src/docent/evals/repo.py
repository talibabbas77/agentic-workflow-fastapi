"""SQL for eval sets, cases, runs, and results. Every query runs in a tenant transaction."""

import uuid
from typing import Any

import asyncpg

from docent.db.pool import Connection
from docent.ids import new_id

CASE_COLUMNS = """
    id, set_id, status, question, history, identity, expected, reference_answer, must_include,
    must_not_include, gold_document_ids, gold_chunk_ids, tags, origin, source_conversation_id,
    source_message_id, created_at, updated_at
"""

RUN_COLUMNS = """
    r.id, r.set_id, s.name as set_name, r.status, r.config, r.metrics, r.case_count,
    r.done_count, r.cost_micros, r.error, r.created_at, r.started_at, r.finished_at,
    u.name as created_by_name
"""

RESULT_COLUMNS = """
    id, run_id, case_id, position, question, expected, case_snapshot, output, retrieved, checks,
    verdict, judge_verdict, judge_notes, tokens_in, tokens_out, cost_micros, latency_ms, label,
    labeled_at, created_at
"""


# Sets


async def list_sets(conn: Connection) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        select s.id, s.name, s.description, s.draft_status, s.draft_requested, s.draft_written,
               s.draft_skipped, s.draft_error, s.created_at, s.updated_at,
               count(c.id) filter (where c.status = 'active') as cases,
               count(c.id) filter (where c.status = 'draft') as drafts,
               lr.id as last_run_id, lr.status as last_run_status, lr.metrics as last_run_metrics,
               lr.finished_at as last_run_finished_at, lr.created_at as last_run_created_at
        from eval_sets s
        left join eval_cases c on c.set_id = s.id
        left join lateral (
          select r.id, r.status, r.metrics, r.finished_at, r.created_at from eval_runs r
          where r.set_id = s.id order by r.created_at desc limit 1
        ) lr on true
        group by s.id, lr.id, lr.status, lr.metrics, lr.finished_at, lr.created_at
        order by lower(s.name)
        """
    )


async def get_set(conn: Connection, set_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        """
        select id, name, description, draft_status, draft_requested, draft_written,
               draft_skipped, draft_error, created_at, updated_at
        from eval_sets where id = $1
        """,
        set_id,
    )


async def lock_set(conn: Connection, set_id: uuid.UUID) -> bool:
    """Serialize changes to one set, such as drafting and editing. False if it is gone."""
    return bool(await conn.fetchval("select true from eval_sets where id = $1 for update", set_id))


async def finish_drafting(conn: Connection, set_id: uuid.UUID, *, error: str | None) -> None:
    await conn.execute(
        """
        update eval_sets
        set draft_status = case when $2::text is null then 'idle' else 'failed' end,
            draft_error = $2, updated_at = now()
        where id = $1 and draft_status = 'running'
        """,
        set_id,
        error,
    )


# Cases


async def list_cases(conn: Connection, set_id: uuid.UUID) -> list[asyncpg.Record]:
    return await conn.fetch(
        f"select {CASE_COLUMNS} from eval_cases where set_id = $1 order by created_at, id",  # noqa: S608
        set_id,
    )


async def get_case(conn: Connection, case_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        f"select {CASE_COLUMNS} from eval_cases where id = $1",  # noqa: S608
        case_id,
    )


async def count_cases(conn: Connection, set_id: uuid.UUID) -> int:
    count: int = await conn.fetchval("select count(*) from eval_cases where set_id = $1", set_id)
    return count


async def insert_case(
    conn: Connection,
    *,
    tenant_id: uuid.UUID,
    set_id: uuid.UUID,
    status: str,
    question: str,
    history: list[dict[str, str]],
    identity: dict[str, str] | None,
    expected: str,
    reference_answer: str,
    must_include: list[str],
    must_not_include: list[str],
    gold_document_ids: list[uuid.UUID],
    gold_chunk_ids: list[uuid.UUID],
    tags: list[str],
    origin: str,
    created_by: uuid.UUID | None,
    source_conversation_id: uuid.UUID | None = None,
    source_message_id: uuid.UUID | None = None,
) -> uuid.UUID:
    case_id = new_id()
    await conn.execute(
        """
        insert into eval_cases (id, tenant_id, set_id, status, question, history, identity,
                                expected, reference_answer, must_include, must_not_include,
                                gold_document_ids, gold_chunk_ids, tags, origin,
                                source_conversation_id, source_message_id, created_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        """,
        case_id,
        tenant_id,
        set_id,
        status,
        question,
        history,
        identity,
        expected,
        reference_answer,
        must_include,
        must_not_include,
        gold_document_ids,
        gold_chunk_ids,
        tags,
        origin,
        source_conversation_id,
        source_message_id,
        created_by,
    )
    return case_id


async def known_documents(conn: Connection, ids: list[uuid.UUID]) -> set[uuid.UUID]:
    rows = await conn.fetch("select id from documents where id = any($1::uuid[])", ids)
    return {r["id"] for r in rows}


async def document_titles(conn: Connection, ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    rows = await conn.fetch(
        """
        select id, coalesce(nullif(title, ''), locator) as title
        from documents where id = any($1::uuid[])
        """,
        ids,
    )
    return {r["id"]: r["title"] for r in rows}


# Runs


async def list_runs(
    conn: Connection, set_id: uuid.UUID | None = None, limit: int = 50
) -> list[asyncpg.Record]:
    return await conn.fetch(
        f"""
        select {RUN_COLUMNS}
        from eval_runs r
        join eval_sets s on s.id = r.set_id
        left join users u on u.id = r.created_by
        where $1::uuid is null or r.set_id = $1
        order by r.created_at desc
        limit $2
        """,  # noqa: S608
        set_id,
        limit,
    )


async def get_run(conn: Connection, run_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        f"""
        select {RUN_COLUMNS}
        from eval_runs r
        join eval_sets s on s.id = r.set_id
        left join users u on u.id = r.created_by
        where r.id = $1
        """,  # noqa: S608
        run_id,
    )


async def active_run(conn: Connection) -> uuid.UUID | None:
    run_id: uuid.UUID | None = await conn.fetchval(
        "select id from eval_runs where status in ('queued', 'running') limit 1"
    )
    return run_id


async def runs_today(conn: Connection) -> int:
    count: int = await conn.fetchval(
        "select count(*) from eval_runs where created_at > now() - interval '1 day'"
    )
    return count


async def results(conn: Connection, run_id: uuid.UUID) -> list[asyncpg.Record]:
    return await conn.fetch(
        f"select {RESULT_COLUMNS} from eval_results where run_id = $1 order by position",  # noqa: S608
        run_id,
    )


async def insert_result(conn: Connection, *, tenant_id: uuid.UUID, row: dict[str, Any]) -> bool:
    """Store one case's result. False if this run already has it (a retried job)."""
    inserted = await conn.fetchval(
        """
        insert into eval_results (id, tenant_id, run_id, case_id, position, question, expected,
                                  case_snapshot, output, retrieved, checks, verdict,
                                  judge_verdict, judge_notes, tokens_in, tokens_out,
                                  cost_micros, latency_ms)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        on conflict (run_id, case_id) do nothing
        returning true
        """,
        row["id"],
        tenant_id,
        row["run_id"],
        row["case_id"],
        row["position"],
        row["question"],
        row["expected"],
        row["case_snapshot"],
        row["output"],
        row["retrieved"],
        row["checks"],
        row["verdict"],
        row["judge_verdict"],
        row["judge_notes"],
        row["tokens_in"],
        row["tokens_out"],
        row["cost_micros"],
        row["latency_ms"],
    )
    return bool(inserted)
