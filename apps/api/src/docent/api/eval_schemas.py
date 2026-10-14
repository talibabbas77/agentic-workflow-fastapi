"""Request and response models for evals: sets, cases, runs, comparison, calibration,
production metrics, and the weekly review queue."""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from docent.api.schemas import (
    ClaimKey,
    ClaimValue,
    HandoffReason,
    InboxMessageOut,
    MessageFeedbackOut,
    Model,
)

Expected = Literal["answer", "escalate", "clarify"]
CaseStatus = Literal["draft", "active"]
CaseOrigin = Literal["manual", "generated", "conversation"]
RunStatus = Literal["queued", "running", "succeeded", "failed", "canceled"]
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
Grade = Literal["right", "wrong"]
ReplyType = Literal["answer", "clarify", "escalate", "reply"]
CheckName = Literal[
    "expected_outcome", "must_include", "must_not_include", "citations", "gold_retrieved"
]

SetName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
Reference = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Phrase = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]


# Sets and cases


class EvalSetIn(Model):
    name: SetName
    description: Description = ""


class EvalSetUpdateIn(Model):
    name: SetName | None = None
    description: Description | None = None


class DraftingOut(BaseModel):
    status: Literal["idle", "running", "failed"]
    requested: int
    written: int
    skipped: int = Field(description="Passages the model could not turn into a trustworthy case")
    error: str | None


class RunSummaryOut(BaseModel):
    id: uuid.UUID
    status: RunStatus
    pass_rate: float | None
    wrong_answer_rate: float | None
    created_at: datetime
    finished_at: datetime | None


class EvalSetOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    cases: int = Field(description="Approved cases, the ones a run uses")
    drafts: int = Field(description="Generated cases waiting for approval")
    drafting: DraftingOut
    last_run: RunSummaryOut | None
    created_at: datetime
    updated_at: datetime


class HistoryTurn(Model):
    role: Literal["visitor", "agent"]
    content: Question


class GoldDocumentOut(BaseModel):
    id: uuid.UUID
    title: str = Field(description="The document's title, or 'Removed document'")


class EvalCaseIn(Model):
    question: Question
    history: list[HistoryTurn] = Field(default_factory=list, max_length=6)
    identity: dict[ClaimKey, ClaimValue] | None = Field(
        default=None,
        max_length=20,
        description="None for an anonymous visitor; the claims of a signed-in customer",
    )
    expected: Expected
    reference_answer: Reference = ""
    must_include: list[Phrase] = Field(default_factory=list, max_length=10)
    must_not_include: list[Phrase] = Field(default_factory=list, max_length=10)
    gold_document_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)
    tags: list[Tag] = Field(default_factory=list, max_length=10)
    source_conversation_id: uuid.UUID | None = None
    source_message_id: uuid.UUID | None = None


class EvalCaseUpdateIn(Model):
    """Only the fields sent change. Send identity as null to make the case anonymous."""

    status: CaseStatus | None = None
    question: Question | None = None
    history: list[HistoryTurn] | None = Field(default=None, max_length=6)
    identity: dict[ClaimKey, ClaimValue] | None = Field(default=None, max_length=20)
    expected: Expected | None = None
    reference_answer: Reference | None = None
    must_include: list[Phrase] | None = Field(default=None, max_length=10)
    must_not_include: list[Phrase] | None = Field(default=None, max_length=10)
    gold_document_ids: list[uuid.UUID] | None = Field(default=None, max_length=10)
    tags: list[Tag] | None = Field(default=None, max_length=10)


class EvalCaseOut(BaseModel):
    id: uuid.UUID
    set_id: uuid.UUID
    status: CaseStatus
    question: str
    history: list[HistoryTurn]
    identity: dict[str, str] | None
    expected: Expected
    reference_answer: str
    must_include: list[str]
    must_not_include: list[str]
    gold_documents: list[GoldDocumentOut]
    tags: list[str]
    origin: CaseOrigin
    source_conversation_id: uuid.UUID | None
    source_message_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class CaseIdsIn(Model):
    case_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class CasesChangedOut(BaseModel):
    changed: int


class DraftsIn(Model):
    count: int = Field(default=20, ge=1, le=50, description="How many drafts to write")


class EvalDocumentOut(BaseModel):
    id: uuid.UUID
    title: str
    source: str


class CasePrefillOut(BaseModel):
    """A new case filled in from a conversation, for a person to check and save."""

    question: str
    history: list[HistoryTurn]
    identity: dict[str, str] | None
    expected: Expected
    reference_answer: str
    tags: list[str]
    source_conversation_id: uuid.UUID
    source_message_id: uuid.UUID | None


# Runs


class RunConfigOut(BaseModel):
    model: str | None = None
    judge_model: str | None = None
    answer_prompt: str | None = None
    triage_prompt: str | None = None
    judge_prompt: str | None = None
    embedding_model: str | None = None
    sources: int | None = None
    min_similarity: float | None = None
    knowledge_version: int | None = Field(
        default=None, description="Changes whenever sources, team answers, or settings change"
    )


class RunMetricsOut(BaseModel):
    cases: int
    scored: int = Field(description="Cases that ran and were scored (not errors)")
    correct: int
    wrong: int
    unsupported: int
    escalated_correctly: int
    escalated_wrongly: int
    missed: int
    error: int
    pass_rate: float | None
    wrong_answer_rate: float | None
    escalation_recall: float | None
    answer_rate: float | None
    retrieval_recall_at_8: float | None
    judged: int
    latency_p50_ms: int
    latency_p95_ms: int
    cost_micros: int
    cost_per_case_micros: int
    tokens_in: int
    tokens_out: int


class EvalRunOut(BaseModel):
    id: uuid.UUID
    set_id: uuid.UUID
    set_name: str
    status: RunStatus
    config: RunConfigOut
    metrics: RunMetricsOut | None
    case_count: int
    done_count: int
    cost_micros: int
    error: str | None
    created_by: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class CheckOut(BaseModel):
    name: CheckName
    passed: bool
    detail: str


class ResultCitationOut(BaseModel):
    marker: int
    document_id: uuid.UUID | None
    document_title: str
    heading_path: str
    excerpt: str


class RetrievedOut(BaseModel):
    rank: int
    document_id: uuid.UUID
    document_title: str
    heading_path: str
    similarity: float | None
    gold: bool


class ResultOutputOut(BaseModel):
    type: ReplyType | None = Field(description="None when the case could not run")
    content: str
    reason: str | None = Field(description="Why it handed off")
    confidence: Literal["high", "medium", "low"] | None
    account_facts: list[str]
    citations: list[ResultCitationOut]


# Stored results written before a field existed read as these.
OUTPUT_DEFAULTS: dict[str, object] = {
    "type": None,
    "content": "",
    "reason": None,
    "confidence": None,
    "account_facts": [],
    "citations": [],
}


class CaseSnapshotOut(BaseModel):
    history: list[HistoryTurn]
    identity: dict[str, str] | None
    reference_answer: str
    must_include: list[str]
    must_not_include: list[str]
    gold_documents: list[GoldDocumentOut]
    tags: list[str]
    origin: CaseOrigin


SNAPSHOT_DEFAULTS: dict[str, object] = {
    "history": [],
    "identity": None,
    "reference_answer": "",
    "must_include": [],
    "must_not_include": [],
    "gold_documents": [],
    "tags": [],
    "origin": "manual",
}


class EvalResultOut(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    case_id: uuid.UUID | None = Field(description="None once the case is deleted")
    position: int
    question: str
    expected: Expected
    case: CaseSnapshotOut = Field(description="The case as it ran")
    output: ResultOutputOut
    retrieved: list[RetrievedOut]
    checks: list[CheckOut]
    verdict: Verdict
    judge_verdict: JudgeVerdict | None
    judge_notes: str | None
    tokens_in: int
    tokens_out: int
    cost_micros: int
    latency_ms: int
    label: Grade | None = Field(description="A person's call on this result, for calibration")
    labeled_at: datetime | None


class EvalSetDetailOut(BaseModel):
    set: EvalSetOut
    cases: list[EvalCaseOut]
    runs: list[EvalRunOut]


class EvalRunDetailOut(BaseModel):
    run: EvalRunOut
    results: list[EvalResultOut]


class MetricDeltaOut(BaseModel):
    key: str
    label: str
    a: float | None
    b: float | None
    delta: float | None
    better: bool | None = Field(description="None when unchanged or not measured in both")


class ConfigChangeOut(BaseModel):
    key: str
    label: str
    a: str | None
    b: str | None


class CaseChangeOut(BaseModel):
    case_id: uuid.UUID | None
    question: str
    change: Literal["fixed", "broke", "unchanged", "added", "removed"]
    a: EvalResultOut | None
    b: EvalResultOut | None
    why: list[str]


class ChangeCountsOut(BaseModel):
    fixed: int
    broke: int
    unchanged: int
    added: int
    removed: int


class CompareOut(BaseModel):
    a: EvalRunOut
    b: EvalRunOut
    metrics: list[MetricDeltaOut]
    config: list[ConfigChangeOut] = Field(description="Settings that differ between the runs")
    counts: ChangeCountsOut
    cases: list[CaseChangeOut]


# Calibration


class LabelIn(Model):
    label: Grade | None = Field(description="None clears the label")


class ConfusionOut(BaseModel):
    judge_correct_person_right: int
    judge_correct_person_wrong: int
    judge_faulted_person_right: int
    judge_faulted_person_wrong: int


class CalibrationOut(BaseModel):
    target: int = Field(description="Labels needed before the judge's numbers are trusted")
    threshold: float = Field(description="The agreement the judge needs, 0 to 1")
    labeled: int
    agreed: int
    agreement: float | None
    trusted: bool
    confusion: ConfusionOut
    to_label: list[EvalResultOut] = Field(description="Judged results nobody has labeled yet")
    recent: list[EvalResultOut] = Field(description="The latest labeled results")


# Production metrics and review


class ReasonRateOut(BaseModel):
    reason: HandoffReason
    conversations: int
    rate: float | None


class DayOut(BaseModel):
    day: date
    conversations: int
    escalated: int


class ProductionMetricsOut(BaseModel):
    days: int
    start: datetime
    end: datetime
    conversations: int
    auto_resolved: int
    confirmed_resolved: int
    escalated: int
    answers: int
    marked_wrong: int = Field(description="Answers the team marked wrong, in the inbox or review")
    voted_up: int = Field(description="Answers a customer said helped")
    voted_down: int = Field(description="Answers a customer said did not help")
    wrong_answers: int = Field(description="Marked wrong or voted down, each answer once")
    reviewed: int
    reviewed_wrong: int
    auto_resolution_rate: float | None
    confirmed_resolution_rate: float | None
    escalation_rate: float | None
    wrong_answer_rate: float | None
    review_wrong_rate: float | None
    latency_p50_ms: int | None
    latency_p95_ms: int | None
    cost_micros: int
    cost_per_conversation_micros: int | None
    reasons: list[ReasonRateOut]
    daily: list[DayOut]


class ReviewItemOut(BaseModel):
    id: uuid.UUID
    week_start: date
    conversation_id: uuid.UUID
    message_id: uuid.UUID = Field(description="The answer being graded")
    question: str | None
    answer: str
    mode: Literal["anonymous", "identified"]
    claims: dict[str, str]
    started_at: datetime
    escalated: bool
    grade: Grade | None
    note: str
    graded_by: str | None
    graded_at: datetime | None
    sampled_at: datetime
    feedback: MessageFeedbackOut | None = Field(
        default=None, description="The customer's vote on the graded answer"
    )


class ReviewWeekOut(BaseModel):
    week_start: date
    sampled: int
    graded: int


class ReviewCountsOut(BaseModel):
    sampled: int
    graded: int
    right: int
    wrong: int


class ReviewQueueOut(BaseModel):
    week_start: date
    current: bool = Field(description="This is this week's queue, which tops itself up")
    sample_size: int
    counts: ReviewCountsOut
    items: list[ReviewItemOut]
    weeks: list[ReviewWeekOut]


class ReviewDetailOut(BaseModel):
    item: ReviewItemOut
    messages: list[InboxMessageOut]
    next_id: uuid.UUID | None = Field(description="The next ungraded item of the same week")


class ReviewGradeIn(Model):
    grade: Grade | None = Field(description="None clears the grade")
    note: Note = ""
