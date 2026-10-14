"""Test doubles."""

import hashlib
import html
import math
import re
import uuid
from datetime import datetime
from typing import Any

from docent.billing.gateway import verify_event
from docent.billing.plans import Plan, TopupPack
from docent.knowledge.embeddings import EmbeddingError

DIMS = 768
_WORD = re.compile(r"[a-z0-9]+")


class FakeEmbedder:
    """Deterministic bag-of-words vectors: texts sharing words point the same way."""

    model = "fake-embedding"

    def __init__(self) -> None:
        self.calls = 0
        self.query_calls = 0
        self.fail_after: int | None = None
        self.fail_queries = False

    async def embed_documents(self, items: list[tuple[str, str]]) -> list[list[float]]:
        self.calls += 1
        if self.fail_after is not None and self.calls > self.fail_after:
            raise EmbeddingError("embedding service unavailable")
        return [_vector(f"{title} {text}") for title, text in items]

    async def embed_query(self, text: str) -> list[float]:
        self.query_calls += 1
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


_PASSAGE = re.compile(r'<passage heading="([^"]*)">(.*)</passage>', re.S)


def _draft(messages: list[dict[str, str]]) -> dict[str, object]:
    """A draft whose answer is the passage's own first words, so it is grounded."""
    found = _PASSAGE.search(messages[-1]["content"])
    heading = html.unescape(found.group(1)) if found else ""
    passage = html.unescape(found.group(2)) if found else ""
    words = passage.split()
    topic = heading.split(" > ")[-1] if heading else "this"
    return {
        "usable": bool(words),
        "question": f"What should I know about {topic}?",
        "answer": " ".join(words[:20]),
    }


def _default(messages: list[dict[str, str]], name: str) -> dict[str, object]:
    if name == "customer_memory":
        return {"facts": []}
    if name == "eval_judgment":
        return {"verdict": "correct", "reason": "Matches the gold passage."}
    if name == "eval_draft":
        return _draft(messages)
    if name == "triage":
        return {"intent": "product_question", "language": "en", "clarifying_question": None}
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


class FakeBilling:
    """Stripe without the network: records requests, verifies webhooks for real."""

    webhook_secret = "whsec_test_secret"

    def __init__(self) -> None:
        self.customers: list[dict[str, object]] = []
        self.checkouts: list[dict[str, object]] = []
        self.calls: list[tuple[str, str]] = []

    async def create_customer(self, *, tenant_id: uuid.UUID, name: str, email: str) -> str:
        self.customers.append({"tenant_id": tenant_id, "name": name, "email": email})
        return f"cus_test{len(self.customers)}"

    async def checkout_url(
        self,
        *,
        customer_id: str,
        tenant_id: uuid.UUID,
        plan: Plan,
        success_url: str,
        cancel_url: str,
    ) -> str:
        self.checkouts.append({"customer_id": customer_id, "plan": plan.id})
        return f"https://checkout.stripe.test/c/{len(self.checkouts)}"

    async def topup_checkout_url(
        self,
        *,
        customer_id: str,
        metadata: dict[str, str],
        pack: TopupPack,
        success_url: str,
        cancel_url: str,
    ) -> str:
        self.checkouts.append(
            {"customer_id": customer_id, "pack": pack.id, "metadata": metadata, "mode": "payment"}
        )
        return f"https://checkout.stripe.test/c/{len(self.checkouts)}"

    async def portal_url(self, *, customer_id: str, return_url: str) -> str:
        return f"https://billing.stripe.test/p/{customer_id}"

    def verify_event(self, payload: bytes, signature: str) -> dict[str, Any]:
        return verify_event(payload, signature, self.webhook_secret)

    async def preview_upgrade(self, *, customer_id: str, subscription_id: str, plan: Plan) -> int:
        return 3500

    async def upgrade(self, *, subscription_id: str, plan: Plan) -> None:
        self.calls.append(("upgrade", plan.id))

    async def schedule_downgrade(self, *, subscription_id: str, plan: Plan) -> str:
        self.calls.append(("schedule_downgrade", plan.id))
        return "sub_sched_test"

    async def release_schedule(self, *, schedule_id: str) -> None:
        self.calls.append(("release_schedule", schedule_id))

    async def set_cancel_at_period_end(self, *, subscription_id: str, cancel: bool) -> None:
        self.calls.append(("cancel_at_period_end", str(cancel)))

    async def refundable_cents(self, *, customer_id: str, since: datetime) -> int:
        return 9900

    async def refund_and_cancel(
        self, *, customer_id: str, subscription_id: str, since: datetime
    ) -> int:
        self.calls.append(("refund_and_cancel", customer_id))
        return 9900
