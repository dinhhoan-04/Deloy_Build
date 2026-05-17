import os

# Set required env vars before any app imports so Settings() doesn't fail at collection time.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://placeholder")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("SESSION_SECRET", "x" * 32)
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id")
os.environ.setdefault("GOCLAW_URL", "http://localhost:8080")
os.environ.setdefault("GOCLAW_TOKEN", "test-token")
os.environ.setdefault("DEV_AUTH_BYPASS", "true")

import pytest
from httpx import ASGITransport, AsyncClient
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer
from alembic import command
from alembic.config import Config


class _RedisInfo:
    def __init__(self, url: str): self.url = url


@pytest.fixture(scope="session")
def redis_container():
    with RedisContainer("redis:7-alpine") as r:
        host = r.get_container_host_ip()
        port = r.get_exposed_port(6379)
        url = f"redis://{host}:{port}/0"
        os.environ["REDIS_URL"] = url
        yield _RedisInfo(url)


@pytest.fixture(scope="session")
def redis_url(redis_container):
    return redis_container.url


def _db_url_for_alembic(sync_url: str) -> str:
    return sync_url


@pytest.fixture(autouse=True)
def reset_redis_pool():
    import app.redis_pool as _rp
    _rp._redis = None
    yield
    _rp._redis = None


@pytest.fixture(scope="session")
def pg_url():
    with PostgresContainer("postgres:16-alpine") as c:
        sync_url = c.get_connection_url()
        async_url = sync_url.replace("+psycopg2", "+asyncpg")
        cfg = Config("alembic.ini")
        cfg.set_main_option("sqlalchemy.url", sync_url)
        os.environ["DATABASE_URL_SYNC"] = sync_url
        command.upgrade(cfg, "head")
        yield async_url


@pytest.fixture
async def db_engine(pg_url):
    import app.db as _db
    _db.init_engine(pg_url)
    yield _db._sessionmaker


@pytest.fixture
async def client(pg_url):
    from app.config import get_settings
    get_settings.cache_clear()
    os.environ["DATABASE_URL"] = pg_url
    import app.db as _db
    _db.init_engine(pg_url)
    from app.main import create_app
    _app = create_app()
    async with AsyncClient(transport=ASGITransport(app=_app), base_url="http://test") as c:
        yield c


async def _dev_client(pg_url: str, dev_user: str):
    import app.db as _db
    from app.config import get_settings
    get_settings.cache_clear()
    _db.init_engine(pg_url)
    from app.main import create_app
    _app = create_app()
    return AsyncClient(
        transport=ASGITransport(app=_app),
        base_url="http://test",
        headers={"X-Dev-User": dev_user},
    )


@pytest.fixture
async def client_dev_alice(pg_url):
    async with await _dev_client(pg_url, "alice@example.com") as c:
        yield c


@pytest.fixture
async def client_dev_bob(pg_url):
    async with await _dev_client(pg_url, "bob@example.com") as c:
        yield c


@pytest.fixture
async def async_session(pg_url):
    import app.db as _db
    _db.init_engine(pg_url)
    sm = _db.sessionmaker()
    async with sm() as s:
        yield s
        await s.rollback()
