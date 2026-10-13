"""Embedding vectors for passages and search queries.

Ollama serves the model in every environment, so document and query vectors
always come from the same weights. embeddinggemma expects task prefixes, which
are applied here and nowhere else.
"""

from typing import Protocol

import httpx


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


def to_pgvector(vector: list[float]) -> str:
    """Text form accepted by a ::halfvec cast."""
    return "[" + ",".join(f"{x:.6g}" for x in vector) + "]"
