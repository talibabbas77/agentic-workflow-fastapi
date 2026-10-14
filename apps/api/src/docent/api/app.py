"""FastAPI application factory."""

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.routing import APIRoute

from docent.api import streaming
from docent.api.errors import install_error_handlers
from docent.api.middleware import (
    BodySizeLimitMiddleware,
    OriginCheckMiddleware,
    RequestContextMiddleware,
)
from docent.api.routes import (
    agent,
    auth,
    billing,
    health,
    knowledge,
    members,
    memory,
    public,
    ticket_types,
    widget_api,
    widget_assets,
    widgets,
    workspace,
)
from docent.api.state import AppState
from docent.billing.gateway import stripe_gateway
from docent.cache import TieredCache
from docent.config import Settings, get_settings
from docent.db.pool import create_pool
from docent.jobs.wake import WorkerWaker
from docent.knowledge.embeddings import OllamaEmbedder, QueryCache
from docent.llm.client import chat_model
from docent.log import configure_logging
from docent.redis_hub import RedisHub
from docent.security.ratelimit import RateLimiter
from docent.storage import ObjectStore


def _operation_id(route: APIRoute) -> str:
    return route.name


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        pool = await create_pool(
            settings.database_url, min_size=settings.db_pool_min, max_size=settings.db_pool_max
        )
        redis = RedisHub(settings.redis_url, settings.redis_timeout_seconds)
        cache = TieredCache(redis, settings.redis_prefix)
        http = httpx.AsyncClient()
        app.state.docent = AppState(
            settings=settings,
            pool=pool,
            redis=redis,
            limiter=RateLimiter(redis, prefix=f"{settings.redis_prefix}:rl"),
            cache=cache,
            http=http,
            waker=WorkerWaker(
                http, settings.worker_url, settings.internal_token.get_secret_value()
            ),
            store=ObjectStore.from_url(settings.object_store),
            embedder=QueryCache(
                OllamaEmbedder(
                    http,
                    settings.ollama_base_url,
                    settings.embedding_model,
                    settings.embedding_dims,
                    timeout=15.0,  # a search query must not hang the request
                ),
                cache,
            ),
            llm=chat_model(settings, http, settings.llm_model),
            billing=stripe_gateway(settings),
        )
        try:
            yield
        finally:
            with contextlib.suppress(TimeoutError):
                async with asyncio.timeout(settings.llm_timeout_seconds):
                    await streaming.drain()
            await http.aclose()
            await redis.close()
            await pool.close()

    app = FastAPI(
        title="Docent API",
        version=settings.version,
        lifespan=lifespan,
        generate_unique_id_function=_operation_id,
        docs_url="/docs" if settings.env in ("local", "test") else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.env in ("local", "test") else None,
    )
    install_error_handlers(app)
    app.add_middleware(OriginCheckMiddleware, allowed_origins=settings.allowed_origins)
    app.add_middleware(
        BodySizeLimitMiddleware,
        max_bytes=settings.max_body_bytes,
        overrides={"/v1/knowledge/uploads": settings.max_upload_bytes + 100_000},
    )
    app.add_middleware(RequestContextMiddleware)
    for router in (
        health.router,
        auth.router,
        workspace.router,
        members.router,
        knowledge.router,
        agent.router,
        memory.router,
        ticket_types.router,
        widgets.router,
        widget_api.router,
        widget_assets.router,
        billing.router,
        billing.webhook_router,
        public.router,
    ):
        app.include_router(router)
    return app
