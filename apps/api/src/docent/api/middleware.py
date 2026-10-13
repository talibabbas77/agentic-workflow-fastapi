"""Request id, security headers, and origin-based CSRF protection (pure ASGI)."""

import uuid
from urllib.parse import urlsplit

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from docent.log import request_id_var

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# Prefixes that authenticate without the admin cookie and so skip the origin check.
CSRF_EXEMPT_PREFIXES = ("/v1/widget/", "/v1/webhooks/")

SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
}


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = Headers(scope=scope).get("x-request-id", "")
        rid = incoming if 8 <= len(incoming) <= 64 and incoming.isascii() else uuid.uuid4().hex
        token = request_id_var.set(rid)
        path: str = scope["path"]

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["x-request-id"] = rid
                for key, value in SECURITY_HEADERS.items():
                    headers.setdefault(key, value)
                if path.startswith("/v1/"):
                    headers.setdefault("cache-control", "no-store")
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            request_id_var.reset(token)


class BodySizeLimitMiddleware:
    """Reject request bodies over a limit before they are read into memory."""

    def __init__(
        self, app: ASGIApp, max_bytes: int, overrides: dict[str, int] | None = None
    ) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.overrides = overrides or {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = self.overrides.get(scope["path"], self.max_bytes)
        declared = Headers(scope=scope).get("content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > limit):
            await self._reject(scope, receive, send)
            return
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _BodyTooLarge:
            await self._reject(scope, receive, send)

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse(
            {"error": {"code": "payload_too_large", "message": "Request body is too large."}},
            status_code=413,
        )
        await response(scope, receive, send)


class _BodyTooLarge(Exception):
    pass


class OriginCheckMiddleware:
    """Reject cookie-authenticated writes that do not come from an allowed origin."""

    def __init__(self, app: ASGIApp, allowed_origins: set[str]) -> None:
        self.app = app
        self.allowed = allowed_origins

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] in UNSAFE_METHODS
            and scope["path"].startswith("/v1/")
            and not scope["path"].startswith(CSRF_EXEMPT_PREFIXES)
            and not self._origin_ok(Headers(scope=scope))
        ):
            response = JSONResponse(
                {"error": {"code": "csrf_failed", "message": "Request origin not allowed."}},
                status_code=403,
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)

    def _origin_ok(self, headers: Headers) -> bool:
        origin = headers.get("origin")
        if origin:
            return origin.rstrip("/") in self.allowed
        referer = headers.get("referer")
        if referer:
            parts = urlsplit(referer)
            return f"{parts.scheme}://{parts.netloc}" in self.allowed
        return False
