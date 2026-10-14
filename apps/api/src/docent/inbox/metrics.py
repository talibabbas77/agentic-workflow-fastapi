"""Inbox numbers: open work, response times, and how often agent answers were marked wrong.

answer_quality is the metrics query Phase 6 builds its dashboard on: an answer
is an agent message with decision type "answer"; a wrong answer is one the team
marked wrong from the inbox.
"""

import uuid
from dataclasses import dataclass

from docent.db.pool import Connection


@dataclass(frozen=True, slots=True)
class AnswerQuality:
    answers: int
    flagged_wrong: int

    @property
    def wrong_rate(self) -> float | None:
        return self.flagged_wrong / self.answers if self.answers else None


async def answer_quality(conn: Connection, days: int = 30) -> AnswerQuality:
    row = await conn.fetchrow(
        """
        select count(*) as answers, count(*) filter (where flagged_wrong) as flagged_wrong
        from messages
        where role = 'agent' and decision ->> 'type' = 'answer'
          and created_at > now() - make_interval(days => $1)
        """,
        days,
    )
    assert row is not None
    return AnswerQuality(answers=row["answers"], flagged_wrong=row["flagged_wrong"])


async def workload(conn: Connection, me: uuid.UUID) -> dict[str, object]:
    row = await conn.fetchrow(
        """
        select count(*) filter (where status <> 'resolved') as open,
               count(*) filter (where status <> 'resolved' and assignee_user_id is null)
                 as unassigned,
               count(*) filter (where status <> 'resolved' and assignee_user_id = $1) as mine,
               count(*) filter (where status = 'waiting') as waiting,
               count(*) filter (where resolved_at > now() - interval '7 days') as resolved_7d,
               percentile_cont(0.5) within group (
                 order by extract(epoch from first_response_at - created_at) / 60
               ) filter (where first_response_at is not null
                           and created_at > now() - interval '30 days')
                 as median_first_response_minutes
        from escalations
        """,
        me,
    )
    assert row is not None
    return dict(row)
