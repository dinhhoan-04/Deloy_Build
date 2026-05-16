import pytest
from rk_shared.models import User
from rk_shared.types import RunKind


@pytest.mark.asyncio
async def test_create_or_get_idempotent(db_engine):
    from app.repos.runs import RunRepo

    async with db_engine() as s:
        u = User(google_sub="g", email="g"); s.add(u); await s.commit(); await s.refresh(u)
        repo = RunRepo(s)
        body = {"claim_id": "c1"}
        r1, created1 = await repo.create_or_get(
            user_id=u.id, kind=RunKind.VERIFY, project_id=None,
            input=body, idempotency_key="k1",
        )
        await s.commit()
        r2, created2 = await repo.create_or_get(
            user_id=u.id, kind=RunKind.VERIFY, project_id=None,
            input=body, idempotency_key="k1",
        )
        assert r1.id == r2.id
        assert created1 is True and created2 is False


@pytest.mark.asyncio
async def test_idem_conflict_on_diff_payload(db_engine):
    from app.errors import ConflictError
    from app.repos.runs import RunRepo

    async with db_engine() as s:
        u = User(google_sub="g2", email="g2"); s.add(u); await s.commit(); await s.refresh(u)
        repo = RunRepo(s)
        await repo.create_or_get(user_id=u.id, kind=RunKind.VERIFY, project_id=None,
                                 input={"a": 1}, idempotency_key="k2")
        await s.commit()
        with pytest.raises(ConflictError):
            await repo.create_or_get(user_id=u.id, kind=RunKind.VERIFY, project_id=None,
                                     input={"a": 2}, idempotency_key="k2")
