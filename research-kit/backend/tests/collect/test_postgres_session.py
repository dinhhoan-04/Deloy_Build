import pytest
from app.db.postgres import get_engine, session_scope


@pytest.mark.asyncio
async def test_session_scope_yields_working_session():
    async with session_scope() as session:
        result = await session.execute(__import__("sqlalchemy").text("SELECT 1"))
        assert result.scalar() == 1
