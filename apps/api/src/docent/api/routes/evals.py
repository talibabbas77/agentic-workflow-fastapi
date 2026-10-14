"""Evals: test sets and cases, runs through the full agent loop, run comparison,
judge calibration, production metrics, and the weekly review queue.

Every member can look. Owners and admins manage sets, cases, and runs, and
label results for calibration. Every member, the agent role too, can grade the
weekly review queue.
"""

import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, Query, status

from docent.api.deps import AdminMember, CurrentMember, State
from docent.api.errors import AppError, not_found
from docent.api.eval_schemas import (
    OUTPUT_DEFAULTS,
    SNAPSHOT_DEFAULTS,
    CalibrationOut,
    CaseChangeOut,
    CaseIdsIn,
    CasePrefillOut,
    CasesChangedOut,
    CaseSnapshotOut,
    ChangeCountsOut,
    CompareOut,
    ConfigChangeOut,
    ConfusionOut,
    DayOut,
    DraftingOut,
    DraftsIn,
    EvalCaseIn,
    EvalCaseOut,
    EvalCaseUpdateIn,
    EvalDocumentOut,
    EvalResultOut,
    EvalRunDetailOut,
    EvalRunOut,
    EvalSetDetailOut,
    EvalSetIn,
    EvalSetOut,
    EvalSetUpdateIn,
    GoldDocumentOut,
    HistoryTurn,
    LabelIn,
    MetricDeltaOut,
    ProductionMetricsOut,
    ReasonRateOut,
    ResultOutputOut,
    ReviewCountsOut,
    ReviewDetailOut,
    ReviewGradeIn,
    ReviewItemOut,
    ReviewQueueOut,
    ReviewWeekOut,
    RunConfigOut,
    RunMetricsOut,
    RunSummaryOut,
)
from docent.api.routes.inbox import _messages as transcript
from docent.api.schemas import ErrorOut
from docent.billing import subscriptions
from docent.db.pool import Connection, transaction
from docent.evals import production, repo, review, scoring
from docent.evals.prefill import NoQuestion, prefill
from docent.evals.runner import DRAFT_EVAL_CASES, RUN_EVAL, case_result, run_config
from docent.ids import new_id
from docent.jobs import queue
from docent.services import audit

router = APIRouter(
    prefix="/v1/evals",
    tags=["evals"],
    responses={
        403: {"model": ErrorOut},
        404: {"model": ErrorOut},
        409: {"model": ErrorOut},
        422: {"model": ErrorOut},
    },
)

# The judge's numbers are trusted after this many labels, at this agreement.
CALIBRATION_TARGET = 50
CALIBRATION_THRESHOLD = 0.85
EVAL_JOB_PRIORITY = 150  # after anything a person is waiting on

CONFIG_LABELS = {
    "model": "Answer model",
    "judge_model": "Judge model",
    "answer_prompt": "Answer prompt",
    "triage_prompt": "Triage prompt",
    "judge_prompt": "Judge prompt",
    "embedding_model": "Embedding model",
    "sources": "Sources sent to the model",
    "min_similarity": "Evidence threshold",
    "knowledge_version": "Knowledge version",
}


# Mapping rows to responses


def _set_out(
    row: asyncpg.Record, *, cases: int, drafts: int, last: RunSummaryOut | None
) -> EvalSetOut:
    return EvalSetOut(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        cases=cases,
        drafts=drafts,
        drafting=DraftingOut(
            status=row["draft_status"],
            requested=row["draft_requested"],
            written=row["draft_written"],
            skipped=row["draft_skipped"],
            error=row["draft_error"],
        ),
        last_run=last,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _summary(metrics: dict[str, Any] | None) -> tuple[float | None, float | None]:
    metrics = metrics or {}
    return metrics.get("pass_rate"), metrics.get("wrong_answer_rate")


def _listed_set(row: asyncpg.Record) -> EvalSetOut:
    last = None
    if row["last_run_id"]:
        pass_rate, wrong = _summary(row["last_run_metrics"])
        last = RunSummaryOut(
            id=row["last_run_id"],
            status=row["last_run_status"],
            pass_rate=pass_rate,
            wrong_answer_rate=wrong,
            created_at=row["last_run_created_at"],
            finished_at=row["last_run_finished_at"],
        )
    return _set_out(row, cases=row["cases"], drafts=row["drafts"], last=last)


def _case_out(row: asyncpg.Record, titles: dict[uuid.UUID, str]) -> EvalCaseOut:
    return EvalCaseOut(
        id=row["id"],
        set_id=row["set_id"],
        status=row["status"],
        question=row["question"],
        history=[HistoryTurn.model_validate(t) for t in row["history"] or []],
        identity=row["identity"],
        expected=row["expected"],
        reference_answer=row["reference_answer"],
        must_include=list(row["must_include"]),
        must_not_include=list(row["must_not_include"]),
        gold_documents=[
            GoldDocumentOut(id=d, title=titles.get(d, "Removed document"))
            for d in row["gold_document_ids"]
        ],
        tags=list(row["tags"]),
        origin=row["origin"],
        source_conversation_id=row["source_conversation_id"],
        source_message_id=row["source_message_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _run_out(row: asyncpg.Record, metrics: dict[str, Any] | None = None) -> EvalRunOut:
    found = metrics if metrics is not None else row["metrics"]
    return EvalRunOut(
        id=row["id"],
        set_id=row["set_id"],
        set_name=row["set_name"],
        status=row["status"],
        config=RunConfigOut(
            **{k: v for k, v in (row["config"] or {}).items() if k in CONFIG_LABELS}
        ),
        metrics=RunMetricsOut(**found) if found else None,
        case_count=row["case_count"],
        done_count=row["done_count"],
        cost_micros=row["cost_micros"],
        error=row["error"],
        created_by=row["created_by_name"],
        created_at=row["created_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


def _result_out(row: asyncpg.Record) -> EvalResultOut:
    return EvalResultOut(
        id=row["id"],
        run_id=row["run_id"],
        case_id=row["case_id"],
        position=row["position"],
        question=row["question"],
        expected=row["expected"],
        case=CaseSnapshotOut.model_validate(SNAPSHOT_DEFAULTS | (row["case_snapshot"] or {})),
        output=ResultOutputOut.model_validate(OUTPUT_DEFAULTS | (row["output"] or {})),
        retrieved=row["retrieved"] or [],
        checks=row["checks"] or [],
        verdict=row["verdict"],
        judge_verdict=row["judge_verdict"],
        judge_notes=row["judge_notes"],
        tokens_in=row["tokens_in"],
        tokens_out=row["tokens_out"],
        cost_micros=row["cost_micros"],
        latency_ms=row["latency_ms"],
        label=row["label"],
        labeled_at=row["labeled_at"],
    )


async def _cases_out(conn: Connection, rows: list[asyncpg.Record]) -> list[EvalCaseOut]:
    titles = await repo.document_titles(
        conn, list({d for r in rows for d in r["gold_document_ids"]})
    )
    return [_case_out(r, titles) for r in rows]


async def _set_detail(conn: Connection, set_id: uuid.UUID) -> EvalSetDetailOut:
    row = await repo.get_set(conn, set_id)
    if row is None:
        raise not_found("Eval set")
    cases = await repo.list_cases(conn, set_id)
    runs = await repo.list_runs(conn, set_id, limit=20)
    last = None
    if runs:
        pass_rate, wrong = _summary(runs[0]["metrics"])
        last = RunSummaryOut(
            id=runs[0]["id"],
            status=runs[0]["status"],
            pass_rate=pass_rate,
            wrong_answer_rate=wrong,
            created_at=runs[0]["created_at"],
            finished_at=runs[0]["finished_at"],
        )
    return EvalSetDetailOut(
        set=_set_out(
            row,
            cases=sum(1 for c in cases if c["status"] == "active"),
            drafts=sum(1 for c in cases if c["status"] == "draft"),
            last=last,
        ),
        cases=await _cases_out(conn, cases),
        runs=[_run_out(r) for r in runs],
    )


# Sets


@router.get("/sets")
async def list_sets(member: CurrentMember, state: State) -> list[EvalSetOut]:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return [_listed_set(r) for r in await repo.list_sets(conn)]


@router.post("/sets", status_code=status.HTTP_201_CREATED)
async def create_set(body: EvalSetIn, member: AdminMember, state: State) -> EvalSetOut:
    set_id = new_id()
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        try:
            await conn.execute(
                """
                insert into eval_sets (id, tenant_id, name, description, created_by)
                values ($1, $2, $3, $4, $5)
                """,
                set_id,
                member.tenant_id,
                body.name,
                body.description,
                member.user_id,
            )
        except asyncpg.UniqueViolationError:
            raise _duplicate_name() from None
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="eval.set_created",
            target_type="eval_set",
            target_id=set_id,
            metadata={"name": body.name},
        )
        return (await _set_detail(conn, set_id)).set


def _duplicate_name() -> AppError:
    return AppError(
        409, "duplicate_name", "A set with this name exists.", {"name": "Choose another name."}
    )


@router.get("/sets/{set_id}")
async def get_set(set_id: uuid.UUID, member: CurrentMember, state: State) -> EvalSetDetailOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return await _set_detail(conn, set_id)


@router.patch("/sets/{set_id}")
async def update_set(
    set_id: uuid.UUID, body: EvalSetUpdateIn, member: AdminMember, state: State
) -> EvalSetOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        try:
            updated = await conn.fetchval(
                """
                update eval_sets
                set name = coalesce($2, name), description = coalesce($3, description),
                    updated_at = now()
                where id = $1 returning id
                """,
                set_id,
                body.name,
                body.description,
            )
        except asyncpg.UniqueViolationError:
            raise _duplicate_name() from None
        if updated is None:
            raise not_found("Eval set")
        return (await _set_detail(conn, set_id)).set


@router.delete("/sets/{set_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_set(set_id: uuid.UUID, member: AdminMember, state: State) -> None:
    """Deletes its cases and runs too. A run in progress stops at its next case."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        name = await conn.fetchval("delete from eval_sets where id = $1 returning name", set_id)
        if name is None:
            raise not_found("Eval set")
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="eval.set_deleted",
            target_type="eval_set",
            target_id=set_id,
            metadata={"name": name},
        )


# Cases


async def _check_references(
    conn: Connection,
    gold: list[uuid.UUID] | None,
    conversation_id: uuid.UUID | None = None,
    message_id: uuid.UUID | None = None,
) -> None:
    if gold:
        unknown = set(gold) - await repo.known_documents(conn, gold)
        if unknown:
            raise AppError(
                422,
                "unknown_document",
                "Some gold documents are not in your knowledge.",
                {"gold_document_ids": "Pick documents from your knowledge."},
            )
    if conversation_id and not await conn.fetchval(
        "select exists(select 1 from conversations where id = $1)", conversation_id
    ):
        raise AppError(
            422,
            "unknown_conversation",
            "That conversation is not in this workspace.",
            {"source_conversation_id": "Unknown conversation."},
        )
    if message_id and not await conn.fetchval(
        "select exists(select 1 from messages where id = $1 and conversation_id = $2)",
        message_id,
        conversation_id,
    ):
        raise AppError(
            422,
            "unknown_message",
            "That message is not in the conversation.",
            {"source_message_id": "Unknown message."},
        )


async def _room_for(conn: Connection, set_id: uuid.UUID, adding: int, limit: int) -> None:
    if await repo.count_cases(conn, set_id) + adding > limit:
        raise AppError(
            409,
            "set_full",
            f"A set holds up to {limit} cases, drafts included. Delete some, or start another set.",
        )


@router.post("/sets/{set_id}/cases", status_code=status.HTTP_201_CREATED)
async def create_case(
    set_id: uuid.UUID, body: EvalCaseIn, member: AdminMember, state: State
) -> EvalCaseOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if not await repo.lock_set(conn, set_id):
            raise not_found("Eval set")
        await _room_for(conn, set_id, 1, state.settings.eval_max_cases)
        if body.source_message_id and not body.source_conversation_id:
            raise AppError(
                422,
                "invalid_request",
                "Some fields need attention.",
                {"source_conversation_id": "Give the conversation of the message."},
            )
        await _check_references(
            conn, body.gold_document_ids, body.source_conversation_id, body.source_message_id
        )
        case_id = await repo.insert_case(
            conn,
            tenant_id=member.tenant_id,
            set_id=set_id,
            status="active",
            question=body.question,
            history=[t.model_dump() for t in body.history],
            identity=body.identity,
            expected=body.expected,
            reference_answer=body.reference_answer,
            must_include=list(dict.fromkeys(body.must_include)),
            must_not_include=list(dict.fromkeys(body.must_not_include)),
            gold_document_ids=list(dict.fromkeys(body.gold_document_ids)),
            gold_chunk_ids=[],
            tags=list(dict.fromkeys(body.tags)),
            origin="conversation" if body.source_conversation_id else "manual",
            created_by=member.user_id,
            source_conversation_id=body.source_conversation_id,
            source_message_id=body.source_message_id,
        )
        await conn.execute("update eval_sets set updated_at = now() where id = $1", set_id)
        row = await repo.get_case(conn, case_id)
        assert row is not None
        return (await _cases_out(conn, [row]))[0]


@router.patch("/cases/{case_id}")
async def update_case(
    case_id: uuid.UUID, body: EvalCaseUpdateIn, member: AdminMember, state: State
) -> EvalCaseOut:
    sent = body.model_fields_set
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        current = await repo.get_case(conn, case_id)
        if current is None:
            raise not_found("Case")
        await _check_references(conn, body.gold_document_ids)
        changes: dict[str, Any] = {}
        for name in (
            "status",
            "question",
            "expected",
            "reference_answer",
            "must_include",
            "must_not_include",
            "tags",
        ):
            value = getattr(body, name)
            if name in sent and value is not None:
                changes[name] = list(dict.fromkeys(value)) if isinstance(value, list) else value
        if "history" in sent and body.history is not None:
            changes["history"] = [t.model_dump() for t in body.history]
        if "identity" in sent:
            changes["identity"] = body.identity
        if "gold_document_ids" in sent and body.gold_document_ids is not None:
            gold = list(dict.fromkeys(body.gold_document_ids))
            changes["gold_document_ids"] = gold
            if set(gold) != set(current["gold_document_ids"]):
                changes["gold_chunk_ids"] = []  # the exact passage no longer applies
        if changes:
            assignments = ", ".join(f"{k} = ${i}" for i, k in enumerate(changes, 2))
            await conn.execute(
                f"update eval_cases set {assignments}, updated_at = now() where id = $1",  # noqa: S608
                case_id,
                *changes.values(),
            )
        row = await repo.get_case(conn, case_id)
        assert row is not None
        return (await _cases_out(conn, [row]))[0]


@router.delete("/cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case(case_id: uuid.UUID, member: AdminMember, state: State) -> None:
    """Past results keep their copy of the case."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if (
            await conn.fetchval("delete from eval_cases where id = $1 returning id", case_id)
            is None
        ):
            raise not_found("Case")


@router.post("/sets/{set_id}/cases/approve")
async def approve_drafts(
    set_id: uuid.UUID, body: CaseIdsIn, member: AdminMember, state: State
) -> CasesChangedOut:
    """Approve drafts, so runs use them."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if not await repo.lock_set(conn, set_id):
            raise not_found("Eval set")
        done = await conn.execute(
            """
            update eval_cases set status = 'active', updated_at = now()
            where set_id = $1 and status = 'draft' and id = any($2::uuid[])
            """,
            set_id,
            body.case_ids,
        )
    return CasesChangedOut(changed=int(done.split()[-1]))


@router.post("/sets/{set_id}/cases/discard")
async def discard_drafts(
    set_id: uuid.UUID, body: CaseIdsIn, member: AdminMember, state: State
) -> CasesChangedOut:
    """Delete drafts. Approved cases are never touched here."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if not await repo.lock_set(conn, set_id):
            raise not_found("Eval set")
        done = await conn.execute(
            """
            delete from eval_cases
            where set_id = $1 and status = 'draft' and id = any($2::uuid[])
            """,
            set_id,
            body.case_ids,
        )
    return CasesChangedOut(changed=int(done.split()[-1]))


@router.post("/sets/{set_id}/drafts", status_code=status.HTTP_202_ACCEPTED)
async def write_drafts(
    set_id: uuid.UUID, body: DraftsIn, member: AdminMember, state: State
) -> EvalSetOut:
    """Ask the model for draft cases from your own help articles. They arrive as drafts."""
    count = min(body.count, state.settings.eval_drafts_per_request)
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        found = await conn.fetchrow(
            "select draft_status from eval_sets where id = $1 for update", set_id
        )
        if found is None:
            raise not_found("Eval set")
        if not (await subscriptions.entitlement(conn, member.tenant_id)).active:
            raise AppError(
                409,
                "plan_inactive",
                "Drafts need an active plan. Choose one on the Billing page.",
            )
        drafted = (await repo.usage(conn)).drafts_today
        if drafted + count > state.settings.eval_drafts_per_day:
            raise AppError(
                409,
                "too_many_drafts",
                f"This workspace asked for {drafted:,} drafts in the last day, and the limit is "
                f"{state.settings.eval_drafts_per_day:,}. Try again later.",
            )
        if found["draft_status"] == "running":
            raise AppError(409, "drafting", "Drafts for this set are being written already.")
        if not await conn.fetchval("select exists(select 1 from chunks)"):
            raise AppError(
                409,
                "no_knowledge",
                "Teach the agent first: drafts come from the help articles on the Knowledge page.",
            )
        await _room_for(conn, set_id, count, state.settings.eval_max_cases)
        await conn.execute(
            """
            update eval_sets
            set draft_status = 'running', draft_requested = $2, draft_written = 0,
                draft_skipped = 0, draft_error = null, updated_at = now()
            where id = $1
            """,
            set_id,
            count,
        )
        await queue.enqueue(
            conn,
            DRAFT_EVAL_CASES,
            {"set_id": str(set_id), "requested_by": str(member.user_id)},
            tenant_id=member.tenant_id,
            priority=EVAL_JOB_PRIORITY,
            max_attempts=2,
            dedupe_key=f"{DRAFT_EVAL_CASES}:{set_id}",
        )
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="eval.drafts_requested",
            target_type="eval_set",
            target_id=set_id,
            metadata={"count": count},
        )
        detail = await _set_detail(conn, set_id)
    await state.waker.wake()
    return detail.set


@router.get("/documents")
async def list_documents(member: CurrentMember, state: State) -> list[EvalDocumentOut]:
    """Documents a case can name as gold."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        rows = await conn.fetch(
            """
            select d.id, coalesce(nullif(d.title, ''), d.locator) as title, s.title as source
            from documents d join knowledge_sources s on s.id = d.source_id
            where s.status <> 'deleting'
            order by lower(coalesce(nullif(d.title, ''), d.locator)), d.id
            limit 1000
            """
        )
    return [EvalDocumentOut(id=r["id"], title=r["title"], source=r["source"]) for r in rows]


@router.get("/prefill")
async def prefill_case(
    member: AdminMember,
    state: State,
    conversation_id: uuid.UUID,
    message_id: uuid.UUID | None = None,
) -> CasePrefillOut:
    """A case filled in from a conversation or one of its messages, for the case editor."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        try:
            found = await prefill(conn, conversation_id, message_id)
        except NoQuestion:
            raise AppError(
                422, "no_question", "This conversation has no message from the customer."
            ) from None
    if found is None:
        raise not_found("Conversation")
    return CasePrefillOut(
        question=found.question,
        history=[HistoryTurn.model_validate(t) for t in found.history],
        identity=found.identity,
        expected=found.expected,  # type: ignore[arg-type]
        reference_answer=found.reference_answer,
        tags=found.tags,
        source_conversation_id=found.source_conversation_id,
        source_message_id=found.source_message_id,
    )


# Runs


@router.post("/sets/{set_id}/runs", status_code=status.HTTP_202_ACCEPTED)
async def start_run(set_id: uuid.UUID, member: AdminMember, state: State) -> EvalRunOut:
    """Queue a run of every approved case. One run at a time per workspace."""
    run_id = new_id()
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if not await repo.lock_set(conn, set_id):
            raise not_found("Eval set")
        cases = await conn.fetchval(
            "select count(*) from eval_cases where set_id = $1 and status = 'active'", set_id
        )
        if not cases:
            raise AppError(422, "no_cases", "Add a case, or approve a draft, before running.")
        current = await subscriptions.entitlement(conn, member.tenant_id)
        if not current.active:
            raise AppError(
                409,
                "plan_inactive",
                "Evals need an active plan. Choose one on the Billing page.",
            )
        if await repo.active_run(conn):
            raise _busy()
        spent = await repo.usage(conn)
        if spent.runs_today >= state.settings.eval_runs_per_day:
            raise AppError(
                409,
                "too_many_runs",
                f"This workspace ran {state.settings.eval_runs_per_day} evals in the last day. "
                "Try again later.",
            )
        budget = repo.monthly_case_budget(current.plan.replies_per_month)
        if spent.cases_this_month + cases > budget:
            raise AppError(
                409,
                "eval_budget_reached",
                f"This run has {cases:,} cases and {budget - spent.cases_this_month:,} of this "
                f"month's {budget:,} eval cases are left on the {current.plan.name} plan. Run a "
                "smaller set, or wait for next month.",
            )
        try:
            await conn.execute(
                """
                insert into eval_runs (id, tenant_id, set_id, config, case_count, created_by)
                values ($1, $2, $3, $4, $5, $6)
                """,
                run_id,
                member.tenant_id,
                set_id,
                run_config(state.settings),
                cases,
                member.user_id,
            )
        except asyncpg.UniqueViolationError:
            raise _busy() from None
        await queue.enqueue(
            conn,
            RUN_EVAL,
            {"run_id": str(run_id)},
            tenant_id=member.tenant_id,
            priority=EVAL_JOB_PRIORITY,
            max_attempts=3,
            dedupe_key=f"{RUN_EVAL}:{run_id}",
        )
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="eval.run_started",
            target_type="eval_run",
            target_id=run_id,
            metadata={"set_id": str(set_id), "cases": cases},
        )
        row = await repo.get_run(conn, run_id)
        assert row is not None
    await state.waker.wake()
    return _run_out(row)


def _busy() -> AppError:
    return AppError(
        409,
        "run_in_progress",
        "Another eval is running in this workspace. Wait for it to finish, or stop it.",
    )


@router.get("/runs")
async def list_runs(
    member: CurrentMember, state: State, set_id: uuid.UUID | None = None
) -> list[EvalRunOut]:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return [_run_out(r) for r in await repo.list_runs(conn, set_id, limit=100)]


async def _run_detail(conn: Connection, run_id: uuid.UUID) -> EvalRunDetailOut:
    row = await repo.get_run(conn, run_id)
    if row is None:
        raise not_found("Run")
    results = await repo.results(conn, run_id)
    # While a run is going, its metrics so far.
    metrics = None if row["metrics"] else scoring.run_metrics([case_result(r) for r in results])
    return EvalRunDetailOut(
        run=_run_out(row, metrics if results else None),
        results=[_result_out(r) for r in results],
    )


@router.get("/runs/{run_id}")
async def get_run(run_id: uuid.UUID, member: CurrentMember, state: State) -> EvalRunDetailOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return await _run_detail(conn, run_id)


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: uuid.UUID, member: AdminMember, state: State) -> EvalRunOut:
    """Stop a run. Cases already done keep their results."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        row = await repo.get_run(conn, run_id)
        if row is None:
            raise not_found("Run")
        stopped = await conn.fetchval(
            """
            update eval_runs set status = 'canceled', finished_at = now()
            where id = $1 and status in ('queued', 'running') returning id
            """,
            run_id,
        )
        if stopped is None:
            raise AppError(409, "run_finished", "This run has already finished.")
        row = await repo.get_run(conn, run_id)
        assert row is not None
        return _run_out(row)


def _outcome(row: asyncpg.Record) -> scoring.CaseOutcome:
    output = row["output"] or {}
    return scoring.CaseOutcome(
        key=str(row["case_id"]) if row["case_id"] else f"result:{row['id']}",
        question=row["question"],
        verdict=row["verdict"],
        reply_type=output.get("type"),
        reason=output.get("reason") if output.get("type") == "escalate" else None,
        failed_checks=frozenset(c["name"] for c in row["checks"] or [] if not c["passed"]),
        # The heading path starts with the document's title already.
        cited=tuple(
            c["heading_path"] or c["document_title"] for c in output.get("citations") or []
        ),
        judge_notes=row["judge_notes"],
        expected=row["expected"],
    )


def _text(value: object) -> str | None:
    return None if value is None else str(value)


@router.get("/compare")
async def compare_runs(
    member: CurrentMember, state: State, a: uuid.UUID, b: uuid.UUID
) -> CompareOut:
    """Two runs of one set: metric changes, settings that differ, and every case that changed."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        first, second = await _run_detail(conn, a), await _run_detail(conn, b)
        rows_a, rows_b = await repo.results(conn, a), await repo.results(conn, b)
    if first.run.set_id != second.run.set_id:
        raise AppError(
            422, "different_sets", "Pick two runs of the same set.", {"b": "Another set's run."}
        )
    by_id = {r.id: r for r in [*first.results, *second.results]}
    changes = scoring.compare([_outcome(r) for r in rows_a], [_outcome(r) for r in rows_b])
    result_of = {
        "a": {_outcome(r).key: by_id[r["id"]] for r in rows_a},
        "b": {_outcome(r).key: by_id[r["id"]] for r in rows_b},
    }
    metrics_a = first.run.metrics.model_dump() if first.run.metrics else {}
    metrics_b = second.run.metrics.model_dump() if second.run.metrics else {}
    config_a, config_b = first.run.config.model_dump(), second.run.config.model_dump()
    counts = {k: sum(1 for c in changes if c.change == k) for k in ChangeCountsOut.model_fields}
    return CompareOut(
        a=first.run,
        b=second.run,
        metrics=[
            MetricDeltaOut(key=d.key, label=d.label, a=d.a, b=d.b, delta=d.delta, better=d.better)
            for d in scoring.metric_deltas(metrics_a, metrics_b)
        ],
        config=[
            ConfigChangeOut(key=k, label=label, a=_text(config_a.get(k)), b=_text(config_b.get(k)))
            for k, label in CONFIG_LABELS.items()
            if config_a.get(k) != config_b.get(k)
        ],
        counts=ChangeCountsOut(**counts),
        cases=[
            CaseChangeOut(
                case_id=uuid.UUID(c.key) if not c.key.startswith("result:") else None,
                question=c.question,
                change=c.change,
                a=result_of["a"].get(c.key),
                b=result_of["b"].get(c.key),
                why=c.why,
            )
            for c in changes
        ],
    )


# Calibration


@router.put("/results/{result_id}/label")
async def label_result(
    result_id: uuid.UUID, body: LabelIn, member: AdminMember, state: State
) -> EvalResultOut:
    """Your call on a judged result: was the answer right or wrong?"""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        found = await conn.fetchrow(
            "select judge_verdict from eval_results where id = $1", result_id
        )
        if found is None:
            raise not_found("Result")
        if found["judge_verdict"] is None:
            raise AppError(
                422, "not_judged", "Only results the judge graded can be labeled for calibration."
            )
        await conn.execute(
            """
            update eval_results
            set label = $2,
                labeled_by = case when $2::text is null then null else $3::uuid end,
                labeled_at = case when $2::text is null then null else now() end
            where id = $1
            """,
            result_id,
            body.label,
            member.user_id,
        )
        row = await conn.fetchrow(
            f"select {repo.RESULT_COLUMNS} from eval_results where id = $1",  # noqa: S608
            result_id,
        )
    assert row is not None
    return _result_out(row)


@router.get("/calibration")
async def calibration(member: CurrentMember, state: State) -> CalibrationOut:
    """How often the judge agrees with your labels, and judged results waiting for one."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        pairs = await conn.fetch(
            """
            select judge_verdict, label from eval_results
            where label is not null and judge_verdict is not null
            """
        )
        waiting = await conn.fetch(
            f"""
            select {repo.RESULT_COLUMNS} from eval_results
            where judge_verdict is not null and label is null
            order by created_at desc, position limit 20
            """  # noqa: S608
        )
        recent = await conn.fetch(
            f"""
            select {repo.RESULT_COLUMNS} from eval_results
            where label is not null order by labeled_at desc limit 20
            """  # noqa: S608
        )
    found = scoring.agreement((p["judge_verdict"], p["label"]) for p in pairs)
    return CalibrationOut(
        target=CALIBRATION_TARGET,
        threshold=CALIBRATION_THRESHOLD,
        labeled=found.labeled,
        agreed=found.agreed,
        agreement=found.rate,
        trusted=found.labeled >= CALIBRATION_TARGET and (found.rate or 0) >= CALIBRATION_THRESHOLD,
        confusion=ConfusionOut(
            judge_correct_person_right=found.judge_correct_person_right,
            judge_correct_person_wrong=found.judge_correct_person_wrong,
            judge_faulted_person_right=found.judge_faulted_person_right,
            judge_faulted_person_wrong=found.judge_faulted_person_wrong,
        ),
        to_label=[_result_out(r) for r in waiting],
        recent=[_result_out(r) for r in recent],
    )


# Production metrics


@router.get("/metrics")
async def production_metrics(
    member: CurrentMember,
    state: State,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> ProductionMetricsOut:
    """Real widget traffic over the last `days` days."""
    now = datetime.now(UTC)
    start, end = production.period(days, now)
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        found = await production.production_metrics(conn, start, end, now)
    rates = found.rates()
    return ProductionMetricsOut(
        days=days,
        start=start,
        end=end,
        conversations=found.conversations,
        auto_resolved=found.auto_resolved,
        confirmed_resolved=found.confirmed_resolved,
        escalated=found.escalated,
        answers=found.answers,
        marked_wrong=found.marked_wrong,
        reviewed=found.reviewed,
        reviewed_wrong=found.reviewed_wrong,
        latency_p50_ms=found.latency_p50_ms,
        latency_p95_ms=found.latency_p95_ms,
        cost_micros=found.cost_micros,
        reasons=[
            ReasonRateOut(
                reason=reason,  # type: ignore[arg-type]
                conversations=n,
                rate=round(n / found.conversations, 4) if found.conversations else None,
            )
            for reason, n in found.reasons.items()
        ],
        daily=[
            DayOut(day=d.day, conversations=d.conversations, escalated=d.escalated)
            for d in found.days
        ],
        **rates,
    )


# Weekly review


def _review_item(row: asyncpg.Record) -> ReviewItemOut:
    return ReviewItemOut(
        id=row["id"],
        week_start=row["week_start"],
        conversation_id=row["conversation_id"],
        message_id=row["message_id"],
        question=row["question"],
        answer=row["answer"],
        mode=row["mode"],
        claims={str(k): str(v) for k, v in (row["claims"] or {}).items()},
        started_at=row["started_at"],
        escalated=row["escalated"],
        grade=row["grade"],
        note=row["note"],
        graded_by=row["graded_by_name"],
        graded_at=row["graded_at"],
        sampled_at=row["sampled_at"],
    )


@router.get("/review")
async def review_queue(
    member: CurrentMember, state: State, week: date | None = None
) -> ReviewQueueOut:
    """A week's sample of answered conversations to grade. This week's fills itself."""
    now = datetime.now(UTC)
    this_week = review.week_of(now.date())
    wanted = review.week_of(week) if week else this_week
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if wanted == this_week:
            await review.top_up(conn, member.tenant_id, now)
        items = [_review_item(r) for r in await review.week_items(conn, wanted)]
        weeks = await review.weeks(conn)
    listed = [
        ReviewWeekOut(week_start=w["week_start"], sampled=w["sampled"], graded=w["graded"])
        for w in weeks
    ]
    if not any(w.week_start == this_week for w in listed):
        listed.insert(0, ReviewWeekOut(week_start=this_week, sampled=0, graded=0))
    return ReviewQueueOut(
        week_start=wanted,
        current=wanted == this_week,
        sample_size=review.SAMPLE_SIZE,
        counts=ReviewCountsOut(
            sampled=len(items),
            graded=sum(1 for i in items if i.grade),
            right=sum(1 for i in items if i.grade == "right"),
            wrong=sum(1 for i in items if i.grade == "wrong"),
        ),
        items=items,
        weeks=listed,
    )


async def _review_detail(conn: Connection, item_id: uuid.UUID) -> ReviewDetailOut:
    row = await review.get_item(conn, item_id)
    if row is None:
        raise not_found("Review item")
    item = _review_item(row)
    siblings = await review.week_items(conn, item.week_start)
    ids = [r["id"] for r in siblings]
    after = ids[ids.index(item.id) + 1 :] + ids[: ids.index(item.id)] if item.id in ids else ids
    ungraded = {r["id"] for r in siblings if r["grade"] is None}
    return ReviewDetailOut(
        item=item,
        messages=await transcript(conn, item.conversation_id, None),
        next_id=next((i for i in after if i in ungraded), None),
    )


@router.get("/review/{item_id}")
async def get_review_item(
    item_id: uuid.UUID, member: CurrentMember, state: State
) -> ReviewDetailOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return await _review_detail(conn, item_id)


@router.put("/review/{item_id}")
async def grade_review_item(
    item_id: uuid.UUID, body: ReviewGradeIn, member: CurrentMember, state: State
) -> ReviewDetailOut:
    """Grade a conversation right or wrong. Wrong also marks its answer as wrong."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if not await review.grade(
            conn, item_id, user_id=member.user_id, grade=body.grade, note=body.note
        ):
            raise not_found("Review item")
        return await _review_detail(conn, item_id)
