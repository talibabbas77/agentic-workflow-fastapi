"""Scoring for evals: deterministic checks, verdicts, run metrics, run comparison,
and judge calibration. Pure functions, shared by tenant eval runs and the
offline golden-set harness.

Verdicts for one case:

  correct              the expected outcome, and (for an answer) the judge agreed
  wrong                an answer that failed a check or the judge, or any answer
                       where a handoff was expected
  unsupported          the judge found claims the cited sources do not back
  escalated_correctly  a handoff where one was expected
  escalated_wrongly    a handoff where an answer or a clarifying question was expected
  missed               a clarifying question or a polite reply where an answer or a
                       handoff was expected: nothing wrong was said, but it did
                       not help
  error                the case could not be run or judged

Wrong-answer rate counts wrong and unsupported over every case that ran. Only
answers can be wrong, so a handoff is never a wrong answer, only a miss.
"""

import re
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

Expected = Literal["answer", "escalate", "clarify"]
ReplyType = Literal["answer", "clarify", "escalate", "reply"]
Verdict = Literal[
    "correct",
    "wrong",
    "unsupported",
    "escalated_correctly",
    "escalated_wrongly",
    "missed",
    "error",
]
JudgeVerdict = Literal["correct", "wrong", "unsupported"]
Label = Literal["right", "wrong"]

PASSING: frozenset[str] = frozenset({"correct", "escalated_correctly"})
RETRIEVAL_DEPTH = 8

_SPACE = re.compile(r"\s+")
_MARKER = re.compile(r"\[(\d{1,2})\]")
# Curly quotes read as straight ones.
_QUOTES = str.maketrans({chr(0x2018): "'", chr(0x2019): "'", chr(0x201C): '"', chr(0x201D): '"'})


def normalize(text: str) -> str:
    """Compare text the way a person reads it: case, spacing, and curly quotes aside."""
    folded = unicodedata.normalize("NFKC", text).translate(_QUOTES).casefold()
    return _SPACE.sub(" ", folded).strip()


def contains(text: str, phrase: str) -> bool:
    wanted = normalize(phrase)
    return bool(wanted) and wanted in normalize(text)


def percentile(values: Sequence[float], q: float) -> float:
    """Nearest rank below: the value at index q * (n - 1) of the sorted values."""
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[int(q * (len(ordered) - 1))]


def rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


# One case


@dataclass(frozen=True, slots=True)
class Check:
    name: Literal[
        "expected_outcome", "must_include", "must_not_include", "citations", "gold_retrieved"
    ]
    passed: bool
    detail: str

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.name, "passed": self.passed, "detail": self.detail}


OUTCOME_WORDS: dict[str, str] = {
    "answer": "an answer",
    "clarify": "a clarifying question",
    "escalate": "a handoff",
    "reply": "a conversational reply",
}

# A failed check of these kinds makes an answer wrong without asking the judge.
HARD_CHECKS = frozenset({"must_include", "must_not_include", "citations"})


def run_checks(
    *,
    expected: Expected,
    reply_type: ReplyType,
    content: str,
    cited_markers: Iterable[int],
    account_facts: Sequence[str],
    must_include: Sequence[str],
    must_not_include: Sequence[str],
    gold_document_ids: Sequence[str],
    retrieved_document_ids: Sequence[str],
) -> list[Check]:
    """Deterministic checks, in the order a person would read them."""
    checks = [
        Check(
            "expected_outcome",
            reply_type == expected,
            f"Expected {OUTCOME_WORDS[expected]}, got {OUTCOME_WORDS[reply_type]}.",
        )
    ]
    if must_include and reply_type in ("answer", "clarify"):
        missing = [p for p in must_include if not contains(content, p)]
        checks.append(
            Check(
                "must_include",
                not missing,
                "Includes every required phrase."
                if not missing
                else "Missing: " + ", ".join(f'"{p}"' for p in missing) + ".",
            )
        )
    if must_not_include:
        found = [p for p in must_not_include if contains(content, p)]
        checks.append(
            Check(
                "must_not_include",
                not found,
                "Says none of the forbidden phrases."
                if not found
                else "Says: " + ", ".join(f'"{p}"' for p in found) + ".",
            )
        )
    if reply_type == "answer":
        cited = set(cited_markers)
        stray = sorted({int(m) for m in _MARKER.findall(content)} - cited)
        backed = bool(cited) or bool(account_facts)
        checks.append(
            Check(
                "citations",
                backed and not stray,
                "Cites its sources."
                if backed and not stray
                else "Cites no source."
                if not backed
                else f"Marks sources it did not cite: {', '.join(map(str, stray))}.",
            )
        )
    if gold_document_ids:
        top = list(retrieved_document_ids)[:RETRIEVAL_DEPTH]
        found_at = next((i + 1 for i, d in enumerate(top) if d in set(gold_document_ids)), None)
        checks.append(
            Check(
                "gold_retrieved",
                found_at is not None,
                f"A gold document was found at rank {found_at}."
                if found_at
                else f"No gold document in the top {RETRIEVAL_DEPTH} search results.",
            )
        )
    return checks


def classify(expected: Expected, reply_type: ReplyType, checks: Sequence[Check]) -> Verdict | None:
    """The verdict from the checks alone, or None when the judge must decide."""
    if reply_type == "escalate":
        return "escalated_correctly" if expected == "escalate" else "escalated_wrongly"
    if expected == "escalate":
        return "wrong" if reply_type == "answer" else "missed"
    failed = {c.name for c in checks if not c.passed}
    if reply_type == "answer":
        return "wrong" if failed & HARD_CHECKS else None
    if reply_type == "clarify" and expected == "clarify":
        return "wrong" if "must_not_include" in failed else "correct"
    return "missed"


def passed(verdict: str) -> bool:
    return verdict in PASSING


# A run


@dataclass(frozen=True, slots=True)
class CaseResult:
    """What run metrics need from one stored result."""

    verdict: str
    expected: str
    reply_type: str | None
    latency_ms: int = 0
    cost_micros: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    gold_retrieved: bool | None = None
    judged: bool = False


VERDICTS: tuple[Verdict, ...] = (
    "correct",
    "wrong",
    "unsupported",
    "escalated_correctly",
    "escalated_wrongly",
    "missed",
    "error",
)


def run_metrics(results: Sequence[CaseResult]) -> dict[str, Any]:
    """The numbers a run is judged by. Rates are None when nothing was measured."""
    scored = [r for r in results if r.verdict != "error"]
    counts: dict[str, int] = {v: sum(1 for r in results if r.verdict == v) for v in VERDICTS}
    want_escalate = [r for r in scored if r.expected == "escalate"]
    want_answer = [r for r in scored if r.expected == "answer"]
    with_gold = [r for r in scored if r.gold_retrieved is not None]
    latencies = [float(r.latency_ms) for r in scored]
    cost = sum(r.cost_micros for r in results)
    return {
        "cases": len(results),
        "scored": len(scored),
        **counts,
        "pass_rate": rate(counts["correct"] + counts["escalated_correctly"], len(scored)),
        "wrong_answer_rate": rate(counts["wrong"] + counts["unsupported"], len(scored)),
        "escalation_recall": rate(
            sum(1 for r in want_escalate if r.reply_type == "escalate"), len(want_escalate)
        ),
        "answer_rate": rate(
            sum(1 for r in want_answer if r.reply_type == "answer"), len(want_answer)
        ),
        "retrieval_recall_at_8": rate(
            sum(1 for r in with_gold if r.gold_retrieved), len(with_gold)
        ),
        "judged": sum(1 for r in results if r.judged),
        "latency_p50_ms": round(percentile(latencies, 0.5)),
        "latency_p95_ms": round(percentile(latencies, 0.95)),
        "cost_micros": cost,
        "cost_per_case_micros": round(cost / len(results)) if results else 0,
        "tokens_in": sum(r.tokens_in for r in results),
        "tokens_out": sum(r.tokens_out for r in results),
    }


# Comparing two runs of one set

# Metric, label, and whether higher is better.
COMPARED: tuple[tuple[str, str, bool], ...] = (
    ("pass_rate", "Passed", True),
    ("wrong_answer_rate", "Wrong-answer rate", False),
    ("escalation_recall", "Escalation recall", True),
    ("answer_rate", "Answer rate", True),
    ("retrieval_recall_at_8", "Gold document in top 8", True),
    ("latency_p50_ms", "Latency p50", False),
    ("latency_p95_ms", "Latency p95", False),
    ("cost_micros", "Cost", False),
)


@dataclass(frozen=True, slots=True)
class MetricDelta:
    key: str
    label: str
    a: float | None
    b: float | None
    delta: float | None
    better: bool | None  # None when unchanged or not measured in both runs


def metric_deltas(a: dict[str, Any], b: dict[str, Any]) -> list[MetricDelta]:
    out: list[MetricDelta] = []
    for key, label, higher_is_better in COMPARED:
        va, vb = a.get(key), b.get(key)
        if va is None or vb is None:
            out.append(MetricDelta(key, label, va, vb, None, None))
            continue
        delta = round(float(vb) - float(va), 4)
        better = None if delta == 0 else (delta > 0) == higher_is_better
        out.append(MetricDelta(key, label, va, vb, delta, better))
    return out


@dataclass(frozen=True, slots=True)
class CaseOutcome:
    """One case in one run, as a comparison sees it."""

    key: str  # the case id; results of deleted cases cannot be matched
    question: str
    verdict: str
    reply_type: str | None
    reason: str | None = None  # the handoff reason
    failed_checks: frozenset[str] = frozenset()
    cited: tuple[str, ...] = ()  # "Document > Heading" of each cited source
    judge_notes: str | None = None


Change = Literal["fixed", "broke", "unchanged", "added", "removed"]


@dataclass(frozen=True, slots=True)
class CaseChange:
    key: str
    question: str
    change: Change
    a: CaseOutcome | None
    b: CaseOutcome | None
    why: list[str] = field(default_factory=list)


VERDICT_WORDS: dict[str, str] = {
    "correct": "correct",
    "wrong": "wrong",
    "unsupported": "not backed by its sources",
    "escalated_correctly": "handed off, as expected",
    "escalated_wrongly": "handed off instead of answering",
    "missed": "did not answer",
    "error": "could not run",
}
CHECK_WORDS: dict[str, str] = {
    "expected_outcome": "expected outcome",
    "must_include": "required phrases",
    "must_not_include": "forbidden phrases",
    "citations": "citations",
    "gold_retrieved": "gold document in the top 8",
}
REASON_WORDS: dict[str, str] = {
    "no_source": "no supporting source",
    "low_confidence": "low confidence",
    "user_requested": "asked for a person",
    "restricted_topic": "restricted topic",
    "repeated_failure": "repeated failure",
    "cap_reached": "reply cap reached",
}


def _reply_words(o: CaseOutcome) -> str:
    words = OUTCOME_WORDS.get(o.reply_type or "", "nothing")
    if o.reply_type == "escalate" and o.reason:
        words += f" ({REASON_WORDS.get(o.reason, o.reason)})"
    return words


def why_changed(a: CaseOutcome, b: CaseOutcome) -> list[str]:
    """Plain sentences on what differs between two results of one case."""
    lines: list[str] = []
    if a.verdict != b.verdict:
        lines.append(f"Was {VERDICT_WORDS[a.verdict]}, now {VERDICT_WORDS[b.verdict]}.")
    if (a.reply_type, a.reason) != (b.reply_type, b.reason):
        lines.append(f"Got {_reply_words(a)} before, {_reply_words(b)} now.")
    newly = sorted(b.failed_checks - a.failed_checks)
    healed = sorted(a.failed_checks - b.failed_checks)
    if newly:
        lines.append("Now fails: " + ", ".join(CHECK_WORDS.get(c, c) for c in newly) + ".")
    if healed:
        lines.append("Now passes: " + ", ".join(CHECK_WORDS.get(c, c) for c in healed) + ".")
    if a.cited != b.cited and (a.cited or b.cited):
        before = "; ".join(a.cited) or "nothing"
        after = "; ".join(b.cited) or "nothing"
        lines.append(f"Cited {before} before, {after} now.")
    if b.judge_notes and b.judge_notes != a.judge_notes and a.verdict != b.verdict:
        lines.append(f"Judge: {b.judge_notes}")
    return lines


def compare(a: Sequence[CaseOutcome], b: Sequence[CaseOutcome]) -> list[CaseChange]:
    """Every case in either run: fixed, broke, unchanged, added, or removed."""
    by_a = {o.key: o for o in a}
    by_b = {o.key: o for o in b}
    changes: list[CaseChange] = []
    for key in [*by_a, *(k for k in by_b if k not in by_a)]:
        oa, ob = by_a.get(key), by_b.get(key)
        if oa and ob:
            pa, pb = passed(oa.verdict), passed(ob.verdict)
            kind: Change = "fixed" if pb and not pa else "broke" if pa and not pb else "unchanged"
            changes.append(CaseChange(key, ob.question, kind, oa, ob, why_changed(oa, ob)))
        elif ob:
            changes.append(
                CaseChange(key, ob.question, "added", None, ob, ["Not in the first run."])
            )
        elif oa:
            changes.append(
                CaseChange(key, oa.question, "removed", oa, None, ["Not in the second run."])
            )
    order = {"broke": 0, "fixed": 1, "added": 2, "removed": 3, "unchanged": 4}
    return sorted(changes, key=lambda c: order[c.change])


# Judge calibration


@dataclass(frozen=True, slots=True)
class Agreement:
    labeled: int
    agreed: int
    rate: float | None
    # judge said correct or not, against the person's right or wrong
    judge_correct_person_right: int
    judge_correct_person_wrong: int
    judge_faulted_person_right: int
    judge_faulted_person_wrong: int


def agreement(pairs: Iterable[tuple[str, str]]) -> Agreement:
    """How often the judge agrees with people. Each pair is (judge verdict, label).

    The judge says an answer is correct, or faults it (wrong or unsupported); a
    person says it is right or wrong. They agree when both pass it or both fault it.
    """
    cc = cw = fr = fw = 0
    for verdict, label in pairs:
        judge_ok = verdict == "correct"
        person_ok = label == "right"
        if judge_ok and person_ok:
            cc += 1
        elif judge_ok:
            cw += 1
        elif person_ok:
            fr += 1
        else:
            fw += 1
    labeled = cc + cw + fr + fw
    return Agreement(labeled, cc + fw, rate(cc + fw, labeled), cc, cw, fr, fw)
