from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.logging import configure as configure_logging
from app.middleware import RequestIdMiddleware
from app import errors

# CORS allow list: research sites + localhost dev + any chrome extension
# Regex matches: https://elicit.com, https://scispace.com, https://consensus.app,
# http://localhost:5173, http://localhost:3000, chrome-extension://*


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        from app.db import init_engine

        init_engine(get_settings().async_database_url)
        yield

    app = FastAPI(title="ResearchKit Backend", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^(https://(elicit\.com|scispace\.com|consensus\.app)|http://localhost:(5173|3000)|chrome-extension://.*)$",
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        allow_credentials=True,
    )
    app.add_middleware(RequestIdMiddleware)
    errors.install(app)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    from app.routers import auth as auth_router
    from app.routers import projects as projects_router
    from app.routers import claims as claims_router
    from app.routers import inbox as inbox_router
    from app.routers import conflicts as conflicts_router
    from app.routers import runs as runs_router
    from app.routers import extract as extract_router
    from app.routers import verify as verify_router
    from app.routers import demo as demo_router
    from app.routers import drafts as drafts_router

    app.include_router(auth_router.router)
    app.include_router(projects_router.router)
    app.include_router(claims_router.router)
    app.include_router(inbox_router.router)
    app.include_router(conflicts_router.router)
    app.include_router(runs_router.router)
    app.include_router(extract_router.router)
    app.include_router(verify_router.router)
    app.include_router(demo_router.router)
    app.include_router(drafts_router.router)

    # Mount FastMCP streamable-HTTP server at /mcp with bearer auth
    import hmac
    import os
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request as StarletteRequest
    from starlette.responses import PlainTextResponse

    from app.mcp.server import create_mcp_server

    class _MCPAuth(BaseHTTPMiddleware):
        async def dispatch(self, request: StarletteRequest, call_next):
            auth = request.headers.get("Authorization", "")
            tok = os.environ.get("RK_MCP_TOKEN", "")
            if not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:], tok):
                return PlainTextResponse("Unauthorized", status_code=401)
            return await call_next(request)

    mcp_server = create_mcp_server()
    mcp_app = mcp_server.streamable_http_app()
    mcp_app.add_middleware(_MCPAuth)
    app.mount("/mcp", mcp_app)

    return app


app = create_app()
