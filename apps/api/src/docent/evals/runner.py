"""The run_eval job: every active case of a set through the full agent loop.

For each case, in a sandbox that keeps nothing (docent.evals.sandbox), the
real turn runs with the case's simulated identity and earlier turns. Then the
deterministic checks, then the judge for answers that passed them. A result
records the reply, what retrieval found, each check, the verdict, the cost,
and the latency.

The model calls of the turn and the judge are real spend, so they are recorded
as usage events for the workspace (kind llm_call, without a conversation), never
as AI replies: evals do not count against the plan's cap.

Runs go one at a time per workspace (a partial unique index) on a worker lane
with one slot, so a run never sends bursts to a rate-limited model. A retried
job skips the cases it already finished; a canceled run stops between cases.
"""

import logging
import uuid
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Any

import asyncpg

from docent.agent import prompts, triage, usage
from docent.config import Settings
from docent.db.pool import Connection, Pool, transaction
from docent.evals import drafts, judge, repo, scoring
from docent.evals.sandbox import CaseInput, SandboxDeps, TurnOutcome, run_case
from docent.ids import new_id
from docent.jobs.worker import Handler, JobContext
from docent.knowledge import repo as knowledge_repo
from docent.knowledge.embeddings import Embedder
from docent.llm.client import ChatModel, LLMError

log = logging.getLogger(__name__)

RUN_EVAL = "run_eval"
DRAFT_EVAL_CASES = drafts.DRAFT_EVAL_CASES
EVAL_JOB_KINDS = (RUN_EVAL, DRAFT_EVAL_CASES)


@dataclass(frozen=True, slots=True)
class EvalDeps:
    settings: Settings
    embedder: Embedder
    llm: ChatModel  # the agent's model, also used to write drafts
    judge: ChatModel  # temperature 0; a different model from the agent's in production
    # The docent_app pool the turn runs on, opened for the length of one run.
    agent_pool: Callable[[], AbstractAsyncContextManager[Pool]]


def make_eval_handlers(deps: EvalDeps) -> dict[str, Handler]:
    async def run_eval(ctx: JobContext) -> None:
        await run(ctx, deps)

    async def draft_eval_cases(ctx: JobContext) -> None:
        await drafts.draft_cases(ctx, deps.llm)

    return {RUN_EVAL: run_eval, DRAFT_EVAL_CASES: draft_eval_cases}


def run_config(settings: Settings) -> dict[str, Any]:
    """What a run ran with, so two runs can be told apart."""
    return {
        "model": settings.llm_model,
        "judge_model": settings.eval_judge_model or settings.llm_model,
        "answer_prompt": prompts.ANSWER_PROMPT_VERSION,
        "triage_prompt": triage.TRIAGE_PROMPT_VERSION,
        "judge_prompt": judge.JUDGE_PROMPT_VERSION,
        "embedding_model": settings.embedding_model,
        "sources": settings.agent_sources,
        "min_similarity": settings.retrieval_min_similarity,
    }


async def run(ctx: JobContext, deps: EvalDeps) -> None:
    tenant_id = ctx.job.tenant_id
    assert tenant_id is not None
    run_id = uuid.UUID(ctx.job.payload["run_id"])
    try:
        await _run(ctx, deps, tenant_id, run_id)
    except Exception as exc:
        if ctx.job.attempts >= ctx.job.max_attempts:
            async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
                await conn.execute(
                    """
                    update eval_runs set status = 'failed', error = $2, finished_at = now()
                    where id = $1 and status in ('queued', 'running')
                    """,
                    run_id,
                    f"{type(exc).__name__}: {exc}"[:500],
                )
        raise


async def _run(ctx: JobContext, deps: EvalDeps, tenant_id: uuid.UUID, run_id: uuid.UUID) -> None:
    async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
        found = await conn.fetchrow(
            "select status, set_id from eval_runs where id = $1 for update", run_id
        )
        if found is None or found["status"] not in ("queued", "running"):
            return  # deleted with its set, canceled before it started, or already finished
        cases = [c for c in await repo.list_cases(conn, found["set_id"]) if c["status"] == "active"]
        config = run_config(deps.settings) | {
            "knowledge_version": await knowledge_repo.knowledge_version(conn)
        }
        await conn.execute(
            """
            update eval_runs
            set status = 'running', started_at = coalesce(started_at, now()), case_count = $2,
                config = $3
            where id = $1
            """,
            run_id,
            len(cases),
            config,
        )
        done = {
            r["case_id"]
            for r in await conn.fetch("select case_id from eval_results where run_id = $1", run_id)
        }
        titles = await repo.document_titles(
            conn, list({d for c in cases for d in c["gold_document_ids"]})
        )

    async with deps.agent_pool() as agent_pool:
        sandbox = SandboxDeps(
            settings=deps.settings, pool=agent_pool, embedder=deps.embedder, llm=deps.llm
        )
        for position, case in enumerate(cases):
            if case["id"] in done:
                continue
            async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
                status = await conn.fetchval("select status from eval_runs where id = $1", run_id)
            if status != "running":
                break  # canceled, or deleted with its set
            row, calls = await evaluate(ctx.pool, tenant_id, sandbox, deps.judge, case, titles)
            row |= {"id": new_id(), "run_id": run_id, "position": position}
            async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
                if not await _save(conn, tenant_id, run_id, row, calls):
                    break

    async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
        metrics = scoring.run_metrics([case_result(r) for r in await repo.results(conn, run_id)])
        await conn.execute(
            """
            update eval_runs
            set metrics = $2, finished_at = now(),
                status = case when status = 'running' then 'succeeded' else status end
            where id = $1
            """,
            run_id,
            metrics,
        )


async def _save(
    conn: Connection,
    tenant_id: uuid.UUID,
    run_id: uuid.UUID,
    row: dict[str, Any],
    calls: list[dict[str, Any]],
) -> bool:
    """Store one result and its usage. False when the run is gone."""
    if await conn.fetchval("select id from eval_runs where id = $1 for update", run_id) is None:
        return False
    already = await conn.fetchval(
        "select exists(select 1 from eval_results where run_id = $1 and case_id = $2)",
        run_id,
        row["case_id"],
    )
    if already:
        return True
    cost = 0
    for i, call in enumerate(calls):
        cost += await usage.record(
            conn,
            tenant_id=tenant_id,
            kind="llm_call",
            idempotency_key=f"eval:{run_id}:{row['case_id']}:{i}",
            model=call["model"],
            tokens_in=int(call["tokens_in"] or 0),
            tokens_out=int(call["tokens_out"] or 0),
        )
    row["cost_micros"] = cost
    await repo.insert_result(conn, tenant_id=tenant_id, row=row)
    await conn.execute(
        """
        update eval_runs set done_count = done_count + 1, cost_micros = cost_micros + $2
        where id = $1
        """,
        run_id,
        cost,
    )
    return True


def case_snapshot(case: asyncpg.Record, titles: dict[uuid.UUID, str]) -> dict[str, Any]:
    """The case as it ran, kept with the result."""
    return {
        "history": case["history"] or [],
        "identity": case["identity"],
        "reference_answer": case["reference_answer"],
        "must_include": list(case["must_include"]),
        "must_not_include": list(case["must_not_include"]),
        "gold_documents": [
            {"id": str(d), "title": titles.get(d, "Removed document")}
            for d in case["gold_document_ids"]
        ],
        "tags": list(case["tags"]),
        "origin": case["origin"],
    }


async def evaluate(
    pool: Pool,
    tenant_id: uuid.UUID,
    sandbox: SandboxDeps,
    judge_llm: ChatModel,
    case: asyncpg.Record,
    titles: dict[uuid.UUID, str],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """One case: the turn, the checks, then the judge if needed. Returns the result row
    (without its id, run, position, and cost) and the model calls it made."""
    gold_docs = [str(d) for d in case["gold_document_ids"]]
    row: dict[str, Any] = {
        "case_id": case["id"],
        "question": case["question"],
        "expected": case["expected"],
        "case_snapshot": case_snapshot(case, titles),
        "judge_verdict": None,
        "judge_notes": None,
    }
    try:
        outcome = await run_case(
            sandbox,
            tenant_id,
            CaseInput(
                question=case["question"],
                history=[(h["role"], h["content"]) for h in case["history"] or []],
                identity=case["identity"],
                wants_retrieval=bool(gold_docs),
            ),
        )
    except Exception as exc:
        log.exception("eval case failed", extra={"case_id": str(case["id"])})
        return row | {
            "output": {"type": None, "content": "", "citations": []},
            "retrieved": [],
            "checks": [],
            "verdict": "error",
            "judge_notes": f"The turn failed: {type(exc).__name__}.",
            "tokens_in": 0,
            "tokens_out": 0,
            "latency_ms": 0,
        }, []

    decision = outcome.reply["decision"]
    reply_type = decision["type"]
    content = outcome.reply["content"]
    checks = scoring.run_checks(
        expected=case["expected"],
        reply_type=reply_type,
        content=content,
        cited_markers=decision.get("citations") or [],
        account_facts=decision.get("account_facts") or [],
        must_include=case["must_include"],
        must_not_include=case["must_not_include"],
        gold_document_ids=gold_docs,
        retrieved_document_ids=[str(h.document_id) for h in outcome.retrieved],
    )
    verdict = scoring.classify(case["expected"], reply_type, checks)
    calls = list(outcome.usage)
    if verdict is None:
        gold = await _gold_passages(pool, tenant_id, case, outcome)
        cited = await _cited_passages(pool, tenant_id, outcome)
        try:
            made = await judge.judge(
                judge_llm,
                question=case["question"],
                reference=case["reference_answer"],
                gold=gold,
                cited=cited,
                answer=content,
            )
        except LLMError:
            verdict = "error"
            row["judge_notes"] = "The judge did not give a usable verdict."
        else:
            verdict = made.value.verdict
            row["judge_verdict"] = made.value.verdict
            row["judge_notes"] = made.value.reason
            calls.append(
                {"model": made.model, "tokens_in": made.tokens_in, "tokens_out": made.tokens_out}
            )
    return row | {
        "output": {
            "type": reply_type,
            "content": content,
            "reason": outcome.escalation_reason or decision.get("reason"),
            "confidence": decision.get("confidence"),
            "account_facts": decision.get("account_facts") or [],
            "citations": [
                {
                    "marker": c["marker"],
                    "document_id": c["document_id"],
                    "document_title": c["document_title"],
                    "heading_path": c["heading_path"],
                    "excerpt": c["excerpt"],
                }
                for c in outcome.citations
            ],
        },
        "retrieved": [
            {
                "rank": rank,
                "document_id": str(h.document_id),
                "document_title": h.document_title,
                "heading_path": h.heading_path,
                "similarity": round(h.similarity, 3) if h.similarity is not None else None,
                "gold": str(h.document_id) in gold_docs,
            }
            for rank, h in enumerate(outcome.retrieved, 1)
        ],
        "checks": [c.as_dict() for c in checks],
        "verdict": verdict,
        "tokens_in": sum(int(c["tokens_in"] or 0) for c in calls),
        "tokens_out": sum(int(c["tokens_out"] or 0) for c in calls),
        "latency_ms": outcome.latency_ms,
    }, calls


async def _chunk_map(
    pool: Pool, tenant_id: uuid.UUID, ids: list[uuid.UUID]
) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    async with transaction(pool, tenant_id=tenant_id) as conn:
        rows = await conn.fetch("select id, content from chunks where id = any($1::uuid[])", ids)
    return {r["id"]: r["content"] for r in rows}


async def _gold_passages(
    pool: Pool, tenant_id: uuid.UUID, case: asyncpg.Record, outcome: TurnOutcome
) -> list[str]:
    """The exact passage of a generated case, or the gold documents' passages that
    retrieval found, or else the start of each gold document."""
    if case["gold_chunk_ids"]:
        ids = list(case["gold_chunk_ids"])
        texts = await _chunk_map(pool, tenant_id, ids)
        return [texts[i] for i in ids if i in texts]
    gold = set(case["gold_document_ids"])
    if not gold:
        return []
    found = [h.content for h in outcome.retrieved if h.document_id in gold]
    if found:
        return found
    async with transaction(pool, tenant_id=tenant_id) as conn:
        rows = await conn.fetch(
            """
            select content from chunks where document_id = any($1::uuid[])
            order by document_id, ordinal limit $2
            """,
            list(gold),
            judge.MAX_PASSAGES,
        )
    return [r["content"] for r in rows]


async def _cited_passages(pool: Pool, tenant_id: uuid.UUID, outcome: TurnOutcome) -> list[str]:
    by_chunk = {h.chunk_id: h.content for h in outcome.retrieved}
    ids = [uuid.UUID(str(c["chunk_id"])) for c in outcome.citations if c["chunk_id"]]
    fetched = await _chunk_map(pool, tenant_id, [i for i in ids if i not in by_chunk])
    texts = [by_chunk.get(i) or fetched.get(i) for i in ids]
    return [t for t in texts if t] or [c["excerpt"] for c in outcome.citations]


def case_result(row: asyncpg.Record) -> scoring.CaseResult:
    gold = next((c for c in row["checks"] if c["name"] == "gold_retrieved"), None)
    return scoring.CaseResult(
        verdict=row["verdict"],
        expected=row["expected"],
        reply_type=(row["output"] or {}).get("type"),
        latency_ms=row["latency_ms"],
        cost_micros=row["cost_micros"],
        tokens_in=row["tokens_in"],
        tokens_out=row["tokens_out"],
        gold_retrieved=gold["passed"] if gold else None,
        judged=row["judge_verdict"] is not None,
    )
