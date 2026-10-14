"""Health check. Never sends a Redis command: that would spend the monthly budget.

redis is ok, degraded (failing, circuit open), disabled (not configured), or
local_only (the monthly command budget is nearly spent, so the app stopped using
it until the month ends). Only degraded makes the whole check degraded:
local_only is the app working as designed.
"""

import asyncio

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from docent.api.deps import State
from docent.api.schemas import HealthOut

router = APIRouter(tags=["health"])


@router.get("/healthz", response_model=HealthOut)
async def healthz(state: State) -> JSONResponse:
    db = "ok"
    try:
        async with asyncio.timeout(2):
            async with state.pool.acquire() as conn:
                await conn.fetchval("select 1")
    except Exception:
        db = "down"
    body = HealthOut(
        status="ok" if db == "ok" and state.redis.status() != "degraded" else "degraded",
        db=db,  # type: ignore[arg-type]
        redis=state.redis.status(),
        version=state.settings.version,
    )
    return JSONResponse(body.model_dump(), status_code=200 if db == "ok" else 503)
