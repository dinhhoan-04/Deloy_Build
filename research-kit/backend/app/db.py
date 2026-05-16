from collections.abc import AsyncIterator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

_engine = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def init_engine(url: str) -> None:
    global _engine, _sessionmaker
    _engine = create_async_engine(url, pool_size=10, max_overflow=20, pool_pre_ping=True)
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)


def sessionmaker() -> async_sessionmaker[AsyncSession]:
    assert _sessionmaker is not None, "Call init_engine first"
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    assert _sessionmaker is not None, "Call init_engine first"
    async with _sessionmaker() as s:
        yield s
