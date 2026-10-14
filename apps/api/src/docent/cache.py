"""Two-tier cache: a small in-process LRU in front of Redis.

- Keys are namespaced by environment and versioned (`docent:local:c1:emb:...`), so
  several environments can share one Redis and a format change never reads old
  values. Bump `FORMAT` when an encoding changes.
- Every entry has a TTL with up to 10 percent jitter, so nothing piles up in Redis
  and entries written together do not all expire together.
- Concurrent misses for the same key share one fill, so a popular entry expiring
  does not send the same expensive call many times at once.
- Redis is optional. Without it, or while its circuit is open, the local tier
  still serves, and the local tier spares Redis most repeated reads, which keeps
  usage inside a free tier's command budget.

Values are bytes; callers choose the encoding.
"""

import asyncio
import contextlib
import random
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from redis.asyncio import Redis

from docent.redis_hub import RedisHub, RedisUnavailable

FORMAT = "c1"
LOCAL_TTL_SECONDS = 300.0


@dataclass(slots=True)
class CacheStats:
    local_hits: int = 0
    redis_hits: int = 0
    misses: int = 0


class TieredCache:
    def __init__(self, hub: RedisHub, prefix: str, *, local_size: int = 4096) -> None:
        self._hub = hub
        self._prefix = f"{prefix}:{FORMAT}"
        self._local: OrderedDict[str, tuple[float, bytes]] = OrderedDict()
        self._local_size = local_size
        self._inflight: dict[str, asyncio.Future[bytes | None]] = {}
        self.stats = CacheStats()

    async def get(self, kind: str, key: str) -> bytes | None:
        full = self._key(kind, key)
        value = self._local_get(full)
        if value is not None:
            self.stats.local_hits += 1
            return value
        try:
            value = await self._hub.call(lambda r: _get_bytes(r, full))
        except RedisUnavailable:
            value = None
        if value is None:
            self.stats.misses += 1
            return None
        self.stats.redis_hits += 1
        self._local_set(full, value, LOCAL_TTL_SECONDS)
        return value

    async def set(self, kind: str, key: str, value: bytes, ttl: int) -> None:
        full = self._key(kind, key)
        jittered = max(1, int(ttl * random.uniform(0.9, 1.0)))  # noqa: S311 - not security
        self._local_set(full, value, min(jittered, LOCAL_TTL_SECONDS))
        with contextlib.suppress(RedisUnavailable):
            await self._hub.call(lambda r: r.set(full, value, ex=jittered))

    async def get_or_fill(
        self, kind: str, key: str, ttl: int, fill: Callable[[], Awaitable[bytes | None]]
    ) -> bytes | None:
        """The cached value, or one shared call to `fill` for everyone waiting on this key."""
        cached = await self.get(kind, key)
        if cached is not None:
            return cached
        full = self._key(kind, key)
        pending = self._inflight.get(full)
        if pending is not None:
            return await asyncio.shield(pending)
        future: asyncio.Future[bytes | None] = asyncio.get_running_loop().create_future()
        self._inflight[full] = future
        try:
            value = await fill()
            if value is not None:
                await self.set(kind, key, value, ttl)
        except BaseException as exc:
            future.set_exception(exc)
            future.exception()  # waiters see it; nobody is left with an unread error
            raise
        else:
            future.set_result(value)
            return value
        finally:
            del self._inflight[full]

    def _key(self, kind: str, key: str) -> str:
        return f"{self._prefix}:{kind}:{key}"

    def _local_get(self, full: str) -> bytes | None:
        entry = self._local.get(full)
        if entry is None:
            return None
        expires, value = entry
        if expires <= time.monotonic():
            del self._local[full]
            return None
        self._local.move_to_end(full)
        return value

    def _local_set(self, full: str, value: bytes, ttl: float) -> None:
        self._local[full] = (time.monotonic() + ttl, value)
        self._local.move_to_end(full)
        while len(self._local) > self._local_size:
            self._local.popitem(last=False)


async def _get_bytes(client: Redis, key: str) -> bytes | None:
    raw = await client.get(key)
    return raw.encode() if isinstance(raw, str) else raw
