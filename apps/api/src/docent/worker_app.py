"""Worker process: the job loop plus a tiny private HTTP endpoint the API uses to wake it."""

import asyncio
import contextlib
import hmac
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header
from fastapi.responses import JSONResponse

from docent.config import Settings, get_settings
from docent.db.pool import create_pool
from docent.email.sender import SmtpEmailSender
from docent.jobs.handlers import make_handlers
from docent.jobs.worker import Worker
from docent.log import configure_logging


def create_worker_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)
    expected = settings.internal_token.get_secret_value()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        pool = await create_pool(settings.worker_database_url, min_size=1, max_size=4)
        worker = Worker(
            pool,
            make_handlers(SmtpEmailSender(settings)),
            idle_poll_seconds=settings.job_idle_poll_seconds,
            lease_seconds=settings.job_lease_seconds,
        )
        app.state.worker = worker
        task = asyncio.create_task(worker.run_forever())
        try:
            yield
        finally:
            worker.stop()
            with contextlib.suppress(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=30)
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
