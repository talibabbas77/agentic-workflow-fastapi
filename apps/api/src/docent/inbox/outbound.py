"""What the worker needs to call tenant URLs (Slack, webhooks) safely."""

import re
from dataclasses import dataclass

import httpx

from docent.config import Settings
from docent.security.secretbox import SecretBox

_SPACE = re.compile(r"\s+")
UNREACHABLE = "That address is not reachable from Docent."


@dataclass(frozen=True, slots=True)
class OutboundDeps:
    settings: Settings
    box: SecretBox
    # The SSRF-guarded client from knowledge.fetch: public addresses only.
    http: httpx.AsyncClient


async def response_excerpt(response: httpx.Response, limit: int = 200) -> str:
    """The start of an error response, on one line, for the delivery log."""
    body = bytearray()
    async for part in response.aiter_bytes():
        body.extend(part)
        if len(body) >= 2000:
            break
    text = _SPACE.sub(" ", body.decode("utf-8", "replace")).strip()
    return f": {text[:limit]}" if text else ""


def describe_error(exc: httpx.HTTPError) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "No answer within 10 seconds."
    if isinstance(exc, httpx.ConnectError):
        if "private address" in str(exc) or "not allowed" in str(exc):
            return UNREACHABLE
        return f"Could not connect: {exc}"[:300]
    return f"{type(exc).__name__}: {exc}"[:300]
