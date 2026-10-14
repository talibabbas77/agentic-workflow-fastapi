"""The platform admin console: Docent's own operators looking across every workspace.

Not the per-company app. Every route needs deps.PlatformAdmin, and
middleware.PlatformAdminGate answers anyone else with the 404 of an unknown
path before routing. Reads run with the app.platform_admin capability; a
change runs in the target workspace's own tenant context. Opening a workspace
and every action are written to that workspace's audit log, with the admin as
actor. Counts and metadata only: no message, knowledge, or memory content.
"""

import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, time
from typing import Annotated

from fastapi import APIRouter, Path, Query

from docent.api.deps import PlatformAdmin, State
from docent.api.errors import AppError, not_found
from docent.api.schemas import (
    AdminActionsOut,
    AdminActivityOut,
    AdminAnomalyOut,
    AdminAuditEntryOut,
    AdminBillingEventOut,
    AdminBillingEventsOut,
    AdminCompIn,
    AdminDeadJobOut,
    AdminExtendTrialIn,
    AdminFiguresOut,
    AdminJobCountOut,
    AdminJobsOut,
    AdminKnowledgeOut,
    AdminMemberOut,
    AdminOverviewOut,
    AdminPeopleOut,
    AdminPersonOut,
    AdminPersonWorkspaceOut,
    AdminPlanStateCount,
    AdminReasonIn,
    AdminRedisOut,
    AdminSubscriptionOut,
    AdminUsageMonthOut,
    AdminWidgetOut,
    AdminWorkspaceDetailOut,
    AdminWorkspaceRowOut,
    AdminWorkspacesOut,
    ErrorOut,
    PlanId,
    WorkspaceSort,
    WorkspaceState,
)
from docent.billing import manual, refunds, subscriptions
from docent.billing.changes import PlanChangeError
from docent.billing.plans import PLAN_BY_ID, TRIAL
from docent.billing.subscriptions import Entitlement
from docent.console import figures, operations, people, workspace
from docent.console.figures import Figures
from docent.db.pool import Connection, set_context, transaction
from docent.redis_budget import ALERT_PERCENTS, LOCAL_ONLY_PERCENT, month_of
from docent.redis_budget import read as read_redis_budget
from docent.services import audit
from docent.services.accounts import SessionUser

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/v1/admin",
    tags=["platform admin"],
    responses={404: {"model": ErrorOut}, 422: {"model": ErrorOut}},
)

Search = Annotated[str | None, Query(max_length=200)]
Page = Annotated[int, Query(ge=1, le=10_000)]


@router.get("/overview")
async def admin_overview(admin: PlatformAdmin, state: State) -> AdminOverviewOut:
    budget = state.settings.redis_monthly_command_budget
    async with transaction(state.pool, platform_admin=True) as conn:
        data = await figures.overview(conn)
        redis = await read_redis_budget(conn, month_of(datetime.now(UTC)), budget)
    median = data.median_cost_per_reply_micros
    return AdminOverviewOut(
        period_start=data.period_start,
        workspaces=data.workspaces,
        by_plan_state=[
            AdminPlanStateCount(plan_id=r["plan_id"], state=r["state"], count=r["count"])
            for r in data.by_plan_state
        ],
        paying_workspaces=data.paying_workspaces,
        mrr_micros=data.mrr_micros,
        topups_this_month_micros=data.topups_micros,
        new_workspaces_30d=data.new_workspaces_30d,
        new_accounts_30d=data.new_accounts_30d,
        replies_this_month=data.replies_this_month,
        cost_this_month_micros=data.cost_this_month_micros,
        gross_margin=data.gross_margin,
        median_cost_per_reply_micros=median,
        anomalies=[
            AdminAnomalyOut(
                tenant_id=r["id"],
                name=r["name"],
                plan_id=r["plan_id"] or TRIAL.id,
                replies_used=r["replies_used"],
                cost_micros=r["cost_micros"],
                cost_per_reply_micros=r["cost_per_reply"],
                times_median=r["cost_per_reply"] / median if median else 0,
            )
            for r in data.anomalies
        ],
        redis=AdminRedisOut(
            status=state.redis.status(),
            month=redis.month,
            commands=redis.commands + state.redis.unflushed,
            budget=redis.budget if redis.updated_at else budget,
            alert_percents=list(ALERT_PERCENTS),
            local_only_percent=LOCAL_ONLY_PERCENT,
            alerted_80_at=redis.alerted_80_at,
            alerted_90_at=redis.alerted_90_at,
            local_only_since=redis.local_only_since,
            counted_at=redis.updated_at,
        ),
    )


@router.get("/workspaces")
async def admin_workspaces(
    admin: PlatformAdmin,
    state: State,
    q: Search = None,
    plan: PlanId | None = None,
    status_filter: Annotated[WorkspaceState | None, Query(alias="status")] = None,
    sort: WorkspaceSort = "newest",
    page: Page = 1,
) -> AdminWorkspacesOut:
    async with transaction(state.pool, platform_admin=True) as conn:
        rows, total = await figures.list_workspaces(
            conn, search=q, plan_id=plan, state=status_filter, sort=sort, page=page
        )
        median = await figures.median_cost_per_reply(conn)
        subs = await conn.fetch(
            "select * from subscriptions where tenant_id = any($1::uuid[])", [r["id"] for r in rows]
        )
    current = {s["tenant_id"]: subscriptions.from_row(s) for s in subs}
    items = []
    for row in rows:
        entitlement = current.get(row["id"])
        items.append(
            AdminWorkspaceRowOut(
                id=row["id"],
                name=row["name"],
                slug=row["slug"],
                plan=entitlement.plan if entitlement else TRIAL,
                state=row["state"],
                provider="stripe" if row["provider"] == "stripe" else "manual",
                members=row["members"],
                created_at=row["created_at"],
                figures=_figures(figures.figures(row, entitlement, median)),
            )
        )
    return AdminWorkspacesOut(
        items=items,
        total=total,
        page=page,
        per_page=figures.PER_PAGE,
        median_cost_per_reply_micros=median,
    )


@router.get("/workspaces/{tenant_id}")
async def admin_workspace(
    tenant_id: uuid.UUID, admin: PlatformAdmin, state: State
) -> AdminWorkspaceDetailOut:
    """One workspace. Opening it is written to its audit log, like any action."""
    async with transaction(state.pool, tenant_id=tenant_id) as conn:
        if not await conn.fetchval("select exists(select 1 from tenants where id = $1)", tenant_id):
            raise not_found("Workspace")
        await _audit(conn, admin, tenant_id, "platform_admin.workspace_viewed")
    return await _detail(state, tenant_id)


@router.post("/workspaces/{tenant_id}/trial", responses={409: {"model": ErrorOut}})
async def admin_extend_trial(
    tenant_id: uuid.UUID, body: AdminExtendTrialIn, admin: PlatformAdmin, state: State
) -> AdminWorkspaceDetailOut:
    async with _workspace_change(state, tenant_id) as (conn, current):
        ends = await manual.extend_trial(conn, tenant_id, current, body.days)
        await _audit(
            conn,
            admin,
            tenant_id,
            "platform_admin.trial_extended",
            {"reason": body.reason, "days": str(body.days), "trial_ends_at": ends.isoformat()},
        )
    return await _detail(state, tenant_id)


@router.post("/workspaces/{tenant_id}/comp", responses={409: {"model": ErrorOut}})
async def admin_give_comp(
    tenant_id: uuid.UUID, body: AdminCompIn, admin: PlatformAdmin, state: State
) -> AdminWorkspaceDetailOut:
    """A paid plan, free of charge, until the start of a chosen day (UTC)."""
    until = datetime.combine(body.until, time(), tzinfo=UTC)
    plan = PLAN_BY_ID[body.plan_id]
    async with _workspace_change(state, tenant_id) as (conn, current):
        await manual.give_comp(conn, tenant_id, current, plan, until)
        await _audit(
            conn,
            admin,
            tenant_id,
            "platform_admin.plan_comped",
            {
                "reason": body.reason,
                "plan_id": plan.id,
                "from_plan_id": current.plan.id,
                "until": until.isoformat(),
            },
        )
    return await _detail(state, tenant_id)


@router.post("/workspaces/{tenant_id}/comp/end", responses={409: {"model": ErrorOut}})
async def admin_end_comp(
    tenant_id: uuid.UUID, body: AdminReasonIn, admin: PlatformAdmin, state: State
) -> AdminWorkspaceDetailOut:
    async with _workspace_change(state, tenant_id) as (conn, current):
        await manual.end_comp(conn, tenant_id, current)
        await _audit(
            conn,
            admin,
            tenant_id,
            "platform_admin.comp_ended",
            {"reason": body.reason, "plan_id": current.plan.id},
        )
    return await _detail(state, tenant_id)


@router.get("/people")
async def admin_people(
    admin: PlatformAdmin, state: State, q: Search = None, page: Page = 1
) -> AdminPeopleOut:
    async with transaction(state.pool, platform_admin=True) as conn:
        rows, workspaces, total = await people.search(conn, q, page)
    return AdminPeopleOut(
        items=[
            AdminPersonOut(
                id=r["id"],
                name=r["name"],
                email=r["email"],
                email_verified=r["email_verified"],
                is_platform_admin=r["is_platform_admin"],
                created_at=r["created_at"],
                last_login_at=r["last_login_at"],
                workspaces=[
                    AdminPersonWorkspaceOut(
                        tenant_id=w["tenant_id"], name=w["name"], role=w["role"]
                    )
                    for w in workspaces.get(r["id"], [])
                ],
            )
            for r in rows
        ],
        total=total,
        page=page,
        per_page=figures.PER_PAGE,
    )


@router.get("/jobs")
async def admin_jobs(admin: PlatformAdmin, state: State) -> AdminJobsOut:
    async with transaction(state.pool, platform_admin=True) as conn:
        health = await operations.queue_health(conn)
    totals = health.totals
    return AdminJobsOut(
        counts=[
            AdminJobCountOut(kind=r["kind"], status=r["status"], count=r["count"])
            for r in health.counts
        ],
        ready=totals["ready"],
        scheduled=totals["scheduled"],
        running=totals["running"],
        dead=totals["dead"],
        oldest_ready_seconds=totals["oldest_ready_seconds"],
        dead_jobs=[AdminDeadJobOut(**dict(r)) for r in health.dead_jobs],
    )


@router.post("/jobs/{job_id}/retry", responses={409: {"model": ErrorOut}})
async def admin_retry_job(
    job_id: Annotated[int, Path(ge=1, le=2**63 - 1)], admin: PlatformAdmin, state: State
) -> AdminJobsOut:
    """Put a dead job back in the queue with fresh attempts, and wake the worker."""
    async with transaction(state.pool, platform_admin=True) as conn:
        try:
            job = await operations.retry_dead_job(conn, job_id)
        except operations.RetryRefused as exc:
            raise AppError(exc.status, exc.code, exc.message) from None
        if job["tenant_id"] is None:
            log.info("dead job retried", extra={"job": job_id, "admin": str(admin.user_id)})
        else:
            # The audit row is a write, so it goes in with that workspace's context alone.
            await set_context(conn, tenant_id=job["tenant_id"])
            await _audit(
                conn,
                admin,
                job["tenant_id"],
                "platform_admin.job_retried",
                {"kind": job["kind"]},
                target=("job", str(job_id)),
            )
    await state.waker.wake()
    return await admin_jobs(admin, state)


@router.get("/billing-events")
async def admin_billing_events(
    admin: PlatformAdmin, state: State, page: Page = 1
) -> AdminBillingEventsOut:
    async with transaction(state.pool, platform_admin=True) as conn:
        rows, total = await operations.billing_events(conn, page)
    return AdminBillingEventsOut(
        items=[AdminBillingEventOut(**dict(r)) for r in rows],
        total=total,
        page=page,
        per_page=operations.EVENTS_PER_PAGE,
    )


async def _detail(state: State, tenant_id: uuid.UUID) -> AdminWorkspaceDetailOut:
    async with transaction(state.pool, tenant_id=tenant_id, platform_admin=True) as conn:
        tenant = await workspace.find(conn, tenant_id)
        if tenant is None:
            raise not_found("Workspace")
        current = await subscriptions.entitlement(conn, tenant_id)
        money = await figures.workspace_figures(conn, tenant_id)
        data = await workspace.load(conn, tenant)
    assert money is not None
    this_month = figures.figures(money, current, money["median"])
    counts = data.counts
    refusal = manual.refusal(current)
    usage = [AdminUsageMonthOut(**dict(r)) for r in data.usage]
    if usage:  # this month's cap is the live one; the stored cap updates on the next reply
        usage[-1] = usage[-1].model_copy(update={"replies_cap": this_month.replies_cap})
    return AdminWorkspaceDetailOut(
        id=tenant["id"],
        name=tenant["name"],
        slug=tenant["slug"],
        status=tenant["status"],
        created_at=tenant["created_at"],
        subscription=_subscription(current, tenant["state"]),
        this_month=_figures(this_month),
        activity=AdminActivityOut(
            conversations=counts["conversations"],
            widget_conversations=counts["widget_conversations"],
            handoffs=counts["handoffs"],
            open_handoffs=counts["open_handoffs"],
        ),
        usage=usage,
        members=[AdminMemberOut(**dict(r)) for r in data.members],
        widgets=[AdminWidgetOut(**dict(r)) for r in data.widgets],
        knowledge=AdminKnowledgeOut(
            sources=counts["sources"],
            failed_sources=counts["failed_sources"],
            team_answers=counts["team_answers"],
            documents=counts["documents"],
            documents_cap=current.plan.pages,
            passages=counts["passages"],
        ),
        billing_events=[
            AdminBillingEventOut(**dict(r), workspace_name=tenant["name"])
            for r in data.billing_events
        ],
        audit=[AdminAuditEntryOut(**dict(r)) for r in data.audit],
        actions=AdminActionsOut(
            extend_trial=refusal is None and current.status == "trialing",
            give_comp=refusal is None,
            end_comp=refusal is None and manual.is_comped(current),
            refusal=refusal,
        ),
    )


def _subscription(current: Entitlement, state: WorkspaceState) -> AdminSubscriptionOut:
    return AdminSubscriptionOut(
        plan=current.plan,
        state=state,
        status=current.status,
        provider="stripe" if current.provider == "stripe" else "manual",
        active=current.active,
        trial_ends_at=current.trial_ends_at,
        current_period_start=current.current_period_start,
        current_period_end=current.current_period_end,
        cancel_at=current.cancel_at,
        cancel_at_period_end=current.cancel_at_period_end,
        scheduled_plan=current.scheduled_plan,
        scheduled_change_at=current.scheduled_change_at,
        grace_ends_at=current.grace_ends_at,
        comped_until=current.comped_until,
        first_paid_at=current.first_paid_at,
        refunded_at=current.refunded_at,
        refund_until=refunds.window_end(current),
        customer_id=current.customer_id,
        subscription_id=current.subscription_id,
    )


def _figures(f: Figures) -> AdminFiguresOut:
    return AdminFiguresOut(
        replies_used=f.replies_used,
        replies_cap=f.replies_cap,
        cost_micros=f.cost_micros,
        revenue_micros=f.revenue_micros,
        margin_micros=f.margin_micros,
        cost_per_reply_micros=f.cost_per_reply_micros,
        anomaly=f.anomaly,
    )


@asynccontextmanager
async def _workspace_change(
    state: State, tenant_id: uuid.UUID
) -> AsyncIterator[tuple[Connection, Entitlement]]:
    """A change to one workspace, in its own tenant context and never with the console's
    read capability, one at a time. Billing rule refusals become a plain 409."""
    async with transaction(state.pool, tenant_id=tenant_id) as conn:
        if not await conn.fetchval("select exists(select 1 from tenants where id = $1)", tenant_id):
            raise not_found("Workspace")
        await conn.execute("select 1 from subscriptions where tenant_id = $1 for update", tenant_id)
        current = await subscriptions.entitlement(conn, tenant_id)
        try:
            yield conn, current
        except PlanChangeError as exc:
            raise AppError(409, exc.code, exc.message) from None


async def _audit(
    conn: Connection,
    admin: SessionUser,
    tenant_id: uuid.UUID,
    action: str,
    metadata: dict[str, str] | None = None,
    target: tuple[str, str] | None = None,
) -> None:
    target_type, target_id = target or ("tenant", str(tenant_id))
    await audit.record(
        conn,
        tenant_id=tenant_id,
        actor_user_id=admin.user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        metadata={"by": "platform_admin", **(metadata or {})},
    )
