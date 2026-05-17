import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.tier2.paper_fetcher import fetch_paper


@pytest.mark.asyncio
async def test_arxiv_url_fetches_html():
    html_content = "<html><body>BERT achieved 93.2% F1</body></html>"
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = html_content

    with patch("app.services.tier2.paper_fetcher._fetch_url", new_callable=AsyncMock, return_value=mock_response), \
         patch("app.db.cache.get", new_callable=AsyncMock, return_value=None), \
         patch("app.db.cache.set", new_callable=AsyncMock):
        text, accessibility = await fetch_paper("https://arxiv.org/abs/1810.04805")

    assert "93.2%" in text
    assert accessibility == "open_access"


@pytest.mark.asyncio
async def test_returns_cached_paper_without_fetching():
    cached_data = {"text": "cached paper text", "accessibility": "open_access"}

    with patch("app.db.cache.get", new_callable=AsyncMock, return_value=cached_data):
        text, accessibility = await fetch_paper("https://arxiv.org/abs/1810.04805")

    assert text == "cached paper text"
    assert accessibility == "open_access"


@pytest.mark.asyncio
async def test_inaccessible_paper_returns_none():
    mock_response = MagicMock()
    mock_response.status_code = 404

    with patch("app.services.tier2.paper_fetcher._fetch_url", new_callable=AsyncMock, return_value=mock_response), \
         patch("app.db.cache.get", new_callable=AsyncMock, return_value=None), \
         patch("app.db.cache.set", new_callable=AsyncMock):
        text, accessibility = await fetch_paper("https://example.com/paywalled")

    assert text is None
    assert accessibility == "inaccessible"


@pytest.mark.asyncio
async def test_network_error_returns_none():
    with patch("app.services.tier2.paper_fetcher._fetch_url", new_callable=AsyncMock, side_effect=Exception("network error")), \
         patch("app.db.cache.get", new_callable=AsyncMock, return_value=None), \
         patch("app.db.cache.set", new_callable=AsyncMock):
        text, accessibility = await fetch_paper("https://arxiv.org/abs/9999.99999")

    assert text is None
    assert accessibility == "inaccessible"
