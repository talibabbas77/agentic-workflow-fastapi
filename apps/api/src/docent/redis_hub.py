"""Optional Redis with a circuit breaker and a command counter.

Redis is never required. When it is unset, slow, failing, or over its monthly
command budget, callers get RedisUnavailable and use their fallback.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Literal

from redis.asyncio import Redis
from redis.exceptions import RedisError

log = logging.getLogger(__name__)

RedisStatus = Literal["ok", "degraded", "disabled"]


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
        self.commands_sent = 0

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def status(self) -> RedisStatus:
        if self._client is None:
            return "disabled"
        return "degraded" if self._is_open() else "ok"

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
        if self._client is None or self._is_open():
            raise RedisUnavailable
        self.commands_sent += commands
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
