"""Fixed-window rate limiting with a Redis backend and an in-process fallback.

Redis gives limits shared across instances. Without it, each instance keeps its
own counters: exact with one instance, looser with several, never unlimited.
"""

import math
import time
from dataclasses import dataclass

from redis.asyncio import Redis

from docent.redis_hub import RedisHub, RedisUnavailable

# One EVALSHA per hit: increment, set expiry on first hit, return count and ttl.
_LUA = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
"""


@dataclass(frozen=True, slots=True)
class Limit:
    name: str
    max_hits: int
    window_seconds: int


@dataclass(frozen=True, slots=True)
class RateResult:
    allowed: bool
    remaining: int
    retry_after: int


class LocalRateLimiter:
    def __init__(self, max_keys: int = 50_000) -> None:
        self._windows: dict[str, tuple[float, int]] = {}
        self._max_keys = max_keys

    def hit(self, key: str, limit: Limit) -> RateResult:
        now = time.monotonic()
        start, count = self._windows.get(key, (now, 0))
        if now - start >= limit.window_seconds:
            start, count = now, 0
        count += 1
        self._windows[key] = (start, count)
        if len(self._windows) > self._max_keys:
            self._evict(now)
        retry_after = max(1, math.ceil(limit.window_seconds - (now - start)))
        return _result(count, limit, retry_after)

    def _evict(self, now: float) -> None:
        horizon = 3600
        for key in [k for k, (s, _) in self._windows.items() if now - s > horizon]:
            del self._windows[key]
        if len(self._windows) > self._max_keys:
            self._windows.clear()


class RateLimiter:
    def __init__(self, hub: RedisHub, prefix: str = "rl") -> None:
        self._hub = hub
        self._local = LocalRateLimiter()
        self._prefix = prefix
        self._sha: str | None = None

    async def hit(self, limit: Limit, *key_parts: str) -> RateResult:
        key = ":".join((self._prefix, limit.name, *key_parts))
        try:
            count, ttl = await self._hub.call(lambda r: self._eval(r, key, limit.window_seconds))
        except RedisUnavailable:
            return self._local.hit(key, limit)
        return _result(count, limit, max(1, ttl))

    async def _eval(self, client: Redis, key: str, window: int) -> tuple[int, int]:
        if self._sha is None:
            self._sha = await client.script_load(_LUA)
        try:
            raw = await client.evalsha(self._sha, 1, key, window)
        except Exception as exc:
            if "NOSCRIPT" not in str(exc):
                raise
            self._sha = await client.script_load(_LUA)
            raw = await client.evalsha(self._sha, 1, key, window)
        return int(raw[0]), int(raw[1])


def _result(count: int, limit: Limit, retry_after: int) -> RateResult:
    allowed = count <= limit.max_hits
    return RateResult(
        allowed=allowed,
        remaining=max(0, limit.max_hits - count),
        retry_after=0 if allowed else retry_after,
    )


# Policies used by the auth endpoints.
LOGIN_PER_IP = Limit("login-ip", 30, 60)
LOGIN_PER_EMAIL = Limit("login-email", 10, 60)
SIGNUP_PER_IP = Limit("signup-ip", 10, 3600)
SIGNUP_PER_EMAIL = Limit("signup-email", 5, 3600)
RESET_PER_IP = Limit("reset-ip", 10, 3600)
RESET_PER_EMAIL = Limit("reset-email", 3, 3600)
VERIFY_RESEND_PER_USER = Limit("verify-resend", 5, 3600)
INVITE_PER_TENANT = Limit("invite-tenant", 50, 86400)
INVITE_LOOKUP_PER_IP = Limit("invite-lookup-ip", 30, 60)
SEARCH_PER_USER = Limit("search-user", 60, 60)
