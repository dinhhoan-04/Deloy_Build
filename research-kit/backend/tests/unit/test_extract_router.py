from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.llm import ExtractResult, ExtractFailed


@pytest.fixture
def app():
    return create_app()


@pytest.mark.asyncio
async def test_extract_endpoint_happy_path(app):
    fake = ExtractResult(
        papers=[
            {
                "id": "p1",
                "title": "X",
                "doi": None,
                "url": None,
                "authors": [],
                "year": None,
                "anchorText": "",
            }
        ],
        claims=[{"id": "c1", "text": "y", "paperIds": ["p1"]}],
        meta={
            "provider": "gemini",
            "latencyMs": 100,
            "inputChars": 5,
            "papersCount": 1,
            "claimsCount": 1,
            "warnings": [],
        },
    )
    with patch("app.routers.extract.extract_via_llm", new=AsyncMock(return_value=fake)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            r = await c.post(
                "/v1/extract",
                json={
                    "url": "http://elicit.com/notebook/abc",
                    "site": "elicit",
                    "page_markdown": "hello",
                },
            )
    assert r.status_code == 200
    data = r.json()
    assert data["papers"][0]["id"] == "p1"
    assert data["claims"][0]["paperIds"] == ["p1"]
    assert data["extractMeta"]["provider"] == "gemini"


@pytest.mark.asyncio
async def test_extract_endpoint_503_when_all_providers_fail(app):
    with patch(
        "app.routers.extract.extract_via_llm",
        new=AsyncMock(side_effect=ExtractFailed("no key")),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            r = await c.post(
                "/v1/extract",
                json={"url": "http://x", "site": "elicit", "page_markdown": "hello"},
            )
    assert r.status_code == 503
    # The app's global error handler wraps HTTPException into {"error": {...}}
    assert r.json()["error"]["code"] == "extract_unavailable"


@pytest.mark.asyncio
async def test_extract_endpoint_rejects_invalid_site(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post(
            "/v1/extract",
            json={"url": "http://x", "site": "wikipedia", "page_markdown": "hello"},
        )
    # The app's global error handler converts Pydantic validation errors to 400
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_extract_endpoint_rejects_empty_markdown(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post(
            "/v1/extract",
            json={"url": "http://x", "site": "elicit", "page_markdown": ""},
        )
    # The app's global error handler converts Pydantic validation errors to 400
    assert r.status_code == 400
