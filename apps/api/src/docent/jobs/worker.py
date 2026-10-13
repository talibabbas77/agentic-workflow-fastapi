"""Job worker loop.

The worker drains the queue, then sleeps until the API wakes it over HTTP or
the idle poll interval passes. It never polls in a tight loop, so a scale-to-zero
database can suspend while nothing is happening.
"""

import asyncio
import contextlib
import logging
import os
import socket
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from docent.db.pool import Pool, transaction
from docent.jobs import queue
from docent.jobs.queue import Job

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class JobContext:
    job: Job
    pool: Pool


Handler = Callable[[JobContext], Awaitable[None]]


class Worker:
    REAP_INTERVAL_SECONDS = 120.0
    PURGE_INTERVAL_SECONDS = 6 * 3600.0

    def __init__(
        self,
        pool: Pool,
        handlers: dict[str, Handler],
        *,
        idle_poll_seconds: float,
        lease_seconds: int,
        worker_id: str | None = None,
    ) -> None:
        self.pool = pool
        self.handlers = handlers
        self.idle_poll_seconds = idle_poll_seconds
        self.lease_seconds = lease_seconds
        self.worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}"
        self._wake = asyncio.Event()
        self._stopping = asyncio.Event()
        self._last_reap = 0.0
        self._last_purge = 0.0
        self.processed = 0

    def wake(self) -> None:
        self._wake.set()

    def stop(self) -> None:
        self._stopping.set()
        self._wake.set()

    async def run_forever(self) -> None:
        log.info("worker started", extra={"worker_id": self.worker_id})
        while not self._stopping.is_set():
            self._wake.clear()
            try:
                await self.maintenance()
                await self.drain()
            except Exception:
                log.exception("worker cycle failed")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=self.idle_poll_seconds)
        log.info("worker stopped")

    async def maintenance(self, force: bool = False) -> None:
        now = time.monotonic()
        if force or now - self._last_reap >= self.REAP_INTERVAL_SECONDS:
            async with transaction(self.pool) as conn:
                reaped = await queue.reap_expired(conn)
            if reaped:
                log.warning("requeued expired jobs", extra={"count": reaped})
            self._last_reap = now
        if force or now - self._last_purge >= self.PURGE_INTERVAL_SECONDS:
            async with transaction(self.pool) as conn:
                await queue.purge_finished(conn)
            self._last_purge = now

    async def drain(self, limit: int | None = None) -> int:
        """Run jobs until none are ready. Returns how many ran."""
        ran = 0
        kinds = list(self.handlers)
        while not self._stopping.is_set() and (limit is None or ran < limit):
            async with transaction(self.pool) as conn:
                job = await queue.claim(conn, self.worker_id, kinds, self.lease_seconds)
            if job is None:
                break
            await self._run(job)
            ran += 1
        return ran

    async def _run(self, job: Job) -> None:
        handler = self.handlers[job.kind]
        beat = asyncio.create_task(self._heartbeat(job.id))
        started = time.monotonic()
        try:
            await handler(JobContext(job=job, pool=self.pool))
        except Exception as exc:
            outcome = "error"
            async with transaction(self.pool) as conn:
                outcome = await queue.fail(
                    conn, job, self.worker_id, f"{type(exc).__name__}: {exc}"
                )
            log.warning(
                "job failed",
                extra={
                    "job_id": job.id,
                    "kind": job.kind,
                    "attempt": job.attempts,
                    "next": outcome,
                },
                exc_info=True,
            )
        else:
            async with transaction(self.pool) as conn:
                await queue.complete(conn, job.id, self.worker_id)
            self.processed += 1
            log.info(
                "job done",
                extra={
                    "job_id": job.id,
                    "kind": job.kind,
                    "ms": round((time.monotonic() - started) * 1000),
                },
            )
        finally:
            beat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await beat

    async def _heartbeat(self, job_id: int) -> None:
        interval = max(5.0, self.lease_seconds / 3)
        while True:
            await asyncio.sleep(interval)
            async with transaction(self.pool) as conn:
                await queue.heartbeat(conn, job_id, self.worker_id, self.lease_seconds)
