import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repos.drafts import DraftRepo
from app.errors import NotFoundError


@pytest.mark.asyncio
async def test_upsert_creates_draft(db_session: AsyncSession):
    user_id = uuid.uuid4()
    project_id = uuid.uuid4()
    # Requires project + user rows to exist; use fixtures from conftest if available,
    # otherwise skip if no conftest support — the router integration test covers this path.
    repo = DraftRepo(db_session)
    draft = await repo.upsert(
        user_id=user_id,
        project_id=project_id,
        markdown="# Hello",
        title="T",
        sections=[],
        run_id=None,
    )
    assert draft.markdown == "# Hello"
    assert draft.title == "T"


@pytest.mark.asyncio
async def test_get_not_found_raises(db_session: AsyncSession):
    repo = DraftRepo(db_session)
    with pytest.raises(NotFoundError):
        await repo.get(uuid.uuid4(), uuid.uuid4())
