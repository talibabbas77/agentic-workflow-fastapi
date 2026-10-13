"""Golden corpus loading and throwaway tenants for evaluations.

`ingested()` creates one tenant per company, uploads its documents through the
real pipeline and embedding model, and removes everything afterwards.
"""

import json
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from docent.config import Settings
from docent.db.pool import Pool, create_pool, set_context, transaction
from docent.jobs import queue
from docent.jobs.worker import Worker
from docent.knowledge import repo
from docent.knowledge.embeddings import OllamaEmbedder
from docent.knowledge.fetch import guarded_client
from docent.knowledge.pipeline import SYNC_SOURCE, KnowledgeDeps, make_knowledge_handlers
from docent.security.passwords import hash_password
from docent.services import accounts, tenants
from docent.storage import ObjectStore


@dataclass(frozen=True)
class Company:
    name: str
    spec: dict[str, Any]
    documents: list[tuple[str, bytes]]


def load_corpus(fixtures: Path) -> list[Company]:
    return [
        Company(
            name=folder.name,
            spec=json.loads((folder / "questions.json").read_text()),
            documents=[(p.name, p.read_bytes()) for p in sorted(folder.glob("*.md"))],
        )
        for folder in sorted(fixtures.iterdir())
        if (folder / "questions.json").is_file()
    ]


@dataclass
class Ingested:
    pool: Pool
    embedder: OllamaEmbedder
    http: httpx.AsyncClient
    tenant_ids: dict[str, uuid.UUID] = field(default_factory=dict)
    embedding_seconds: float = 0.0


@asynccontextmanager
async def ingested(settings: Settings, companies: list[Company]) -> AsyncIterator[Ingested]:
    app_pool = await create_pool(settings.database_url, max_size=4)
    worker_pool = await create_pool(settings.worker_database_url, max_size=4)
    store = ObjectStore.from_url("memory://")
    async with httpx.AsyncClient() as http, guarded_client(user_agent="eval", timeout=5) as crawler:
        embedder = OllamaEmbedder(
            http,
            settings.ollama_base_url,
            settings.embedding_model,
            settings.embedding_dims,
            settings.embedding_timeout_seconds,
        )
        deps = KnowledgeDeps(settings=settings, store=store, embedder=embedder, http=crawler)
        worker = Worker(
            worker_pool, make_knowledge_handlers(deps), idle_poll_seconds=60, lease_seconds=600
        )
        owner_id = await _eval_user(app_pool)
        result = Ingested(pool=app_pool, embedder=embedder, http=http)
        try:
            for company in companies:
                result.tenant_ids[company.name] = await _ingest(app_pool, store, owner_id, company)
            started = time.perf_counter()
            await worker.drain()
            result.embedding_seconds = time.perf_counter() - started
            yield result
        finally:
            await _cleanup(app_pool, owner_id, list(result.tenant_ids.values()))
            await app_pool.close()
            await worker_pool.close()


async def _eval_user(pool: Pool) -> uuid.UUID:
    async with transaction(pool) as conn:
        return await accounts.create_user(
            conn,
            email=f"eval-{uuid.uuid4().hex[:12]}@docent.invalid",
            name="Evaluation",
            password_hash=await hash_password(uuid.uuid4().hex),
            verified=True,
        )


async def _ingest(
    pool: Pool, store: ObjectStore, owner_id: uuid.UUID, company: Company
) -> uuid.UUID:
    identified = set(company.spec.get("identified_only", []))
    async with transaction(pool) as conn:
        tenant_id = await tenants.create_tenant(
            conn, name=f"Eval {company.name}", owner_id=owner_id
        )
        for filename, data in company.documents:
            source_id = await repo.create_source(
                conn,
                tenant_id=tenant_id,
                kind="upload",
                title=filename.removesuffix(".md"),
                uri=filename,
                audience="identified" if filename in identified else "public",
                page_limit=1,
                created_by=owner_id,
            )
            key = f"{tenant_id}/{source_id}/{filename}"
            await store.put(key, data)
            await repo.create_document(
                conn,
                tenant_id=tenant_id,
                source_id=source_id,
                locator=filename,
                title=filename.removesuffix(".md"),
                url=None,
                mime="text/markdown",
                object_key=key,
            )
            await queue.enqueue(
                conn, SYNC_SOURCE, {"source_id": str(source_id)}, tenant_id=tenant_id
            )
    return tenant_id


async def _cleanup(pool: Pool, owner_id: uuid.UUID, tenant_ids: list[uuid.UUID]) -> None:
    async with transaction(pool) as conn:
        for tenant_id in tenant_ids:
            await set_context(conn, tenant_id=tenant_id)
            await conn.execute("delete from tenants where id = $1", tenant_id)
        await set_context(conn)
        await conn.execute("delete from users where id = $1", owner_id)
