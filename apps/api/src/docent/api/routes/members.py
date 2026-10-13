"""Workspace members and invitations."""

import uuid
from datetime import timedelta

from fastapi import APIRouter, Query, Request, Response, status

from docent.api.deps import (
    AdminMember,
    CurrentMember,
    OptionalUser,
    OwnerMember,
    State,
    enforce,
    ip_key,
    session_ttl,
    set_session_cookie,
)
from docent.api.errors import AppError, forbidden, not_found
from docent.api.schemas import (
    AcceptInviteIn,
    ErrorOut,
    InvitationLookupOut,
    InvitationOut,
    InviteIn,
    MemberOut,
    MembersOut,
    MeOut,
    RoleUpdateIn,
)
from docent.api.views import build_me
from docent.db.pool import set_context, transaction
from docent.ids import hash_token
from docent.jobs import queue
from docent.jobs.handlers import SEND_EMAIL
from docent.security import ratelimit
from docent.security.passwords import hash_password
from docent.services import accounts, audit, members, tenants

router = APIRouter(
    prefix="/v1",
    tags=["members"],
    responses={403: {"model": ErrorOut}, 404: {"model": ErrorOut}, 422: {"model": ErrorOut}},
)


@router.get("/members")
async def list_members(member: AdminMember, state: State) -> MembersOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        rows = await members.list_members(conn, member.tenant_id)
        invites = await members.list_open_invitations(conn, member.tenant_id)
    return MembersOut(
        members=[
            MemberOut(
                user_id=r["user_id"],
                name=r["name"],
                email=r["email"],
                role=r["role"],
                joined_at=r["joined_at"],
                is_you=r["user_id"] == member.user_id,
            )
            for r in rows
        ],
        invitations=[
            InvitationOut(
                id=i["id"],
                email=i["email"],
                role=i["role"],
                invited_by_name=i["invited_by_name"],
                created_at=i["created_at"],
                expires_at=i["expires_at"],
            )
            for i in invites
        ],
    )


@router.post(
    "/invitations", status_code=status.HTTP_201_CREATED, responses={409: {"model": ErrorOut}}
)
async def invite(body: InviteIn, member: AdminMember, state: State) -> InvitationOut:
    if not member.user.email_verified:
        raise AppError(403, "email_unverified", "Confirm your email before inviting teammates.")
    await enforce(state, ratelimit.INVITE_PER_TENANT, str(member.tenant_id))
    s = state.settings
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if await members.is_member_email(conn, member.tenant_id, str(body.email)):
            raise AppError(
                409,
                "already_member",
                "That person is already in this workspace.",
                {"email": "Already a member."},
            )
        invitation_id, token = await members.create_invitation(
            conn,
            tenant_id=member.tenant_id,
            email=str(body.email),
            role=body.role,
            invited_by=member.user_id,
            ttl=timedelta(days=s.invite_ttl_days),
        )
        tenant = await tenants.get_tenant(conn, member.tenant_id)
        assert tenant is not None
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="member.invited",
            target_type="invitation",
            target_id=invitation_id,
            metadata={"role": body.role},
        )
        await queue.enqueue(
            conn,
            SEND_EMAIL,
            {
                "template": "invitation",
                "data": {
                    "to": str(body.email),
                    "inviter": member.user.name,
                    "workspace": tenant["name"],
                    "role": body.role,
                    "url": f"{s.web_origin}/invite?token={token}",
                    "ttl_days": s.invite_ttl_days,
                },
            },
            tenant_id=member.tenant_id,
        )
        row = await conn.fetchrow(
            "select created_at, expires_at from invitations where id = $1", invitation_id
        )
    assert row is not None
    await state.waker.wake()
    return InvitationOut(
        id=invitation_id,
        email=accounts.normalize_email(str(body.email)),
        role=body.role,
        invited_by_name=member.user.name,
        created_at=row["created_at"],
        expires_at=row["expires_at"],
    )


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(invitation_id: uuid.UUID, member: AdminMember, state: State) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if not await members.revoke_invitation(conn, member.tenant_id, invitation_id):
            raise not_found("Invitation")
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="invitation.revoked",
            target_type="invitation",
            target_id=invitation_id,
        )


@router.patch("/members/{user_id}")
async def change_role(
    user_id: uuid.UUID, body: RoleUpdateIn, member: OwnerMember, state: State
) -> MemberOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        current = await members.get_member_role(conn, member.tenant_id, user_id)
        if current is None:
            raise not_found("Member")
        if (
            current == "owner"
            and body.role != "owner"
            and await members.owner_count(conn, member.tenant_id) <= 1
        ):
            raise AppError(409, "last_owner", "A workspace needs at least one owner.")
        await members.set_member_role(conn, member.tenant_id, user_id, body.role)
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="member.role_changed",
            target_type="user",
            target_id=user_id,
            metadata={"from": current, "to": body.role},
        )
        row = await conn.fetchrow(
            """
            select m.user_id, u.name, u.email, m.role, m.created_at as joined_at
            from memberships m join users u on u.id = m.user_id
            where m.tenant_id = $1 and m.user_id = $2
            """,
            member.tenant_id,
            user_id,
        )
    assert row is not None
    return MemberOut(
        user_id=row["user_id"],
        name=row["name"],
        email=row["email"],
        role=row["role"],
        joined_at=row["joined_at"],
        is_you=row["user_id"] == member.user_id,
    )


@router.delete("/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(user_id: uuid.UUID, member: CurrentMember, state: State) -> None:
    """Owners remove anyone, admins remove agents, anyone can leave."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        target_role = await members.get_member_role(conn, member.tenant_id, user_id)
        if target_role is None:
            raise not_found("Member")
        is_self = user_id == member.user_id
        allowed = (
            is_self or member.role == "owner" or (member.role == "admin" and target_role == "agent")
        )
        if not allowed:
            raise forbidden()
        if target_role == "owner" and await members.owner_count(conn, member.tenant_id) <= 1:
            raise AppError(409, "last_owner", "A workspace needs at least one owner.")
        await members.remove_member(conn, member.tenant_id, user_id)
        await audit.record(
            conn,
            tenant_id=member.tenant_id,
            actor_user_id=member.user_id,
            action="member.left" if is_self else "member.removed",
            target_type="user",
            target_id=user_id,
        )


@router.get("/invitations/lookup", responses={410: {"model": ErrorOut}})
async def lookup_invitation(
    request: Request,
    state: State,
    token: str = Query(min_length=10, max_length=200),
) -> InvitationLookupOut:
    await enforce(state, ratelimit.INVITE_LOOKUP_PER_IP, ip_key(request, state))
    async with transaction(state.pool, invite_token_hash=hash_token(token)) as conn:
        inv = await members.find_invitation_by_token(conn)
        if inv is None or inv["revoked_at"] or inv["accepted_at"]:
            raise AppError(404, "invitation_invalid", "This invitation is no longer valid.")
        account = await accounts.find_user_by_email(conn, inv["email"])
    return InvitationLookupOut(
        workspace_name=inv["workspace_name"],
        email=inv["email"],
        role=inv["role"],
        inviter_name=inv["inviter_name"],
        expired=bool(inv["expired"]),
        account_exists=account is not None,
    )


@router.post("/invitations/accept", responses={409: {"model": ErrorOut}, 410: {"model": ErrorOut}})
async def accept_invitation(
    body: AcceptInviteIn,
    request: Request,
    response: Response,
    user: OptionalUser,
    state: State,
) -> MeOut:
    await enforce(state, ratelimit.INVITE_LOOKUP_PER_IP, ip_key(request, state))
    token_hash = hash_token(body.token)
    new_user = user is None
    password_hash = await hash_password(body.password) if new_user and body.password else None
    async with transaction(state.pool, invite_token_hash=token_hash) as conn:
        inv = await members.find_invitation_by_token(conn)
        if inv is None or inv["revoked_at"] or inv["accepted_at"]:
            raise AppError(404, "invitation_invalid", "This invitation is no longer valid.")
        if inv["expired"]:
            raise AppError(
                410, "invitation_expired", "This invitation has expired. Ask for a new one."
            )
        if user is not None:
            if user.email.lower() != inv["email"].lower():
                raise AppError(
                    403,
                    "invitation_email_mismatch",
                    "This invitation was sent to a different email. Log in with that email.",
                )
            user_id = user.user_id
        else:
            if await accounts.find_user_by_email(conn, inv["email"]) is not None:
                raise AppError(409, "account_exists", "Log in to accept this invitation.")
            if not body.name or not password_hash:
                required = "Required."
                missing = {
                    field: required
                    for field, value in (("name", body.name), ("password", password_hash))
                    if not value
                }
                raise AppError(422, "invalid_request", "Some fields need attention.", missing)
            user_id = await accounts.create_user(
                conn, email=inv["email"], name=body.name, password_hash=password_hash, verified=True
            )
        await set_context(
            conn, tenant_id=inv["tenant_id"], user_id=user_id, invite_token_hash=token_hash
        )
        await members.accept_invitation(
            conn,
            invitation_id=inv["id"],
            tenant_id=inv["tenant_id"],
            user_id=user_id,
            role=inv["role"],
        )
        await audit.record(
            conn,
            tenant_id=inv["tenant_id"],
            actor_user_id=user_id,
            action="invitation.accepted",
            target_type="invitation",
            target_id=inv["id"],
        )
        if user is None:
            session = await accounts.create_session(
                conn,
                user_id=user_id,
                tenant_id=inv["tenant_id"],
                ttl=session_ttl(state.settings),
                ip_hash=ip_key(request, state),
                user_agent=request.headers.get("user-agent"),
            )
            set_session_cookie(response, state.settings, session)
        else:
            await accounts.set_active_tenant(conn, user.token_hash, inv["tenant_id"])
        return await build_me(conn, user_id, inv["tenant_id"])
