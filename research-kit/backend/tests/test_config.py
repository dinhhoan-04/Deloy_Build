def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x")
    monkeypatch.setenv("REDIS_URL", "redis://r")
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("GOCLAW_URL", "http://g")
    monkeypatch.setenv("GOCLAW_TOKEN", "t")
    monkeypatch.setenv("DEV_AUTH_BYPASS", "false")
    from app.config import Settings, get_settings
    get_settings.cache_clear()
    s = Settings()
    assert s.env == "development"
    assert s.session_secret == "s" * 32
    assert s.dev_auth_bypass is False
