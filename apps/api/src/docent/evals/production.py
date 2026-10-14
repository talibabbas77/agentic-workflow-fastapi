"""Production metrics: how the agent does with real visitors over a period.

Only widget conversations count; staff previews and evals are not traffic. A
conversation belongs to the period it started in, and needs at least one
visitor message.

  resolved automatically  quiet for 30 minutes, no handoff, nothing marked wrong,
                          and its last agent turn (greetings and thanks aside)
                          was an answer backed by a source or verified details
  resolved, confirmed     a teammate graded it right in the weekly review. The
                          widget has no thumbs up yet, so people on the team are
                          the only ones who confirm.
  wrong-answer rate       agent answers marked wrong (from the inbox or the review
                          queue) divided by agent answers
  escalation rate         conversations with a handoff, overall and by reason
  latency                 p50 and p95 of the answer model's time per answer
  cost                    model cost of these conversations
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from docent.db.pool import Connection

QUIET = timedelta(minutes=30)

_COHORT = """
    with cohort as (
      select c.id, c.started_at, c.last_message_at,
             exists (select 1 from escalations e where e.conversation_id = c.id) as escalated
      from conversations c
      where c.channel = 'widget' and c.started_at >= $1 and c.started_at < $2
        and exists (select 1 from messages m where m.conversation_id = c.id and m.role = 'visitor')
    )
"""

_RESOLUTION = (
    _COHORT  # noqa: S608 - constant SQL, no input
    + """
    , last_turn as (
      select distinct on (m.conversation_id) m.conversation_id, m.decision
      from messages m join cohort on cohort.id = m.conversation_id
      where m.role = 'agent' and coalesce(m.decision ->> 'type', '') <> 'reply'
      order by m.conversation_id, m.created_at desc, m.id desc
    )
    select
      count(*) as conversations,
      count(*) filter (where c.escalated) as escalated,
      count(*) filter (
        where not c.escalated
          and c.last_message_at < $3
          and t.decision ->> 'type' = 'answer'
          and (jsonb_array_length(coalesce(t.decision -> 'citations', '[]')) > 0
               or jsonb_array_length(coalesce(t.decision -> 'account_facts', '[]')) > 0)
          and not exists (
            select 1 from messages w where w.conversation_id = c.id and w.flagged_wrong)
      ) as auto_resolved,
      count(*) filter (
        where exists (
          select 1 from review_items r where r.conversation_id = c.id and r.grade = 'right')
      ) as confirmed_resolved
    from cohort c left join last_turn t on t.conversation_id = c.id
"""
)

_ANSWERS = (
    _COHORT  # noqa: S608 - constant SQL, no input
    + """
    select count(*) as answers,
           count(*) filter (where m.flagged_wrong) as marked_wrong,
           percentile_cont(0.5) within group (order by m.latency_ms) as p50,
           percentile_cont(0.95) within group (order by m.latency_ms) as p95
    from messages m join cohort c on c.id = m.conversation_id
    where m.role = 'agent' and m.decision ->> 'type' = 'answer'
"""
)

_REASONS = (
    _COHORT  # noqa: S608 - constant SQL, no input
    + """
    select e.reason, count(distinct e.conversation_id) as conversations
    from escalations e join cohort c on c.id = e.conversation_id
    group by e.reason order by conversations desc, e.reason
"""
)

_COST = (
    _COHORT  # noqa: S608 - constant SQL, no input
    + """
    select coalesce(sum(u.cost_micros), 0)::bigint as cost
    from usage_events u join cohort c on c.id = u.conversation_id
"""
)

_DAYS = (
    _COHORT  # noqa: S608 - constant SQL, no input
    + """
    select (c.started_at at time zone 'utc')::date as day, count(*) as conversations,
           count(*) filter (where c.escalated) as escalated
    from cohort c group by 1 order by 1
"""
)

_REVIEW = """
    select count(*) filter (where grade is not null) as graded,
           count(*) filter (where grade = 'wrong') as wrong
    from review_items where graded_at >= $1 and graded_at < $2
"""


@dataclass(frozen=True, slots=True)
class Day:
    day: date
    conversations: int
    escalated: int


@dataclass(slots=True)
class Production:
    start: datetime
    end: datetime
    conversations: int = 0
    auto_resolved: int = 0
    confirmed_resolved: int = 0
    escalated: int = 0
    answers: int = 0
    marked_wrong: int = 0
    reviewed: int = 0
    reviewed_wrong: int = 0
    latency_p50_ms: int | None = None
    latency_p95_ms: int | None = None
    cost_micros: int = 0
    reasons: dict[str, int] = field(default_factory=dict)
    days: list[Day] = field(default_factory=list)

    @staticmethod
    def _rate(part: int, whole: int) -> float | None:
        return round(part / whole, 4) if whole else None

    def rates(self) -> dict[str, Any]:
        n = self.conversations
        return {
            "auto_resolution_rate": self._rate(self.auto_resolved, n),
            "confirmed_resolution_rate": self._rate(self.confirmed_resolved, n),
            "escalation_rate": self._rate(self.escalated, n),
            "wrong_answer_rate": self._rate(self.marked_wrong, self.answers),
            "review_wrong_rate": self._rate(self.reviewed_wrong, self.reviewed),
            "cost_per_conversation_micros": round(self.cost_micros / n) if n else None,
        }


async def production_metrics(
    conn: Connection, start: datetime, end: datetime, now: datetime | None = None
) -> Production:
    """Numbers for the tenant in context, for conversations that started in [start, end)."""
    quiet_before = (now or datetime.now(start.tzinfo)) - QUIET
    out = Production(start=start, end=end)
    row = await conn.fetchrow(_RESOLUTION, start, end, quiet_before)
    assert row is not None
    out.conversations = row["conversations"]
    out.escalated = row["escalated"]
    out.auto_resolved = row["auto_resolved"]
    out.confirmed_resolved = row["confirmed_resolved"]
    answers = await conn.fetchrow(_ANSWERS, start, end)
    assert answers is not None
    out.answers = answers["answers"]
    out.marked_wrong = answers["marked_wrong"]
    out.latency_p50_ms = round(answers["p50"]) if answers["p50"] is not None else None
    out.latency_p95_ms = round(answers["p95"]) if answers["p95"] is not None else None
    out.reasons = {r["reason"]: r["conversations"] for r in await conn.fetch(_REASONS, start, end)}
    out.cost_micros = int(await conn.fetchval(_COST, start, end))
    review = await conn.fetchrow(_REVIEW, start, end)
    assert review is not None
    out.reviewed = review["graded"]
    out.reviewed_wrong = review["wrong"]
    by_day = {r["day"]: r for r in await conn.fetch(_DAYS, start, end)}
    day = start.date()
    while day <= end.date():
        found = by_day.get(day)
        out.days.append(
            Day(day, found["conversations"] if found else 0, found["escalated"] if found else 0)
        )
        day += timedelta(days=1)
    return out


def period(days: int, now: datetime) -> tuple[datetime, datetime]:
    """The last `days` days up to now."""
    return now - timedelta(days=days), now
