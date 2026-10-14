"""Two-tier cache and the query embedding cache built on it."""

import asyncio
import socket
import uuid

import pytest

from docent.cache import TieredCache
from docent.knowledge.embeddings import QueryCache
from docent.redis_hub import RedisHub
from tests.fakes import FakeEmbedder


def _redis_running() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 6379), timeout=0.2):
            return True
    except OSError:
        return False


async def test_local_tier_serves_expires_and_stays_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [1000.0]
    monkeypatch.setattr("docent.cache.time.monotonic", lambda: clock[0])
    cache = TieredCache(RedisHub(None), "docent:test", local_size=2)
    await cache.set("k", "a", b"1", ttl=60)
    assert await cache.get("k", "a") == b"1"
    clock[0] += 61
    assert await cache.get("k", "a") is None  # expired
    for key in ("a", "b", "c"):
        await cache.set("k", key, key.encode(), ttl=60)
    assert await cache.get("k", "a") is None  # least recently used went first
    assert await cache.get("k", "c") == b"c"
    assert (cache.stats.local_hits, cache.stats.misses) == (2, 2)


async def test_concurrent_misses_share_one_fill() -> None:
    cache = TieredCache(RedisHub(None), "docent:test")
    calls = 0

    async def fill() -> bytes:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return b"value"

    results = await asyncio.gather(*(cache.get_or_fill("k", "x", 60, fill) for _ in range(10)))
    assert results == [b"value"] * 10
    assert calls == 1


async def test_a_failed_fill_reaches_every_waiter_and_is_not_cached() -> None:
    cache = TieredCache(RedisHub(None), "docent:test")

    async def fail() -> bytes:
        await asyncio.sleep(0.01)
        raise RuntimeError("model down")

    outcomes = await asyncio.gather(
        *(cache.get_or_fill("k", "y", 60, fail) for _ in range(3)), return_exceptions=True
    )
    assert all(isinstance(o, RuntimeError) for o in outcomes)
    assert await cache.get("k", "y") is None


@pytest.mark.skipif(not _redis_running(), reason="local Redis not running")
async def test_redis_tier_is_shared_between_instances() -> None:
    prefix = f"docent:test-{uuid.uuid4().hex}"
    hub = RedisHub("redis://127.0.0.1:6379/15")
    first, second = TieredCache(hub, prefix), TieredCache(hub, prefix)
    await first.set("k", "shared", b"from first", ttl=30)
    assert await second.get("k", "shared") == b"from first"
    assert second.stats.redis_hits == 1
    await hub.close()


async def test_query_vectors_are_cached_as_float16() -> None:
    inner = FakeEmbedder()
    embedder = QueryCache(inner, TieredCache(RedisHub(None), "docent:test"))
    first = await embedder.embed_query("How do refunds work?")
    again = await embedder.embed_query("  how do REFUNDS work?  ")
    assert first == again
    assert inner.query_calls == 1
    direct = await inner.embed_query("How do refunds work?")
    assert max(abs(a - b) for a, b in zip(first, direct, strict=True)) < 1e-3
