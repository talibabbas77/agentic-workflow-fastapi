"""Rate limiting with GCRA, in Redis when it is there and in process when it is not.

GCRA (the generic cell rate algorithm) keeps one number per key: the time the
next request is "due". It allows a burst of up to the limit, then one request
per window / limit, so there is no doubling at a window edge the way fixed
windows allow. One key and one script call per check, which keeps Redis usage
inside a free tier's command budget. Without Redis, each instance keeps the
same state in memory: exact with one instance, looser with several, never off.
"""

import math
import time
from dataclasses import dataclass

from redis.asyncio import Redis

from docent.redis_hub import RedisHub, RedisUnavailable

# KEYS[1] limiter key. ARGV: now and emission interval in ms, burst tolerance in ms.
# Returns {allowed, remaining, retry_after_ms}.
_GCRA = """
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local tolerance = tonumber(ARGV[3])
local tat = tonumber(redis.call('GET', KEYS[1]) or now)
if tat < now then tat = now end
if tat - now > tolerance then
  return {0, 0, tat - now - tolerance}
end
local next_tat = tat + interval
redis.call('SET', KEYS[1], next_tat, 'PX', next_tat - now)
return {1, math.floor((tolerance + interval - (next_tat - now)) / interval), 0}
"""


@dataclass(frozen=True, slots=True)
class Limit:
    name: str
    max_hits: int
    window_seconds: int

    @property
    def interval_ms(self) -> int:
        return max(1, self.window_seconds * 1000 // self.max_hits)

    @property
    def tolerance_ms(self) -> int:
        return self.window_seconds * 1000 - self.interval_ms


@dataclass(frozen=True, slots=True)
class RateResult:
    allowed: bool
    remaining: int
    retry_after: int  # seconds, 0 when allowed


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


def _result(allowed: bool, remaining: int, retry_ms: int) -> RateResult:
    return RateResult(
        allowed=allowed,
        remaining=max(0, remaining),
        retry_after=0 if allowed else max(1, math.ceil(retry_ms / 1000)),
    )


class LocalRateLimiter:
    """The same algorithm in memory, for when Redis is missing or degraded."""

    def __init__(self, max_keys: int = 50_000) -> None:
        self._due: dict[str, int] = {}
        self._max_keys = max_keys

    def hit(self, key: str, limit: Limit) -> RateResult:
        now = _now_ms()
        tat = max(self._due.get(key, now), now)
        if tat - now > limit.tolerance_ms:
            return _result(False, 0, tat - now - limit.tolerance_ms)
        next_tat = tat + limit.interval_ms
        self._due[key] = next_tat
        if len(self._due) > self._max_keys:
            self._due = {k: v for k, v in self._due.items() if v > now}
        remaining = (limit.tolerance_ms + limit.interval_ms - (next_tat - now)) // limit.interval_ms
        return _result(True, remaining, 0)


class RateLimiter:
    def __init__(self, hub: RedisHub, prefix: str = "rl") -> None:
        self._hub = hub
        self._local = LocalRateLimiter()
        self._prefix = prefix
        self._sha: str | None = None

    async def hit(self, limit: Limit, *key_parts: str) -> RateResult:
        key = ":".join((self._prefix, limit.name, *key_parts))
        # The first check in a process loads the script first: two commands, not one.
        commands = 1 if self._sha else 2
        try:
            allowed, remaining, retry_ms = await self._hub.call(
                lambda r: self._eval(r, key, limit), commands=commands
            )
        except RedisUnavailable:
            return self._local.hit(key, limit)
        return _result(bool(allowed), remaining, retry_ms)

    async def _eval(self, client: Redis, key: str, limit: Limit) -> tuple[int, int, int]:
        args = (_now_ms(), limit.interval_ms, limit.tolerance_ms)
        if self._sha is None:
            self._sha = await client.script_load(_GCRA)
        try:
            raw = await client.evalsha(self._sha, 1, key, *args)
        except Exception as exc:
            if "NOSCRIPT" not in str(exc):
                raise
            self._sha = await client.script_load(_GCRA)
            raw = await client.evalsha(self._sha, 1, key, *args)
        return int(raw[0]), int(raw[1]), int(raw[2])


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
AGENT_TURN_PER_USER = Limit("agent-turn", 20, 60)
# Inbox: emails to customers, and test sends to tenant URLs.
INBOX_REPLY_PER_USER = Limit("inbox-reply", 30, 60)
OUTBOUND_TEST_PER_TENANT = Limit("outbound-test", 20, 600)
