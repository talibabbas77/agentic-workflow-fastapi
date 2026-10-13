"""Request and response models. These generate the OpenAPI schema the web app uses."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator

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
    redis: Literal["ok", "degraded", "disabled"]
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
    type: Literal["answer", "clarify", "escalate"]
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


class WidgetIn(Model):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    allowed_origins: list[Annotated[str, StringConstraints(max_length=200)]] = Field(
        default_factory=list, max_length=20
    )
    anonymous_enabled: bool = True
    anonymous_daily_cap: int = Field(default=200, ge=0, le=100_000)
    allowed_claims: list[ClaimKey] = Field(default_factory=list, max_length=20)
    greeting: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""


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


class WidgetHandoff(BaseModel):
    status: Literal["open", "assigned", "waiting", "resolved"]
    contact_given: bool = Field(description="The team already has an email to reply to")


class WidgetConversationOut(BaseModel):
    id: uuid.UUID
    status: Literal["open", "escalated", "closed"]
    messages: list[MessageOut]
    handoff: WidgetHandoff | None = Field(description="The latest handoff, if any")


class ContactIn(Model):
    email: EmailStr
