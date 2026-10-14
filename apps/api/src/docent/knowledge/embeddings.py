"""Embedding vectors for passages and search queries.

Ollama serves the model in every environment, so document and query vectors
always come from the same weights. embeddinggemma expects task prefixes, which
are applied here and nowhere else.
"""

import hashlib
import struct
from typing import Protocol

import httpx

from docent.cache import TieredCache


class EmbeddingError(Exception):
    pass


class Embedder(Protocol):
    model: str

    async def embed_documents(self, items: list[tuple[str, str]]) -> list[list[float]]:
        """Embed (title, text) pairs."""
        ...

    async def embed_query(self, text: str) -> list[float]: ...


class OllamaEmbedder:
    def __init__(
        self, client: httpx.AsyncClient, base_url: str, model: str, dims: int, timeout: float
    ) -> None:
        self._client = client
        self._url = f"{base_url.rstrip('/')}/api/embed"
        self.model = model
        self._dims = dims
        self._timeout = timeout

    async def embed_documents(self, items: list[tuple[str, str]]) -> list[list[float]]:
        return await self._embed([f"title: {t or 'none'} | text: {x}" for t, x in items])

    async def embed_query(self, text: str) -> list[float]:
        (vector,) = await self._embed([f"task: search result | query: {text}"])
        return vector

    async def _embed(self, inputs: list[str]) -> list[list[float]]:
        try:
            response = await self._client.post(
                self._url,
                json={"model": self.model, "input": inputs, "truncate": True},
                timeout=self._timeout,
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise EmbeddingError(f"embedding request failed: {exc}") from exc
        vectors: list[list[float]] = response.json()["embeddings"]
        if len(vectors) != len(inputs) or any(len(v) != self._dims for v in vectors):
            raise EmbeddingError(f"expected {len(inputs)} vectors of {self._dims} dimensions")
        return vectors


class QueryCache:
    """Remembers query vectors. Customers ask the same things in the same words.

    Vectors go through the two-tier cache as float16 bytes (1.5 KB for 768
    dimensions, the same precision as the halfvec column they are compared
    with), so every API instance shares them and they survive a restart.
    """

    TTL_SECONDS = 30 * 86400

    def __init__(self, inner: Embedder, cache: TieredCache) -> None:
        self._inner = inner
        self._cache = cache
        self.model = inner.model

    async def embed_documents(self, items: list[tuple[str, str]]) -> list[list[float]]:
        return await self._inner.embed_documents(items)

    async def embed_query(self, text: str) -> list[float]:
        normalized = " ".join(text.lower().split())
        key = hashlib.sha256(f"{self.model}|{normalized}".encode()).hexdigest()[:40]

        async def fill() -> bytes:
            vector = await self._inner.embed_query(text)
            return struct.pack(f"<{len(vector)}e", *vector)

        packed = await self._cache.get_or_fill("emb", key, self.TTL_SECONDS, fill)
        assert packed is not None
        return list(struct.unpack(f"<{len(packed) // 2}e", packed))


def to_pgvector(vector: list[float]) -> str:
    """Text form accepted by a ::halfvec cast."""
    return "[" + ",".join(f"{x:.6g}" for x in vector) + "]"
