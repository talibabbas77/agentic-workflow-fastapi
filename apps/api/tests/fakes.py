"""Test doubles."""

import hashlib
import math
import re

from docent.knowledge.embeddings import EmbeddingError

DIMS = 768
_WORD = re.compile(r"[a-z0-9]+")


class FakeEmbedder:
    """Deterministic bag-of-words vectors: texts sharing words point the same way."""

    model = "fake-embedding"

    def __init__(self) -> None:
        self.calls = 0
        self.fail_after: int | None = None
        self.fail_queries = False

    async def embed_documents(self, items: list[tuple[str, str]]) -> list[list[float]]:
        self.calls += 1
        if self.fail_after is not None and self.calls > self.fail_after:
            raise EmbeddingError("embedding service unavailable")
        return [_vector(f"{title} {text}") for title, text in items]

    async def embed_query(self, text: str) -> list[float]:
        if self.fail_queries:
            raise EmbeddingError("embedding service unavailable")
        return _vector(text)


def _vector(text: str) -> list[float]:
    vector = [0.0] * DIMS
    for word in _WORD.findall(text.lower()):
        index = int.from_bytes(hashlib.blake2b(word.encode(), digest_size=4).digest()) % DIMS
        vector[index] += 1.0
    norm = math.sqrt(sum(x * x for x in vector)) or 1.0
    return [x / norm for x in vector]


class FakeChat:
    """Scripted chat model. Queue replies (dicts, models, or exceptions) or use the defaults:
    answer from the first source, and summarize into the first ticket type."""

    model = "fake-chat"

    def __init__(self) -> None:
        self.calls: list[list[dict[str, str]]] = []
        self.replies: list[object] = []

    async def structured(self, messages, schema, *, name, max_tokens):  # type: ignore[no-untyped-def]
        from docent.llm.client import Structured

        self.calls.append(messages)
        item = self.replies.pop(0) if self.replies else _default(messages, name)
        if isinstance(item, Exception):
            raise item
        value = item if isinstance(item, schema) else schema.model_validate(item)
        return Structured(value, self.model, 120, 30, 7, 1)


def _default(messages: list[dict[str, str]], name: str) -> dict[str, object]:
    if name == "agent_decision":
        return {
            "type": "answer",
            "answer": "Here is what our help center says [1].",
            "citations": [1],
            "account_facts": [],
            "confidence": "high",
            "escalation_reason": None,
        }
    match = re.search(r"- ([^:\n]+): ", messages[-1]["content"])
    return {
        "ticket_type": match.group(1) if match else None,
        "fields": [{"key": "order_id", "value": "A-1001"}, {"key": "unknown", "value": "x"}],
        "issue": "Customer asked for a person.",
        "tried": "Nothing yet.",
        "user_context": "Signed in.",
        "sentiment": "calm",
        "suggested_next_step": "Reply by email.",
    }
