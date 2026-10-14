"""The Redis command budget: counted in process, added up in Postgres, alerts, local-only mode.

ARCHITECTURE section 7. Phase 7 acceptance check 9: forcing the counter to 90
percent switches the app to local-only mode.
"""

import socket
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import asyncpg
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from redis.exceptions import ResponseError

from docent.api.app import create_app
from docent.cache import TieredCache
from docent.config import Settings
from docent.console.access import set_access
from docent.db.pool import Pool
from docent.redis_budget import RedisBudget, month_end, month_of
from docent.redis_hub import RedisHub
from docent.security.ratelimit import Limit, RateLimiter
from tests.conftest import ClientFactory, Drain, make_settings, unique_email, verified_owner

LIMIT = Limit("budget-test", 3, 60)
# A logical database the local stack does not use, and a key prefix per test run.
TEST_REDIS = "redis://127.0.0.1:6379/15"
DEAD_REDIS = "redis://127.0.0.1:6390/0"


def _redis_running() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 6379), timeout=0.2):
            return True
    except OSError:
        return False


REDIS_URL = TEST_REDIS if _redis_running() else DEAD_REDIS


def budget_for(hub: RedisHub, pool: Pool, budget: int = 1_000) -> RedisBudget:
    return RedisBudget(
        hub, pool, budget=budget, flush_seconds=3600, web_origin="http://localhost:3000"
    )


async def stored(admin_pool: Pool, month: Any = None) -> asyncpg.Record | None:
    async with admin_pool.acquire() as conn:
        return await conn.fetchrow(
            "select * from redis_usage where month = $1", month or month_of(datetime.now(UTC))
        )


async def test_commands_are_counted_in_process_and_added_up_without_redis_commands(
    app_pool: Pool, admin_pool: Pool
) -> None:
    if not _redis_running():
        pytest.skip("local Redis not running")
    hub = RedisHub(TEST_REDIS)
    limiter = RateLimiter(hub, prefix=f"budget-{unique_email()}")
    cache = TieredCache(hub, f"budget-{unique_email()}")
    budget = budget_for(hub, app_pool)
    for _ in range(3):
        assert (await limiter.hit(LIMIT, "k")).allowed
    await cache.set("x", "k", b"value", ttl=60)
    assert await cache.get("x", "k") == b"value"  # served by the in-process tier: no command
    sent = hub.commands_sent
    assert sent == 5  # the script load, three checks, one SET
    assert hub.unflushed == sent

    state = await budget.flush()
    assert state is not None
    assert (state.commands, state.budget) == (5, 1_000)
    assert hub.commands_sent == sent  # adding up is a Postgres write, never a Redis command
    assert hub.unflushed == 0
    row = await stored(admin_pool)
    assert row is not None
    assert await budget.flush() is None  # nothing new: nothing written
    assert await stored(admin_pool) == row
    await hub.close()


async def test_forcing_the_counter_to_ninety_percent_switches_to_local_only(
    app_pool: Pool, admin_pool: Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    hub = RedisHub(REDIS_URL)
    limiter = RateLimiter(hub, prefix=f"budget-{unique_email()}")
    cache = TieredCache(hub, f"budget-{unique_email()}")
    budget = budget_for(hub, app_pool)

    hub.give_back(899)  # as if this process had sent 899 commands
    state = await budget.flush()
    assert state is not None
    assert (state.percent, state.local_only_since) == (89.9, None)
    assert hub.status() != "local_only"

    hub.give_back(1)
    state = await budget.flush()
    assert state is not None
    assert state.percent == 90
    assert state.local_only_since is not None
    assert hub.status() == "local_only"

    # Local-only: the rate limiter and the cache still work, and nothing reaches Redis.
    sent = hub.commands_sent
    results = [await limiter.hit(LIMIT, "visitor") for _ in range(4)]
    assert [r.allowed for r in results] == [True, True, True, False]
    await cache.set("emb", "q", b"vector", ttl=60)
    assert await cache.get("emb", "q") == b"vector"
    assert hub.commands_sent == sent

    # Another API process that starts now reads the month's count and stays local-only too.
    other = RedisHub(REDIS_URL)
    later = budget_for(other, app_pool)
    await later.start()
    assert other.status() == "local_only"
    await later.close()

    # When the month ends, Redis is back.
    month = month_of(datetime.now(UTC))
    next_month = month_end(month).timestamp() + 1
    monkeypatch.setattr("docent.redis_hub.time.time", lambda: next_month)
    assert hub.local_only is False
    assert hub.status() in ("ok", "degraded")
    await hub.close()
    await other.close()


async def test_raising_the_budget_and_restarting_turns_redis_back_on(
    app_pool: Pool, admin_pool: Pool
) -> None:
    async with admin_pool.acquire() as conn:
        await conn.execute(
            "insert into redis_usage (month, commands, budget, local_only_since)"
            " values ($1, 950, 1000, now())",
            month_of(datetime.now(UTC)),
        )
    same, bigger = RedisHub(REDIS_URL), RedisHub(REDIS_URL)
    as_before = budget_for(same, app_pool, budget=1_000)
    raised = budget_for(bigger, app_pool, budget=10_000)
    for budget in (as_before, raised):
        await budget.start()
    assert same.status() == "local_only"
    assert bigger.status() != "local_only"
    for budget, hub in ((as_before, same), (raised, bigger)):
        await budget.close()
        await hub.close()


@pytest_asyncio.fixture
async def platform_admin(
    client_factory: ClientFactory, drain: Drain, settings: Settings
) -> dict[str, Any]:
    me = await verified_owner(client_factory(), drain, "Docent HQ")
    await set_access(settings, me["user"]["email"], grant=True)
    # Granted but unverified: the console stays closed to them, and so do these emails.
    unverified = unique_email("ops")
    signed_up = await client_factory().post(
        "/v1/auth/signup",
        json={
            "name": "Unverified Ops",
            "email": unverified,
            "password": "correct horse battery",
            "workspace_name": "Ops",
        },
    )
    assert signed_up.status_code == 201
    await set_access(settings, unverified, grant=True)
    return me


async def test_the_alert_is_sent_once_per_threshold_per_month(
    app_pool: Pool, admin_pool: Pool, drain: Drain, platform_admin: dict[str, Any]
) -> None:
    await drain()
    hub = RedisHub(DEAD_REDIS)
    budget = budget_for(hub, app_pool)
    october = datetime(2026, 10, 14, 12, tzinfo=UTC)

    hub.give_back(800)
    await budget.flush(october)
    sent = await drain()
    assert [(e.to, e.subject) for e in sent] == [
        (platform_admin["user"]["email"], "Docent has used 80 percent of October's Redis commands")
    ]
    assert "about 800 of the 1,000 Redis commands" in sent[0].text
    assert "/admin" in sent[0].text

    hub.give_back(50)  # 85 percent: no new threshold
    await budget.flush(october)
    assert await drain() == []

    hub.give_back(60)  # 91 percent: the 90 percent alert, once, and local-only mode
    await budget.flush(october)
    sent = await drain()
    assert [e.subject for e in sent] == ["Docent stopped using Redis for the rest of October"]
    assert "until November 1" in sent[0].text

    hub.give_back(80)
    await budget.flush(october)
    assert await drain() == []  # still over 90 percent: nothing more this month
    row = await stored(admin_pool, october.date().replace(day=1))
    assert row is not None
    assert row["commands"] == 990
    assert row["alerted_80_at"] is not None
    assert row["alerted_90_at"] is not None

    # A new month starts over. Jumping straight past 90 percent sends one alert, the 90 one.
    november = datetime(2026, 11, 2, tzinfo=UTC)
    hub.give_back(950)
    await budget.flush(november)
    assert [e.subject for e in await drain()] == [
        "Docent stopped using Redis for the rest of November"
    ]
    row = await stored(admin_pool, november.date().replace(day=1))
    assert row is not None
    assert row["alerted_80_at"] is not None  # marked, so it never follows the 90 percent one
    await hub.close()


class OverLimitRedis:
    """A Redis that refuses every command the way Upstash does past the monthly limit."""

    async def script_load(self, script: str) -> str:
        raise ResponseError("ERR max requests limit exceeded. Limit: 500000, Usage: 500000")

    async def get(self, key: str) -> bytes | None:
        raise ResponseError("ERR max requests limit exceeded. Limit: 500000, Usage: 500000")


async def test_redis_errors_fall_back_cleanly(app_pool: Pool, admin_pool: Pool) -> None:
    # Unreachable: the attempts are counted, the circuit opens, the fallbacks answer.
    dead = RedisHub(DEAD_REDIS, timeout_seconds=0.05)
    limiter = RateLimiter(dead, prefix="dead")
    cache = TieredCache(dead, "dead")
    assert [(await limiter.hit(LIMIT, "k")).allowed for _ in range(4)] == [True] * 3 + [False]
    assert await cache.get("emb", "missing") is None
    assert dead.status() == "degraded"
    attempted = dead.commands_sent
    state = await budget_for(dead, app_pool).flush()
    assert state is not None
    assert state.commands == attempted
    await dead.close()

    # Over the provider's own limit: Redis is left alone for an hour, not hammered.
    hub = RedisHub(REDIS_URL)
    hub._client = OverLimitRedis()  # type: ignore[assignment]
    limiter = RateLimiter(hub, prefix="over")
    assert (await limiter.hit(LIMIT, "k")).allowed
    sent = hub.commands_sent
    assert hub.status() == "degraded"
    assert [(await limiter.hit(LIMIT, "k")).allowed for _ in range(3)] == [True, True, False]
    assert hub.commands_sent == sent

    # Postgres refusing the count keeps it for the next flush instead of losing it.
    flaky = RedisHub(REDIS_URL)
    budget = budget_for(flaky, app_pool)

    async def refuse(count: int, now: datetime) -> Any:
        raise asyncpg.PostgresConnectionError("connection lost")

    flaky.give_back(7)
    budget._add = refuse  # type: ignore[method-assign]
    assert await budget.flush() is None
    assert flaky.unflushed == 7
    await flaky.close()


@pytest_asyncio.fixture
async def app_near_budget(admin_pool: Pool, app: FastAPI) -> AsyncIterator[FastAPI]:
    """The API with Redis configured, started after 95 percent of the month was spent."""
    async with admin_pool.acquire() as conn:
        await conn.execute(
            "insert into redis_usage (month, commands, budget) values ($1, 475000, 500000)",
            month_of(datetime.now(UTC)),
        )
    application = create_app(make_settings(redis_url=REDIS_URL))
    async with application.router.lifespan_context(application):
        yield application


async def test_the_app_starts_local_only_near_the_budget_and_keeps_working(
    app_near_budget: FastAPI,
) -> None:
    hub: RedisHub = app_near_budget.state.docent.redis
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_near_budget),
        base_url="http://testserver",
        headers={"origin": "http://localhost:3000"},
    )
    async with client:
        health = await client.get("/healthz")
        assert health.json() == {
            "status": "ok",
            "db": "ok",
            "redis": "local_only",
            "version": "0.1.0",
        }
        email, codes = unique_email(), []
        for _ in range(11):
            r = await client.post(
                "/v1/auth/login", json={"email": email, "password": "wrong pw 123"}
            )
            codes.append(r.status_code)
        assert codes[:10] == [401] * 10
        assert codes[10] == 429  # the in-process limiter enforces the same limit
    assert hub.commands_sent == 0
