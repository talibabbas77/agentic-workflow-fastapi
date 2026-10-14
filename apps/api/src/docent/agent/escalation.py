"""Background job: write the handoff note for an escalation.

Picks the ticket type whose description fits, fills only that type's fields,
and summarizes the conversation for the person who picks it up.
"""

import uuid

from docent.agent import prompts, repo, usage
from docent.agent.loop import SUMMARIZE_ESCALATION
from docent.agent.prompts import EscalationBrief
from docent.db.pool import transaction
from docent.jobs.worker import Handler, JobContext
from docent.llm.client import ChatModel

# Values a model writes when it has nothing to say. A missing field is better.
PLACEHOLDERS = frozenset(
    {
        "",
        "-",
        "n/a",
        "na",
        "none",
        "null",
        "unknown",
        "not provided",
        "not specified",
        "unspecified",
        "anonymous",
        "anonymous visitor",
        "not available",
    }
)


def make_escalation_handlers(llm: ChatModel, max_tokens: int = 600) -> dict[str, Handler]:
    async def summarize_escalation(ctx: JobContext) -> None:
        escalation_id = uuid.UUID(ctx.job.payload["escalation_id"])
        tenant_id = ctx.job.tenant_id
        async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
            escalation = await conn.fetchrow(
                """
                select e.id, e.conversation_id, e.summary, c.claims
                from escalations e join conversations c on c.id = e.conversation_id
                where e.id = $1
                """,
                escalation_id,
            )
            if escalation is None or escalation["summary"] is not None:
                return  # gone, or already written by an earlier attempt
            transcript = await repo.recent_turns(conn, escalation["conversation_id"], 20)
            types = [dict(t) for t in await repo.active_ticket_types(conn)]

        brief = await llm.structured(
            prompts.summary_messages(transcript, escalation["claims"] or None, types),
            EscalationBrief,
            name="escalation_brief",
            max_tokens=max_tokens,
        )
        chosen = next(
            (
                t
                for t in types
                if brief.value.ticket_type and t["name"].lower() == brief.value.ticket_type.lower()
            ),
            None,
        )
        allowed = {f["key"] for f in chosen["fields"]} if chosen else set()
        fields = {
            f.key: f.value.strip()[:500]
            for f in brief.value.fields
            if f.key in allowed and f.value.strip().casefold() not in PLACEHOLDERS
        }
        summary = brief.value.model_dump(exclude={"ticket_type", "fields"})

        async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
            await conn.execute(
                """
                update escalations set summary = $2, fields = $3, ticket_type_id = $4
                where id = $1 and summary is null
                """,
                escalation_id,
                summary,
                fields,
                chosen["id"] if chosen else None,
            )
            assert tenant_id is not None
            await usage.record(
                conn,
                tenant_id=tenant_id,
                kind="llm_call",
                idempotency_key=f"summary:{escalation_id}",
                model=brief.model,
                tokens_in=brief.tokens_in,
                tokens_out=brief.tokens_out,
                conversation_id=escalation["conversation_id"],
            )

    return {SUMMARIZE_ESCALATION: summarize_escalation}
