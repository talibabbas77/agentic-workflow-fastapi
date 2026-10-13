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
