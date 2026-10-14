"""Redis is optional: rate limits and health keep working when it is missing or failing."""

import socket
from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from docent.api.app import create_app
from docent.redis_hub import RedisHub
from docent.security.ratelimit import Limit, RateLimiter
from tests.conftest import PASSWORD, make_settings, signup, unique_email

LIMIT = Limit("test", 3, 60)


def _redis_running() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 6379), timeout=0.2):
            return True
    except OSError:
        return False


async def test_local_limiter_when_redis_disabled() -> None:
    hub = RedisHub(None)
    limiter = RateLimiter(hub)
    results = [await limiter.hit(LIMIT, "k") for _ in range(4)]
    assert [r.allowed for r in results] == [True, True, True, False]
    assert results[-1].retry_after >= 1
    assert hub.status() == "disabled"
    assert hub.commands_sent == 0


@pytest.mark.parametrize("url", [None, "redis://127.0.0.1:6379/15"])
async def test_gcra_refills_steadily_with_no_burst_at_a_window_edge(
    url: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    if url and not _redis_running():
        pytest.skip("local Redis not running")
    clock = [1_000_000]
    monkeypatch.setattr("docent.security.ratelimit._now_ms", lambda: clock[0])
    hub = RedisHub(url)
    limiter = RateLimiter(hub, prefix=f"gcra-{unique_email()}")
    limit = Limit("edge", 4, 60)  # one request every 15 seconds, bursts of up to 4
    assert [(await limiter.hit(limit, "k")).allowed for _ in range(5)] == [True] * 4 + [False]
    clock[0] += 14_000
    denied = await limiter.hit(limit, "k")
    assert not denied.allowed
    assert denied.retry_after == 1
    clock[0] += 1_000  # a fixed window would now allow four more at its edge
    assert [(await limiter.hit(limit, "k")).allowed for _ in range(2)] == [True, False]
    await hub.close()


async def test_unreachable_redis_falls_back_and_opens_circuit() -> None:
    hub = RedisHub("redis://127.0.0.1:6390/0", timeout_seconds=0.05)
    limiter = RateLimiter(hub)
    results = [await limiter.hit(LIMIT, "k") for _ in range(4)]
    assert [r.allowed for r in results] == [True, True, True, False]
    assert hub.status() == "degraded"
    sent = hub.commands_sent
    await limiter.hit(LIMIT, "k")
    assert hub.commands_sent == sent  # circuit open: no further attempts
    await hub.close()


@pytest.mark.skipif(not _redis_running(), reason="local Redis not running")
async def test_redis_backed_limiter_shares_counts() -> None:
    hub = RedisHub("redis://127.0.0.1:6379/15")
    first, second = RateLimiter(hub, prefix="t1"), RateLimiter(hub, prefix="t1")
    key = unique_email()
    assert (await first.hit(LIMIT, key)).allowed
    assert (await second.hit(LIMIT, key)).allowed
    assert (await first.hit(LIMIT, key)).allowed
    assert not (await second.hit(LIMIT, key)).allowed  # counts shared across instances
    assert hub.status() == "ok"
    assert hub.commands_sent >= 4
    await hub.close()


@pytest_asyncio.fixture
async def app_with_dead_redis(app: FastAPI) -> AsyncIterator[FastAPI]:
    application = create_app(make_settings(redis_url="redis://127.0.0.1:6390/0"))
    async with application.router.lifespan_context(application):
        yield application


async def test_app_works_with_redis_down(app_with_dead_redis: FastAPI) -> None:
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_with_dead_redis),
        base_url="http://testserver",
        headers={"origin": "http://localhost:3000"},
    )
    async with client:
        me = await signup(client)
        email = me["user"]["email"]
        codes = []
        for _ in range(11):
            r = await client.post(
                "/v1/auth/login", json={"email": email, "password": "wrong pw 123"}
            )
            codes.append(r.status_code)
        assert codes[:10] == [401] * 10
        assert codes[10] == 429  # local limiter still enforces
        health = await client.get("/healthz")
        assert health.status_code == 200
        assert health.json()["redis"] == "degraded"
        assert health.json()["db"] == "ok"
        ok = await client.post(
            "/v1/auth/login", json={"email": unique_email(), "password": PASSWORD}
        )
        assert ok.status_code in (401, 429)


async def test_health_ok(client: httpx.AsyncClient) -> None:
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok", "redis": "disabled", "version": "0.1.0"}
