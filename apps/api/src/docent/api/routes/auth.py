"""Staff authentication: sign up, log in, sessions, email verification, password reset."""

from datetime import timedelta

from fastapi import APIRouter, Request, Response, status

from docent.api.deps import (
    CurrentUser,
    State,
    clear_session_cookie,
    email_key,
    enforce,
    ip_key,
    session_ttl,
    set_session_cookie,
)
from docent.api.errors import AppError
from docent.api.schemas import (
    ErrorOut,
    ForgotPasswordIn,
    LoginIn,
    MeOut,
    ResetPasswordIn,
    SignupIn,
    SwitchTenantIn,
    TokenIn,
)
from docent.api.views import build_me
from docent.db.pool import set_context, transaction
from docent.jobs import queue
from docent.jobs.handlers import SEND_EMAIL
from docent.security import ratelimit
from docent.security.passwords import hash_password, needs_rehash, verify_password
from docent.services import accounts, tenants

router = APIRouter(prefix="/v1/auth", tags=["auth"], responses={422: {"model": ErrorOut}})


def _verify_url(state: State, token: str) -> str:
    return f"{state.settings.web_origin}/verify-email?token={token}"


@router.post("/signup", status_code=status.HTTP_201_CREATED, responses={409: {"model": ErrorOut}})
async def signup(body: SignupIn, request: Request, response: Response, state: State) -> MeOut:
    await enforce(state, ratelimit.SIGNUP_PER_IP, ip_key(request, state))
    await enforce(state, ratelimit.SIGNUP_PER_EMAIL, email_key(state, str(body.email)))
    password_hash = await hash_password(body.password)
    s = state.settings
    async with transaction(state.pool) as conn:
        try:
            user_id = await accounts.create_user(
                conn, email=str(body.email), name=body.name, password_hash=password_hash
            )
        except accounts.EmailTaken:
            raise AppError(
                409,
                "email_taken",
                "An account with this email already exists. Log in instead.",
                {"email": "Already registered."},
            ) from None
        tenant_id = await tenants.create_tenant(conn, name=body.workspace_name, owner_id=user_id)
        token = await accounts.issue_auth_token(
            conn, user_id, "verify_email", timedelta(hours=s.verify_token_ttl_hours)
        )
        await set_context(conn)
        await queue.enqueue(
            conn,
            SEND_EMAIL,
            {
                "template": "verify_email",
                "data": {
                    "to": str(body.email),
                    "name": body.name,
                    "url": _verify_url(state, token),
                    "ttl_hours": s.verify_token_ttl_hours,
                },
            },
        )
        session = await accounts.create_session(
            conn,
            user_id=user_id,
            tenant_id=tenant_id,
            ttl=session_ttl(s),
            ip_hash=ip_key(request, state),
            user_agent=request.headers.get("user-agent"),
        )
        me = await build_me(conn, user_id, tenant_id)
    await state.waker.wake()
    set_session_cookie(response, s, session)
    return me


@router.post("/login", responses={401: {"model": ErrorOut}, 429: {"model": ErrorOut}})
async def login(body: LoginIn, request: Request, response: Response, state: State) -> MeOut:
    await enforce(state, ratelimit.LOGIN_PER_IP, ip_key(request, state))
    await enforce(state, ratelimit.LOGIN_PER_EMAIL, email_key(state, str(body.email)))
    async with transaction(state.pool) as conn:
        user = await accounts.find_user_by_email(conn, str(body.email))
    stored_hash = user["password_hash"] if user else None
    if not await verify_password(stored_hash, body.password) or user is None:
        raise AppError(401, "invalid_credentials", "Email or password is incorrect.")
    new_hash = await hash_password(body.password) if needs_rehash(user["password_hash"]) else None
    async with transaction(state.pool, user_id=user["id"]) as conn:
        if new_hash:
            await accounts.set_password(conn, user["id"], new_hash)
        await accounts.mark_login(conn, user["id"])
        memberships = await tenants.tenants_for_user(conn)
        active = memberships[0]["id"] if memberships else None
        session = await accounts.create_session(
            conn,
            user_id=user["id"],
            tenant_id=active,
            ttl=session_ttl(state.settings),
            ip_hash=ip_key(request, state),
            user_agent=request.headers.get("user-agent"),
        )
        me = await build_me(conn, user["id"], active)
    set_session_cookie(response, state.settings, session)
    return me


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(user: CurrentUser, response: Response, state: State) -> None:
    async with transaction(state.pool) as conn:
        await accounts.revoke_session(conn, user.token_hash)
    clear_session_cookie(response, state.settings)


@router.get("/me", responses={401: {"model": ErrorOut}})
async def me(user: CurrentUser, state: State) -> MeOut:
    async with transaction(state.pool, user_id=user.user_id) as conn:
        return await build_me(conn, user.user_id, user.active_tenant_id)


@router.post("/switch-tenant", responses={404: {"model": ErrorOut}})
async def switch_tenant(body: SwitchTenantIn, user: CurrentUser, state: State) -> MeOut:
    async with transaction(state.pool, tenant_id=body.tenant_id, user_id=user.user_id) as conn:
        if await tenants.role_of(conn, body.tenant_id, user.user_id) is None:
            raise AppError(404, "not_found", "Workspace not found.")
        await accounts.set_active_tenant(conn, user.token_hash, body.tenant_id)
        return await build_me(conn, user.user_id, body.tenant_id)


@router.post(
    "/verify-email", status_code=status.HTTP_204_NO_CONTENT, responses={400: {"model": ErrorOut}}
)
async def verify_email(body: TokenIn, state: State) -> None:
    async with transaction(state.pool) as conn:
        user_id = await accounts.consume_auth_token(conn, body.token, "verify_email")
        if user_id is None:
            raise AppError(
                400,
                "token_invalid",
                "This link has expired or was already used. Request a new one.",
            )
        await accounts.mark_email_verified(conn, user_id)


@router.post(
    "/verify-email/resend",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={429: {"model": ErrorOut}},
)
async def resend_verification(user: CurrentUser, state: State) -> None:
    if user.email_verified:
        return
    await enforce(state, ratelimit.VERIFY_RESEND_PER_USER, str(user.user_id))
    s = state.settings
    async with transaction(state.pool) as conn:
        token = await accounts.issue_auth_token(
            conn, user.user_id, "verify_email", timedelta(hours=s.verify_token_ttl_hours)
        )
        await queue.enqueue(
            conn,
            SEND_EMAIL,
            {
                "template": "verify_email",
                "data": {
                    "to": user.email,
                    "name": user.name,
                    "url": _verify_url(state, token),
                    "ttl_hours": s.verify_token_ttl_hours,
                },
            },
        )
    await state.waker.wake()


@router.post("/password/forgot", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(body: ForgotPasswordIn, request: Request, state: State) -> None:
    """Always 202, so the response never reveals whether an account exists."""
    await enforce(state, ratelimit.RESET_PER_IP, ip_key(request, state))
    await enforce(state, ratelimit.RESET_PER_EMAIL, email_key(state, str(body.email)))
    s = state.settings
    async with transaction(state.pool) as conn:
        user = await accounts.find_user_by_email(conn, str(body.email))
        if user is None:
            return
        token = await accounts.issue_auth_token(
            conn, user["id"], "reset_password", timedelta(minutes=s.reset_token_ttl_minutes)
        )
        await queue.enqueue(
            conn,
            SEND_EMAIL,
            {
                "template": "reset_password",
                "data": {
                    "to": user["email"],
                    "name": user["name"],
                    "url": f"{s.web_origin}/reset-password?token={token}",
                    "ttl_minutes": s.reset_token_ttl_minutes,
                },
            },
        )
    await state.waker.wake()


@router.post("/password/reset", responses={400: {"model": ErrorOut}})
async def reset_password(
    body: ResetPasswordIn, request: Request, response: Response, state: State
) -> MeOut:
    password_hash = await hash_password(body.password)
    async with transaction(state.pool) as conn:
        user_id = await accounts.consume_auth_token(conn, body.token, "reset_password")
        if user_id is None:
            raise AppError(
                400,
                "token_invalid",
                "This link has expired or was already used. Request a new one.",
            )
        await accounts.set_password(conn, user_id, password_hash)
        await accounts.mark_email_verified(conn, user_id)
        await accounts.revoke_all_sessions(conn, user_id)
        await set_context(conn, user_id=user_id)
        memberships = await tenants.tenants_for_user(conn)
        active = memberships[0]["id"] if memberships else None
        session = await accounts.create_session(
            conn,
            user_id=user_id,
            tenant_id=active,
            ttl=session_ttl(state.settings),
            ip_hash=ip_key(request, state),
            user_agent=request.headers.get("user-agent"),
        )
        me = await build_me(conn, user_id, active)
    set_session_cookie(response, state.settings, session)
    return me
