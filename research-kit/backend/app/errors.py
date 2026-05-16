from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException


class APIError(Exception):
    code: str = "internal_error"
    status: int = 500

    def __init__(self, message: str, *, details: dict | None = None):
        self.message = message
        self.details = details


class AuthError(APIError):
    code, status = "auth_error", 401


class PermissionError_(APIError):
    code, status = "permission_denied", 403


class NotFoundError(APIError):
    code, status = "not_found", 404


class ValidationError(APIError):
    code, status = "validation_error", 400


class ConflictError(APIError):
    code, status = "conflict", 409


class RateLimitError(APIError):
    code, status = "rate_limited", 429


class UpstreamError(APIError):
    code, status = "upstream_error", 502


def _envelope(code: str, message: str, details: dict | None = None) -> dict:
    body: dict = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    return body


async def api_error_handler(_: Request, exc: APIError) -> JSONResponse:
    return JSONResponse(_envelope(exc.code, exc.message, exc.details), status_code=exc.status)


async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    # If detail is a dict with a "code" key, use it directly for structured errors.
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        detail_dict = exc.detail
        return JSONResponse(
            _envelope(detail_dict["code"], detail_dict.get("message", detail_dict["code"])),
            status_code=exc.status_code,
        )
    code = {
        400: "validation_error",
        401: "auth_error",
        403: "permission_denied",
        404: "not_found",
        405: "method_not_allowed",
        409: "conflict",
        429: "rate_limited",
        503: "service_unavailable",
    }.get(exc.status_code, "internal_error")
    return JSONResponse(_envelope(code, exc.detail or code), status_code=exc.status_code)


async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        _envelope("validation_error", "invalid request", {"errors": exc.errors()}),
        status_code=400,
    )


def install(app) -> None:
    app.add_exception_handler(APIError, api_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
