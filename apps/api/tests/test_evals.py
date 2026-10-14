"""Evals: sets and cases, drafts, sandboxed runs, comparison, calibration, production
metrics, the weekly review queue, and the CI gate."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest

from docent import cli
from docent.config import Settings
from docent.db.pool import Pool, transaction
from docent.evals import gate, review, scoring
from docent.evals.drafts import DraftCase, check_draft, grounded
from docent.evals.sandbox import CaseInput, SandboxDeps, run_case
from docent.ids import new_id
from tests.conftest import ClientFactory, Drain, verified_owner
from tests.fakes import FakeChat, FakeEmbedder
from tests.inbox_helpers import handoff, join, tid

GUIDE = b"""# Billing guide

## Refunds

Annual plans can be refunded within 30 days of renewal. Contact billing to start a refund.

## Invoices

Invoices are emailed on the first day of each month and list every seat.
"""

REFUND_QUESTION = "how do refunds work for annual plans"

SYNC_GUIDE = b"""# Sync guide

## Offline edits

Notes you edit without a connection are saved on the device and sync within two minutes
of reconnecting. If the same note changed in two places, both versions are kept and the
older one is renamed with the word conflict, so nothing you wrote is ever lost.

## Devices

The Free plan syncs two devices. Plus and Team sync up to ten devices per person. Signing
out of a device frees its place at once, and devices unused for ninety days are removed
from the list automatically, with an email to the account owner.

## Storage

Each workspace stores 5 GB on Free and 100 GB on Plus. Attachments count toward storage,
but notes do not. When storage is full, new attachments are refused until something is
deleted or the plan changes, and every existing note keeps syncing.
"""


@pytest.fixture
async def owner(client_factory: ClientFactory, drain: Drain) -> httpx.AsyncClient:
    client = client_factory()
    await verified_owner(client, drain, "Lumen Notes")
    upload = await client.post("/v1/knowledge/uploads", files={"file": ("billing.md", GUIDE)})
    assert upload.status_code == 201, upload.text
    await drain()
    return client


async def me(client: httpx.AsyncClient) -> dict[str, Any]:
    body: dict[str, Any] = (await client.get("/v1/auth/me")).json()
    return body


async def tenant_of(client: httpx.AsyncClient) -> uuid.UUID:
    return tid(await me(client))


async def guide_id(client: httpx.AsyncClient) -> str:
    docs = (await client.get("/v1/evals/documents")).json()
    assert [d["title"] for d in docs] == ["Billing guide"], docs
    found: str = docs[0]["id"]
    return found


async def new_set(client: httpx.AsyncClient, name: str = "Billing") -> str:
    response = await client.post("/v1/evals/sets", json={"name": name})
    assert response.status_code == 201, response.text
    set_id: str = response.json()["id"]
    return set_id


async def add_case(client: httpx.AsyncClient, set_id: str, **body: Any) -> dict[str, Any]:
    response = await client.post(f"/v1/evals/sets/{set_id}/cases", json=body)
    assert response.status_code == 201, response.text
    case: dict[str, Any] = response.json()
    return case


async def run_set(client: httpx.AsyncClient, drain: Drain, set_id: str) -> dict[str, Any]:
    started = await client.post(f"/v1/evals/sets/{set_id}/runs")
    assert started.status_code == 202, started.text
    assert started.json()["status"] == "queued"
    await drain()
    detail: dict[str, Any] = (await client.get(f"/v1/evals/runs/{started.json()['id']}")).json()
    return detail


async def side_effects(admin_pool: Pool, tenant_id: uuid.UUID) -> dict[str, Any]:
    """Everything a turn could leave behind for this workspace."""
    async with admin_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            select
              (select count(*) from conversations where tenant_id = $1) as conversations,
              (select count(*) from messages where tenant_id = $1) as messages,
              (select count(*) from escalations where tenant_id = $1) as escalations,
              (select count(*) from knowledge_gaps where tenant_id = $1) as gaps,
              (select count(*) from customer_memories where tenant_id = $1) as memories,
              (select count(*) from notifications where tenant_id = $1) as notifications,
              (select count(*) from email_deliveries where tenant_id = $1) as emails,
              (select count(*) from usage_events where tenant_id = $1 and kind = 'ai_reply')
                as billed_replies,
              (select count(*) from usage_events
               where tenant_id = $1 and conversation_id is not null) as turn_usage,
              (select coalesce(sum(replies_used + replies_reserved), 0) from usage_periods
               where tenant_id = $1) as replies,
              (select count(*) from jobs where tenant_id = $1
               and kind not in ('run_eval', 'draft_eval_cases')) as other_jobs
            """,
            tenant_id,
        )
    assert row is not None
    return dict(row)


# Sets and cases


async def test_sets_and_cases_crud_and_validation(owner: httpx.AsyncClient) -> None:
    gold = await guide_id(owner)
    set_id = await new_set(owner, "Billing questions")
    duplicate = await owner.post("/v1/evals/sets", json={"name": "billing QUESTIONS"})
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["fields"] == {"name": "Choose another name."}
    assert (await owner.post("/v1/evals/sets", json={"name": " "})).status_code == 422

    case = await add_case(
        owner,
        set_id,
        question="  What plan am I on?  ",
        history=[
            {"role": "visitor", "content": "Hi"},
            {"role": "agent", "content": "Hello, how can I help?"},
        ],
        identity={"plan": "Pro", "name": "Ana"},
        expected="answer",
        reference_answer="You are on Pro.",
        must_include=["Pro", "Pro"],
        must_not_include=["Enterprise"],
        gold_document_ids=[gold],
        tags=["identity"],
    )
    assert case["question"] == "What plan am I on?"
    assert case["status"] == "active"
    assert case["origin"] == "manual"
    assert case["identity"] == {"plan": "Pro", "name": "Ana"}
    assert case["must_include"] == ["Pro"]  # duplicates dropped
    assert case["gold_documents"] == [{"id": gold, "title": "Billing guide"}]
    assert [t["role"] for t in case["history"]] == ["visitor", "agent"]

    bad = [
        {"question": "", "expected": "answer"},
        {"question": "Hi?", "expected": "maybe"},
        {"question": "Hi?", "expected": "answer", "identity": {"Bad Key": "x"}},
        {
            "question": "Hi?",
            "expected": "answer",
            "history": [{"role": "visitor", "content": "a"}] * 7,
        },
        {"question": "Hi?", "expected": "answer", "gold_document_ids": [str(uuid.uuid4())]},
        {"question": "Hi?", "expected": "answer", "surprise": True},
    ]
    for body in bad:
        response = await owner.post(f"/v1/evals/sets/{set_id}/cases", json=body)
        assert response.status_code == 422, (body, response.text)

    # Only the fields sent change; identity null makes the case anonymous.
    edited = await owner.patch(
        f"/v1/evals/cases/{case['id']}",
        json={"identity": None, "expected": "escalate", "tags": ["handoff"]},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["identity"] is None
    assert edited.json()["expected"] == "escalate"
    assert edited.json()["question"] == "What plan am I on?"
    assert edited.json()["must_include"] == ["Pro"]

    renamed = await owner.patch(f"/v1/evals/sets/{set_id}", json={"description": "Plans."})
    assert renamed.json()["name"] == "Billing questions"
    assert renamed.json()["description"] == "Plans."
    listed = (await owner.get("/v1/evals/sets")).json()
    assert [(s["name"], s["cases"], s["drafts"]) for s in listed] == [("Billing questions", 1, 0)]

    assert (await owner.delete(f"/v1/evals/cases/{case['id']}")).status_code == 204
    assert (await owner.delete(f"/v1/evals/cases/{case['id']}")).status_code == 404
    assert (await owner.delete(f"/v1/evals/sets/{set_id}")).status_code == 204
    assert (await owner.get(f"/v1/evals/sets/{set_id}")).status_code == 404


async def test_agent_role_reads_but_does_not_manage(
    owner: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    set_id = await new_set(owner)
    await add_case(owner, set_id, question="Can I talk to a person?", expected="escalate")
    agent, _ = await join(owner, client_factory, drain)
    assert (await agent.get("/v1/evals/sets")).status_code == 200
    assert (await agent.get(f"/v1/evals/sets/{set_id}")).status_code == 200
    assert (await agent.get("/v1/evals/metrics")).status_code == 200
    assert (await agent.get("/v1/evals/review")).status_code == 200
    assert (await agent.get("/v1/evals/calibration")).status_code == 200
    assert (await agent.post("/v1/evals/sets", json={"name": "Mine"})).status_code == 403
    denied = await agent.post(
        f"/v1/evals/sets/{set_id}/cases", json={"question": "Hi?", "expected": "answer"}
    )
    assert denied.status_code == 403
    assert (await agent.post(f"/v1/evals/sets/{set_id}/runs")).status_code == 403
    assert (await agent.post(f"/v1/evals/sets/{set_id}/drafts", json={})).status_code == 403
    assert (await agent.delete(f"/v1/evals/sets/{set_id}")).status_code == 403


# Drafts


def test_drafts_never_invent_facts() -> None:
    passage = "Annual plans can be refunded within 30 days of renewal. Contact billing to start."
    assert grounded("Annual plans are refunded within 30 days of renewal.", passage)
    assert not grounded("Annual plans are refunded within 60 days of renewal.", passage)
    assert not grounded("Refunds arrive by wire transfer from headquarters overnight.", passage)

    def draft(**over: Any) -> DraftCase:
        body = {
            "usable": True,
            "question": "Can I get my money back on a yearly plan?",
            "answer": "Annual plans can be refunded within 30 days of renewal.",
        } | over
        return DraftCase.model_validate(body)

    kept = check_draft(draft(), passage, taken=set())
    assert kept is not None
    assert (kept.question, kept.answer) == (
        "Can I get my money back on a yearly plan?",
        "Annual plans can be refunded within 30 days of renewal.",
    )
    assert check_draft(draft(usable=False), passage, set()) is None
    assert check_draft(draft(answer="Refunds take 90 days."), passage, set()) is None
    assert check_draft(draft(question="What does the passage say?"), passage, set()) is None
    taken = {scoring.normalize("Can I get my money back on a yearly plan?")}
    assert check_draft(draft(), passage, taken) is None


async def test_drafts_come_from_real_chunks_and_wait_for_approval(
    owner: httpx.AsyncClient, drain: Drain, admin_pool: Pool, chat: FakeChat
) -> None:
    upload = await owner.post("/v1/knowledge/uploads", files={"file": ("sync.md", SYNC_GUIDE)})
    assert upload.status_code == 201
    await drain()
    set_id = await new_set(owner)
    asked = await owner.post(f"/v1/evals/sets/{set_id}/drafts", json={"count": 2})
    assert asked.status_code == 202, asked.text
    assert asked.json()["drafting"]["status"] == "running"
    again = await owner.post(f"/v1/evals/sets/{set_id}/drafts", json={"count": 3})
    assert again.status_code == 409
    await drain()

    detail = (await owner.get(f"/v1/evals/sets/{set_id}")).json()
    drafting = detail["set"]["drafting"]
    # Only the sync guide has passages long enough to draft from: three of them.
    assert drafting["status"] == "idle"
    assert (drafting["requested"], drafting["written"], drafting["skipped"]) == (2, 2, 0)
    drafts = [c for c in detail["cases"] if c["status"] == "draft"]
    assert len(drafts) == 2
    assert all(d["gold_documents"][0]["title"] == "Sync guide" for d in drafts)
    assert all(d["expected"] == "answer" and d["identity"] is None for d in drafts)
    async with admin_pool.acquire() as conn:
        chunks = {
            r["id"]: r
            for r in await conn.fetch(
                "select id, document_id, content from chunks where tenant_id = $1",
                await tenant_of(owner),
            )
        }
        stored = await conn.fetch(
            "select gold_chunk_ids, gold_document_ids, reference_answer, must_include,"
            " origin from eval_cases where set_id = $1",
            uuid.UUID(set_id),
        )
    for row in stored:
        assert row["origin"] == "generated"
        (chunk_id,) = row["gold_chunk_ids"]
        chunk = chunks[chunk_id]  # tied to a real passage of this workspace
        assert row["gold_document_ids"] == [chunk["document_id"]]
        assert grounded(row["reference_answer"], chunk["content"])
        assert row["must_include"] == []  # people add required phrases while reviewing
    assert any(m[0]["content"].startswith("You write test questions") for m in chat.calls)

    # Runs skip drafts until they are approved.
    assert (await owner.post(f"/v1/evals/sets/{set_id}/runs")).status_code == 422
    first, *rest = drafts
    approved = await owner.post(
        f"/v1/evals/sets/{set_id}/cases/approve", json={"case_ids": [first["id"]]}
    )
    assert approved.json() == {"changed": 1}
    if rest:
        discarded = await owner.post(
            f"/v1/evals/sets/{set_id}/cases/discard",
            json={"case_ids": [c["id"] for c in rest] + [first["id"]]},
        )
        assert discarded.json() == {"changed": len(rest)}  # the approved one stays
    after = (await owner.get(f"/v1/evals/sets/{set_id}")).json()
    assert (after["set"]["cases"], after["set"]["drafts"]) == (1, 0)

    # A second request drafts only from passages the set does not use: the discarded
    # draft freed its passage, so two of three are left.
    more = await owner.post(f"/v1/evals/sets/{set_id}/drafts", json={"count": 5})
    assert more.status_code == 202
    await drain()
    final = (await owner.get(f"/v1/evals/sets/{set_id}")).json()
    assert final["set"]["drafting"]["requested"] == 2
    assert final["set"]["drafting"]["status"] == "idle"
    async with admin_pool.acquire() as conn:
        passages = await conn.fetch(
            "select unnest(gold_chunk_ids) as id from eval_cases where set_id = $1",
            uuid.UUID(set_id),
        )
    assert len(passages) == len({r["id"] for r in passages}) == 3


async def test_drafts_need_knowledge(client_factory: ClientFactory, drain: Drain) -> None:
    client = client_factory()
    await verified_owner(client, drain, "Empty")
    set_id = await new_set(client)
    response = await client.post(f"/v1/evals/sets/{set_id}/drafts", json={"count": 2})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_knowledge"


# Runs


async def test_a_run_checks_every_case_and_leaves_nothing_behind(
    owner: httpx.AsyncClient,
    drain: Drain,
    admin_pool: Pool,
    chat: FakeChat,
    mailbox: Any,
) -> None:
    tenant_id = await tenant_of(owner)
    gold = await guide_id(owner)
    set_id = await new_set(owner)
    await add_case(
        owner,
        set_id,
        question=REFUND_QUESTION,
        expected="answer",
        must_include=["help center"],
        must_not_include=["guarantee"],
        gold_document_ids=[gold],
    )
    await add_case(owner, set_id, question="Please let me talk to a person", expected="escalate")
    await add_case(owner, set_id, question="Do you ship to the moon?", expected="answer")
    await add_case(
        owner,
        set_id,
        question="and invoices?",
        history=[
            {"role": "visitor", "content": "how are invoices emailed each month"},
            {"role": "agent", "content": "Invoices are emailed on the first day [1]."},
        ],
        identity={"plan": "Pro"},
        expected="answer",
        gold_document_ids=[gold],
    )
    # The workspace is out of replies this month: evals still run, and use none.
    async with admin_pool.acquire() as conn:
        await conn.execute(
            """
            insert into usage_periods (tenant_id, period_start, period_end, replies_cap,
                                       replies_used)
            values ($1, date_trunc('month', now())::date,
                    (date_trunc('month', now()) + interval '1 month')::date, 500, 500)
            """,
            tenant_id,
        )
        await conn.execute(
            """
            insert into model_prices (model, input_micros_per_mtok, output_micros_per_mtok,
                                      effective_from)
            values ('fake-chat', 1000000, 2000000, '2026-01-01')
            """
        )
    try:
        before = await side_effects(admin_pool, tenant_id)
        sent = len(mailbox.sent)
        chat.calls.clear()
        detail = await run_set(owner, drain, set_id)
    finally:
        async with admin_pool.acquire() as conn:
            await conn.execute("delete from model_prices where model = 'fake-chat'")

    run = detail["run"]
    assert run["status"] == "succeeded", run
    assert (run["case_count"], run["done_count"]) == (4, 4)
    assert run["config"]["model"] == "gemma4:cloud"
    assert run["config"]["knowledge_version"] is not None
    results = {r["question"]: r for r in detail["results"]}
    answered = results[REFUND_QUESTION]
    assert answered["output"]["type"] == "answer"
    assert answered["verdict"] == "correct"
    assert answered["judge_verdict"] == "correct"
    assert answered["judge_notes"] == "Matches the gold passage."
    assert {c["name"]: c["passed"] for c in answered["checks"]} == {
        "expected_outcome": True,
        "must_include": True,
        "must_not_include": True,
        "citations": True,
        "gold_retrieved": True,
    }
    assert answered["output"]["citations"][0]["document_id"] == gold
    assert answered["retrieved"][0]["gold"] is True
    # Agent call and judge call, priced at 1 and 2 dollars per million tokens.
    assert (answered["tokens_in"], answered["tokens_out"]) == (240, 60)
    assert answered["cost_micros"] == 360
    assert answered["latency_ms"] >= 0

    person = results["Please let me talk to a person"]
    assert (person["verdict"], person["output"]["reason"]) == (
        "escalated_correctly",
        "user_requested",
    )
    assert person["judge_verdict"] is None
    assert person["cost_micros"] == 0

    moon = results["Do you ship to the moon?"]
    assert moon["verdict"] == "escalated_wrongly"
    assert moon["output"]["reason"] == "no_source"

    follow_up = results["and invoices?"]
    assert follow_up["output"]["type"] == "answer"
    assert follow_up["case"]["identity"] == {"plan": "Pro"}
    # The judge sees the verified details an answer may state without a passage.
    judged = [
        m[1]["content"] for m in chat.calls if m[0]["content"].startswith("You grade answers")
    ]
    assert len(judged) == 2
    assert any("<verified>\nplan: Pro\n</verified>" in text for text in judged)
    assert any("<verified>none</verified>" in text for text in judged)
    # A short follow-up borrows the previous question: the invoices passage is found.
    assert follow_up["retrieved"][0]["heading_path"] == "Billing guide > Invoices"

    metrics = run["metrics"]
    assert metrics["cases"] == 4
    assert metrics["correct"] == 2
    assert metrics["escalated_correctly"] == 1
    assert metrics["escalated_wrongly"] == 1
    assert metrics["wrong_answer_rate"] == 0.0
    assert metrics["escalation_recall"] == 1.0
    assert metrics["answer_rate"] == pytest.approx(2 / 3, abs=1e-4)
    assert metrics["pass_rate"] == 0.75
    assert metrics["cost_micros"] == run["cost_micros"] > 0

    # No side effects: no messages, no handoff in the inbox, no email, no billed reply,
    # no knowledge gap, no customer memory, no summary or email job.
    assert await side_effects(admin_pool, tenant_id) == before
    assert len(mailbox.sent) == sent
    assert (await owner.get("/v1/inbox")).json()["items"] == []
    async with admin_pool.acquire() as conn:
        eval_usage = await conn.fetch(
            "select kind, conversation_id, cost_micros from usage_events where tenant_id = $1",
            tenant_id,
        )
    assert {r["kind"] for r in eval_usage} == {"llm_call"}
    assert all(r["conversation_id"] is None for r in eval_usage)
    assert sum(r["cost_micros"] for r in eval_usage) == run["cost_micros"]


async def test_one_run_at_a_time_cancel_and_plan(
    owner: httpx.AsyncClient, drain: Drain, admin_pool: Pool
) -> None:
    set_id = await new_set(owner)
    assert (await owner.post(f"/v1/evals/sets/{set_id}/runs")).status_code == 422  # no cases
    await add_case(owner, set_id, question="Please let me talk to a person", expected="escalate")
    first = await owner.post(f"/v1/evals/sets/{set_id}/runs")
    assert first.status_code == 202
    busy = await owner.post(f"/v1/evals/sets/{set_id}/runs")
    assert busy.status_code == 409
    assert busy.json()["error"]["code"] == "run_in_progress"

    canceled = await owner.post(f"/v1/evals/runs/{first.json()['id']}/cancel")
    assert canceled.json()["status"] == "canceled"
    assert (await owner.post(f"/v1/evals/runs/{first.json()['id']}/cancel")).status_code == 409
    await drain()  # the job sees the run was canceled and does nothing
    detail = (await owner.get(f"/v1/evals/runs/{first.json()['id']}")).json()
    assert detail["results"] == []

    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update subscriptions set status = 'canceled' where tenant_id = $1",
            await tenant_of(owner),
        )
    inactive = await owner.post(f"/v1/evals/sets/{set_id}/runs")
    assert inactive.status_code == 409
    assert inactive.json()["error"]["code"] == "plan_inactive"


async def test_the_sandbox_rolls_back_everything_the_turn_writes(
    owner: httpx.AsyncClient, app_pool: Pool, admin_pool: Pool, settings: Settings
) -> None:
    tenant_id = await tenant_of(owner)
    deps = SandboxDeps(settings=settings, pool=app_pool, embedder=FakeEmbedder(), llm=FakeChat())
    before = await side_effects(admin_pool, tenant_id)
    answered = await run_case(deps, tenant_id, CaseInput(REFUND_QUESTION, [], None))
    handed = await run_case(
        deps, tenant_id, CaseInput("Do you sell gift cards?", [], {"plan": "Pro"})
    )
    assert answered.reply["decision"]["type"] == "answer"
    assert answered.citations[0]["chunk_id"] is not None
    assert answered.citations[0]["document_id"] is not None
    assert [u["tokens_in"] for u in answered.usage] == [120]
    assert handed.reply["decision"]["type"] == "escalate"
    assert handed.escalation_reason == "no_source"
    assert len(handed.usage) == 1  # the triage call
    assert await side_effects(admin_pool, tenant_id) == before
    # The connection went back clean: no sandbox setting, no tenant context.
    async with transaction(app_pool) as conn:
        assert await conn.fetchval("select current_setting('app.sandbox', true)") in (None, "")


# Comparing runs


def outcome(key: str, verdict: str, reply: str = "answer", **extra: Any) -> scoring.CaseOutcome:
    return scoring.CaseOutcome(
        key=key, question=f"Q{key}", verdict=verdict, reply_type=reply, **extra
    )


def test_comparison_math() -> None:
    a = [
        outcome("1", "correct", cited=("Billing > Refunds",)),
        outcome("2", "wrong", failed_checks=frozenset({"must_include"})),
        outcome("3", "escalated_correctly", "escalate", reason="user_requested"),
        outcome("4", "correct"),
    ]
    b = [
        outcome("1", "escalated_wrongly", "escalate", reason="no_source"),
        outcome("2", "correct"),
        outcome("3", "escalated_correctly", "escalate", reason="user_requested"),
        outcome("5", "missed", "clarify"),
    ]
    changes = {c.key: c for c in scoring.compare(a, b)}
    assert {k: c.change for k, c in changes.items()} == {
        "1": "broke",
        "2": "fixed",
        "3": "unchanged",
        "4": "removed",
        "5": "added",
    }
    assert changes["1"].why == [
        "Was correct, now handed off instead of answering.",
        "Got an answer before, a handoff (no supporting source) now.",
        "Cited Billing > Refunds before, nothing now.",
    ]
    assert changes["2"].why == ["Was wrong, now correct.", "Now passes: required phrases."]
    assert changes["3"].why == []
    assert [c.change for c in scoring.compare(a, b)][:2] == ["broke", "fixed"]
    # A case edited between runs says so first.
    edited = scoring.compare(
        [outcome("6", "wrong", expected="escalate")],
        [outcome("6", "correct", expected="answer")],
    )
    assert edited[0].why[0] == ("The case changed: it expected a handoff before, an answer now.")

    deltas = {
        d.key: d
        for d in scoring.metric_deltas(
            {
                "pass_rate": 0.5,
                "wrong_answer_rate": 0.25,
                "latency_p50_ms": 900,
                "answer_rate": None,
            },
            {
                "pass_rate": 0.75,
                "wrong_answer_rate": 0.25,
                "latency_p50_ms": 1200,
                "answer_rate": 1.0,
            },
        )
    }
    assert (deltas["pass_rate"].delta, deltas["pass_rate"].better) == (0.25, True)
    assert (deltas["wrong_answer_rate"].delta, deltas["wrong_answer_rate"].better) == (0.0, None)
    assert (deltas["latency_p50_ms"].delta, deltas["latency_p50_ms"].better) == (300, False)
    assert (deltas["answer_rate"].delta, deltas["answer_rate"].better) == (None, None)


def test_run_metrics_math() -> None:
    results = [
        scoring.CaseResult(
            "correct",
            "answer",
            "answer",
            latency_ms=100,
            cost_micros=10,
            gold_retrieved=True,
            judged=True,
        ),
        scoring.CaseResult(
            "unsupported",
            "answer",
            "answer",
            latency_ms=300,
            cost_micros=10,
            gold_retrieved=False,
            judged=True,
        ),
        scoring.CaseResult("escalated_wrongly", "answer", "escalate", latency_ms=200),
        scoring.CaseResult("escalated_correctly", "escalate", "escalate", latency_ms=50),
        scoring.CaseResult("wrong", "escalate", "answer", latency_ms=400, cost_micros=5),
        scoring.CaseResult("error", "answer", None),
    ]
    m = scoring.run_metrics(results)
    assert (m["cases"], m["scored"], m["error"]) == (6, 5, 1)
    assert m["wrong_answer_rate"] == 0.4  # wrong and unsupported over the 5 that ran
    assert m["escalation_recall"] == 0.5
    assert m["answer_rate"] == pytest.approx(2 / 3, abs=1e-4)
    assert m["pass_rate"] == 0.4
    assert m["retrieval_recall_at_8"] == 0.5
    assert (m["latency_p50_ms"], m["latency_p95_ms"]) == (200, 300)
    assert (m["cost_micros"], m["cost_per_case_micros"], m["judged"]) == (25, 4, 2)


async def test_compare_two_runs_of_a_set(
    owner: httpx.AsyncClient, drain: Drain, chat: FakeChat
) -> None:
    set_id = await new_set(owner)
    kept = await add_case(owner, set_id, question=REFUND_QUESTION, expected="answer")
    await add_case(owner, set_id, question="Please let me talk to a person", expected="escalate")
    first = await run_set(owner, drain, set_id)
    assert first["run"]["metrics"]["pass_rate"] == 1.0

    # A worse answer: the judge faults it this time.
    chat.replies += [
        {
            "type": "answer",
            "answer": "Refunds are always possible [1].",
            "citations": [1],
            "account_facts": [],
            "confidence": "high",
            "escalation_reason": None,
        },
        {"verdict": "wrong", "reason": "The passage limits refunds to 30 days."},
    ]
    second = await run_set(owner, drain, set_id)
    compared = await owner.get(
        "/v1/evals/compare", params={"a": first["run"]["id"], "b": second["run"]["id"]}
    )
    assert compared.status_code == 200, compared.text
    body = compared.json()
    assert body["counts"] == {"fixed": 0, "broke": 1, "unchanged": 1, "added": 0, "removed": 0}
    broke = body["cases"][0]
    assert (broke["case_id"], broke["change"]) == (kept["id"], "broke")
    assert broke["a"]["verdict"] == "correct"
    assert broke["b"]["verdict"] == "wrong"
    assert broke["why"] == [
        "Was correct, now wrong.",
        "Judge: The passage limits refunds to 30 days.",
    ]
    wrong_rate = next(m for m in body["metrics"] if m["key"] == "wrong_answer_rate")
    assert (wrong_rate["a"], wrong_rate["b"], wrong_rate["delta"], wrong_rate["better"]) == (
        0.0,
        0.5,
        0.5,
        False,
    )
    assert body["config"] == []  # same settings and knowledge

    other = await new_set(owner, "Other")
    await add_case(owner, other, question="Please let me talk to a person", expected="escalate")
    third = await run_set(owner, drain, other)
    mixed = await owner.get(
        "/v1/evals/compare", params={"a": first["run"]["id"], "b": third["run"]["id"]}
    )
    assert mixed.status_code == 422


# Calibration


def test_agreement_math() -> None:
    found = scoring.agreement(
        [
            ("correct", "right"),
            ("correct", "right"),
            ("correct", "wrong"),
            ("wrong", "wrong"),
            ("unsupported", "wrong"),
            ("unsupported", "right"),
        ]
    )
    assert (found.labeled, found.agreed, found.rate) == (6, 4, 0.6667)
    assert (
        found.judge_correct_person_right,
        found.judge_correct_person_wrong,
        found.judge_faulted_person_right,
        found.judge_faulted_person_wrong,
    ) == (2, 1, 1, 2)
    assert scoring.agreement([]).rate is None


async def test_calibration_labels_and_agreement(
    owner: httpx.AsyncClient, drain: Drain, chat: FakeChat
) -> None:
    set_id = await new_set(owner)
    await add_case(owner, set_id, question=REFUND_QUESTION, expected="answer")
    await add_case(owner, set_id, question="how are invoices emailed each month", expected="answer")
    await add_case(owner, set_id, question="Please let me talk to a person", expected="escalate")
    run = await run_set(owner, drain, set_id)
    judged = [r for r in run["results"] if r["judge_verdict"]]
    unjudged = next(r for r in run["results"] if not r["judge_verdict"])
    assert len(judged) == 2

    start = (await owner.get("/v1/evals/calibration")).json()
    assert (start["labeled"], start["agreement"], start["trusted"]) == (0, None, False)
    assert (start["target"], start["threshold"]) == (50, 0.85)
    assert {r["id"] for r in start["to_label"]} == {r["id"] for r in judged}

    right = await owner.put(f"/v1/evals/results/{judged[0]['id']}/label", json={"label": "right"})
    assert right.status_code == 200, right.text
    assert right.json()["label"] == "right"
    await owner.put(f"/v1/evals/results/{judged[1]['id']}/label", json={"label": "wrong"})
    refused = await owner.put(f"/v1/evals/results/{unjudged['id']}/label", json={"label": "right"})
    assert refused.status_code == 422

    after = (await owner.get("/v1/evals/calibration")).json()
    assert (after["labeled"], after["agreed"], after["agreement"]) == (2, 1, 0.5)
    assert after["confusion"]["judge_correct_person_wrong"] == 1
    assert after["to_label"] == []
    assert len(after["recent"]) == 2

    cleared = await owner.put(f"/v1/evals/results/{judged[1]['id']}/label", json={"label": None})
    assert cleared.json()["label"] is None
    assert (await owner.get("/v1/evals/calibration")).json()["agreement"] == 1.0


# Production metrics


async def insert_conversation(
    conn: Any,
    tenant_id: uuid.UUID,
    started: datetime,
    turns: list[tuple[str, dict[str, Any] | None, dict[str, Any]]],
    *,
    channel: str = "widget",
    escalation: str | None = None,
    last: datetime | None = None,
) -> tuple[uuid.UUID, list[uuid.UUID]]:
    """A conversation written by hand. Turns are (role, decision, extra message columns)."""
    conversation_id = new_id()
    await conn.execute(
        """
        insert into conversations (id, tenant_id, channel, mode, started_at, last_message_at)
        values ($1, $2, $3, 'anonymous', $4, $5)
        """,
        conversation_id,
        tenant_id,
        channel,
        started,
        last or started,
    )
    ids = []
    for i, (role, decision, extra) in enumerate(turns):
        message_id = new_id()
        ids.append(message_id)
        await conn.execute(
            """
            insert into messages (id, tenant_id, conversation_id, role, content, decision,
                                  latency_ms, flagged_wrong, created_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """,
            message_id,
            tenant_id,
            conversation_id,
            role,
            extra.get("content", f"{role} {i}"),
            decision,
            extra.get("latency_ms"),
            extra.get("flagged_wrong", False),
            started + timedelta(seconds=i),
        )
    if escalation:
        await conn.execute(
            """
            insert into escalations (id, tenant_id, conversation_id, reason, created_at)
            values ($1, $2, $3, $4, $5)
            """,
            new_id(),
            tenant_id,
            conversation_id,
            escalation,
            started,
        )
    return conversation_id, ids


def made(kind: str, **fields: Any) -> dict[str, Any]:
    """A decision as the loop stores it."""
    return {
        "type": kind,
        "confidence": None,
        "reason": None,
        "citations": [],
        "account_facts": [],
        "intent": None,
        "cache": None,
    } | fields


def answer(**extra: Any) -> tuple[str, dict[str, Any], dict[str, Any]]:
    return ("agent", made("answer", citations=[1], confidence="high"), extra)


VISITOR: tuple[str, None, dict[str, Any]] = ("visitor", None, {})


async def test_production_metrics_match_hand_written_sql(
    owner: httpx.AsyncClient, admin_pool: Pool
) -> None:
    tenant_id = await tenant_of(owner)
    now = datetime.now(UTC)
    day = timedelta(days=1)
    async with admin_pool.acquire() as conn:
        c1, c1_msgs = await insert_conversation(
            conn, tenant_id, now - 2 * day, [VISITOR, answer(latency_ms=1000)]
        )
        await insert_conversation(  # thanks after the answer: still resolved
            conn,
            tenant_id,
            now - 3 * day,
            [VISITOR, answer(latency_ms=3000), VISITOR, ("agent", made("reply"), {})],
        )
        await insert_conversation(  # marked wrong
            conn, tenant_id, now - day, [VISITOR, answer(latency_ms=2000, flagged_wrong=True)]
        )
        await insert_conversation(
            conn,
            tenant_id,
            now - 5 * day,
            [VISITOR, ("agent", made("escalate", reason="no_source"), {})],
            escalation="no_source",
        )
        await insert_conversation(
            conn,
            tenant_id,
            now - 4 * day,
            [VISITOR, ("agent", made("escalate", reason="user_requested"), {})],
            escalation="user_requested",
        )
        c6, _ = await insert_conversation(  # not quiet for 30 minutes yet
            conn, tenant_id, now - timedelta(minutes=10), [VISITOR, answer(latency_ms=500)]
        )
        await insert_conversation(conn, tenant_id, now - 2 * day, [VISITOR])  # no reply yet
        # Not counted: too old, a staff preview, and one with no visitor message.
        old, _ = await insert_conversation(conn, tenant_id, now - 40 * day, [VISITOR, answer()])
        preview, _ = await insert_conversation(
            conn, tenant_id, now - day, [VISITOR, answer(latency_ms=9000)], channel="preview"
        )
        await insert_conversation(conn, tenant_id, now - day, [answer()])
        for conversation_id, cost in ((c1, 100), (c6, 250), (preview, 50), (old, 70), (None, 999)):
            await conn.execute(
                """
                insert into usage_events (id, tenant_id, kind, cost_micros, conversation_id,
                                          idempotency_key)
                values ($1, $2, 'llm_call', $3, $4, $5)
                """,
                new_id(),
                tenant_id,
                cost,
                conversation_id,
                uuid.uuid4().hex,
            )
        await conn.execute(
            """
            insert into review_items (id, tenant_id, week_start, conversation_id, message_id,
                                      grade, graded_at)
            values ($1, $2, $3, $4, $5, 'right', now())
            """,
            new_id(),
            tenant_id,
            review.week_of(now.date()),
            c1,
            c1_msgs[1],
        )
        # Hand-written SQL for the same numbers.
        window = now - 30 * day
        hand = await conn.fetchrow(
            """
            with traffic as (
              select c.id from conversations c
              where c.tenant_id = $1 and c.channel = 'widget' and c.started_at >= $2
                and c.id in (select conversation_id from messages where role = 'visitor')
            )
            select
              (select count(*) from traffic) as conversations,
              (select count(*) from messages
               where conversation_id in (select id from traffic)
                 and role = 'agent' and decision ->> 'type' = 'answer') as answers,
              (select count(*) from messages
               where conversation_id in (select id from traffic) and flagged_wrong)
                as marked_wrong,
              (select count(distinct conversation_id) from escalations
               where conversation_id in (select id from traffic)) as escalated,
              (select sum(cost_micros) from usage_events
               where conversation_id in (select id from traffic)) as cost
            """,
            tenant_id,
            window,
        )
    assert hand is not None

    response = await owner.get("/v1/evals/metrics", params={"days": 30})
    assert response.status_code == 200, response.text
    m = response.json()
    assert m["conversations"] == hand["conversations"] == 7
    assert m["answers"] == hand["answers"] == 4
    assert m["marked_wrong"] == hand["marked_wrong"] == 1
    assert m["escalated"] == hand["escalated"] == 2
    assert m["cost_micros"] == hand["cost"] == 350
    assert (m["auto_resolved"], m["confirmed_resolved"]) == (2, 1)
    assert m["auto_resolution_rate"] == round(2 / 7, 4)
    assert m["confirmed_resolution_rate"] == round(1 / 7, 4)
    assert m["escalation_rate"] == round(2 / 7, 4)
    assert m["wrong_answer_rate"] == 0.25
    assert (m["reviewed"], m["reviewed_wrong"], m["review_wrong_rate"]) == (1, 0, 0.0)
    # percentile_cont over 500, 1000, 2000, 3000 ms
    assert (m["latency_p50_ms"], m["latency_p95_ms"]) == (1500, 2850)
    assert m["cost_per_conversation_micros"] == 50
    assert {r["reason"]: r["conversations"] for r in m["reasons"]} == {
        "no_source": 1,
        "user_requested": 1,
    }
    assert sum(d["conversations"] for d in m["daily"]) == 7
    assert sum(d["escalated"] for d in m["daily"]) == 2
    assert len(m["daily"]) == 31

    week = (await owner.get("/v1/evals/metrics", params={"days": 7})).json()
    assert week["conversations"] == 7
    assert (await owner.get("/v1/evals/metrics", params={"days": 0})).status_code == 422


# Weekly review


async def test_review_samples_at_most_20_answered_conversations(
    owner: httpx.AsyncClient,
    admin_pool: Pool,
    app_pool: Pool,
    client_factory: ClientFactory,
    drain: Drain,
) -> None:
    tenant_id = await tenant_of(owner)
    now = datetime.now(UTC)
    answered: dict[uuid.UUID, datetime] = {}
    async with admin_pool.acquire() as conn:
        for i in range(25):
            started = now - timedelta(minutes=i + 1)
            conversation_id, _ = await insert_conversation(
                conn,
                tenant_id,
                started,
                [("visitor", None, {"content": f"Question {i}?"}), answer()],
            )
            answered[conversation_id] = started + timedelta(seconds=1)  # the answer
        for _ in range(3):  # handed off, never answered
            await insert_conversation(
                conn,
                tenant_id,
                now - timedelta(hours=2),
                [VISITOR, ("agent", made("escalate", reason="no_source"), {})],
                escalation="no_source",
            )
        await insert_conversation(  # a staff preview
            conn, tenant_id, now - timedelta(hours=1), [VISITOR, answer()], channel="preview"
        )
        await insert_conversation(conn, tenant_id, now - timedelta(days=10), [VISITOR, answer()])

    queue = (await owner.get("/v1/evals/review")).json()
    assert queue["current"] is True
    assert queue["sample_size"] == 20
    assert len(queue["items"]) == 20
    sampled = {uuid.UUID(i["conversation_id"]) for i in queue["items"]}
    assert sampled <= answered.keys()
    assert all(i["question"] and i["question"].startswith("Question") for i in queue["items"])
    again = (await owner.get("/v1/evals/review")).json()
    assert {i["id"] for i in again["items"]} == {i["id"] for i in queue["items"]}  # no overfill

    # Next week samples from the ones left, never repeating a conversation.
    later = datetime.combine(
        review.week_of(now.date()) + timedelta(days=7), datetime.min.time(), UTC
    ) + timedelta(seconds=30)
    left = {c for c, at in answered.items() if c not in sampled and at >= later - review.WINDOW}
    async with transaction(app_pool, tenant_id=tenant_id) as conn:
        added = await review.top_up(conn, tenant_id, later)
        fresh = {
            r["conversation_id"]
            for r in await conn.fetch(
                "select conversation_id from review_items where week_start = $1",
                review.week_of(later.date()),
            )
        }
    assert added == len(left)
    assert fresh == left
    assert not fresh & sampled
    past = (await owner.get("/v1/evals/review", params={"week": queue["week_start"]})).json()
    assert len(past["items"]) == 20

    # Grading: an agent can do it. Wrong marks the answer; regrading right unmarks it.
    agent, _ = await join(owner, client_factory, drain)
    item = queue["items"][0]
    detail = (await agent.get(f"/v1/evals/review/{item['id']}")).json()
    assert [m["role"] for m in detail["messages"]] == ["visitor", "agent"]
    assert detail["next_id"] is not None
    graded = await agent.put(
        f"/v1/evals/review/{item['id']}", json={"grade": "wrong", "note": "Missed the limit."}
    )
    assert graded.status_code == 200, graded.text
    assert graded.json()["item"]["grade"] == "wrong"
    assert graded.json()["item"]["graded_by"] == "Robin Park"
    assert graded.json()["messages"][1]["flag"]["reason"] == "Missed the limit."
    metrics = (await owner.get("/v1/evals/metrics")).json()
    assert (metrics["marked_wrong"], metrics["reviewed_wrong"]) == (1, 1)

    regraded = await agent.put(f"/v1/evals/review/{item['id']}", json={"grade": "right"})
    assert regraded.json()["messages"][1]["flag"] is None
    counts = (await owner.get("/v1/evals/review")).json()["counts"]
    assert counts == {"sampled": 20, "graded": 1, "right": 1, "wrong": 0}
    bad = await agent.put(f"/v1/evals/review/{item['id']}", json={"grade": "maybe"})
    assert bad.status_code == 422


# Add to eval set


async def test_prefill_from_a_handoff_and_from_an_answer_marked_wrong(
    owner: httpx.AsyncClient,
) -> None:
    made = await handoff(owner, "my invoice", email=None)
    filled = await owner.get(
        "/v1/evals/prefill", params={"conversation_id": made["conversation_id"]}
    )
    assert filled.status_code == 200, filled.text
    body = filled.json()
    assert body["question"] == "Please let me talk to a person about my invoice"
    assert (body["expected"], body["identity"], body["tags"]) == ("escalate", None, ["handoff"])
    assert body["source_conversation_id"] == made["conversation_id"]

    conversation = (
        await owner.post(
            "/v1/agent/conversations", json={"mode": "identified", "claims": {"plan": "Pro"}}
        )
    ).json()
    for text in ("hello", REFUND_QUESTION):
        await owner.post(
            f"/v1/agent/conversations/{conversation['id']}/messages", json={"content": text}
        )
    messages = (await owner.get(f"/v1/agent/conversations/{conversation['id']}")).json()["messages"]
    wrong = messages[-1]
    assert wrong["decision"]["type"] == "answer"
    flagged = await owner.post(
        f"/v1/messages/{wrong['id']}/flag", json={"reason": "Refunds take 30 days."}
    )
    assert flagged.status_code == 200
    filled = await owner.get(
        "/v1/evals/prefill",
        params={"conversation_id": conversation["id"], "message_id": wrong["id"]},
    )
    body = filled.json()
    assert body["question"] == REFUND_QUESTION
    assert [t["content"] for t in body["history"]] == ["hello", messages[1]["content"]]
    assert body["identity"] == {"plan": "Pro"}
    assert (body["expected"], body["reference_answer"], body["tags"]) == (
        "answer",
        "Refunds take 30 days.",
        ["marked wrong"],
    )
    assert body["source_message_id"] == wrong["id"]

    set_id = await new_set(owner)
    case = await add_case(
        owner,
        set_id,
        **{k: body[k] for k in ("question", "history", "identity", "expected", "tags")},
        source_conversation_id=body["source_conversation_id"],
        source_message_id=body["source_message_id"],
    )
    assert case["origin"] == "conversation"
    missing = await owner.get("/v1/evals/prefill", params={"conversation_id": str(uuid.uuid4())})
    assert missing.status_code == 404


# Tenant isolation


async def test_tenant_b_sees_nothing_of_tenant_a(
    owner: httpx.AsyncClient,
    client_factory: ClientFactory,
    drain: Drain,
    admin_pool: Pool,
    app_pool: Pool,
) -> None:
    a_tenant = await tenant_of(owner)
    set_id = await new_set(owner)
    case = await add_case(owner, set_id, question=REFUND_QUESTION, expected="answer")
    run = await run_set(owner, drain, set_id)
    result = run["results"][0]
    made = await handoff(owner, "a refund")
    answered = (await owner.post("/v1/agent/conversations", json={})).json()
    await owner.post(
        f"/v1/agent/conversations/{answered['id']}/messages", json={"content": REFUND_QUESTION}
    )
    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update conversations set channel = 'widget' where tenant_id = $1", a_tenant
        )
    item = (await owner.get("/v1/evals/review")).json()["items"][0]
    await drain()  # the handoff's summary and email, before B signs up

    b = client_factory()
    await verified_owner(b, drain, "Tenant B")
    run_id = run["run"]["id"]
    checks = [
        ("get", f"/v1/evals/sets/{set_id}", None),
        ("patch", f"/v1/evals/sets/{set_id}", {"name": "Mine"}),
        ("delete", f"/v1/evals/sets/{set_id}", None),
        ("post", f"/v1/evals/sets/{set_id}/cases", {"question": "Hi?", "expected": "answer"}),
        ("patch", f"/v1/evals/cases/{case['id']}", {"question": "Mine?"}),
        ("delete", f"/v1/evals/cases/{case['id']}", None),
        ("post", f"/v1/evals/sets/{set_id}/cases/approve", {"case_ids": [case["id"]]}),
        ("post", f"/v1/evals/sets/{set_id}/cases/discard", {"case_ids": [case["id"]]}),
        ("post", f"/v1/evals/sets/{set_id}/drafts", {"count": 1}),
        ("post", f"/v1/evals/sets/{set_id}/runs", None),
        ("get", f"/v1/evals/runs/{run_id}", None),
        ("post", f"/v1/evals/runs/{run_id}/cancel", None),
        ("put", f"/v1/evals/results/{result['id']}/label", {"label": "right"}),
        ("get", f"/v1/evals/review/{item['id']}", None),
        ("put", f"/v1/evals/review/{item['id']}", {"grade": "wrong"}),
    ]
    for method, path, body in checks:
        kwargs = {"json": body} if body is not None else {}
        response = await b.request(method.upper(), path, **kwargs)
        assert response.status_code == 404, (method, path, response.status_code, response.text)
    compare = await b.get("/v1/evals/compare", params={"a": run_id, "b": run_id})
    assert compare.status_code == 404
    prefill = await b.get("/v1/evals/prefill", params={"conversation_id": made["conversation_id"]})
    assert prefill.status_code == 404
    assert (await b.get("/v1/evals/sets")).json() == []
    assert (await b.get("/v1/evals/runs")).json() == []
    assert (await b.get("/v1/evals/documents")).json() == []
    assert (await b.get("/v1/evals/review")).json()["items"] == []
    assert (await b.get("/v1/evals/calibration")).json()["to_label"] == []
    assert (await b.get("/v1/evals/metrics")).json()["conversations"] == 0

    # The database agrees: in B's context every eval table is empty; A still sees its rows.
    b_tenant = await tenant_of(b)
    tables = ["eval_sets", "eval_cases", "eval_runs", "eval_results", "review_items"]
    async with transaction(app_pool, tenant_id=b_tenant) as conn:
        for table in tables:
            assert await conn.fetchval(f"select count(*) from {table}") == 0, table  # noqa: S608
    async with transaction(app_pool, tenant_id=a_tenant) as conn:
        for table in tables:
            assert await conn.fetchval(f"select count(*) from {table}") >= 1, table  # noqa: S608
    # Nothing changed for A.
    assert (await owner.get(f"/v1/evals/sets/{set_id}")).json()["set"]["name"] == "Billing"


# The CI gate


BASELINE = {"wrong_answer_rate": 0.0, "escalation_recall": 1.0, "safety_pass_rate": 1.0}


def test_gate_thresholds() -> None:
    limits = gate.Limits()
    ok = gate.check({"wrong_answer_rate": 0.02, "escalation_recall": 1.0}, BASELINE, limits)
    assert ok.passed
    worse = gate.check(
        {"wrong_answer_rate": 0.03, "escalation_recall": 1.0, "safety_pass_rate": 1.0},
        BASELINE,
        limits,
    )
    assert not worse.passed
    assert [r.passed for r in worse.rules] == [False, True, True]
    assert not gate.check(
        {"wrong_answer_rate": 0.0, "escalation_recall": 0.94}, BASELINE, limits
    ).passed
    # Recall may fall 5 points from the baseline by default, never below 95 percent.
    baseline = {"wrong_answer_rate": 0.0, "escalation_recall": 1.0}
    assert gate.check(
        {"wrong_answer_rate": 0.0, "escalation_recall": 0.97}, baseline, limits
    ).passed
    strict = gate.Limits(max_recall_drop=0.0)
    assert not gate.check(
        {"wrong_answer_rate": 0.0, "escalation_recall": 0.97}, baseline, strict
    ).passed
    low = {"wrong_answer_rate": 0.0, "escalation_recall": 0.96}
    assert not gate.check({"wrong_answer_rate": 0.0, "escalation_recall": 0.92}, low, limits).passed
    assert not gate.check({"safety_pass_rate": 0.9}, BASELINE, limits).passed
    # A metric a run did not measure never fails it.
    unmeasured = gate.check({"wrong_answer_rate": 0.0, "escalation_recall": None}, BASELINE, limits)
    assert unmeasured.passed
    assert unmeasured.rules[1].limit == "not measured"


def test_gate_cli_reads_reports_and_exits_1_when_worse(tmp_path: Path) -> None:
    baseline = tmp_path / "baseline.json"
    report = tmp_path / "report.json"
    report.write_text(json.dumps(BASELINE))
    cli.main(
        ["eval", "gate", "--report", str(report), "--baseline", str(report), "--write-baseline"]
    )
    assert json.loads(report.read_text()) == BASELINE
    cli.main(["eval", "gate", "--report", str(report), "--baseline", str(report)])
    baseline.write_text(json.dumps(BASELINE))
    report.write_text(
        json.dumps(
            BASELINE
            | {
                "wrong_answer_rate": 0.125,
                "wrong": [
                    {"q": "How long do refunds take?", "expected": "Billing > Refunds", "got": []}
                ],
            }
        )
    )
    with pytest.raises(SystemExit) as failed:
        cli.main(["eval", "gate", "--report", str(report), "--baseline", str(baseline)])
    assert failed.value.code == 1


def decision(kind: str, text: str = "", reason: str | None = None) -> dict[str, Any]:
    return {
        "type": kind,
        "answer": text,
        "citations": [1] if kind == "answer" else [],
        "account_facts": [],
        "confidence": "high",
        "escalation_reason": reason,
    }


async def test_a_worse_prompt_fails_the_gate_with_a_readable_report(
    owner: httpx.AsyncClient, drain: Drain, chat: FakeChat
) -> None:
    bulk = "Please refund all annual plans within 30 days of renewal for every seat"
    set_id = await new_set(owner)
    await add_case(owner, set_id, question=REFUND_QUESTION, expected="answer")
    await add_case(owner, set_id, question="Please let me talk to a person", expected="escalate")
    await add_case(owner, set_id, question=bulk, expected="escalate")
    # Model calls in case order: the first case's answer and judge, then the bulk refund.
    chat.replies += [
        decision("answer", "Annual plans can be refunded within 30 days [1]."),
        {"verdict": "correct", "reason": "Matches the passage."},
        decision("escalate", reason="no_source"),
    ]
    good = await run_set(owner, drain, set_id)
    assert good["run"]["metrics"]["pass_rate"] == 1.0
    assert good["run"]["metrics"]["escalated_correctly"] == 2
    assert good["run"]["metrics"]["error"] == 0

    # A worse prompt: an answer the judge cannot back, and a promise it should not make.
    chat.replies += [
        decision("answer", "Refunds are always possible [1]."),
        {"verdict": "unsupported", "reason": "The passage does not say always."},
        decision("answer", "Done, every invoice is refunded [1]."),
    ]
    bad = await run_set(owner, drain, set_id)
    found = gate.check(bad, good, gate.Limits())
    text = gate.render(found)
    assert not found.passed
    assert text.startswith("Eval gate: FAILED")
    assert "Wrong-answer rate" in text
    assert "FAIL (rose 66.7 points)" in text
    assert "FAIL (fell 50.0 points)" in text
    assert f'Unsupported: "{REFUND_QUESTION}"' in text
    assert f'Wrong: "{bulk}"' in text
    assert gate.check(good, good, gate.Limits()).passed


async def spend(admin_pool: Pool, tenant_id: uuid.UUID, action: str, **metadata: int) -> None:
    async with admin_pool.acquire() as conn:
        await conn.execute(
            """
            insert into audit_log (id, tenant_id, action, target_type, target_id, metadata)
            values ($1, $2, $3, 'eval_set', 'gone', $4)
            """,
            uuid.uuid4(),
            tenant_id,
            action,
            metadata,
        )


async def test_eval_limits_survive_deleting_the_set(
    owner: httpx.AsyncClient, admin_pool: Pool, settings: Settings
) -> None:
    """Deleting a set and making a new one used to reset the daily count (security review)."""
    tenant_id = await tenant_of(owner)
    for _ in range(settings.eval_runs_per_day):
        await spend(admin_pool, tenant_id, "eval.run_started", cases=1)
    set_id = await new_set(owner)
    await add_case(owner, set_id, question=REFUND_QUESTION, expected="answer")
    refused = await owner.post(f"/v1/evals/sets/{set_id}/runs")
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "too_many_runs"


async def test_runs_stop_at_the_monthly_case_budget(
    owner: httpx.AsyncClient, admin_pool: Pool
) -> None:
    tenant_id = await tenant_of(owner)
    await spend(admin_pool, tenant_id, "eval.run_started", cases=300)  # the trial's budget
    set_id = await new_set(owner)
    await add_case(owner, set_id, question=REFUND_QUESTION, expected="answer")
    refused = await owner.post(f"/v1/evals/sets/{set_id}/runs")
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "eval_budget_reached"
    assert "of this month's 300 eval cases" in refused.json()["error"]["message"]


async def test_drafts_need_an_active_plan_and_stop_at_the_daily_limit(
    owner: httpx.AsyncClient, admin_pool: Pool, settings: Settings
) -> None:
    tenant_id = await tenant_of(owner)
    set_id = await new_set(owner)
    await spend(admin_pool, tenant_id, "eval.drafts_requested", count=settings.eval_drafts_per_day)
    refused = await owner.post(f"/v1/evals/sets/{set_id}/drafts", json={"count": 5})
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "too_many_drafts"

    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update subscriptions set trial_ends_at = now() - interval '1 day'"
            " where tenant_id = $1",
            tenant_id,
        )
    ended = await owner.post(f"/v1/evals/sets/{set_id}/drafts", json={"count": 5})
    assert ended.status_code == 409
    assert ended.json()["error"]["code"] == "plan_inactive"
