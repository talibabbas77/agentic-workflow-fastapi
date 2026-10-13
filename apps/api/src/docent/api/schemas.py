"""Request and response models. These generate the OpenAPI schema the web app uses."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

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
