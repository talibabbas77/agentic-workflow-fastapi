"""Agent turns as Server-Sent Events, detached from the HTTP connection.

The turn runs in its own task and the response only relays its events, so a
visitor who closes the tab, or a proxy that drops the stream, never loses the
reply: it is stored either way and appears when the conversation is reloaded.
A comment line every 15 seconds keeps proxies from closing a quiet stream while
the model writes, and `no-transform` stops them from compressing it, which would
hold every event back until the end.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi.responses import StreamingResponse

from docent.agent.loop import AgentDeps, ConversationNotFound, Progress, run_turn
from docent.api.schemas import MessageOut

log = logging.getLogger(__name__)

HEARTBEAT_SECONDS = 15.0

# Turns still running in this process, so shutdown can let them finish.
_turns: set[asyncio.Task[None]] = set()


def stream_turn(
    deps: AgentDeps, tenant_id: uuid.UUID, conversation_id: uuid.UUID, text: str
) -> StreamingResponse:
    events: asyncio.Queue[str | None] = asyncio.Queue()
    task = asyncio.create_task(_run(deps, tenant_id, conversation_id, text, events))
    _turns.add(task)
    task.add_done_callback(_turns.discard)
    return StreamingResponse(
        _relay(events, HEARTBEAT_SECONDS),
        media_type="text/event-stream",
        headers={"cache-control": "no-store, no-transform", "x-accel-buffering": "no"},
    )


async def drain() -> None:
    """Wait for turns in flight to store their replies. Cancelling the wait leaves them be."""
    if _turns:
        await asyncio.wait(_turns)


async def _run(
    deps: AgentDeps,
    tenant_id: uuid.UUID,
    conversation_id: uuid.UUID,
    text: str,
    events: asyncio.Queue[str | None],
) -> None:
    try:
        async for event in run_turn(
            deps, tenant_id=tenant_id, conversation_id=conversation_id, text=text
        ):
            if isinstance(event, Progress):
                events.put_nowait(_sse("status", {"stage": event.stage}))
            else:
                message = MessageOut(**event.message).model_dump(mode="json")
                events.put_nowait(_sse("message", message))
    except ConversationNotFound:
        events.put_nowait(
            _sse("error", {"code": "not_found", "message": "Conversation not found."})
        )
    except Exception:
        log.exception("agent turn failed")
        events.put_nowait(
            _sse("error", {"code": "agent_error", "message": "The agent could not reply."})
        )
    finally:
        events.put_nowait(None)


async def _relay(events: asyncio.Queue[str | None], heartbeat: float) -> AsyncIterator[str]:
    while True:
        try:
            item = await asyncio.wait_for(events.get(), heartbeat)
        except TimeoutError:
            yield ": keepalive\n\n"
            continue
        if item is None:
            return
        yield item


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"
