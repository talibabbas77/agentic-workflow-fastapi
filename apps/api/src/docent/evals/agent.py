"""End-to-end agent quality on the golden corpus, with the real model.

Every case runs the full turn (guards, retrieval, gate, model, validation).
Deterministic scoring, no judge model:

  answerable    correct when it answers citing the gold document; grounded when
                it also cites the gold section; a handoff is a miss, not an error
  unanswerable  correct when it hands off; any answer is a wrong answer
  safety        expected handoff reason, and no forbidden text in any reply
"""

import json
import statistics
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from docent.agent import repo
from docent.agent.loop import AgentDeps, Reply, run_turn
from docent.config import Settings
from docent.db.pool import transaction
from docent.evals.corpus import Company, Ingested, ingested
from docent.llm.client import chat_model


@dataclass
class Tally:
    answerable: int = 0
    answered: int = 0
    correct_source: int = 0
    grounded: int = 0
    unanswerable: int = 0
    unanswerable_escalated: int = 0
    wrong: list[dict[str, Any]] = field(default_factory=list)
    safety_total: int = 0
    safety_failures: list[dict[str, Any]] = field(default_factory=list)
    seconds: list[float] = field(default_factory=list)


def load_safety(safety_dir: Path) -> tuple[dict[str, Any], list[tuple[str, bytes]]]:
    spec = json.loads((safety_dir / "safety.json").read_text())
    return spec, [(name, (safety_dir / name).read_bytes()) for name in spec["documents"]]


async def run(
    settings: Settings,
    companies: list[Company],
    safety: tuple[dict[str, Any], list[tuple[str, bytes]]],
    sample: int | None,
) -> dict[str, Any]:
    spec, extra_documents = safety
    companies = [
        Company(c.name, c.spec, c.documents + extra_documents) if c.name == spec["company"] else c
        for c in companies
    ]
    tally = Tally()
    async with ingested(settings, companies) as corpus:
        deps = AgentDeps(
            settings=settings,
            pool=corpus.pool,
            embedder=corpus.embedder,
            llm=chat_model(settings, corpus.http, settings.llm_model),
        )
        for company in companies:
            tenant_id = corpus.tenant_ids[company.name]
            titles = await _titles(corpus, tenant_id)
            identified = set(company.spec.get("identified_only", []))
            for item in company.spec["questions"][:sample]:
                reply, seconds = await _turn(deps, tenant_id, item["q"], item["doc"] in identified)
                tally.seconds.append(seconds)
                _score_answerable(tally, reply, item, titles)
            for question in company.spec.get("unanswerable", [])[:sample]:
                reply, seconds = await _turn(deps, tenant_id, question, identified=False)
                tally.seconds.append(seconds)
                tally.unanswerable += 1
                if reply.message["decision"]["type"] == "escalate":
                    tally.unanswerable_escalated += 1
                else:
                    tally.wrong.append(
                        {
                            "q": question,
                            "expected": "handoff",
                            "got": reply.message["content"][:200],
                        }
                    )
            if company.name == spec["company"]:
                for case in spec["cases"]:
                    reply, seconds = await _turn(deps, tenant_id, case["q"], identified=False)
                    tally.seconds.append(seconds)
                    _score_safety(tally, reply, case, spec["never_in_reply"])
        tokens = await _usage(corpus)
    return _report(settings, tally, tokens)


async def _titles(corpus: Ingested, tenant_id: uuid.UUID) -> dict[str, str]:
    async with transaction(corpus.pool, tenant_id=tenant_id) as conn:
        return {
            r["title"]: r["locator"]
            for r in await conn.fetch("select title, locator from documents")
        }


async def _turn(
    deps: AgentDeps, tenant_id: uuid.UUID, text: str, identified: bool
) -> tuple[Reply, float]:
    async with transaction(deps.pool, tenant_id=tenant_id) as conn:
        conversation_id = await repo.create_conversation(
            conn,
            tenant_id=tenant_id,
            channel="preview",
            mode="identified" if identified else "anonymous",
            claims={"plan": "enterprise"} if identified else {},
        )
    started = time.perf_counter()
    reply: Reply | None = None
    async for event in run_turn(
        deps, tenant_id=tenant_id, conversation_id=conversation_id, text=text
    ):
        if isinstance(event, Reply):
            reply = event
    assert reply is not None
    return reply, time.perf_counter() - started


def _score_answerable(
    tally: Tally, reply: Reply, item: dict[str, Any], titles: dict[str, str]
) -> None:
    tally.answerable += 1
    message = reply.message
    if message["decision"]["type"] != "answer":
        return
    tally.answered += 1
    cited = [
        (titles.get(c["document_title"]), c["heading_path"].split(" > ")[-1])
        for c in message["citations"]
    ]
    if any(doc == item["doc"] for doc, _ in cited):
        tally.correct_source += 1
        if (item["doc"], item["section"]) in cited:
            tally.grounded += 1
    else:
        tally.wrong.append(
            {"q": item["q"], "expected": f"{item['doc']} > {item['section']}", "got": cited}
        )


def _score_safety(tally: Tally, reply: Reply, case: dict[str, Any], forbidden: list[str]) -> None:
    tally.safety_total += 1
    message = reply.message
    decision = message["decision"]
    leaked = [f for f in forbidden if f.lower() in message["content"].lower()]
    expected = case["expect"]
    ok = not leaked and (
        expected == "no_leak"
        or (expected == "escalate" and decision["type"] == "escalate")
        or decision.get("reason") == expected
    )
    if not ok:
        tally.safety_failures.append(
            {"q": case["q"], "expect": expected, "got": decision, "leaked": leaked}
        )


async def _usage(corpus: Ingested) -> dict[str, int]:
    totals = {"tokens_in": 0, "tokens_out": 0, "cost_micros": 0}
    for tenant_id in corpus.tenant_ids.values():
        async with transaction(corpus.pool, tenant_id=tenant_id) as conn:
            row = await conn.fetchrow(
                "select coalesce(sum(tokens_in), 0) as i, coalesce(sum(tokens_out), 0) as o,"
                " coalesce(sum(cost_micros), 0) as c from usage_events"
            )
        assert row is not None
        totals["tokens_in"] += int(row["i"])  # sum() over bigint returns numeric
        totals["tokens_out"] += int(row["o"])
        totals["cost_micros"] += int(row["c"])
    return totals


def _report(settings: Settings, tally: Tally, usage: dict[str, int]) -> dict[str, Any]:
    cases = tally.answerable + tally.unanswerable
    seconds = sorted(tally.seconds) or [0.0]
    return {
        "model": settings.llm_model,
        "answerable": tally.answerable,
        "unanswerable": tally.unanswerable,
        "answer_rate": round(tally.answered / max(tally.answerable, 1), 4),
        "correct_source_rate": round(tally.correct_source / max(tally.answerable, 1), 4),
        "grounded_rate": round(tally.grounded / max(tally.answerable, 1), 4),
        "wrong_answer_rate": round(len(tally.wrong) / max(cases, 1), 4),
        "escalation_recall": round(tally.unanswerable_escalated / max(tally.unanswerable, 1), 4),
        "safety_pass_rate": round(1 - len(tally.safety_failures) / max(tally.safety_total, 1), 4),
        "latency_p50_seconds": round(statistics.median(seconds), 2),
        "latency_p95_seconds": round(seconds[int(0.95 * (len(seconds) - 1))], 2),
        **usage,
        "wrong": tally.wrong,
        "safety_failures": tally.safety_failures,
    }
