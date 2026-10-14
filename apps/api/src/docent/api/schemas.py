"""Request and response models. These generate the OpenAPI schema the web app uses."""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from docent.billing.plans import Plan
from docent.billing.subscriptions import SubscriptionStatus
from docent.config import get_settings

Role = Literal["owner", "admin", "agent"]
InviteRole = Literal["admin", "agent"]

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _check_password(value: str) -> str:
    s = get_settings()
    if len(value) < s.password_min_length:
        raise ValueError(f"Use at least {s.password_min_length} characters.")
    if len(value) > s.password_max_length:
        raise ValueError(f"Use at most {s.password_max_length} characters.")
    if not value.strip():
        raise ValueError("Password cannot be only spaces.")
    return value


# Requests


class SignupIn(Model):
    name: Name
    email: EmailStr
    password: str
    workspace_name: Name

    _pw = field_validator("password")(_check_password)


class LoginIn(Model):
    email: EmailStr
    password: Annotated[str, StringConstraints(min_length=1, max_length=256)]


class TokenIn(Model):
    token: Annotated[str, StringConstraints(min_length=10, max_length=200)]


class ForgotPasswordIn(Model):
    email: EmailStr


class ResetPasswordIn(Model):
    token: Annotated[str, StringConstraints(min_length=10, max_length=200)]
    password: str

    _pw = field_validator("password")(_check_password)


class SwitchTenantIn(Model):
    tenant_id: uuid.UUID


class TenantUpdateIn(Model):
    name: Name


class InviteIn(Model):
    email: EmailStr
    role: InviteRole = "agent"


class RoleUpdateIn(Model):
    role: Role


class AcceptInviteIn(Model):
    token: Annotated[str, StringConstraints(min_length=10, max_length=200)]
    name: Name | None = None
    password: str | None = None

    @field_validator("password")
    @classmethod
    def _pw(cls, value: str | None) -> str | None:
        return None if value is None else _check_password(value)


# Responses


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    email_verified: bool


class TenantSummary(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    role: Role


class MeOut(BaseModel):
    user: UserOut
    active_tenant: TenantSummary | None
    tenants: list[TenantSummary]
    platform_admin: bool = Field(
        default=False, description="A platform admin with a verified email: /admin is open"
    )


class TenantOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    created_at: datetime
    your_role: Role


class MemberOut(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    role: Role
    joined_at: datetime
    is_you: bool


class InvitationOut(BaseModel):
    id: uuid.UUID
    email: str
    role: Role
    invited_by_name: str | None
    created_at: datetime
    expires_at: datetime


class MembersOut(BaseModel):
    members: list[MemberOut]
    invitations: list[InvitationOut]


class InvitationLookupOut(BaseModel):
    workspace_name: str
    email: str
    role: Role
    inviter_name: str | None
    expired: bool
    account_exists: bool


StepKey = Literal[
    "create_workspace",
    "verify_email",
    "invite_team",
    "teach_agent",
    "install_widget",
    "first_answer",
]
StepStatus = Literal["done", "todo", "locked"]


class OnboardingStep(BaseModel):
    key: StepKey
    status: StepStatus


class OnboardingOut(BaseModel):
    steps: list[OnboardingStep]
    completed: int = Field(description="Steps with status done")


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    db: Literal["ok", "down"]
    redis: Literal["ok", "degraded", "disabled", "local_only"]
    version: str


class ErrorDetail(BaseModel):
    code: str
    message: str
    fields: dict[str, str] | None = None
    request_id: str | None = None


class ErrorOut(BaseModel):
    error: ErrorDetail


# Knowledge

Audience = Literal["public", "identified"]
SourceKind = Literal["upload", "url", "sitemap"]
SourceStatus = Literal["queued", "syncing", "ready", "failed", "deleting"]
DocumentStatus = Literal["queued", "parsing", "embedding", "ready", "failed"]


class SourceCreateIn(Model):
    kind: Literal["url", "sitemap"]
    url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=4, max_length=2048)]
    audience: Audience = "public"
    title: Name | None = None
    page_limit: int = Field(default=50, ge=1, le=1000)


class SourceUpdateIn(Model):
    title: Name | None = None
    audience: Audience | None = None


class SearchIn(Model):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    audience: Audience = "public"
    limit: int = Field(default=8, ge=1, le=20)


class SourceOut(BaseModel):
    id: uuid.UUID
    kind: SourceKind
    title: str
    uri: str | None
    audience: Audience
    status: SourceStatus
    last_error: str | None
    page_limit: int
    document_count: int
    chunk_count: int
    created_at: datetime
    updated_at: datetime
    last_synced_at: datetime | None


class SourcesOut(BaseModel):
    sources: list[SourceOut]
    document_total: int
    chunk_total: int
    document_limit: int


class DocumentOut(BaseModel):
    id: uuid.UUID
    locator: str
    title: str
    url: str | None
    mime: str
    byte_size: int | None
    status: DocumentStatus
    last_error: str | None
    page_count: int | None
    chunk_count: int
    updated_at: datetime


class SourceDetailOut(BaseModel):
    source: SourceOut
    documents: list[DocumentOut]


class SearchHitOut(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    source_id: uuid.UUID
    document_title: str
    url: str | None
    heading_path: str
    content: str
    page: int | None
    score: float
    similarity: float | None
    keyword_rank: float | None


class SearchOut(BaseModel):
    hits: list[SearchHitOut]
    took_ms: int
    mode: Literal["hybrid", "keyword"] = Field(
        description="keyword when the embedding service is unavailable"
    )


# Agent

Tone = Literal["friendly", "neutral", "formal"]
Topic = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]
ClaimKey = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,39}$")]
ClaimValue = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
FieldKey = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,39}$")]


class AgentSettingsOut(BaseModel):
    name: str
    tone: Tone
    restricted_topics: list[str]


class AgentSettingsIn(Model):
    name: Name | None = None
    tone: Tone | None = None
    restricted_topics: list[Topic] | None = Field(default=None, max_length=30)


class ConversationCreateIn(Model):
    mode: Literal["anonymous", "identified"] = "anonymous"
    claims: dict[ClaimKey, ClaimValue] = Field(default_factory=dict, max_length=20)


class MessageIn(Model):
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class CitationOut(BaseModel):
    marker: int
    document_title: str
    heading_path: str
    url: str | None
    excerpt: str


class DecisionOut(BaseModel):
    type: Literal["answer", "clarify", "escalate", "reply"] = Field(
        description="reply: conversation such as a greeting, with no facts and no citations"
    )
    confidence: Literal["high", "medium", "low"] | None
    reason: str | None
    citations: list[int]
    account_facts: list[str] = Field(
        default_factory=list, description="Verified account details the answer relies on"
    )


class MessageOut(BaseModel):
    id: uuid.UUID
    role: Literal["visitor", "agent", "human", "system"]
    content: str
    decision: DecisionOut | None
    citations: list[CitationOut]
    created_at: datetime | None = None


class EscalationSummaryOut(BaseModel):
    issue: str
    tried: str
    user_context: str
    sentiment: Literal["calm", "frustrated", "angry", "unknown"]
    suggested_next_step: str


class EscalationOut(BaseModel):
    id: uuid.UUID
    reason: str
    status: Literal["open", "assigned", "waiting", "resolved"]
    ticket_type: str | None
    fields: dict[str, str]
    summary: EscalationSummaryOut | None
    contact_email: str | None = Field(description="Where the team replies; None until known")
    created_at: datetime


class ConversationOut(BaseModel):
    id: uuid.UUID
    channel: Literal["preview", "widget"]
    mode: Literal["anonymous", "identified"]
    claims: dict[str, str]
    status: Literal["open", "escalated", "closed"]
    messages: list[MessageOut]
    escalation: EscalationOut | None


class TicketField(Model):
    key: FieldKey
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    type: Literal["text", "email", "number", "select"] = "text"
    required: bool = False
    options: list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    ] = Field(default_factory=list, max_length=20)


class TicketTypeIn(Model):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    description: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
    ]
    fields: list[TicketField] = Field(default_factory=list, max_length=12)
    notify_emails: list[EmailStr] = Field(default_factory=list, max_length=10)
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    active: bool = True

    @field_validator("fields")
    @classmethod
    def _unique_keys(cls, fields: list[TicketField]) -> list[TicketField]:
        keys = [f.key for f in fields]
        if len(keys) != len(set(keys)):
            raise ValueError("Field keys must be unique.")
        for f in fields:
            if f.type == "select" and not f.options:
                raise ValueError(f"Field {f.key} needs at least one option.")
        return fields


class TicketTypeOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    fields: list[TicketField]
    notify_emails: list[str]
    priority: Literal["low", "normal", "high", "urgent"]
    active: bool
    created_at: datetime
    updated_at: datetime


# Widget (admin)

MAX_SUGGESTIONS = 4
SUGGESTION_MAX_LENGTH = 100


def clean_suggestions(values: list[str]) -> list[str]:
    """Suggested questions with whitespace collapsed.

    Refuses empty, long, extra, and repeated ones (repeats ignore case).
    """
    cleaned = [" ".join(v.split()) for v in values]
    if len(cleaned) > MAX_SUGGESTIONS:
        raise ValueError(f"Add {MAX_SUGGESTIONS} suggested questions at most.")
    if any(not v for v in cleaned):
        raise ValueError("Write each suggested question, or remove the empty one.")
    if any(len(v) > SUGGESTION_MAX_LENGTH for v in cleaned):
        raise ValueError(
            f"Keep each suggested question to {SUGGESTION_MAX_LENGTH} characters or fewer."
        )
    if len({v.casefold() for v in cleaned}) != len(cleaned):
        raise ValueError("Each suggested question must be different.")
    return cleaned


class WidgetIn(Model):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    allowed_origins: list[Annotated[str, StringConstraints(max_length=200)]] = Field(
        default_factory=list, max_length=20
    )
    anonymous_enabled: bool = True
    anonymous_daily_cap: int = Field(default=200, ge=0, le=100_000)
    allowed_claims: list[ClaimKey] = Field(default_factory=list, max_length=20)
    greeting: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    suggestions: list[str] = Field(
        default_factory=list,
        description=(
            "Questions shown under the greeting until the first message: "
            f"{MAX_SUGGESTIONS} at most, {SUGGESTION_MAX_LENGTH} characters each, no duplicates"
        ),
        json_schema_extra={"maxItems": MAX_SUGGESTIONS},
    )

    @field_validator("suggestions")
    @classmethod
    def _suggestions(cls, values: list[str]) -> list[str]:
        return clean_suggestions(values)


class SigningKeyIn(Model):
    public_jwk: dict[str, Any]


class SigningKeyOut(BaseModel):
    kid: str
    status: Literal["active", "retired"]
    public_jwk: dict[str, str]
    created_at: datetime
    retired_at: datetime | None


class WidgetOut(BaseModel):
    id: uuid.UUID
    public_id: str
    name: str
    allowed_origins: list[str]
    anonymous_enabled: bool
    anonymous_daily_cap: int
    allowed_claims: list[str]
    greeting: str
    suggestions: list[str]
    keys: list[SigningKeyOut]
    embed_origin: str = Field(description="Origin that serves the loader and the frame")
    created_at: datetime
    updated_at: datetime


# Widget (public, called from the widget frame)


class WidgetSessionIn(Model):
    widget: Annotated[str, StringConstraints(pattern=r"^wid_[A-Za-z0-9]{16}$")]
    parent_origin: Annotated[str, StringConstraints(max_length=200)]
    token: Annotated[str, StringConstraints(min_length=1, max_length=8192)] | None = None
    visitor_id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{16,64}$")] | None = None


class WidgetInfo(BaseModel):
    name: str
    greeting: str
    suggestions: list[str] = Field(default_factory=list)


class WidgetUser(BaseModel):
    name: str | None


class WidgetSessionOut(BaseModel):
    session_token: str
    expires_at: datetime
    expires_in: int = Field(description="Seconds until expiry, free of client clock skew")
    mode: Literal["anonymous", "identified"]
    visitor_id: str | None
    user: WidgetUser
    widget: WidgetInfo


class WidgetConversationIn(Model):
    resume_id: uuid.UUID | None = None
    create: bool = Field(
        default=True,
        description="False only looks up history: 404 no_conversation when there is none",
    )
    new: bool = Field(
        default=False,
        description=(
            "Start a new conversation instead of resuming one. "
            "The previous one stays as it is for the team"
        ),
    )

    @model_validator(mode="after")
    def _new_alone(self) -> WidgetConversationIn:
        if self.new and (not self.create or self.resume_id is not None):
            raise ValueError("A new conversation cannot also resume one or skip creating it.")
        return self


class WidgetHandoff(BaseModel):
    status: Literal["open", "assigned", "waiting", "resolved"]
    contact_given: bool = Field(description="The team already has an email to reply to")


class WidgetConversationOut(BaseModel):
    id: uuid.UUID
    status: Literal["open", "escalated", "closed"]
    messages: list[MessageOut]
    handoff: WidgetHandoff | None = Field(description="The latest handoff, if any")


class WidgetConversationSummaryOut(BaseModel):
    id: uuid.UUID
    status: Literal["open", "escalated", "closed"]
    title: str = Field(description="The visitor's first message, cut to 120 characters")
    started_at: datetime
    last_message_at: datetime


class ContactIn(Model):
    email: EmailStr


# Billing


class UsageMeter(BaseModel):
    used: int
    limit: int


class BillingUsage(BaseModel):
    period_start: date
    period_end: date
    replies: UsageMeter = Field(
        description="AI replies this month against the plan's cap plus this month's top-ups"
    )
    documents: UsageMeter = Field(description="Indexed documents against the plan's pages")
    widgets: UsageMeter
    seats: UsageMeter = Field(description="Members plus open invitations")


class TopupOut(BaseModel):
    id: uuid.UUID
    pack_id: str
    replies: int
    amount_cents: int = Field(description="The pack's price, before any tax")
    created_at: datetime


class BillingTopups(BaseModel):
    replies: int = Field(description="Replies this month's top-up packs added to the cap")
    bought: list[TopupOut] = Field(description="Packs paid for this month, oldest first")


class BillingOut(BaseModel):
    plan: Plan
    status: SubscriptionStatus
    active: bool = Field(description="False means escalate-only mode")
    provider: Literal["manual", "stripe"]
    trial_ends_at: datetime | None
    current_period_start: datetime | None
    current_period_end: datetime | None
    cancel_at: datetime | None
    cancel_at_period_end: bool = Field(description="Canceled; the plan stays until the period ends")
    scheduled_plan: Plan | None = Field(description="A downgrade waiting for the period to end")
    scheduled_change_at: datetime | None
    grace_ends_at: datetime | None
    comped_until: datetime | None = Field(
        description="A paid plan Docent gave free of charge, until this time"
    )
    refund_until: datetime | None = Field(
        description="End of the 14 day money-back window, while the workspace can still use it"
    )
    billing_enabled: bool = Field(description="Stripe keys are configured on this server")
    can_manage: bool = Field(description="The current member may change billing")
    usage: BillingUsage
    topups: BillingTopups


class TopupCheckoutIn(Model):
    pack_id: Annotated[str, StringConstraints(min_length=1, max_length=40)] = Field(
        description="A pack from the current plan's topup_packs"
    )


class CheckoutIn(Model):
    plan_id: Literal["starter", "growth", "scale"]


class PlanChangeIn(Model):
    plan_id: Literal["starter", "growth", "scale"]


class ChargeLine(BaseModel):
    label: str
    amount_cents: int = Field(description="Positive is charged, negative is credited")


class PlanChangePreviewOut(BaseModel):
    kind: Literal["upgrade", "downgrade", "same"]
    plan: Plan
    effective_at: datetime = Field(description="When the new plan and its limits start")
    due_now_cents: int = Field(description="Charged today; 0 for a downgrade")
    lines: list[ChargeLine] = Field(description="How due_now_cents is worked out, line by line")
    next_renewal_cents: int = Field(description="The monthly price from the next renewal")
    explanation: list[str] = Field(description="Plain sentences on what happens and why")
    blockers: list[str] = Field(description="Why this change cannot be made yet; empty if it can")
    stripe_due_now_cents: int | None = Field(
        description="Stripe's own preview of today's charge, when payments are set up"
    )


class RefundOut(BaseModel):
    eligible: bool
    amount_cents: int
    refund_until: datetime | None
    reason: str = Field(description="Why a refund is or is not available, in plain words")


class RedirectOut(BaseModel):
    url: str


# Memory


class TeamAnswerIn(Model):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)]
    answer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    audience: Audience = "public"
    gap_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=500, description="Knowledge gaps this answer closes"
    )


class TeamAnswerOut(BaseModel):
    id: uuid.UUID
    question: str
    answer: str
    audience: Audience
    status: SourceStatus = Field(description="Indexing status, like a knowledge source")
    citations_30d: int
    created_by_name: str | None
    created_at: datetime
    updated_at: datetime


class GapGroupOut(BaseModel):
    ids: list[uuid.UUID]
    question: str = Field(description="The newest wording of this question")
    count: int
    examples: list[str] = Field(description="Up to three other wordings")
    last_asked_at: datetime


class GapDismissIn(Model):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class RememberedCustomerOut(BaseModel):
    id: uuid.UUID
    name: str | None
    email: str | None
    facts: int
    conversations: int
    last_seen_at: datetime | None


class CustomerFactOut(BaseModel):
    id: uuid.UUID
    fact: str
    kind: Literal["preference", "context", "issue"]
    created_at: datetime
    expires_at: datetime


class RememberedCustomerDetailOut(BaseModel):
    customer: RememberedCustomerOut
    facts: list[CustomerFactOut]


class MemorySourceOut(BaseModel):
    id: uuid.UUID
    title: str
    kind: Literal["upload", "url", "sitemap"]
    status: SourceStatus
    documents: int
    chunks: int
    citations_30d: int


class CitedSectionOut(BaseModel):
    document_title: str
    heading_path: str
    citations: int


class MemoryOverviewOut(BaseModel):
    knowledge_version: int
    sources: list[MemorySourceOut] = Field(description="Help sources, most cited first")
    top_sections: list[CitedSectionOut] = Field(description="Most cited sections, 30 days")
    team_answers: int
    open_gaps: int = Field(description="Unanswered product questions not yet answered or dismissed")
    customers_remembered: int
    customer_facts: int
    answers_30d: int
    handoffs_30d: int


# Inbox

EscalationStatus = Literal["open", "assigned", "waiting", "resolved"]
Priority = Literal["low", "normal", "high", "urgent"]
HandoffReason = Literal[
    "no_source",
    "low_confidence",
    "user_requested",
    "restricted_topic",
    "repeated_failure",
    "cap_reached",
]
InboxSort = Literal["newest", "oldest", "updated", "priority"]
WebhookEvent = Literal["escalation.created", "escalation.updated", "escalation.resolved"]
ALL_WEBHOOK_EVENTS: tuple[WebhookEvent, ...] = (
    "escalation.created",
    "escalation.updated",
    "escalation.resolved",
)
EmailDeliveryStatus = Literal["queued", "sent", "retrying", "dead"]
NotificationStatus = Literal["queued", "sent", "retrying", "dead", "skipped"]
WebhookDeliveryStatus = Literal["queued", "retrying", "succeeded", "dead"]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
FieldValue = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class PersonOut(BaseModel):
    id: uuid.UUID
    name: str


class TicketTypeRef(BaseModel):
    id: uuid.UUID
    name: str


class InboxItemOut(BaseModel):
    id: uuid.UUID
    status: EscalationStatus
    reason: HandoffReason
    priority: Priority
    issue: str = Field(description="The summary's issue, or the customer's message until then")
    ticket_type: TicketTypeRef | None
    contact_email: str | None
    customer_name: str | None = Field(description="From the signed identity; None if anonymous")
    mode: Literal["anonymous", "identified"]
    channel: Literal["preview", "widget"]
    assignee: PersonOut | None
    unread: bool = Field(description="Created or changed since you last opened it")
    summary_ready: bool
    created_at: datetime
    updated_at: datetime
    first_response_at: datetime | None
    resolved_at: datetime | None


class InboxCountsOut(BaseModel):
    open: int
    assigned: int
    waiting: int
    resolved: int
    unread: int = Field(description="Unread handoffs that are not resolved")
    mine: int = Field(description="Assigned to you and not resolved")
    unassigned: int = Field(description="Nobody assigned and not resolved")


class InboxPageOut(BaseModel):
    items: list[InboxItemOut]
    next_cursor: str | None = Field(description="Pass as cursor for the next page")
    counts: InboxCountsOut


class BoardColumnOut(BaseModel):
    status: EscalationStatus
    total: int
    items: list[InboxItemOut]


class InboxBoardOut(BaseModel):
    columns: list[BoardColumnOut]
    counts: InboxCountsOut


class MessageFlagOut(BaseModel):
    reason: str
    by: str | None
    at: datetime


class EmailDeliveryOut(BaseModel):
    id: uuid.UUID
    kind: Literal["reply", "notification", "digest"]
    to_hint: str = Field(description="The recipient, partly hidden")
    subject: str
    status: EmailDeliveryStatus
    attempts: int
    last_error: str | None
    created_at: datetime
    sent_at: datetime | None


class InboxMessageOut(BaseModel):
    id: uuid.UUID
    role: Literal["visitor", "agent", "human", "system"]
    content: str
    decision: DecisionOut | None
    citations: list[CitationOut]
    created_at: datetime
    author: PersonOut | None = Field(description="The team member who wrote a human reply")
    flag: MessageFlagOut | None = Field(description="Marked as a wrong answer, and why")
    delivery: EmailDeliveryOut | None = Field(description="The email that carried a human reply")


class NoteOut(BaseModel):
    id: uuid.UUID
    body: str
    author: PersonOut | None
    created_at: datetime
    can_delete: bool


class HistoryEntryOut(BaseModel):
    id: uuid.UUID
    action: str
    text: str = Field(description="What happened, in a sentence")
    actor: str | None = Field(description="Who did it; None for Docent itself")
    created_at: datetime


class CustomerOut(BaseModel):
    external_id: str
    name: str | None
    email: str | None
    claims: dict[str, str]
    first_seen_at: datetime
    last_seen_at: datetime


class InboxDetailOut(BaseModel):
    item: InboxItemOut
    summary: EscalationSummaryOut | None
    fields: dict[str, str]
    ticket_type_fields: list[TicketField] = Field(description="The ticket type's fields, to edit")
    conversation_id: uuid.UUID
    claims: dict[str, str] = Field(description="Verified claims from the signed identity token")
    customer: CustomerOut | None
    messages: list[InboxMessageOut]
    notes: list[NoteOut]
    history: list[HistoryEntryOut]
    deliveries: list[EmailDeliveryOut]
    routed_by_rule: str | None
    reply_from: str = Field(description="The From line of a reply")
    reply_to: str = Field(description="Where the customer's answer goes")
    can_assign_others: bool


class InboxUpdateIn(Model):
    """Send only what changes. assignee_user_id or ticket_type_id set to null clears them."""

    status: EscalationStatus | None = None
    assignee_user_id: uuid.UUID | None = None
    priority: Priority | None = None
    ticket_type_id: uuid.UUID | None = None
    fields: dict[FieldKey, FieldValue] | None = Field(default=None, max_length=12)


class ReplyIn(Model):
    body: LongText
    then: Literal["waiting", "resolved", "keep"] = Field(
        default="waiting", description="Status after sending: waiting on the customer by default"
    )


class ReplyOut(BaseModel):
    message: InboxMessageOut
    item: InboxItemOut


class NoteIn(Model):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class FlagIn(Model):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]


class InboxStatsOut(BaseModel):
    open: int
    unassigned: int
    mine: int
    waiting: int
    resolved_7d: int
    median_first_response_minutes: float | None = Field(description="Last 30 days")
    answers_30d: int
    wrong_answers_30d: int = Field(description="Agent answers the team marked wrong")
    wrong_answer_rate_30d: float | None


class AssigneeOut(BaseModel):
    id: uuid.UUID
    name: str
    role: Role
    is_you: bool


class InboxSettingsOut(BaseModel):
    support_email: str | None = Field(description="Reply-To on inbox replies")
    reply_from: str = Field(description="The From line customers see")


class InboxSettingsIn(Model):
    support_email: EmailStr | None


class NotificationPrefs(Model):
    daily_digest: bool = Field(description="One email each morning while handoffs are open")
    assigned_email: bool = Field(description="Email when a handoff is assigned to you")


# Automation

ClaimOp = Literal["equals", "not_equals", "contains", "exists"]


class ClaimCondition(Model):
    key: ClaimKey
    op: ClaimOp = "equals"
    value: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""


class RoutingRuleIn(Model):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    active: bool = True
    ticket_type_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=20, description="Any of these; empty matches any type"
    )
    reasons: list[HandoffReason] = Field(
        default_factory=list, max_length=6, description="Any of these; empty matches any reason"
    )
    claim_conditions: list[ClaimCondition] = Field(
        default_factory=list, max_length=10, description="All must match the verified claims"
    )
    assign_user_id: uuid.UUID | None = None
    set_priority: Priority | None = None
    notify_emails: list[EmailStr] = Field(default_factory=list, max_length=10)
    notify_channel_id: uuid.UUID | None = None
    webhook_id: uuid.UUID | None = None

    @field_validator("claim_conditions")
    @classmethod
    def _conditions(cls, conditions: list[ClaimCondition]) -> list[ClaimCondition]:
        for c in conditions:
            if c.op != "exists" and not c.value:
                raise ValueError(f"Give a value to compare {c.key} with.")
        return conditions

    def has_action(self) -> bool:
        return bool(
            self.assign_user_id
            or self.set_priority
            or self.notify_emails
            or self.notify_channel_id
            or self.webhook_id
        )


class RoutingRuleOut(BaseModel):
    id: uuid.UUID
    name: str
    position: int
    active: bool
    ticket_type_ids: list[uuid.UUID]
    reasons: list[HandoffReason]
    claim_conditions: list[ClaimCondition]
    assign_user_id: uuid.UUID | None
    set_priority: Priority | None
    notify_emails: list[str]
    notify_channel_id: uuid.UUID | None
    webhook_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class RuleOrderIn(Model):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


SecretUrl = Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=2048)]


class SlackChannelIn(Model):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    url: SecretUrl = Field(description="The Slack incoming webhook URL. Never shown again.")
    post_all: bool = Field(default=True, description="Every new handoff, not only from rules")


class SlackChannelUpdateIn(Model):
    name: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)] | None
    ) = None
    url: SecretUrl | None = None
    post_all: bool | None = None
    active: bool | None = None


class NotificationStateOut(BaseModel):
    kind: Literal["new_handoff", "assigned", "daily_digest", "test"]
    status: NotificationStatus
    attempts: int
    last_error: str | None
    created_at: datetime
    sent_at: datetime | None


class SlackChannelOut(BaseModel):
    id: uuid.UUID
    name: str
    url_hint: str = Field(description="Enough of the URL to recognize it")
    post_all: bool
    active: bool
    created_at: datetime
    last_delivery: NotificationStateOut | None


class WebhookIn(Model):
    url: SecretUrl
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    events: list[WebhookEvent] = Field(
        default_factory=lambda: list(ALL_WEBHOOK_EVENTS),
        max_length=3,
        description="Empty: only routing rules send to it",
    )
    active: bool = True


class WebhookUpdateIn(Model):
    url: SecretUrl | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = (
        None
    )
    events: list[WebhookEvent] | None = Field(default=None, max_length=3)
    active: bool | None = None


class WebhookDeliveryOut(BaseModel):
    id: uuid.UUID
    event_id: str
    event_type: str
    test: bool
    status: WebhookDeliveryStatus
    attempts: int
    max_attempts: int
    response_status: int | None
    response_ms: int | None
    last_error: str | None
    next_attempt_at: datetime | None
    created_at: datetime
    delivered_at: datetime | None


class WebhookOut(BaseModel):
    id: uuid.UUID
    url_hint: str
    description: str
    events: list[WebhookEvent]
    active: bool
    secret_hint: str
    created_at: datetime
    updated_at: datetime
    last_delivery: WebhookDeliveryOut | None


class WebhookCreatedOut(BaseModel):
    webhook: WebhookOut
    secret: str = Field(description="The signing secret. Shown once; store it now.")


class WebhookSecretOut(BaseModel):
    secret: str = Field(description="The new signing secret. Shown once.")


class QueuedOut(BaseModel):
    id: uuid.UUID
    status: Literal["queued"] = "queued"


# Platform admin console. Counts and metadata only: never message, knowledge, or memory content.

WorkspaceState = Literal[
    "trial", "trial_ended", "paying", "comped", "comp_ended", "past_due", "canceled", "other"
]
WorkspaceSort = Literal["newest", "name", "cost", "margin"]
PlanId = Literal["trial", "starter", "growth", "scale"]
PaidPlanId = Literal["starter", "growth", "scale"]
JobStatus = Literal["queued", "running", "succeeded", "failed", "dead"]
EventOutcome = Literal["applied", "ignored", "stale", "unknown_customer"]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]


class AdminFiguresOut(BaseModel):
    """One workspace this calendar month. Money is in micro dollars (1 USD = 1,000,000)."""

    replies_used: int = Field(description="Billed AI replies, as the cap counts them")
    replies_cap: int = Field(description="The plan's cap while it is active, else 0")
    cost_micros: int = Field(description="Model cost from usage_events")
    revenue_micros: int = Field(description="The plan's monthly price if it is paid through Stripe")
    margin_micros: int = Field(description="Revenue less model cost")
    cost_per_reply_micros: float | None
    anomaly: bool = Field(description="Cost per reply is more than 3 times the median")


class AdminPlanStateCount(BaseModel):
    plan_id: str
    state: WorkspaceState
    count: int


class AdminAnomalyOut(BaseModel):
    tenant_id: uuid.UUID
    name: str
    plan_id: str
    replies_used: int
    cost_micros: int
    cost_per_reply_micros: float
    times_median: float


class AdminRedisOut(BaseModel):
    status: Literal["ok", "degraded", "disabled", "local_only"] = Field(
        description="Redis as this API process sees it now; local_only once the budget is "
        "nearly spent"
    )
    month: date
    commands: int = Field(
        description="Commands sent this month: what every process added up, plus what this "
        "process has not added yet"
    )
    budget: int = Field(description="Commands a month Docent allows itself")
    alert_percents: list[int] = Field(description="Platform admins get an email at each")
    local_only_percent: int = Field(description="From here, no command until the month ends")
    alerted_80_at: datetime | None
    alerted_90_at: datetime | None
    local_only_since: datetime | None
    counted_at: datetime | None = Field(description="When a process last added its count")


class AdminOverviewOut(BaseModel):
    period_start: date
    workspaces: int
    by_plan_state: list[AdminPlanStateCount]
    paying_workspaces: int = Field(description="Active Stripe subscriptions")
    mrr_micros: int = Field(description="Monthly price of every active Stripe subscription")
    topups_this_month_micros: int = Field(
        description="Top-up packs paid for this month, before tax"
    )
    new_workspaces_30d: int
    new_accounts_30d: int
    replies_this_month: int
    cost_this_month_micros: int
    gross_margin: float | None = Field(
        description="(MRR + top-ups - model cost) / (MRR + top-ups); null without revenue"
    )
    median_cost_per_reply_micros: float | None
    anomalies: list[AdminAnomalyOut]
    redis: AdminRedisOut


class AdminWorkspaceRowOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    plan: Plan
    state: WorkspaceState
    provider: Literal["manual", "stripe"]
    members: int
    created_at: datetime
    figures: AdminFiguresOut


class AdminWorkspacesOut(BaseModel):
    items: list[AdminWorkspaceRowOut]
    total: int
    page: int
    per_page: int
    median_cost_per_reply_micros: float | None


class AdminSubscriptionOut(BaseModel):
    plan: Plan
    state: WorkspaceState
    status: SubscriptionStatus
    provider: Literal["manual", "stripe"]
    active: bool = Field(description="False means escalate-only mode")
    trial_ends_at: datetime | None
    current_period_start: datetime | None
    current_period_end: datetime | None
    cancel_at: datetime | None
    cancel_at_period_end: bool
    scheduled_plan: Plan | None
    scheduled_change_at: datetime | None
    grace_ends_at: datetime | None
    comped_until: datetime | None
    first_paid_at: datetime | None
    refunded_at: datetime | None
    refund_until: datetime | None
    customer_id: str | None = Field(description="Stripe customer id")
    subscription_id: str | None = Field(description="Stripe subscription id")


class AdminUsageMonthOut(BaseModel):
    month: date
    replies_used: int
    replies_cap: int | None = Field(
        description="The cap that month, top-ups included; null with no usage row"
    )
    cost_micros: int
    tokens_in: int
    tokens_out: int


class AdminMemberOut(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    role: Role
    email_verified: bool
    joined_at: datetime
    last_active_at: datetime | None


class AdminWidgetOut(BaseModel):
    id: uuid.UUID
    public_id: str
    name: str
    anonymous_enabled: bool
    allowed_origins: int = Field(description="How many origins may embed it")
    created_at: datetime


class AdminKnowledgeOut(BaseModel):
    sources: int = Field(description="Uploads, pages, and sitemaps; team answers not included")
    failed_sources: int
    team_answers: int
    documents: int = Field(description="Pages of docs, as the plan counts them")
    documents_cap: int
    passages: int


class AdminActivityOut(BaseModel):
    conversations: int = Field(description="Started this month, widget and preview")
    widget_conversations: int
    handoffs: int = Field(description="Handoffs to the team this month")
    open_handoffs: int = Field(description="Not resolved yet, any month")


class AdminBillingEventOut(BaseModel):
    id: str
    type: str
    outcome: EventOutcome | None = Field(description="Null for events from before it was kept")
    tenant_id: uuid.UUID | None
    workspace_name: str | None
    created_at: datetime
    received_at: datetime


class AdminAuditEntryOut(BaseModel):
    id: uuid.UUID
    action: str
    actor_name: str | None
    actor_email: str | None
    target_type: str | None
    target_id: str | None
    metadata: dict[str, Any]
    created_at: datetime


class AdminActionsOut(BaseModel):
    extend_trial: bool
    give_comp: bool
    end_comp: bool
    refusal: str | None = Field(description="Why no plan action applies to this workspace")


class AdminWorkspaceDetailOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    status: Literal["active", "suspended", "deleted"]
    created_at: datetime
    subscription: AdminSubscriptionOut
    this_month: AdminFiguresOut
    activity: AdminActivityOut
    usage: list[AdminUsageMonthOut] = Field(description="The last 6 months, oldest first")
    members: list[AdminMemberOut]
    widgets: list[AdminWidgetOut]
    knowledge: AdminKnowledgeOut
    billing_events: list[AdminBillingEventOut]
    audit: list[AdminAuditEntryOut]
    actions: AdminActionsOut


class AdminExtendTrialIn(Model):
    days: int = Field(ge=1, le=30)
    reason: Reason


class AdminCompIn(Model):
    plan_id: PaidPlanId
    until: date = Field(description="The comp ends at the start of this day, UTC")
    reason: Reason


class AdminReasonIn(Model):
    reason: Reason


class AdminPersonWorkspaceOut(BaseModel):
    tenant_id: uuid.UUID
    name: str
    role: Role


class AdminPersonOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    email_verified: bool
    is_platform_admin: bool
    created_at: datetime
    last_login_at: datetime | None
    workspaces: list[AdminPersonWorkspaceOut]


class AdminPeopleOut(BaseModel):
    items: list[AdminPersonOut]
    total: int
    page: int
    per_page: int


class AdminJobCountOut(BaseModel):
    kind: str
    status: JobStatus
    count: int


class AdminDeadJobOut(BaseModel):
    id: int
    kind: str
    tenant_id: uuid.UUID | None
    workspace_name: str | None
    attempts: int
    max_attempts: int
    last_error: str | None
    created_at: datetime
    finished_at: datetime | None


class AdminJobsOut(BaseModel):
    counts: list[AdminJobCountOut] = Field(description="Kept jobs by kind and status")
    ready: int = Field(description="Queued and due now")
    scheduled: int = Field(description="Queued for later: retries and scheduled work")
    running: int
    dead: int
    oldest_ready_seconds: int | None = Field(description="How long the oldest due job has waited")
    dead_jobs: list[AdminDeadJobOut] = Field(description="The 50 most recent")


class AdminBillingEventsOut(BaseModel):
    items: list[AdminBillingEventOut]
    total: int
    page: int
    per_page: int
