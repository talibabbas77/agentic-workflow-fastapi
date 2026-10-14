"""SQL for the inbox: filtered, sorted, cursor-paged lists, the board, counts, and detail.

"Unread" means the handoff was created or changed after the member last opened
it. escalations.updated_at moves on every change the team should see (a new
customer message, the summary arriving, status, assignee, fields, notes,
replies), and escalation_reads keeps when each member last opened each one.
A member's own changes mark it read for them.
"""

import base64
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import asyncpg

from docent.db.pool import Connection
from docent.inbox.events import ISSUE_SQL

STATUSES = ("open", "assigned", "waiting", "resolved")
PRIORITY_RANK = (
    "case e.priority when 'urgent' then 3 when 'high' then 2 when 'normal' then 1 else 0 end"
)

ITEM_COLUMNS = f"""
    e.id, e.status, e.reason, e.priority, e.created_at, e.updated_at, e.first_response_at,
    e.resolved_at, e.contact_email, e.summary is not null as summary_ready,
    e.ticket_type_id, t.name as ticket_type_name, e.assignee_user_id, a.name as assignee_name,
    c.mode, c.channel, coalesce(cu.name, nullif(c.claims ->> 'name', '')) as customer_name,
    cu.email as customer_email,
    {ISSUE_SQL} as issue,
    (r.read_at is null or r.read_at < e.updated_at) as unread
"""

ITEM_FROM = """
    from escalations e
    join conversations c on c.id = e.conversation_id
    left join ticket_types t on t.id = e.ticket_type_id
    left join users a on a.id = e.assignee_user_id
    left join end_users cu on cu.id = c.end_user_id
    left join escalation_reads r on r.escalation_id = e.id and r.user_id = $1
"""

# Sort keys, all compared as one row so a cursor can continue after the last item.
SORTS: dict[str, tuple[list[str], bool]] = {
    "newest": (["e.created_at", "e.id"], True),
    "oldest": (["e.created_at", "e.id"], False),
    "updated": (["e.updated_at", "e.id"], True),
    "priority": ([PRIORITY_RANK, "e.created_at", "e.id"], True),
}


class BadCursor(ValueError):
    pass


@dataclass(slots=True)
class Filters:
    statuses: list[str] = field(default_factory=list)
    ticket_type_id: uuid.UUID | None = None
    reasons: list[str] = field(default_factory=list)
    assignee: str | None = None  # "me", "unassigned", or a user id
    query: str | None = None
    unread_only: bool = False


def _like(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _where(filters: Filters, me: uuid.UUID, args: list[Any], *, with_status: bool = True) -> str:
    """Conditions for the filters. args starts with the member's id as $1."""
    parts: list[str] = []

    def arg(value: Any) -> str:
        args.append(value)
        return f"${len(args)}"

    if with_status and filters.statuses:
        parts.append(f"e.status = any({arg(filters.statuses)}::text[])")
    if filters.ticket_type_id:
        parts.append(f"e.ticket_type_id = {arg(filters.ticket_type_id)}")
    if filters.reasons:
        parts.append(f"e.reason = any({arg(filters.reasons)}::text[])")
    if filters.assignee == "me":
        parts.append("e.assignee_user_id = $1")
    elif filters.assignee == "unassigned":
        parts.append("e.assignee_user_id is null")
    elif filters.assignee:
        parts.append(f"e.assignee_user_id = {arg(uuid.UUID(filters.assignee))}")
    if filters.query:
        q = arg(_like(filters.query.strip()))
        parts.append(
            f"""(e.summary ->> 'issue' ilike {q} or e.summary ->> 'tried' ilike {q}
                 or e.summary ->> 'user_context' ilike {q}
                 or e.summary ->> 'suggested_next_step' ilike {q}
                 or e.contact_email ilike {q} or cu.name ilike {q}
                 or c.claims ->> 'name' ilike {q}
                 or exists (select 1 from messages m where m.conversation_id = e.conversation_id
                            and m.role = 'visitor' and m.content ilike {q}))"""  # noqa: S608
        )
    if filters.unread_only:
        parts.append("(r.read_at is null or r.read_at < e.updated_at)")
    return " and ".join(parts) or "true"


def encode_cursor(values: list[Any]) -> str:
    raw = json.dumps([v.isoformat() if isinstance(v, datetime) else str(v) for v in values])
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str, sort: str) -> list[Any]:
    keys, _ = SORTS[sort]
    try:
        raw = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        if not isinstance(raw, list) or len(raw) != len(keys):
            raise BadCursor("cursor does not match the sort")
        values: list[Any] = []
        for key, value in zip(keys, raw, strict=True):
            if key == "e.id":
                values.append(uuid.UUID(value))
            elif key == PRIORITY_RANK:
                values.append(int(value))
            else:
                values.append(datetime.fromisoformat(value))
        return values
    except (ValueError, TypeError) as exc:
        raise BadCursor("invalid cursor") from exc


def _sort_value(row: asyncpg.Record, key: str) -> Any:
    if key == PRIORITY_RANK:
        return {"urgent": 3, "high": 2, "normal": 1}.get(row["priority"], 0)
    return row[key.removeprefix("e.")]


async def list_page(
    conn: Connection,
    me: uuid.UUID,
    filters: Filters,
    *,
    sort: str,
    limit: int,
    cursor: str | None,
) -> tuple[list[asyncpg.Record], str | None]:
    keys, descending = SORTS[sort]
    args: list[Any] = [me]
    where = _where(filters, me, args)
    if cursor:
        values = _decode_cursor(cursor, sort)
        placeholders = []
        for value in values:
            args.append(value)
            placeholders.append(f"${len(args)}")
        where += (
            f" and ({', '.join(keys)}) {'<' if descending else '>'} ({', '.join(placeholders)})"
        )
    direction = "desc" if descending else "asc"
    args.append(limit + 1)
    rows = await conn.fetch(
        f"""
        select {ITEM_COLUMNS} {ITEM_FROM}
        where {where}
        order by {", ".join(f"{k} {direction}" for k in keys)}
        limit ${len(args)}
        """,
        *args,
    )
    more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = encode_cursor([_sort_value(rows[-1], k) for k in keys]) if more and rows else None
    return rows, next_cursor


async def board(
    conn: Connection, me: uuid.UUID, filters: Filters, *, per_column: int
) -> dict[str, tuple[int, list[asyncpg.Record]]]:
    args: list[Any] = [me]
    where = _where(filters, me, args, with_status=False)
    args.append(per_column)
    rows = await conn.fetch(
        f"""
        select * from (
          select {ITEM_COLUMNS},
                 count(*) over (partition by e.status) as column_total,
                 row_number() over (
                   partition by e.status
                   order by case when e.status = 'resolved' then e.resolved_at end desc nulls last,
                            {PRIORITY_RANK} desc, e.created_at
                 ) as position
          {ITEM_FROM}
          where {where}
        ) ranked
        where position <= ${len(args)}
        order by position
        """,  # noqa: S608
        *args,
    )
    columns: dict[str, tuple[int, list[asyncpg.Record]]] = {s: (0, []) for s in STATUSES}
    for row in rows:
        _, items = columns[row["status"]]
        items.append(row)
        columns[row["status"]] = (int(row["column_total"]), items)
    return columns


async def counts(conn: Connection, me: uuid.UUID) -> asyncpg.Record:
    row = await conn.fetchrow(
        """
        select count(*) filter (where e.status = 'open') as open,
               count(*) filter (where e.status = 'assigned') as assigned,
               count(*) filter (where e.status = 'waiting') as waiting,
               count(*) filter (where e.status = 'resolved') as resolved,
               count(*) filter (where e.status <> 'resolved'
                                  and (r.read_at is null or r.read_at < e.updated_at)) as unread,
               count(*) filter (where e.status <> 'resolved' and e.assignee_user_id = $1) as mine,
               count(*) filter (where e.status <> 'resolved' and e.assignee_user_id is null)
                 as unassigned
        from escalations e
        left join escalation_reads r on r.escalation_id = e.id and r.user_id = $1
        """,
        me,
    )
    assert row is not None
    return row


async def get_item(
    conn: Connection, me: uuid.UUID, escalation_id: uuid.UUID
) -> asyncpg.Record | None:
    return await conn.fetchrow(
        f"select {ITEM_COLUMNS} {ITEM_FROM} where e.id = $2",
        me,
        escalation_id,
    )


async def mark_read(
    conn: Connection, tenant_id: uuid.UUID, me: uuid.UUID, escalation_id: uuid.UUID
) -> None:
    """Opening a handoff reads it, and reads the member's notifications about it."""
    await conn.execute(
        """
        insert into escalation_reads (tenant_id, user_id, escalation_id, read_at)
        values ($1, $2, $3, now())
        on conflict (user_id, escalation_id) do update set read_at = excluded.read_at
        """,
        tenant_id,
        me,
        escalation_id,
    )
    await conn.execute(
        """
        update notifications set read_at = now()
        where user_id = $1 and escalation_id = $2 and channel = 'in_app' and read_at is null
        """,
        me,
        escalation_id,
    )


async def unread_count(conn: Connection, me: uuid.UUID) -> int:
    """Unread handoffs that are not resolved: the inbox's own unread rule."""
    count: int = await conn.fetchval(
        """
        select count(*) from escalations e
        left join escalation_reads r on r.escalation_id = e.id and r.user_id = $1
        where e.status <> 'resolved' and (r.read_at is null or r.read_at < e.updated_at)
        """,
        me,
    )
    return count


async def touch(conn: Connection, escalation_id: uuid.UUID) -> None:
    await conn.execute("update escalations set updated_at = now() where id = $1", escalation_id)


async def messages(conn: Connection, conversation_id: uuid.UUID) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        select m.id, m.role, m.content, m.decision, m.created_at, m.flagged_wrong, m.flag_reason,
               m.flagged_at, fu.name as flagged_by_name, m.author_user_id, au.name as author_name,
               f.vote, f.comment as feedback_comment, f.updated_at as voted_at,
               coalesce(json_agg(json_build_object(
                 'marker', c.marker, 'document_title', c.document_title,
                 'heading_path', c.heading_path, 'url', c.url, 'excerpt', c.excerpt
               ) order by c.marker) filter (where c.id is not null), '[]') as citations
        from messages m
        left join message_citations c on c.message_id = m.id
        left join users au on au.id = m.author_user_id
        left join users fu on fu.id = m.flagged_by
        left join message_feedback f on f.message_id = m.id
        where m.conversation_id = $1
        group by m.id, au.name, fu.name, f.id
        order by m.created_at, m.id
        """,
        conversation_id,
    )


async def deliveries(conn: Connection, escalation_id: uuid.UUID) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        select id, kind, message_id, to_hint, subject, status, attempts, last_error, created_at,
               sent_at
        from email_deliveries where escalation_id = $1 order by created_at
        """,
        escalation_id,
    )


async def notes(conn: Connection, escalation_id: uuid.UUID) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        select n.id, n.body, n.author_user_id, u.name as author_name, n.created_at
        from escalation_notes n left join users u on u.id = n.author_user_id
        where n.escalation_id = $1 order by n.created_at, n.id
        """,
        escalation_id,
    )


async def history(conn: Connection, escalation_id: uuid.UUID) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        select a.id, a.action, a.metadata, a.created_at, u.name as actor_name
        from audit_log a left join users u on u.id = a.actor_user_id
        where a.target_type = 'escalation' and a.target_id = $1
        order by a.created_at, a.id
        """,
        str(escalation_id),
    )
