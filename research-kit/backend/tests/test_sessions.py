import pytest
from datetime import timedelta

from rk_shared.models import User


@pytest.mark.asyncio
async def test_issue_and_validate_session(db_engine):
    from app.auth.session import SessionService

    svc = SessionService(secret="x" * 32, ttl=timedelta(hours=1))
    async with db_engine() as s:
        u = User(google_sub="g1", email="a@b")
        s.add(u)
        await s.commit()
        await s.refresh(u)
    async with db_engine() as s:
        token = await svc.issue(s, user_id=u.id)
        await s.commit()
    async with db_engine() as s:
        uid = await svc.validate(s, token)
        assert uid == u.id


@pytest.mark.asyncio
async def test_invalid_token_rejected(db_engine):
    from app.auth.session import SessionService
    from app.errors import AuthError

    svc = SessionService(secret="x" * 32, ttl=timedelta(hours=1))
    async with db_engine() as s:
        with pytest.raises(AuthError):
            await svc.validate(s, "bogus")
