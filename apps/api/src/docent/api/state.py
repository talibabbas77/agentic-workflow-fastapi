"""Process-wide resources, created in the app lifespan."""

from dataclasses import dataclass

import httpx

from docent.config import Settings
from docent.db.pool import Pool
from docent.jobs.wake import WorkerWaker
from docent.redis_hub import RedisHub
from docent.security.ratelimit import RateLimiter


@dataclass(slots=True)
class AppState:
    settings: Settings
    pool: Pool
    redis: RedisHub
    limiter: RateLimiter
    http: httpx.AsyncClient
    waker: WorkerWaker
