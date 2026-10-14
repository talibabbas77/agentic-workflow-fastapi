"""The weekly review queue: a person grades a sample of real answered conversations.

Weeks start on Monday, UTC. The first time anyone opens the queue in a week, it
samples up to 20 widget conversations at random from those the agent answered
in the 7 days before; later visits that week top it up to 20 with newer ones.
A conversation is sampled once, ever, so a week never repeats an earlier one.

Each item is graded right or wrong, with an optional note. Wrong also marks the
graded answer as wrong (unless someone already had), so it counts in the
wrong-answer rate like any answer marked wrong in the inbox; changing the grade
back removes that mark. Right confirms the conversation as resolved.
"""

import uuid
from datetime import UTC, date, datetime, timedelta

import asyncpg

from docent.db.pool import Connection
from docent.ids import new_id

SAMPLE_SIZE = 20
WINDOW = timedelta(days=7)
REVIEW_FLAG_REASON = "Graded wrong in the weekly review."


def week_of(day: date) -> date:
    """The Monday that starts the week of this day."""
    return day - timedelta(days=day.weekday())


async def top_up(conn: Connection, tenant_id: uuid.UUID, now: datetime) -> int:
    """Fill this week's sample up to 20. Returns how many were added."""
    week = week_of(now.astimezone(UTC).date())
    # One sampler per workspace at a time, so two visitors cannot overfill the week.
    await conn.execute(
        "select pg_advisory_xact_lock(hashtextextended('docent.review:' || $1::text, 0))",
        str(tenant_id),
    )
    have: int = await conn.fetchval("select count(*) from review_items where week_start = $1", week)
    if have >= SAMPLE_SIZE:
        return 0
    rows = await conn.fetch(
        """
        select conversation_id, message_id from (
          select distinct on (m.conversation_id) m.conversation_id, m.id as message_id
          from messages m join conversations c on c.id = m.conversation_id
          where c.channel = 'widget' and m.role = 'agent' and m.decision ->> 'type' = 'answer'
            and m.created_at >= $1 and m.created_at <= $2
            and not exists (
              select 1 from review_items r where r.conversation_id = m.conversation_id)
          order by m.conversation_id, m.created_at desc, m.id desc
        ) answered
        order by random()
        limit $3
        """,
        now - WINDOW,
        now,
        SAMPLE_SIZE - have,
    )
    if rows:
        await conn.executemany(
            """
            insert into review_items (id, tenant_id, week_start, conversation_id, message_id)
            values ($1, $2, $3, $4, $5)
            on conflict (tenant_id, conversation_id) do nothing
            """,
            [(new_id(), tenant_id, week, r["conversation_id"], r["message_id"]) for r in rows],
        )
    return len(rows)


ITEM_COLUMNS = """
    r.id, r.week_start, r.conversation_id, r.message_id, r.grade, r.note, r.graded_at,
    r.sampled_at, gu.name as graded_by_name, c.mode, c.started_at, c.claims,
    m.content as answer, m.flagged_wrong,
    (select v.content from messages v
     where v.conversation_id = r.conversation_id and v.role = 'visitor'
       and (v.created_at, v.id) < (m.created_at, m.id)
     order by v.created_at desc, v.id desc limit 1) as question,
    exists (select 1 from escalations e where e.conversation_id = r.conversation_id) as escalated
"""


async def week_items(conn: Connection, week: date) -> list[asyncpg.Record]:
    return await conn.fetch(
        f"""
        select {ITEM_COLUMNS}
        from review_items r
        join conversations c on c.id = r.conversation_id
        join messages m on m.id = r.message_id
        left join users gu on gu.id = r.graded_by
        where r.week_start = $1
        order by r.sampled_at, r.id
        """,  # noqa: S608
        week,
    )


async def get_item(conn: Connection, item_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        f"""
        select {ITEM_COLUMNS}
        from review_items r
        join conversations c on c.id = r.conversation_id
        join messages m on m.id = r.message_id
        left join users gu on gu.id = r.graded_by
        where r.id = $1
        """,  # noqa: S608
        item_id,
    )


async def weeks(conn: Connection) -> list[asyncpg.Record]:
    """Every week with a sample, newest first, with how much of it is graded."""
    return await conn.fetch(
        """
        select week_start, count(*) as sampled, count(grade) as graded
        from review_items group by week_start order by week_start desc limit 52
        """
    )


async def grade(
    conn: Connection,
    item_id: uuid.UUID,
    *,
    user_id: uuid.UUID,
    grade: str | None,
    note: str,
) -> bool:
    """Grade one item, or clear its grade. False if there is no such item."""
    item = await conn.fetchrow(
        "select message_id, flagged_answer from review_items where id = $1 for update", item_id
    )
    if item is None:
        return False
    flagged = item["flagged_answer"]
    if grade == "wrong" and not flagged:
        flagged = bool(
            await conn.fetchval(
                """
                update messages
                set flagged_wrong = true, flag_reason = $2, flagged_by = $3, flagged_at = now()
                where id = $1 and not flagged_wrong
                returning true
                """,
                item["message_id"],
                note or REVIEW_FLAG_REASON,
                user_id,
            )
        )
    elif grade != "wrong" and flagged:
        await conn.execute(
            """
            update messages
            set flagged_wrong = false, flag_reason = null, flagged_by = null, flagged_at = null
            where id = $1
            """,
            item["message_id"],
        )
        flagged = False
    await conn.execute(
        """
        update review_items
        set grade = $2, note = $3, flagged_answer = $4,
            graded_by = case when $2::text is null then null else $5::uuid end,
            graded_at = case when $2::text is null then null else now() end
        where id = $1
        """,
        item_id,
        grade,
        note,
        flagged,
        user_id,
    )
    return True
