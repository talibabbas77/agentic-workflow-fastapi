"""Background job: write the handoff note for an escalation, then route it.

Picks the ticket type whose description fits, fills only that type's fields,
and summarizes the conversation for the person who picks it up. With the
ticket type known, the routing rules run and the team is notified. If the
model keeps failing, the last attempt routes the handoff without a summary, so
nobody misses it.
"""

import uuid

from docent.agent import prompts, repo, usage
from docent.agent.loop import SUMMARIZE_ESCALATION
from docent.agent.prompts import EscalationBrief
from docent.config import Settings
from docent.db.pool import transaction
from docent.inbox import routing
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


def make_escalation_handlers(
    llm: ChatModel, settings: Settings, max_tokens: int = 600
) -> dict[str, Handler]:
    async def summarize_escalation(ctx: JobContext) -> None:
        escalation_id = uuid.UUID(ctx.job.payload["escalation_id"])
        tenant_id = ctx.job.tenant_id
        assert tenant_id is not None
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

        try:
            brief = await llm.structured(
                prompts.summary_messages(transcript, escalation["claims"] or None, types),
                EscalationBrief,
                name="escalation_brief",
                max_tokens=max_tokens,
            )
        except Exception:
            if ctx.job.attempts >= ctx.job.max_attempts:
                async with transaction(ctx.pool, tenant_id=tenant_id) as conn:
                    await routing.route(
                        conn, tenant_id=tenant_id, escalation_id=escalation_id, settings=settings
                    )
            raise
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
                update escalations set summary = $2, fields = $3, ticket_type_id = $4,
                                   updated_at = now()
                where id = $1 and summary is null
                """,
                escalation_id,
                summary,
                fields,
                chosen["id"] if chosen else None,
            )
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
            await routing.route(
                conn, tenant_id=tenant_id, escalation_id=escalation_id, settings=settings
            )

    return {SUMMARIZE_ESCALATION: summarize_escalation}
