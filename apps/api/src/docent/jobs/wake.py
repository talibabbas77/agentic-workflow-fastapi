"""Tell the worker that new jobs exist. Best effort: the safety poll covers misses."""

import logging

import httpx

log = logging.getLogger(__name__)


class WorkerWaker:
    def __init__(
        self, client: httpx.AsyncClient | None, worker_url: str | None, token: str
    ) -> None:
        self._client = client
        self._url = f"{worker_url.rstrip('/')}/internal/wake" if worker_url else None
        self._token = token

    async def wake(self) -> None:
        if self._client is None or self._url is None:
            return
        try:
            await self._client.post(
                self._url, headers={"x-internal-token": self._token}, timeout=0.5
            )
        except httpx.HTTPError as exc:
            log.debug("worker wake failed", extra={"error": type(exc).__name__})
