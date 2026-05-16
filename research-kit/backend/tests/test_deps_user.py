import pytest
from fastapi import Depends
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_dev_bypass_creates_user(pg_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", pg_url)
    monkeypatch.setenv("ENV", "development")
    monkeypatch.setenv("DEV_AUTH_BYPASS", "true")
    monkeypatch.setenv("SESSION_SECRET", "x" * 32)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("REDIS_URL", "redis://x")
    monkeypatch.setenv("GOCLAW_URL", "http://x")
    monkeypatch.setenv("GOCLAW_TOKEN", "t")
    from app.config import get_settings
    get_settings.cache_clear()
    import app.db as _db
    _db.init_engine(pg_url)
    from app.main import create_app
    from app.deps import current_user

    app = create_app()

    @app.get("/whoami")
    async def whoami(u=Depends(current_user)):
        return {"id": str(u.id), "email": u.email}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/whoami", headers={"X-Dev-User": "alice@example.com"})
    assert r.status_code == 200
    assert r.json()["email"] == "alice@example.com"


@pytest.mark.asyncio
async def test_no_token_rejects(client):
    r = await client.get("/v1/auth/me")
    assert r.status_code == 401
