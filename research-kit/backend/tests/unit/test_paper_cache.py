import pytest
import pytest_asyncio
import os

@pytest_asyncio.fixture
async def db_path(tmp_path):
    path = str(tmp_path / "test_cache.db")
    yield path
    if os.path.exists(path):
        os.unlink(path)

@pytest.mark.asyncio
async def test_cache_miss_returns_none(db_path):
    from app.db.paper_cache_sqlite import get_cached_paper, init_paper_cache_db
    await init_paper_cache_db(db_path)
    result = await get_cached_paper("https://doi.org/10.1000/nonexistent", db_path)
    assert result is None

@pytest.mark.asyncio
async def test_cache_set_then_get(db_path):
    from app.db.paper_cache_sqlite import get_cached_paper, set_cached_paper, init_paper_cache_db
    await init_paper_cache_db(db_path)
    data = {"title": "Test Paper", "abstract": "This is an abstract.", "source": "crossref"}
    await set_cached_paper("https://doi.org/10.1000/test", data, db_path)
    result = await get_cached_paper("https://doi.org/10.1000/test", db_path)
    assert result is not None
    assert result["title"] == "Test Paper"
    assert result["abstract"] == "This is an abstract."

@pytest.mark.asyncio
async def test_cache_is_url_keyed(db_path):
    from app.db.paper_cache_sqlite import get_cached_paper, set_cached_paper, init_paper_cache_db
    await init_paper_cache_db(db_path)
    await set_cached_paper("https://doi.org/10.1000/a", {"title": "A", "abstract": "", "source": "x"}, db_path)
    result_b = await get_cached_paper("https://doi.org/10.1000/b", db_path)
    assert result_b is None
