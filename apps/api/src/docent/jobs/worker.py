"""Job worker.

Jobs run in lanes. Each lane owns some job kinds and a number of slots, so
quick work (emails, summaries) never waits behind heavy work (crawling,
embedding). Every slot drains its lane, then sleeps until the API wakes the
worker over HTTP or the idle poll interval passes. Nothing polls in a tight
loop, so a scale-to-zero database can suspend while the queue is empty.
"""

import asyncio
import contextlib
import logging
import os
import socket
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace

from docent.db.pool import Pool, transaction
from docent.jobs import queue
from docent.jobs.queue import Job

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class JobContext:
    job: Job
    pool: Pool


Handler = Callable[[JobContext], Awaitable[None]]


class PermanentJobError(Exception):
    """Retrying will not help. The job goes straight to dead."""


@dataclass(frozen=True, slots=True)
class Lane:
    name: str
    kinds: tuple[str, ...]
    slots: int = 1


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
        lanes: list[Lane] | None = None,
        worker_id: str | None = None,
    ) -> None:
        self.pool = pool
        self.handlers = handlers
        self.lanes = lanes or [Lane("default", tuple(handlers))]
        lane_kinds = [kind for lane in self.lanes for kind in lane.kinds]
        if sorted(lane_kinds) != sorted(handlers):
            raise ValueError("every job kind must belong to exactly one lane")
        self.idle_poll_seconds = idle_poll_seconds
        self.lease_seconds = lease_seconds
        self.worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}"
        self._signals: list[asyncio.Event] = []
        self._stopping = asyncio.Event()
        self._last_reap = 0.0
        self._last_purge = 0.0
        self.processed = 0

    def wake(self) -> None:
        for signal in self._signals:
            signal.set()

    def stop(self) -> None:
        self._stopping.set()
        self.wake()

    async def run_forever(self) -> None:
        log.info(
            "worker started",
            extra={
                "worker_id": self.worker_id,
                "lanes": {lane.name: lane.slots for lane in self.lanes},
            },
        )
        slots = [(lane, asyncio.Event()) for lane in self.lanes for _ in range(lane.slots)]
        self._signals = [signal for _, signal in slots]
        await asyncio.gather(*(self._slot(lane, signal) for lane, signal in slots))
        log.info("worker stopped")

    async def _slot(self, lane: Lane, signal: asyncio.Event) -> None:
        while not self._stopping.is_set():
            signal.clear()  # a wake that arrives while draining is kept for the next loop
            try:
                await self.maintenance()
                await self.drain(kinds=lane.kinds)
            except Exception:
                log.exception("worker cycle failed", extra={"lane": lane.name})
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(signal.wait(), timeout=self.idle_poll_seconds)

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

    async def drain(self, limit: int | None = None, kinds: tuple[str, ...] | None = None) -> int:
        """Run ready jobs of the given kinds (default all) until none are left."""
        ran = 0
        wanted = list(kinds or self.handlers)
        while not self._stopping.is_set() and (limit is None or ran < limit):
            async with transaction(self.pool) as conn:
                job = await queue.claim(conn, self.worker_id, wanted, self.lease_seconds)
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
            # A permanent error skips the remaining retries.
            final = (
                replace(job, attempts=job.max_attempts)
                if isinstance(exc, PermanentJobError)
                else job
            )
            async with transaction(self.pool) as conn:
                outcome = await queue.fail(
                    conn, final, self.worker_id, f"{type(exc).__name__}: {exc}"
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
