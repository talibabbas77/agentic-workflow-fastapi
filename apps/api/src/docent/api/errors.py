"""One error shape for every failure: {"error": {"code", "message", "fields"}}."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from docent.log import request_id_var

log = logging.getLogger(__name__)


class AppError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        fields: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields
        self.headers = headers


def not_found(what: str = "Resource") -> AppError:
    return AppError(404, "not_found", f"{what} not found.")


def forbidden(message: str = "You do not have permission to do that.") -> AppError:
    return AppError(403, "forbidden", message)


def unauthenticated() -> AppError:
    return AppError(401, "not_authenticated", "Log in to continue.")


def rate_limited(retry_after: int) -> AppError:
    return AppError(
        429,
        "rate_limited",
        "Too many attempts. Try again shortly.",
        headers={"Retry-After": str(retry_after)},
    )


def _body(code: str, message: str, fields: dict[str, str] | None = None) -> dict[str, object]:
    error: dict[str, object] = {"code": code, "message": message}
    if fields:
        error["fields"] = fields
    if rid := request_id_var.get():
        error["request_id"] = rid
    return {"error": error}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            _body(exc.code, exc.message, exc.fields), status_code=exc.status, headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields: dict[str, str] = {}
        for err in exc.errors():
            loc = [str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path")]
            key = ".".join(loc) or "request"
            msg = str(err.get("msg", "Invalid value"))
            fields.setdefault(key, msg.removeprefix("Value error, "))
        return JSONResponse(
            _body("invalid_request", "Some fields need attention.", fields), status_code=422
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return JSONResponse(
            _body(code, str(exc.detail)), status_code=exc.status_code, headers=exc.headers
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error", exc_info=exc)
        return JSONResponse(
            _body("internal_error", "Something went wrong on our side."), status_code=500
        )
