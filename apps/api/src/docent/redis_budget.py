"""The Redis command budget: count, add up in Postgres, alert, and go local-only.

Upstash's free tier allows 500K commands a month and refuses the rest. Docent
keeps itself inside the budget (ARCHITECTURE section 7):

- RedisHub counts every command it sends, in process. Counting costs no
  command.
- Every REDIS_BUDGET_FLUSH_SECONDS, or sooner once 1 percent of the budget is
  waiting, each API process adds its count to this month's redis_usage row
  with one upsert. A process that sent nothing writes nothing, so an idle app
  never wakes Postgres for this.
- At 80 and at 90 percent the platform admins get one email, once per
  threshold per month, whichever process gets there first: the upsert locks
  the month's row, so two processes cannot both see a threshold as new.
- From 90 percent every process sends no Redis command until the month ends:
  the cache and the rate limits use their in-process tiers. A process that
  starts later reads the count when it starts. Raising the budget and
  restarting turns Redis back on.

The count is close, not exact: connection setup is not counted, and commands
counted just before a month ends are added to the next one. Stopping at 90
percent leaves room for both.
"""

import asyncio
import contextlib
import logging
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime

import asyncpg

from docent.db.pool import Connection, Pool, transaction
from docent.jobs import queue
from docent.jobs.handlers import SEND_EMAIL
from docent.jobs.wake import WorkerWaker
from docent.redis_hub import RedisHub

log = logging.getLogger(__name__)

ALERT_PERCENTS = (80, 90)
LOCAL_ONLY_PERCENT = 90
# Flush early once this share of the budget is waiting in one process (1 percent).
EARLY_FLUSH_DIVISOR = 100


def month_of(moment: datetime) -> date:
    """The budget month a moment falls in, by UTC calendar."""
    utc = moment.astimezone(UTC)
    return date(utc.year, utc.month, 1)


def month_end(month: date) -> datetime:
    """The first instant of the next month, when local-only mode ends."""
    year, number = (month.year + 1, 1) if month.month == 12 else (month.year, month.month + 1)
    return datetime(year, number, 1, tzinfo=UTC)


@dataclass(frozen=True, slots=True)
class BudgetState:
    month: date
    commands: int
    budget: int
    alerted_80_at: datetime | None
    alerted_90_at: datetime | None
    local_only_since: datetime | None
    updated_at: datetime | None

    @property
    def percent(self) -> float:
        return self.commands * 100 / self.budget if self.budget > 0 else 0.0

    @property
    def over(self) -> bool:
        """Spent enough that the app should send Redis nothing until the month ends."""
        return self.percent >= LOCAL_ONLY_PERCENT


def _state(row: asyncpg.Record) -> BudgetState:
    return BudgetState(
        month=row["month"],
        commands=row["commands"],
        budget=row["budget"],
        alerted_80_at=row["alerted_80_at"],
        alerted_90_at=row["alerted_90_at"],
        local_only_since=row["local_only_since"],
        updated_at=row["updated_at"],
    )


async def read(conn: Connection, month: date, budget: int) -> BudgetState:
    """The month's state as stored, or an empty one before anything was counted."""
    row = await conn.fetchrow("select * from redis_usage where month = $1", month)
    if row is None:
        return BudgetState(month, 0, budget, None, None, None, None)
    return _state(row)


class RedisBudget:
    def __init__(
        self,
        hub: RedisHub,
        pool: Pool,
        *,
        budget: int,
        flush_seconds: float,
        web_origin: str,
        waker: WorkerWaker | None = None,
    ) -> None:
        self._hub = hub
        self._pool = pool
        self.budget = budget
        self._flush_seconds = flush_seconds
        self._web_origin = web_origin.rstrip("/")
        self._waker = waker
        self._task: asyncio.Task[None] | None = None
        hub.flush_every = max(1, budget // EARLY_FLUSH_DIVISOR)

    async def start(self) -> None:
        """Pick up this month's count, so a restart near the budget stays local-only."""
        try:
            async with transaction(self._pool) as conn:
                state = await read(conn, month_of(datetime.now(UTC)), self.budget)
        except (asyncpg.PostgresError, OSError) as exc:
            log.warning("could not read the redis budget", extra={"error": str(exc)})
        else:
            # Measured against this process's budget, so a raised one takes effect on restart.
            self._apply_mode(replace(state, budget=self.budget))
        self._task = asyncio.create_task(self._run())

    async def close(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        with contextlib.suppress(TimeoutError):
            async with asyncio.timeout(2):
                await self.flush()

    async def flush(self, now: datetime | None = None) -> BudgetState | None:
        """Add this process's count to the month's total, then alert or switch if due.

        Returns the month's state, or None when there was nothing to add or Postgres
        could not be reached (the count is kept for the next try).
        """
        count = self._hub.take_unflushed()
        if count <= 0:
            return None
        try:
            state, emailed = await self._add(count, now or datetime.now(UTC))
        except (asyncpg.PostgresError, OSError) as exc:
            self._hub.give_back(count)
            log.warning("could not record redis commands", extra={"error": str(exc)})
            return None
        self._apply_mode(state)
        if emailed and self._waker:
            await self._waker.wake()
        return state

    async def _run(self) -> None:
        while True:
            with contextlib.suppress(TimeoutError):
                async with asyncio.timeout(self._flush_seconds):
                    await self._hub.flush_wanted.wait()
            await self.flush()

    def _apply_mode(self, state: BudgetState) -> None:
        if state.over:
            self._hub.go_local_only(month_end(state.month).timestamp())

    async def _add(self, count: int, now: datetime) -> tuple[BudgetState, int]:
        month = month_of(now)
        async with transaction(self._pool) as conn:
            # Locks the month's row until commit: thresholds are seen as new exactly once.
            row = await conn.fetchrow(
                """
                insert into redis_usage (month, commands, budget) values ($1, $2, $3)
                on conflict (month) do update
                set commands = redis_usage.commands + excluded.commands,
                    budget = excluded.budget, updated_at = now()
                returning *
                """,
                month,
                count,
                self.budget,
            )
            assert row is not None
            state = _state(row)
            crossed = [
                p
                for p in ALERT_PERCENTS
                if state.percent >= p and getattr(state, f"alerted_{p}_at") is None
            ]
            newly_local = state.over and state.local_only_since is None
            if not crossed and not newly_local:
                return state, 0
            row = await conn.fetchrow(
                """
                update redis_usage
                set alerted_80_at = case when $2 then coalesce(alerted_80_at, $5)
                                         else alerted_80_at end,
                    alerted_90_at = case when $3 then coalesce(alerted_90_at, $5)
                                         else alerted_90_at end,
                    local_only_since = case when $4 then coalesce(local_only_since, $5)
                                            else local_only_since end
                where month = $1
                returning *
                """,
                month,
                state.percent >= 80,
                state.percent >= 90,
                state.over,
                now,
            )
            assert row is not None
            state = _state(row)
            # One email for the highest threshold crossed: forcing straight to 90 percent
            # sends the 90 percent alert, and marks 80 as done for the month too.
            emailed = await self._alert(conn, state, max(crossed)) if crossed else 0
        return state, emailed

    async def _alert(self, conn: Connection, state: BudgetState, percent: int) -> int:
        admins = await conn.fetch(
            """
            select id, email, name from users
            where is_platform_admin and email_verified_at is not null
            order by email
            """
        )
        for admin in admins:
            await queue.enqueue(
                conn,
                SEND_EMAIL,
                {
                    "template": "redis_budget",
                    "data": {
                        "to": admin["email"],
                        "name": admin["name"],
                        "percent": percent,
                        "used": state.commands,
                        "budget": state.budget,
                        "month": state.month.isoformat(),
                        "local_only": percent >= LOCAL_ONLY_PERCENT,
                        "url": f"{self._web_origin}/admin",
                    },
                },
                dedupe_key=f"redis-budget:{state.month}:{percent}:{admin['id']}",
            )
        if not admins:
            log.warning("redis budget alert with no platform admin to tell", extra={"at": percent})
        return len(admins)
