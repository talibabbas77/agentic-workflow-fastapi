"""Demo data for local development and product walkthroughs.

  pnpm seed --owner-email you@example.com      (SEED_OWNER_PASSWORD in the environment)

1. People, workspaces, roles, invitations, and plan states (always).
2. With the API running: agent settings, ticket types, help articles, team
   answers, and a widget on the demo host, all through the public API.
3. Then, unless --no-conversations: customer conversations through the real
   agent, spread over the past month, with handoffs, usage history, and
   customer memory. This needs the worker and the chat model, and takes a few
   minutes.

Safe to run more than once: every step checks what exists. --reset rebuilds
from scratch. Refuses to run outside local and test environments. The owner
password comes only from SEED_OWNER_PASSWORD; teammates share DEMO_PASSWORD
unless SEED_DEMO_PASSWORD is set.
"""

import asyncio
import os
import uuid
from collections.abc import Callable
from pathlib import Path

import httpx

from docent.agent.loop import AgentDeps
from docent.config import Settings
from docent.db.pool import Pool, create_pool, transaction
from docent.knowledge.embeddings import OllamaEmbedder
from docent.llm.client import chat_model
from docent.security.passwords import hash_password
from docent.seed import accounts, conversations, setup
from docent.seed.catalog import DEMO_HOST_ORIGIN, DEMO_PASSWORD, OWNER, TEAM, WORKSPACES, Person
from docent.seed.setup import install_widget

__all__ = ["DEMO_HOST_ORIGIN", "DEMO_PASSWORD", "WORKSPACES", "install_widget", "seed"]


async def seed(
    settings: Settings,
    owner_email: str,
    owner_name: str,
    *,
    reset: bool = False,
    api_url: str | None = None,
    fixtures: Path | None = None,
    demo_keys: Path | None = None,
    with_conversations: bool = True,
    say: Callable[[str], None] = lambda _: None,
) -> list[str]:
    if settings.env not in ("local", "test"):
        raise SystemExit("Refusing to seed demo data outside local and test environments.")
    owner_password = os.environ.get("SEED_OWNER_PASSWORD")
    if not owner_password or len(owner_password) < settings.password_min_length:
        raise SystemExit(
            f"Set SEED_OWNER_PASSWORD (at least {settings.password_min_length} characters)."
        )
    demo_password = os.environ.get("SEED_DEMO_PASSWORD", DEMO_PASSWORD)
    people = accounts.owner_person(owner_name, owner_email)

    owner_hash, demo_hash = await asyncio.gather(
        hash_password(owner_password), hash_password(demo_password)
    )
    pool = await create_pool(settings.database_url, max_size=4)
    try:
        if reset:
            await accounts.reset(pool, owner_email)
        ids: dict[str, uuid.UUID] = {}
        async with transaction(pool) as conn:
            for key, person in people.items():
                password_hash = owner_hash if key == OWNER else demo_hash
                ids[key] = await accounts.ensure_user(conn, person, password_hash)
        lines = [(await accounts.create_workspace(pool, ws, ids, settings))[1] for ws in WORKSPACES]

        if api_url and fixtures:
            passwords = {OWNER: owner_password, **dict.fromkeys(TEAM, demo_password)}
            set_up = await _through_api(settings, api_url, people, passwords, fixtures, demo_keys)
            lines += set_up
            if with_conversations and not any("no API" in line for line in set_up):
                lines += await _conversations(settings, pool, ids, say)
    finally:
        await pool.close()
    return [*lines, "", *_accounts_summary(people, owner_email, demo_password)]


async def _through_api(
    settings: Settings,
    api_url: str,
    people: dict[str, Person],
    passwords: dict[str, str],
    fixtures: Path,
    demo_keys: Path | None,
) -> list[str]:
    lines: list[str] = []
    for ws in WORKSPACES:
        key = setup.admin_of(ws)
        async with httpx.AsyncClient(
            base_url=api_url, headers={"origin": settings.web_origin}, timeout=60
        ) as api:
            if not await setup.login(api, people[key], passwords[key], ws.name):
                return [f"Setup skipped: no API at {api_url}. Start it and run the seed again."]
            lines += await setup.set_up(api, ws, fixtures, demo_keys)
    return lines


async def _conversations(
    settings: Settings, pool: Pool, ids: dict[str, uuid.UUID], say: Callable[[str], None]
) -> list[str]:
    tenants: dict[str, uuid.UUID] = {}
    async with transaction(pool) as conn:
        for ws in WORKSPACES:
            found = await accounts.seeded_tenant(conn, ws.slug, list(ids.values()))
            if found and ws.scenarios:
                tenants[ws.slug] = found
    say("Waiting for the worker to finish indexing help articles")
    if not await conversations.wait_for_knowledge(pool, list(tenants.values()), say):
        return ["Conversations skipped: indexing did not finish. Is the worker running?"]

    lines: list[str] = []
    worker_pool = await create_pool(settings.worker_database_url, max_size=2)
    try:
        async with httpx.AsyncClient(timeout=180) as http:
            llm = chat_model(settings, http, settings.llm_model)
            embedder = OllamaEmbedder(
                http,
                settings.ollama_base_url,
                settings.embedding_model,
                settings.embedding_dims,
                timeout=60,
            )
            deps = AgentDeps(settings=settings, pool=pool, embedder=embedder, llm=llm)
            for ws in WORKSPACES:
                tenant_id = tenants.get(ws.slug)
                if tenant_id is None:
                    continue
                say(f"Talking to {ws.name}'s agent as its customers")
                lines.append(await conversations.run_scenarios(deps, tenant_id, ws, say))
                # Each step below is idempotent, so a rerun finishes what a failed run started.
                await conversations.spread_over_past_month(pool, tenant_id, ws)
                await conversations.progress_handoffs(pool, tenant_id, ws)
                await conversations.usage_history(pool, tenant_id, ws)
                facts = await conversations.remember_customers(worker_pool, llm, tenant_id)
                lines.append(f"{ws.name}: {facts} customer memory facts")
        await conversations.wait_for_summaries(worker_pool, say)
    finally:
        await worker_pool.close()
    return lines


def _accounts_summary(people: dict[str, Person], owner_email: str, demo_password: str) -> list[str]:
    roles: dict[str, list[str]] = {}
    for ws in WORKSPACES:
        for key, role in ws.members:
            roles.setdefault(key, []).append(f"{role} of {ws.name} ({ws.plan.plan_id})")
    lines = [f"Log in as {owner_email} with SEED_OWNER_PASSWORD: {', '.join(roles[OWNER])}."]
    lines.append(f"Teammates, all with the password {demo_password}:")
    lines += [
        f"  {people[key].email:<38} {people[key].name:<15} {', '.join(roles[key])}"
        for key in TEAM
        if key in roles
    ]
    lines.append(f"See the widget on a customer site: pnpm demo-host, then open {DEMO_HOST_ORIGIN}")
    return lines
