import pytest
from rk_shared.models import User


@pytest.mark.asyncio
async def test_create_list_filters_by_user(db_engine):
    from app.repos.projects import ProjectRepo

    async with db_engine() as s:
        u1 = User(google_sub="proj_a", email="a@proj")
        u2 = User(google_sub="proj_b", email="b@proj")
        s.add_all([u1, u2])
        await s.commit()
        await s.refresh(u1)
        await s.refresh(u2)
        repo = ProjectRepo(s)
        p1 = await repo.create(u1.id, name="X")
        p2 = await repo.create(u2.id, name="Y")
        await s.commit()
        listed = await repo.list_for(u1.id)
        ids = {p.id for p in listed}
        assert p1.id in ids and p2.id not in ids
