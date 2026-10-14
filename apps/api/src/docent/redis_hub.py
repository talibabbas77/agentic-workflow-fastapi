"""Optional Redis with a circuit breaker and a command counter.

Redis is never required. When it is unset, slow, failing, or over its monthly
command budget, callers get RedisUnavailable and use their fallback.

Every command sent is counted here, in process. redis_budget.RedisBudget adds
the count up across processes in Postgres and, near the monthly budget, puts
the hub in local-only mode until the month ends: no command is sent at all, and
the cache and rate limiter use their in-process tiers.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Literal

from redis.asyncio import Redis
from redis.exceptions import RedisError

log = logging.getLogger(__name__)

RedisStatus = Literal["ok", "degraded", "disabled", "local_only"]


class RedisUnavailable(Exception):
    pass


class RedisHub:
    FAILURE_THRESHOLD = 3
    OPEN_SECONDS = 30.0
    OVER_LIMIT_OPEN_SECONDS = 3600.0

    def __init__(self, url: str | None, timeout_seconds: float = 0.1) -> None:
        self._timeout = timeout_seconds
        self._client: Redis | None = (
            Redis.from_url(
                url,
                socket_timeout=timeout_seconds,
                socket_connect_timeout=timeout_seconds,
                retry_on_timeout=False,
            )
            if url
            else None
        )
        self._failures = 0
        self._open_until = 0.0
        self._local_only_until = 0.0  # wall clock: the start of the next month
        self.commands_sent = 0
        self._unflushed = 0
        # Set when enough commands are waiting that the budget should flush early.
        self.flush_wanted = asyncio.Event()
        self.flush_every = 0  # commands; 0 means only on the budget's timer

    @property
    def enabled(self) -> bool:
        return self._client is not None

    @property
    def local_only(self) -> bool:
        return time.time() < self._local_only_until

    def status(self) -> RedisStatus:
        if self._client is None:
            return "disabled"
        if self.local_only:
            return "local_only"
        return "degraded" if self._is_open() else "ok"

    def go_local_only(self, until: float) -> None:
        """Send nothing to Redis until `until` (a Unix time), the end of the budget month."""
        if until > self._local_only_until:
            log.warning("redis command budget nearly spent, local-only until the month ends")
        self._local_only_until = max(self._local_only_until, until)

    @property
    def unflushed(self) -> int:
        """Commands this process sent that the budget has not added up yet."""
        return self._unflushed

    def take_unflushed(self) -> int:
        """Commands counted since the last call, for the budget to add up in Postgres."""
        count, self._unflushed = self._unflushed, 0
        self.flush_wanted.clear()
        return count

    def give_back(self, count: int) -> None:
        """Commands a failed flush took, kept for the next one."""
        self._unflushed += count

    def _is_open(self) -> bool:
        return time.monotonic() < self._open_until

    def _record_failure(self, exc: Exception) -> None:
        self._failures += 1
        if "max requests limit exceeded" in str(exc).lower():
            self._open_until = time.monotonic() + self.OVER_LIMIT_OPEN_SECONDS
            log.warning("redis over monthly command limit, local-only for one hour")
        elif self._failures >= self.FAILURE_THRESHOLD:
            self._open_until = time.monotonic() + self.OPEN_SECONDS
            log.warning("redis circuit open", extra={"seconds": self.OPEN_SECONDS})

    async def call[T](self, fn: Callable[[Redis], Awaitable[T]], commands: int = 1) -> T:
        """Run one Redis operation, or raise RedisUnavailable."""
        if self._client is None or self._is_open() or self.local_only:
            raise RedisUnavailable
        self.commands_sent += commands
        self._unflushed += commands
        if self.flush_every and self._unflushed >= self.flush_every:
            self.flush_wanted.set()
        try:
            result = await asyncio.wait_for(fn(self._client), timeout=self._timeout * 3)
        except (RedisError, TimeoutError, OSError) as exc:
            self._record_failure(exc)
            raise RedisUnavailable from exc
        self._failures = 0
        return result

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
