import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.openalex import lookup_paper


@pytest.mark.asyncio
async def test_lookup_by_doi_returns_paper_info():
    mock_response = {
        "doi": "https://doi.org/10.1234/test",
        "title": "Effects of sleep on memory",
        "open_access": {"oa_url": "https://open.example.com/paper.pdf", "is_oa": True},
        "authorships": [{"author": {"display_name": "Walker M"}}],
        "publication_year": 2017,
        "best_oa_location": {"pdf_url": "https://open.example.com/paper.pdf"},
    }
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = mock_response

    with patch(
        "httpx.AsyncClient.__aenter__",
        return_value=AsyncMock(get=AsyncMock(return_value=mock_resp)),
    ):
        result = await lookup_paper(doi="10.1234/test")
    assert result is not None
    assert result.title == "Effects of sleep on memory"
    assert result.fulltext_url == "https://open.example.com/paper.pdf"
    assert result.year == 2017


@pytest.mark.asyncio
async def test_lookup_not_found_returns_none():
    mock_resp = MagicMock()
    mock_resp.status_code = 404

    with patch(
        "httpx.AsyncClient.__aenter__",
        return_value=AsyncMock(get=AsyncMock(return_value=mock_resp)),
    ):
        result = await lookup_paper(doi="10.9999/notreal")
    assert result is None


@pytest.mark.asyncio
async def test_lookup_by_title_fuzzy():
    mock_response = {
        "results": [
            {
                "doi": "https://doi.org/10.1234/test",
                "title": "Effects of sleep on memory consolidation",
                "open_access": {"oa_url": None, "is_oa": False},
                "authorships": [],
                "publication_year": 2017,
                "best_oa_location": None,
            }
        ]
    }
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = mock_response

    with patch(
        "httpx.AsyncClient.__aenter__",
        return_value=AsyncMock(get=AsyncMock(return_value=mock_resp)),
    ):
        result = await lookup_paper(title="Effects of sleep on memory")
    assert result is not None
    assert result.doi == "10.1234/test"
    assert result.fulltext_url is None
