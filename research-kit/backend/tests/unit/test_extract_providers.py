import json
import pytest
import respx
from httpx import Response

from app.llm.providers import (
    GeminiProvider,
    PayloadTooLargeError,
    ProviderError,
    RateLimitError,
)
from app.llm.schema import EXTRACT_SCHEMA


GEMINI_OK = {
    "candidates": [
        {
            "content": {
                "parts": [
                    {
                        "text": json.dumps(
                            {
                                "papers": [
                                    {
                                        "id": "p1",
                                        "title": "X",
                                        "doi": None,
                                        "url": None,
                                        "authors": [],
                                        "year": None,
                                        "anchorText": "[1]",
                                    }
                                ],
                                "claims": [
                                    {"id": "c1", "text": "y", "paperIds": ["p1"]}
                                ],
                            }
                        )
                    }
                ]
            }
        }
    ]
}


@pytest.mark.asyncio
@respx.mock
async def test_gemini_returns_parsed_json():
    route = respx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    ).mock(return_value=Response(200, json=GEMINI_OK))
    provider = GeminiProvider(api_key="test-key", model="gemini-2.5-flash")
    out = await provider.extract("sys", "user", EXTRACT_SCHEMA)
    assert out["papers"][0]["id"] == "p1"
    assert out["claims"][0]["paperIds"] == ["p1"]
    # Verify request body shape.
    req_body = json.loads(route.calls[0].request.content)
    assert req_body["generationConfig"]["responseMimeType"] == "application/json"
    assert "responseSchema" in req_body["generationConfig"]
    assert req_body["systemInstruction"]["parts"][0]["text"] == "sys"


@pytest.mark.asyncio
@respx.mock
async def test_gemini_429_raises_ratelimit():
    respx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    ).mock(return_value=Response(429, json={"error": "quota"}))
    provider = GeminiProvider(api_key="test-key", model="gemini-2.5-flash")
    with pytest.raises(RateLimitError):
        await provider.extract("sys", "user", EXTRACT_SCHEMA)


@pytest.mark.asyncio
@respx.mock
async def test_gemini_5xx_raises_provider_error():
    respx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    ).mock(return_value=Response(500, text="boom"))
    provider = GeminiProvider(api_key="test-key", model="gemini-2.5-flash")
    with pytest.raises(ProviderError):
        await provider.extract("sys", "user", EXTRACT_SCHEMA)


@pytest.mark.asyncio
@respx.mock
async def test_gemini_invalid_json_raises_provider_error():
    bad = {"candidates": [{"content": {"parts": [{"text": "not json {"}]}}]}
    respx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    ).mock(return_value=Response(200, json=bad))
    provider = GeminiProvider(api_key="test-key", model="gemini-2.5-flash")
    with pytest.raises(ProviderError):
        await provider.extract("sys", "user", EXTRACT_SCHEMA)


@pytest.mark.asyncio
@respx.mock
async def test_gemini_safety_block_raises_provider_error():
    blocked = {"candidates": [], "promptFeedback": {"blockReason": "SAFETY"}}
    respx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    ).mock(return_value=Response(200, json=blocked))
    provider = GeminiProvider(api_key="test-key", model="gemini-2.5-flash")
    with pytest.raises(ProviderError):
        await provider.extract("sys", "user", EXTRACT_SCHEMA)


from unittest.mock import AsyncMock, MagicMock, patch

from app.llm.providers import OpenAIProvider
from app.llm.providers import ZaiProvider


OPENAI_OK_CONTENT = json.dumps(
    {
        "papers": [
            {
                "id": "p1",
                "title": "X",
                "doi": None,
                "url": None,
                "authors": [],
                "year": None,
                "anchorText": "[1]",
            }
        ],
        "claims": [{"id": "c1", "text": "y", "paperIds": ["p1"]}],
    }
)


def _mock_openai_response(content: str):
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    return resp


@pytest.mark.asyncio
async def test_openai_returns_parsed_json():
    fake = _mock_openai_response(OPENAI_OK_CONTENT)
    with patch("app.llm.providers.AsyncOpenAI") as cls:
        client = cls.return_value
        client.chat.completions.create = AsyncMock(return_value=fake)
        provider = OpenAIProvider(api_key="k", model="gpt-4o-mini")
        out = await provider.extract("sys", "user", EXTRACT_SCHEMA)
        assert out["papers"][0]["id"] == "p1"
        call_kwargs = client.chat.completions.create.await_args.kwargs
        assert call_kwargs["response_format"]["type"] == "json_schema"
        assert call_kwargs["response_format"]["json_schema"]["strict"] is True


@pytest.mark.asyncio
async def test_openai_ratelimit_raises():
    from openai import RateLimitError as OpenAIRateLimit

    with patch("app.llm.providers.AsyncOpenAI") as cls:
        client = cls.return_value
        client.chat.completions.create = AsyncMock(
            side_effect=OpenAIRateLimit("quota", response=MagicMock(), body=None)
        )
        provider = OpenAIProvider(api_key="k", model="gpt-4o-mini")
        with pytest.raises(RateLimitError):
            await provider.extract("sys", "user", EXTRACT_SCHEMA)


@pytest.mark.asyncio
async def test_openai_invalid_json_raises():
    fake = _mock_openai_response("not json {")
    with patch("app.llm.providers.AsyncOpenAI") as cls:
        client = cls.return_value
        client.chat.completions.create = AsyncMock(return_value=fake)
        provider = OpenAIProvider(api_key="k", model="gpt-4o-mini")
        with pytest.raises(ProviderError):
            await provider.extract("sys", "user", EXTRACT_SCHEMA)


@pytest.mark.asyncio
async def test_openai_5xx_raises_provider_error():
    from openai import InternalServerError

    with patch("app.llm.providers.AsyncOpenAI") as cls:
        client = cls.return_value
        client.chat.completions.create = AsyncMock(
            side_effect=InternalServerError("server error", response=MagicMock(), body=None)
        )
        provider = OpenAIProvider(api_key="k", model="gpt-4o-mini")
        with pytest.raises(ProviderError):
            await provider.extract("sys", "user", EXTRACT_SCHEMA)


@pytest.mark.asyncio
async def test_openai_empty_choices_raises_provider_error():
    empty_resp = MagicMock()
    empty_resp.choices = []
    with patch("app.llm.providers.AsyncOpenAI") as cls:
        client = cls.return_value
        client.chat.completions.create = AsyncMock(return_value=empty_resp)
        provider = OpenAIProvider(api_key="k", model="gpt-4o-mini")
        with pytest.raises(ProviderError):
            await provider.extract("sys", "user", EXTRACT_SCHEMA)


@pytest.mark.asyncio
async def test_zai_413_maps_to_payload_too_large():
    with patch("app.llm.providers.AsyncOpenAI") as cls:
        client = cls.return_value
        client.chat.completions.create = AsyncMock(
            side_effect=Exception("Error code: 413 - Request too large for model on tokens per minute")
        )
        provider = ZaiProvider(api_key="k", model="glm-4.7")
        with pytest.raises(PayloadTooLargeError):
            await provider.extract("sys", "user", EXTRACT_SCHEMA)


from app.llm import extract_via_llm, ExtractFailed, ExtractResult


@pytest.mark.asyncio
async def test_orchestrator_uses_primary_when_ok():
    primary = MagicMock()
    primary.name = "gemini"
    primary.extract = AsyncMock(return_value={
        "papers": [{"id": "p1", "title": "X", "doi": None, "url": None, "authors": [], "year": None, "anchorText": ""}],
        "claims": [{"id": "c1", "text": "y", "paperIds": ["p1"]}],
    })
    fallback = MagicMock()
    fallback.extract = AsyncMock()

    result = await extract_via_llm(
        markdown="md", site="elicit", url="http://x",
        providers=[primary, fallback],
    )
    assert isinstance(result, ExtractResult)
    assert result.meta["provider"] == "gemini"
    fallback.extract.assert_not_called()


@pytest.mark.asyncio
async def test_orchestrator_falls_back_on_ratelimit():
    primary = MagicMock()
    primary.name = "gemini"
    primary.extract = AsyncMock(side_effect=RateLimitError("quota"))
    fallback = MagicMock()
    fallback.name = "openai"
    fallback.extract = AsyncMock(return_value={
        "papers": [{"id": "p1", "title": "X", "doi": None, "url": None, "authors": [], "year": None, "anchorText": ""}],
        "claims": [{"id": "c1", "text": "y", "paperIds": ["p1"]}],
    })

    result = await extract_via_llm(
        markdown="md", site="elicit", url="http://x",
        providers=[primary, fallback],
    )
    assert result.meta["provider"] == "openai"


@pytest.mark.asyncio
async def test_orchestrator_raises_when_all_fail():
    primary = MagicMock(); primary.name = "gemini"
    primary.extract = AsyncMock(side_effect=ProviderError("boom"))
    fallback = MagicMock(); fallback.name = "openai"
    fallback.extract = AsyncMock(side_effect=ProviderError("boom2"))

    with pytest.raises(ExtractFailed):
        await extract_via_llm(
            markdown="md", site="elicit", url="http://x",
            providers=[primary, fallback],
        )


@pytest.mark.asyncio
async def test_orchestrator_runs_validator():
    """Orphan paperIds should be dropped before returning."""
    primary = MagicMock(); primary.name = "gemini"
    primary.extract = AsyncMock(return_value={
        "papers": [{"id": "p1", "title": "X", "doi": None, "url": None, "authors": [], "year": None, "anchorText": ""}],
        "claims": [
            {"id": "c1", "text": "ok", "paperIds": ["p1"]},
            {"id": "c2", "text": "orphan", "paperIds": ["p99"]},
        ],
    })
    result = await extract_via_llm(
        markdown="md", site="elicit", url="http://x",
        providers=[primary],
    )
    assert [c["id"] for c in result.claims] == ["c1"]
    assert any("c2" in w for w in result.meta["warnings"])
