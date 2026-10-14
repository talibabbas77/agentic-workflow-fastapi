"""Worker process: the job loop plus a tiny private HTTP endpoint the API uses to wake it."""

import asyncio
import contextlib
import hmac
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Header
from fastapi.responses import JSONResponse

from docent.agent.escalation import make_escalation_handlers
from docent.config import Settings, get_settings
from docent.db.pool import create_pool
from docent.email.sender import SmtpEmailSender
from docent.inbox.jobs import inbox_schedules, make_inbox_handlers
from docent.inbox.outbound import OutboundDeps
from docent.jobs.handlers import make_handlers
from docent.jobs.worker import Lane, Worker
from docent.knowledge.embeddings import OllamaEmbedder
from docent.knowledge.fetch import guarded_client
from docent.knowledge.pipeline import KnowledgeDeps, make_knowledge_handlers
from docent.llm.client import chat_model
from docent.log import configure_logging
from docent.memory.customers import make_memory_handlers
from docent.security.secretbox import SecretBox
from docent.storage import ObjectStore


def create_worker_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)
    expected = settings.internal_token.get_secret_value()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        pool = await create_pool(settings.worker_database_url, min_size=1, max_size=4)
        ollama = httpx.AsyncClient()
        crawler = guarded_client(
            user_agent=settings.crawl_user_agent,
            timeout=settings.crawl_timeout_seconds,
            allow_private=settings.crawl_allow_private,
        )
        knowledge = KnowledgeDeps(
            settings=settings,
            store=ObjectStore.from_url(settings.object_store),
            embedder=OllamaEmbedder(
                ollama,
                settings.ollama_base_url,
                settings.embedding_model,
                settings.embedding_dims,
                timeout=settings.embedding_timeout_seconds,
            ),
            http=crawler,
        )
        # Slack and webhook calls go to tenant URLs: the same guard as crawling.
        outbound = guarded_client(
            user_agent="Docent-Webhooks/1.0",
            timeout=10.0,
            allow_private=settings.crawl_allow_private,
        )
        summarizer = chat_model(settings, ollama, settings.llm_summary_model or settings.llm_model)
        io = (
            make_handlers(SmtpEmailSender(settings))
            | make_escalation_handlers(summarizer, settings)
            | make_memory_handlers(summarizer)
            | make_inbox_handlers(
                OutboundDeps(
                    settings=settings,
                    box=SecretBox(settings.secret_key.get_secret_value()),
                    http=outbound,
                )
            )
        )
        ingest = make_knowledge_handlers(knowledge)
        worker = Worker(
            pool,
            io | ingest,
            lanes=[
                Lane("io", tuple(io), settings.job_io_slots),
                Lane("ingest", tuple(ingest), settings.job_ingest_slots),
            ],
            idle_poll_seconds=settings.job_idle_poll_seconds,
            lease_seconds=settings.job_lease_seconds,
            schedules=inbox_schedules(),
        )
        app.state.worker = worker
        task = asyncio.create_task(worker.run_forever())
        try:
            yield
        finally:
            worker.stop()
            with contextlib.suppress(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=30)
            await crawler.aclose()
            await outbound.aclose()
            await ollama.aclose()
            await pool.close()

    app = FastAPI(title="Docent worker", lifespan=lifespan, docs_url=None, openapi_url=None)

    @app.post("/internal/wake", status_code=202)
    async def wake(x_internal_token: str = Header(default="")) -> JSONResponse:
        if not hmac.compare_digest(x_internal_token, expected):
            return JSONResponse({"error": {"code": "forbidden"}}, status_code=403)
        app.state.worker.wake()
        return JSONResponse({"ok": True}, status_code=202)

    @app.get("/healthz")
    async def healthz() -> dict[str, object]:
        return {"status": "ok", "processed": app.state.worker.processed}

    return app
