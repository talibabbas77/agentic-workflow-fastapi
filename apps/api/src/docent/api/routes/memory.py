"""What the agent remembers: team answers, knowledge gaps, and customer memory.

Everyone in a workspace can look; admins and owners change it.
"""

import uuid

from fastapi import APIRouter, status

from docent.api.deps import AdminMember, CurrentMember, Member, State
from docent.api.errors import not_found
from docent.api.plan_limits import check_limit
from docent.api.schemas import (
    CitedSectionOut,
    CustomerFactOut,
    ErrorOut,
    GapDismissIn,
    GapGroupOut,
    MemoryOverviewOut,
    MemorySourceOut,
    RememberedCustomerDetailOut,
    RememberedCustomerOut,
    TeamAnswerIn,
    TeamAnswerOut,
)
from docent.db.pool import Connection, transaction
from docent.memory import answers, gaps
from docent.services import audit

router = APIRouter(
    prefix="/v1/memory",
    tags=["memory"],
    responses={403: {"model": ErrorOut}, 404: {"model": ErrorOut}, 422: {"model": ErrorOut}},
)

_CITED_30D = """
    select d.source_id, count(*) as citations
    from message_citations mc
    join messages m on m.id = mc.message_id and m.created_at > now() - interval '30 days'
    join chunks c on c.id = mc.chunk_id
    join documents d on d.id = c.document_id
    group by d.source_id
"""


@router.get("")
async def overview(member: CurrentMember, state: State) -> MemoryOverviewOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        sources = await conn.fetch(
            f"""
            with cited as ({_CITED_30D})
            select s.id, s.title, s.kind, s.status, s.document_count as documents,
                   s.chunk_count as chunks, coalesce(cited.citations, 0) as citations_30d
            from knowledge_sources s left join cited on cited.source_id = s.id
            where s.kind <> 'answer' and s.status <> 'deleting'
            order by citations_30d desc, s.created_at
            """  # noqa: S608
        )
        sections = await conn.fetch(
            """
            select mc.document_title, mc.heading_path, count(*) as citations
            from message_citations mc
            join messages m on m.id = mc.message_id and m.created_at > now() - interval '30 days'
            group by mc.document_title, mc.heading_path
            order by citations desc limit 10
            """
        )
        counts = await conn.fetchrow(
            """
            select
              (select coalesce(max(version), 0) from knowledge_versions) as version,
              (select count(*) from team_answers) as team_answers,
              (select count(*) from knowledge_gaps
               where answered_by is null and dismissed_at is null) as open_gaps,
              (select count(distinct end_user_id) from customer_memories
               where expires_at > now()) as customers,
              (select count(*) from customer_memories where expires_at > now()) as facts,
              (select count(*) from messages where role = 'agent'
                 and decision ->> 'type' = 'answer'
                 and created_at > now() - interval '30 days') as answers,
              (select count(*) from escalations
               where created_at > now() - interval '30 days') as handoffs
            """
        )
    assert counts is not None
    return MemoryOverviewOut(
        knowledge_version=counts["version"],
        sources=[MemorySourceOut(**dict(r)) for r in sources],
        top_sections=[CitedSectionOut(**dict(r)) for r in sections],
        team_answers=counts["team_answers"],
        open_gaps=counts["open_gaps"],
        customers_remembered=counts["customers"],
        customer_facts=counts["facts"],
        answers_30d=counts["answers"],
        handoffs_30d=counts["handoffs"],
    )


@router.get("/answers")
async def list_answers(member: CurrentMember, state: State) -> list[TeamAnswerOut]:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        return await _answers(conn)


@router.post("/answers", status_code=status.HTTP_201_CREATED)
async def create_answer(body: TeamAnswerIn, member: AdminMember, state: State) -> TeamAnswerOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await check_limit(conn, member.tenant_id, "documents")
        answer_id = await answers.create(
            conn,
            state.store,
            tenant_id=member.tenant_id,
            user_id=member.user_id,
            question=body.question,
            answer=body.answer,
            audience=body.audience,
        )
        closed = await gaps.close(conn, body.gap_ids, answered_by=answer_id) if body.gap_ids else 0
        await _audit(conn, member, "memory.answer_created", answer_id, {"gaps": str(closed)})
        created = await _answers(conn, answer_id)
    await state.waker.wake()
    return created[0]


@router.put("/answers/{answer_id}")
async def update_answer(
    answer_id: uuid.UUID, body: TeamAnswerIn, member: AdminMember, state: State
) -> TeamAnswerOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        found = await answers.update(
            conn,
            state.store,
            tenant_id=member.tenant_id,
            answer_id=answer_id,
            question=body.question,
            answer=body.answer,
            audience=body.audience,
        )
        if not found:
            raise not_found("Answer")
        if body.gap_ids:
            await gaps.close(conn, body.gap_ids, answered_by=answer_id)
        await _audit(conn, member, "memory.answer_updated", answer_id)
        updated = await _answers(conn, answer_id)
    await state.waker.wake()
    return updated[0]


@router.delete("/answers/{answer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_answer(answer_id: uuid.UUID, member: AdminMember, state: State) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        if not await answers.delete(conn, tenant_id=member.tenant_id, answer_id=answer_id):
            raise not_found("Answer")
        await _audit(conn, member, "memory.answer_deleted", answer_id)
    await state.waker.wake()


@router.get("/gaps")
async def list_gaps(member: CurrentMember, state: State) -> list[GapGroupOut]:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        groups = await gaps.open_groups(conn)
    return [
        GapGroupOut(
            ids=g.ids,
            question=g.question,
            count=g.count,
            examples=g.examples,
            last_asked_at=g.last_asked_at,
        )
        for g in groups
    ]


@router.post("/gaps/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_gaps(body: GapDismissIn, member: AdminMember, state: State) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await gaps.close(conn, body.ids, answered_by=None)


@router.get("/customers")
async def list_customers(member: CurrentMember, state: State) -> list[RememberedCustomerOut]:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        rows = await conn.fetch(f"{_CUSTOMERS} order by max(m.created_at) desc limit 200")
    return [RememberedCustomerOut(**dict(r)) for r in rows]


@router.get("/customers/{end_user_id}")
async def get_customer(
    end_user_id: uuid.UUID, member: CurrentMember, state: State
) -> RememberedCustomerDetailOut:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        row = await conn.fetchrow(f"{_CUSTOMERS} having u.id = $1", end_user_id)
        if row is None:
            raise not_found("Customer memory")
        facts = await conn.fetch(
            """
            select id, fact, kind, created_at, expires_at from customer_memories
            where end_user_id = $1 and expires_at > now() order by created_at desc
            """,
            end_user_id,
        )
    return RememberedCustomerDetailOut(
        customer=RememberedCustomerOut(**dict(row)),
        facts=[CustomerFactOut(**dict(f)) for f in facts],
    )


@router.delete("/customers/{end_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def forget_customer(end_user_id: uuid.UUID, member: AdminMember, state: State) -> None:
    """Make the agent forget everything it remembered about this customer."""
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        await conn.execute("delete from customer_memories where end_user_id = $1", end_user_id)
        await _audit(conn, member, "memory.customer_forgotten", end_user_id)


@router.delete("/customers/{end_user_id}/facts/{fact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def forget_fact(
    end_user_id: uuid.UUID, fact_id: uuid.UUID, member: AdminMember, state: State
) -> None:
    async with transaction(state.pool, tenant_id=member.tenant_id) as conn:
        deleted = await conn.execute(
            "delete from customer_memories where id = $1 and end_user_id = $2",
            fact_id,
            end_user_id,
        )
        if deleted.endswith(" 0"):
            raise not_found("Fact")


_CUSTOMERS = """
    select u.id, u.name, u.email, u.last_seen_at, count(m.id) as facts,
           (select count(*) from conversations c where c.end_user_id = u.id) as conversations
    from end_users u
    join customer_memories m on m.end_user_id = u.id and m.expires_at > now()
    group by u.id
"""


async def _answers(conn: Connection, answer_id: uuid.UUID | None = None) -> list[TeamAnswerOut]:
    rows = await conn.fetch(
        f"""
        with cited as ({_CITED_30D})
        select a.id, a.question, a.answer, s.audience, s.status, a.created_at, a.updated_at,
               coalesce(cited.citations, 0) as citations_30d, u.name as created_by_name
        from team_answers a
        join knowledge_sources s on s.id = a.source_id
        left join cited on cited.source_id = a.source_id
        left join users u on u.id = a.created_by
        where s.status <> 'deleting' and ($1::uuid is null or a.id = $1)
        order by a.updated_at desc
        """,  # noqa: S608
        answer_id,
    )
    return [TeamAnswerOut(**dict(r)) for r in rows]


async def _audit(
    conn: Connection,
    member: Member,
    action: str,
    target_id: uuid.UUID,
    metadata: dict[str, str] | None = None,
) -> None:
    await audit.record(
        conn,
        tenant_id=member.tenant_id,
        actor_user_id=member.user_id,
        action=action,
        target_type="memory",
        target_id=target_id,
        metadata=metadata,
    )
