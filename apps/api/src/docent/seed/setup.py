"""Set each demo workspace up through the public API, the way a customer would.

Agent settings, ticket types, help articles, team answers, and a widget on the
demo host. Every step checks what exists first, so a rerun adds nothing twice.
The widget's private signing key is kept in a local, git-ignored folder for
`apps/demo-host`, with owner-only permissions.
"""

import json
import os
from pathlib import Path
from typing import Any

import httpx
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

from docent.seed.catalog import DEMO_HOST_ORIGIN, OWNER, Person, Workspace


def admin_of(ws: Workspace) -> str:
    """The person key that sets this workspace up: the CLI owner if allowed, else its owner."""
    roles = dict(ws.members)
    if roles.get(OWNER) in ("owner", "admin"):
        return OWNER
    return next(key for key, role in ws.members if role == "owner")


async def set_up(
    api: httpx.AsyncClient, ws: Workspace, fixtures: Path, demo_keys: Path | None
) -> list[str]:
    lines = [await _agent_settings(api, ws), await _ticket_types(api, ws)]
    if ws.docs:
        lines.append(await upload_knowledge(api, ws, fixtures / ws.docs))
    if ws.team_answers:
        lines.append(await _team_answers(api, ws))
    if ws.docs:
        lines.append(await install_widget(api, ws, demo_keys))
    return [line for line in lines if line]


async def login(api: httpx.AsyncClient, person: Person, password: str, workspace: str) -> bool:
    """Sign in and switch to the workspace. False when the API is not running."""
    try:
        response = await api.post(
            "/v1/auth/login", json={"email": person.email, "password": password}
        )
    except httpx.ConnectError:
        return False
    response.raise_for_status()
    tenant = next(t for t in response.json()["tenants"] if t["name"] == workspace)
    switched = await api.post("/v1/auth/switch-tenant", json={"tenant_id": tenant["id"]})
    switched.raise_for_status()
    return True


async def _agent_settings(api: httpx.AsyncClient, ws: Workspace) -> str:
    body = {"tone": ws.tone, "restricted_topics": list(ws.restricted_topics)}
    (await api.patch("/v1/agent/settings", json=body)).raise_for_status()
    return ""


async def _ticket_types(api: httpx.AsyncClient, ws: Workspace) -> str:
    if not ws.ticket_types or (await api.get("/v1/ticket-types")).json():
        return ""
    for ticket in ws.ticket_types:
        response = await api.post(
            "/v1/ticket-types",
            json={
                "name": ticket.name,
                "description": ticket.description,
                "fields": list(ticket.fields),
                "priority": ticket.priority,
            },
        )
        response.raise_for_status()
    return f"{ws.name}: {len(ws.ticket_types)} ticket types"


async def upload_knowledge(api: httpx.AsyncClient, ws: Workspace, folder: Path) -> str:
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
    return f"{ws.name}: uploaded {len(articles)} help articles"


async def _team_answers(api: httpx.AsyncClient, ws: Workspace) -> str:
    if (await api.get("/v1/memory/answers")).json():
        return ""
    for question, answer in ws.team_answers:
        response = await api.post(
            "/v1/memory/answers", json={"question": question, "answer": answer}
        )
        response.raise_for_status()
    return f"{ws.name}: taught {len(ws.team_answers)} team answers"


async def install_widget(api: httpx.AsyncClient, ws: Workspace, demo_keys: Path | None) -> str:
    """One widget per company, allowed on the demo host, with a signing key the host can use.

    An existing widget is brought back to the catalog's settings with a PUT, so a
    rerun converges after a catalog change or an edit in the admin app.
    """
    widgets = (await api.get("/v1/widgets")).json()
    widget = widgets[0] if widgets else None
    updated = ""
    if widget is None:
        created = await api.post("/v1/widgets", json=_widget_settings(ws, None))
        created.raise_for_status()
        widget = created.json()
    else:
        wanted = _widget_settings(ws, widget)
        if any(widget[key] != value for key, value in wanted.items()):
            replaced = await api.put(f"/v1/widgets/{widget['id']}", json=wanted)
            replaced.raise_for_status()
            widget = replaced.json()
            updated = "settings updated, "
    if demo_keys is None:
        return (
            f"{ws.name}: widget {widget['public_id']} {updated}ready (no folder for the demo key)"
        )

    key_file = demo_keys / f"{ws.slug}.json"
    active = [k for k in widget["keys"] if k["status"] == "active"]
    saved = _read_demo_key(key_file)
    if (
        saved
        and saved["widget"] == widget["public_id"]
        and saved["kid"] in {k["kid"] for k in active}
    ):
        return (
            f"{ws.name}: widget {widget['public_id']} {updated}already installed on the demo host"
        )

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
    return f"{ws.name}: widget {widget['public_id']} {updated}installed on {DEMO_HOST_ORIGIN}"


def _widget_settings(ws: Workspace, current: dict[str, Any] | None) -> dict[str, Any]:
    """The widget body for POST and PUT /v1/widgets.

    The catalog owns anonymous mode, the allowed claims, and the greeting, and
    the demo host must stay an allowed origin. The name, the daily cap, and any
    other origins keep what an admin set. The name is the chat header, so the
    seed names the widget after the company; "Help center" was the old seed
    default, not an admin's choice.
    """
    origins = list(current["allowed_origins"]) if current else []
    if DEMO_HOST_ORIGIN not in origins:
        origins.append(DEMO_HOST_ORIGIN)
    kept = current["name"] if current and current["name"] != "Help center" else None
    return {
        "name": kept or f"{ws.name} help",
        "allowed_origins": origins,
        "anonymous_enabled": ws.anonymous_enabled,
        "anonymous_daily_cap": current["anonymous_daily_cap"] if current else 200,
        "allowed_claims": list(ws.claims),
        "greeting": ws.greeting,
    }


def _help_articles(folder: Path) -> list[tuple[str, bytes, str]] | None:
    """(file name, content, audience) for each article, or None when the folder is missing."""
    if not folder.is_dir():
        return None
    questions = folder / "questions.json"
    identified = (
        set(json.loads(questions.read_text())["identified_only"]) if questions.is_file() else set()
    )
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
