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
