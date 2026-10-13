"""Test fixtures. Tests run against a real Postgres (docent_test) with real roles and RLS."""

import asyncio
import os
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from fastapi import FastAPI

from docent.api.app import create_app
from docent.cli import API_ROOT
from docent.config import Settings
from docent.db.pool import Pool, create_pool
from docent.email.sender import MemoryEmailSender, OutgoingEmail
from docent.jobs.handlers import make_handlers
from docent.jobs.worker import Worker
from docent.security.ratelimit import RateLimiter

PG_HOST = os.environ.get("TEST_PG_HOST", "127.0.0.1")
PG_PORT = os.environ.get("TEST_PG_PORT", "5432")
PG_DB = os.environ.get("TEST_PG_DB", "docent_test")
PG_SUPERUSER = os.environ.get("TEST_PG_SUPERUSER", "postgres:postgres")

TENANT_TABLES = ["memberships", "invitations", "audit_log"]
ALL_TABLES = [
    "jobs",
    "audit_log",
    "invitations",
    "auth_tokens",
    "user_sessions",
    "memberships",
    "users",
    "tenants",
]


def _dsn(role: str) -> str:
    return f"postgresql://{role}:{role}@{PG_HOST}:{PG_PORT}/{PG_DB}"


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "env": "test",
        "database_url": _dsn("docent_app"),
        "worker_database_url": _dsn("docent_worker"),
        "migration_database_url": _dsn("docent_owner"),
        "redis_url": None,
        "worker_url": None,
        "web_origin": "http://localhost:3000",
        "log_level": "WARNING",
    }
    values.update(overrides)
    return Settings(**values)


@pytest.fixture(scope="session")
def settings() -> Settings:
    return make_settings()


@pytest_asyncio.fixture(scope="session")
async def owner_pool(settings: Settings) -> AsyncIterator[Pool]:
    pool = await create_pool(settings.migration_database_url, max_size=2)
    async with pool.acquire() as conn:
        await conn.execute("drop owned by docent_owner cascade")
    cfg = Config(str(API_ROOT / "alembic.ini"))
    os.environ["DOCENT_MIGRATION_URL_OVERRIDE"] = settings.migration_database_url
    try:
        await asyncio.to_thread(command.upgrade, cfg, "head")
    finally:
        os.environ.pop("DOCENT_MIGRATION_URL_OVERRIDE", None)
    yield pool
    await pool.close()


@pytest_asyncio.fixture(scope="session")
async def admin_pool(owner_pool: Pool) -> AsyncIterator[Pool]:
    """Superuser connection that bypasses RLS. Only for test setup and assertions."""
    pool = await create_pool(f"postgresql://{PG_SUPERUSER}@{PG_HOST}:{PG_PORT}/{PG_DB}", max_size=2)
    yield pool
    await pool.close()


@pytest_asyncio.fixture(scope="session")
async def app(settings: Settings, owner_pool: Pool) -> AsyncIterator[FastAPI]:
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        yield application


@pytest_asyncio.fixture(scope="session")
async def app_pool(app: FastAPI) -> Pool:
    pool: Pool = app.state.docent.pool
    return pool


@pytest_asyncio.fixture(scope="session")
async def worker_pool(settings: Settings, owner_pool: Pool) -> AsyncIterator[Pool]:
    pool = await create_pool(settings.worker_database_url, max_size=4)
    yield pool
    await pool.close()


@pytest_asyncio.fixture(autouse=True)
async def clean(owner_pool: Pool, app: FastAPI) -> AsyncIterator[None]:
    async with owner_pool.acquire() as conn:
        await conn.execute(f"truncate {', '.join(ALL_TABLES)} restart identity cascade")
    state = app.state.docent
    state.limiter = RateLimiter(state.redis)
    yield


@pytest.fixture
def mailbox() -> MemoryEmailSender:
    return MemoryEmailSender()


@pytest.fixture
def worker(worker_pool: Pool, mailbox: MemoryEmailSender) -> Worker:
    return Worker(
        worker_pool, make_handlers(mailbox), idle_poll_seconds=60, lease_seconds=30, worker_id="t1"
    )


ClientFactory = Callable[..., httpx.AsyncClient]


@pytest_asyncio.fixture
async def client_factory(app: FastAPI, settings: Settings) -> AsyncIterator[ClientFactory]:
    clients: list[httpx.AsyncClient] = []

    def make(origin: str | None = settings.web_origin, ip: str = "127.0.0.1") -> httpx.AsyncClient:
        headers = {"origin": origin} if origin else {}
        c = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=(ip, 50000)),
            base_url="http://testserver",
            headers=headers,
        )
        clients.append(c)
        return c

    yield make
    for c in clients:
        await c.aclose()


@pytest_asyncio.fixture
async def client(client_factory: ClientFactory) -> httpx.AsyncClient:
    return client_factory()


def unique_email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@example.com"


PASSWORD = "correct horse battery"


async def signup(
    client: httpx.AsyncClient,
    *,
    email: str | None = None,
    name: str = "Sam Ortiz",
    workspace: str = "Acme",
) -> dict[str, Any]:
    response = await client.post(
        "/v1/auth/signup",
        json={
            "name": name,
            "email": email or unique_email(),
            "password": PASSWORD,
            "workspace_name": workspace,
        },
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def token_from(email: OutgoingEmail) -> str:
    match = re.search(r"token=([A-Za-z0-9_\-]+)", email.text)
    assert match, email.text
    return match.group(1)


Drain = Callable[[], Awaitable[list[OutgoingEmail]]]


@pytest.fixture
def drain(worker: Worker, mailbox: MemoryEmailSender) -> Drain:
    async def run() -> list[OutgoingEmail]:
        before = len(mailbox.sent)
        await worker.drain()
        return mailbox.sent[before:]

    return run


async def verified_owner(
    client: httpx.AsyncClient, drain: Drain, workspace: str = "Acme"
) -> dict[str, Any]:
    me = await signup(client, workspace=workspace)
    emails = await drain()
    response = await client.post("/v1/auth/verify-email", json={"token": token_from(emails[-1])})
    assert response.status_code == 204
    me_response = await client.get("/v1/auth/me")
    body: dict[str, Any] = me_response.json()
    assert body["user"]["email_verified"] is True
    return me | body
