"""Answers to repeated first questions from anonymous visitors.

Many visitors open the widget and ask the same thing in the same words. For an
anonymous visitor's first message (public sources only, no history, no claims,
no memory), the checked answer depends only on the question and on what the
agent can find, so it is kept for a day under a key that includes the tenant's
knowledge version and the prompt version. Teaching the agent anything, changing
a source, or changing how it speaks bumps the version, so a stale answer is
never served.

Only high-confidence, cited answers are kept. A cached answer skips the search
and the model, but is still stored, cited, and counted like any other reply.
"""

import hashlib
import json
import uuid
from dataclasses import asdict
from typing import Any

from docent.agent.prompts import ANSWER_PROMPT_VERSION
from docent.cache import TieredCache
from docent.knowledge.search import Hit

TTL_SECONDS = 86400


def cache_key(tenant_id: uuid.UUID, knowledge_version: int, text: str) -> str:
    normalized = " ".join(text.casefold().split())
    digest = hashlib.sha256(f"{ANSWER_PROMPT_VERSION}|{normalized}".encode()).hexdigest()[:40]
    return f"{tenant_id}:{knowledge_version}:{digest}"


async def lookup(cache: TieredCache, key: str) -> tuple[str, str, list[tuple[int, Hit]]] | None:
    """The cached answer text, its confidence, and its cited passages."""
    raw = await cache.get("ans", key)
    if raw is None:
        return None
    data = json.loads(raw)
    cited = [(int(n), _hit(h)) for n, h in data["cited"]]
    return data["text"], data["confidence"], cited


async def store(
    cache: TieredCache, key: str, text: str, confidence: str | None, cited: list[tuple[int, Hit]]
) -> None:
    if confidence != "high" or not cited:
        return
    payload = {"text": text, "confidence": confidence, "cited": [(n, asdict(h)) for n, h in cited]}
    await cache.set("ans", key, json.dumps(payload, default=str).encode(), TTL_SECONDS)


def _hit(data: dict[str, Any]) -> Hit:
    return Hit(
        chunk_id=uuid.UUID(data["chunk_id"]),
        document_id=uuid.UUID(data["document_id"]),
        source_id=uuid.UUID(data["source_id"]),
        document_title=data["document_title"],
        url=data["url"],
        heading_path=data["heading_path"],
        content=data["content"],
        page=data["page"],
        score=data["score"],
        similarity=data["similarity"],
        keyword_rank=data["keyword_rank"],
    )
