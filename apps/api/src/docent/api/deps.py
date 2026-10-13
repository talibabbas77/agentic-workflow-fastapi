"""Request dependencies: app state, the signed-in user, and their role in the active tenant."""

import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, Request, Response

from docent.api.errors import AppError, forbidden, rate_limited, unauthenticated
from docent.api.state import AppState
from docent.config import Settings
from docent.db.pool import transaction
from docent.ids import keyed_hash
from docent.security.ratelimit import Limit
from docent.services import accounts, tenants
from docent.services.accounts import SessionUser


def get_state(request: Request) -> AppState:
    state: AppState = request.app.state.docent
    return state


State = Annotated[AppState, Depends(get_state)]


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def ip_key(request: Request, state: AppState) -> str:
    return keyed_hash(state.settings.secret_key.get_secret_value(), client_ip(request))


def email_key(state: AppState, email: str) -> str:
    return keyed_hash(state.settings.secret_key.get_secret_value(), accounts.normalize_email(email))


async def enforce(state: AppState, limit: Limit, *key_parts: str) -> None:
    result = await state.limiter.hit(limit, *key_parts)
    if not result.allowed:
        raise rate_limited(result.retry_after)


def session_ttl(settings: Settings) -> timedelta:
    return timedelta(days=settings.session_ttl_days)


def set_session_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=int(session_ttl(settings).total_seconds()),
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
    )


async def get_optional_user(request: Request, state: State) -> SessionUser | None:
    token = request.cookies.get(state.settings.session_cookie_name)
    if not token or len(token) > 200:
        return None
    async with transaction(state.pool) as conn:
        return await accounts.load_session(conn, token, session_ttl(state.settings))


OptionalUser = Annotated[SessionUser | None, Depends(get_optional_user)]


async def get_user(user: OptionalUser) -> SessionUser:
    if user is None:
        raise unauthenticated()
    return user


CurrentUser = Annotated[SessionUser, Depends(get_user)]


@dataclass(frozen=True, slots=True)
class Member:
    user: SessionUser
    tenant_id: uuid.UUID
    role: str

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.user_id


async def get_member(user: CurrentUser, state: State) -> Member:
    tenant_id = user.active_tenant_id
    if tenant_id is None:
        raise AppError(409, "no_workspace", "Choose or create a workspace first.")
    async with transaction(state.pool, tenant_id=tenant_id, user_id=user.user_id) as conn:
        role = await tenants.role_of(conn, tenant_id, user.user_id)
        if role is None:
            await accounts.set_active_tenant(conn, user.token_hash, None)
    if role is None:
        raise AppError(409, "no_workspace", "You are no longer a member of that workspace.")
    return Member(user=user, tenant_id=tenant_id, role=role)


CurrentMember = Annotated[Member, Depends(get_member)]


async def get_admin(member: CurrentMember) -> Member:
    if member.role not in ("owner", "admin"):
        raise forbidden()
    return member


async def get_owner(member: CurrentMember) -> Member:
    if member.role != "owner":
        raise forbidden("Only workspace owners can do that.")
    return member


AdminMember = Annotated[Member, Depends(get_admin)]
OwnerMember = Annotated[Member, Depends(get_owner)]
