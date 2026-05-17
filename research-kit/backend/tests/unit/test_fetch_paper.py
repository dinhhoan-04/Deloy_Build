import pytest
from unittest.mock import AsyncMock, patch, MagicMock


def _make_mock_response(status: int, json_data: dict | None = None):
    mock = MagicMock()
    mock.status_code = status
    mock.json.return_value = json_data or {}
    return mock


@pytest.mark.asyncio
async def test_fetch_paper_by_doi_crossref_hit(tmp_path):
    crossref_data = {
        "message": {
            "title": ["Sleep deprivation and cognitive performance"],
            "abstract": "This study shows sleep deprivation impairs cognition.",
        }
    }
    mock_resp = _make_mock_response(200, crossref_data)
    with (
        patch("app.tools.fetch_paper.init_paper_cache_db", AsyncMock()),
        patch("app.tools.fetch_paper.get_cached_paper", AsyncMock(return_value=None)),
        patch("app.tools.fetch_paper.set_cached_paper", AsyncMock()),
        patch("httpx.AsyncClient") as mock_client_cls,
    ):
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.get = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = instance

        from app.tools.fetch_paper import fetch_paper

        result = await fetch_paper(doi="10.1000/test", _db_path=str(tmp_path / "c.db"))

    assert "error" not in result
    assert result["title"] == "Sleep deprivation and cognitive performance"
    assert result["source"] == "crossref"


@pytest.mark.asyncio
async def test_fetch_paper_cache_hit(tmp_path):
    cached = {
        "title": "Cached Title",
        "abstract": "Cached abstract",
        "source": "crossref",
        "full_text": None,
    }
    with (
        patch("app.tools.fetch_paper.init_paper_cache_db", AsyncMock()),
        patch("app.tools.fetch_paper.get_cached_paper", AsyncMock(return_value=cached)),
    ):
        from app.tools.fetch_paper import fetch_paper

        result = await fetch_paper(
            url="https://doi.org/10.1000/cached", _db_path=str(tmp_path / "c.db")
        )

    assert result["title"] == "Cached Title"


@pytest.mark.asyncio
async def test_fetch_paper_no_url_no_doi(tmp_path):
    from app.tools.fetch_paper import fetch_paper

    result = await fetch_paper(_db_path=str(tmp_path / "c.db"))
    assert "error" in result
