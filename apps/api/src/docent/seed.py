"""Demo data for local development and product walkthroughs.

Creates two fictional companies with teammates, roles, pending invitations, and
an activity history, using the same service functions as the API so RLS and
validation apply. Safe to run more than once. Refuses to run outside local and
test environments.

Passwords never live in this file: the owner password comes from
SEED_OWNER_PASSWORD, demo teammates share SEED_DEMO_PASSWORD. Each company also
gets a support widget for the demo host; the seed generates its signing key and
keeps the private half in a local, git-ignored folder for `apps/demo-host`.
"""

import asyncio
import json
import os
import uuid
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

from docent.config import Settings
from docent.db.pool import Connection, Pool, create_pool, set_context, transaction
from docent.security.passwords import hash_password
from docent.services import accounts, audit, members, tenants

DEFAULT_DEMO_PASSWORD = "docent-demo-password"  # noqa: S105 - local demo accounts only
# Public inboxes, readable at mailinator.com once real SMTP is configured. Never real data.
DEMO_DOMAIN = "mailinator.com"
# `apps/demo-host` plays the customer's website.
DEMO_HOST_ORIGIN = "http://localhost:5173"


def demo_email(local: str) -> str:
    return f"docent-{local}@{DEMO_DOMAIN}"


@dataclass(frozen=True)
class Person:
    name: str
    email: str


@dataclass(frozen=True)
class Workspace:
    name: str
    slug: str
    members: tuple[tuple[str, str], ...]  # (person key, role)
    invites: tuple[tuple[str, str], ...]  # (email, role)
    greeting: str
    claims: tuple[str, ...]


TEAM: dict[str, Person] = {
    "maya": Person("Maya Chen", demo_email("maya.chen")),
    "omar": Person("Omar Haddad", demo_email("omar.haddad")),
    "priya": Person("Priya Nair", demo_email("priya.nair")),
    "lucas": Person("Lucas Martin", demo_email("lucas.martin")),
    "sofia": Person("Sofia Rossi", demo_email("sofia.rossi")),
    "kenji": Person("Kenji Watanabe", demo_email("kenji.watanabe")),
}

WORKSPACES = (
    Workspace(
        name="Lumen Notes",
        slug="lumen-notes",
        members=(("owner", "owner"), ("maya", "admin"), ("omar", "agent"), ("priya", "agent")),
        invites=((demo_email("jordan.lee"), "agent"), (demo_email("ava.brooks"), "admin")),
        greeting="Hi, I can help with anything about Lumen Notes.",
        claims=("plan", "workspace"),
    ),
    Workspace(
        name="Parcelwise",
        slug="parcelwise",
        members=(("lucas", "owner"), ("owner", "admin"), ("sofia", "agent"), ("kenji", "agent")),
        invites=((demo_email("noah.patel"), "agent"),),
        greeting="Hi, ask me about shipping, labels, or the Parcelwise API.",
        claims=("plan", "account"),
    ),
)


async def _ensure_user(conn: Connection, person: Person, password_hash: str) -> uuid.UUID:
    existing = await accounts.find_user_by_email(conn, person.email)
    if existing is not None:
        user_id: uuid.UUID = existing["id"]
        await accounts.set_password(conn, user_id, password_hash)
        await accounts.mark_email_verified(conn, user_id)
        return user_id
    return await accounts.create_user(
        conn, email=person.email, name=person.name, password_hash=password_hash, verified=True
    )


async def _seeded_tenant(conn: Connection, key: str, user_ids: list[uuid.UUID]) -> uuid.UUID | None:
    """Find a tenant this seed created, through any of its members (RLS hides others)."""
    for user_id in user_ids:
        await set_context(conn, user_id=user_id)
        found: uuid.UUID | None = await conn.fetchval(
            "select id from tenants where settings ->> 'seed' = $1", key
        )
        if found:
            return found
    return None


async def _seed_workspace(
    pool: Pool, ws: Workspace, people: dict[str, uuid.UUID], settings: Settings
) -> str:
    owner_key = next(key for key, role in ws.members if role == "owner")
    owner_id = people[owner_key]
    async with transaction(pool) as conn:
        existing = await _seeded_tenant(conn, ws.slug, list(people.values()))
        if existing is not None:
            return f"{ws.name}: already seeded"

        tenant_id = await tenants.create_tenant(conn, name=ws.name, owner_id=owner_id)
        await conn.execute(
            "update tenants set settings = settings || jsonb_build_object('seed', $2::text)"
            " where id = $1",
            tenant_id,
            ws.slug,
        )
        await audit.record(
            conn,
            tenant_id=tenant_id,
            actor_user_id=owner_id,
            action="tenant.created",
            target_type="tenant",
            target_id=tenant_id,
        )
        for key, role in ws.members:
            if key == owner_key:
                continue
            await conn.execute(
                "insert into memberships (tenant_id, user_id, role) values ($1, $2, $3)",
                tenant_id,
                people[key],
                role,
            )
            await audit.record(
                conn,
                tenant_id=tenant_id,
                actor_user_id=owner_id,
                action="invitation.accepted",
                target_type="user",
                target_id=people[key],
                metadata={"role": role},
            )
        for email, role in ws.invites:
            invitation_id, _ = await members.create_invitation(
                conn,
                tenant_id=tenant_id,
                email=email,
                role=role,
                invited_by=owner_id,
                ttl=timedelta(days=settings.invite_ttl_days),
            )
            await audit.record(
                conn,
                tenant_id=tenant_id,
                actor_user_id=owner_id,
                action="member.invited",
                target_type="invitation",
                target_id=invitation_id,
                metadata={"role": role},
            )
    return f"{ws.name}: created with {len(ws.members)} members and {len(ws.invites)} invitations"


async def _reset(pool: Pool, owner_email: str) -> None:
    """Remove seeded workspaces and demo teammates. The owner account is kept."""
    emails = [owner_email, *(p.email for p in TEAM.values())]
    async with transaction(pool) as conn:
        user_ids = [
            row["id"] for e in emails if (row := await accounts.find_user_by_email(conn, e))
        ]
        tenant_ids: set[uuid.UUID] = set()
        for user_id in user_ids:
            await set_context(conn, user_id=user_id)
            rows = await conn.fetch("select id from tenants where settings ? 'seed'")
            tenant_ids.update(r["id"] for r in rows)
        for tenant_id in tenant_ids:
            await set_context(conn, tenant_id=tenant_id)
            await conn.execute("delete from tenants where id = $1", tenant_id)
        for person in TEAM.values():
            row = await accounts.find_user_by_email(conn, person.email)
            if row is None:
                continue
            await set_context(conn, user_id=row["id"])
            if not await conn.fetchval("select exists(select 1 from memberships)"):
                await conn.execute("delete from users where id = $1", row["id"])


async def _seed_through_api(
    settings: Settings,
    api_url: str,
    owner_email: str,
    owner_password: str,
    fixtures: Path,
    demo_keys: Path | None,
) -> list[str]:
    """Teach each demo company's agent and install its widget, as a customer would."""
    lines: list[str] = []
    async with httpx.AsyncClient(
        base_url=api_url, headers={"origin": settings.web_origin}, timeout=30
    ) as api:
        try:
            login = await api.post(
                "/v1/auth/login", json={"email": owner_email, "password": owner_password}
            )
        except httpx.ConnectError:
            return [f"Knowledge and widgets: skipped, no API at {api_url}. Start it and rerun."]
        login.raise_for_status()
        workspaces = {t["name"]: t["id"] for t in login.json()["tenants"]}
        for ws in WORKSPACES:
            if ws.name not in workspaces:
                continue
            switch = await api.post(
                "/v1/auth/switch-tenant", json={"tenant_id": workspaces[ws.name]}
            )
            switch.raise_for_status()
            lines.append(await _upload_knowledge(api, ws, fixtures / ws.slug))
            lines.append(await _install_widget(api, ws, demo_keys))
    return lines


async def _upload_knowledge(api: httpx.AsyncClient, ws: Workspace, folder: Path) -> str:
    articles = _help_articles(folder)
    if articles is None:
        return f"{ws.name}: no help articles in {folder}"
    if (await api.get("/v1/knowledge/sources")).json()["sources"]:
        return f"{ws.name}: knowledge already uploaded"
    for name, content, audience in articles:
        upload = await api.post(
            "/v1/knowledge/uploads",
            files={"file": (name, content, "text/markdown")},
            data={"audience": audience},
        )
        upload.raise_for_status()
    return f"{ws.name}: uploaded {len(articles)} help articles, the worker is indexing them"


async def _install_widget(api: httpx.AsyncClient, ws: Workspace, demo_keys: Path | None) -> str:
    """One widget per company, allowed on the demo host, with a signing key the host can use."""
    widgets = (await api.get("/v1/widgets")).json()
    widget = widgets[0] if widgets else None
    if widget is None:
        created = await api.post(
            "/v1/widgets",
            json={
                "name": "Help center",
                "allowed_origins": [DEMO_HOST_ORIGIN],
                "anonymous_enabled": True,
                "anonymous_daily_cap": 200,
                "allowed_claims": list(ws.claims),
                "greeting": ws.greeting,
            },
        )
        created.raise_for_status()
        widget = created.json()
    if demo_keys is None:
        return f"{ws.name}: widget {widget['public_id']} ready (no folder for the demo key)"

    key_file = demo_keys / f"{ws.slug}.json"
    active = [k for k in widget["keys"] if k["status"] == "active"]
    saved = _read_demo_key(key_file)
    if (
        saved
        and saved["widget"] == widget["public_id"]
        and saved["kid"] in {k["kid"] for k in active}
    ):
        return f"{ws.name}: widget {widget['public_id']} already installed on the demo host"

    if len(active) >= 2:
        oldest = min(active, key=lambda k: k["created_at"])
        retired = await api.post(f"/v1/widgets/{widget['id']}/keys/{oldest['kid']}/retire")
        retired.raise_for_status()
    private = ec.generate_private_key(ec.SECP256R1())
    added = await api.post(
        f"/v1/widgets/{widget['id']}/keys",
        json={"public_jwk": ECAlgorithm.to_jwk(private.public_key(), as_dict=True)},
    )
    added.raise_for_status()
    _write_demo_key(
        key_file,
        {
            "company": ws.name,
            "widget": widget["public_id"],
            "kid": added.json()["kid"],
            "private_jwk": ECAlgorithm.to_jwk(private, as_dict=True),
            "widget_origin": widget["embed_origin"],
        },
    )
    return f"{ws.name}: widget {widget['public_id']} installed on {DEMO_HOST_ORIGIN}"


def _help_articles(folder: Path) -> list[tuple[str, bytes, str]] | None:
    """(file name, content, audience) for each article, or None when the folder is missing."""
    if not folder.is_dir():
        return None
    identified = set(json.loads((folder / "questions.json").read_text())["identified_only"])
    return [
        (path.name, path.read_bytes(), "identified" if path.name in identified else "public")
        for path in sorted(folder.glob("*.md"))
    ]


def _read_demo_key(path: Path) -> dict[str, Any] | None:
    return json.loads(path.read_text()) if path.is_file() else None


def _write_demo_key(path: Path, data: dict[str, Any]) -> None:
    """Private key material: owner-only permissions from the first byte."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)


async def seed(
    settings: Settings,
    owner_email: str,
    owner_name: str,
    *,
    reset: bool = False,
    api_url: str | None = None,
    fixtures: Path | None = None,
    demo_keys: Path | None = None,
) -> list[str]:
    if settings.env not in ("local", "test"):
        raise SystemExit("Refusing to seed demo data outside local and test environments.")
    owner_password = os.environ.get("SEED_OWNER_PASSWORD")
    if not owner_password or len(owner_password) < settings.password_min_length:
        raise SystemExit(
            f"Set SEED_OWNER_PASSWORD (at least {settings.password_min_length} characters)."
        )
    demo_password = os.environ.get("SEED_DEMO_PASSWORD", DEFAULT_DEMO_PASSWORD)

    owner_hash, demo_hash = await asyncio.gather(
        hash_password(owner_password), hash_password(demo_password)
    )
    pool = await create_pool(settings.database_url, max_size=2)
    try:
        if reset:
            await _reset(pool, owner_email)
        people: dict[str, uuid.UUID] = {}
        async with transaction(pool) as conn:
            people["owner"] = await _ensure_user(conn, Person(owner_name, owner_email), owner_hash)
            for key, person in TEAM.items():
                people[key] = await _ensure_user(conn, person, demo_hash)
        lines = [await _seed_workspace(pool, ws, people, settings) for ws in WORKSPACES]
    finally:
        await pool.close()
    if api_url and fixtures:
        lines += await _seed_through_api(
            settings, api_url, owner_email, owner_password, fixtures, demo_keys
        )

    lines += [
        "",
        f"Log in as {owner_email} with SEED_OWNER_PASSWORD.",
        f"Teammates ({', '.join(p.email for p in TEAM.values())})",
        f"use the demo password: {demo_password}",
        f"See the widget on a customer site: pnpm demo-host, then open {DEMO_HOST_ORIGIN}",
    ]
    return lines
