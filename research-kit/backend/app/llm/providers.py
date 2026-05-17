"""LLM provider abstraction for extract.

Each provider implements `extract(system, user, schema) -> dict`. Errors must
be normalized to RateLimitError or ProviderError so the orchestrator can
fall back cleanly.
"""

from __future__ import annotations

import json
from typing import Protocol

import httpx
from openai import AsyncOpenAI
from openai import APIError as OpenAIAPIError
from openai import RateLimitError as OpenAIRateLimit


class RateLimitError(Exception):
    """Provider hit a quota/throughput limit. Caller should try fallback."""


class ProviderError(Exception):
    """Any other provider failure (5xx, network, bad JSON). Caller should try fallback."""


class PayloadTooLargeError(Exception):
    """Provider rejected request due to context/token size."""


class LLMProvider(Protocol):
    name: str

    async def extract(self, system: str, user: str, schema: dict) -> dict: ...


_TIMEOUT = httpx.Timeout(60.0, connect=10.0)


def _strip_additional_properties(schema: dict) -> dict:
    """Return a deep copy of schema with all 'additionalProperties' keys removed.

    Gemini's responseSchema parser rejects the field entirely (it's an OpenAI /
    JSON-Schema concept). OpenAI strict mode requires it, so we keep it in the
    canonical EXTRACT_SCHEMA and strip on the way to Gemini.
    """
    import copy

    def _strip(obj: object) -> object:
        if isinstance(obj, dict):
            return {k: _strip(v) for k, v in obj.items() if k != "additionalProperties"}
        if isinstance(obj, list):
            return [_strip(i) for i in obj]
        return obj

    return _strip(copy.deepcopy(schema))  # type: ignore[return-value]


class GeminiProvider:
    """Google Gemini via REST. We call httpx directly to avoid pulling in
    google-generativeai SDK (one less dep, and the REST surface is stable)."""

    name = "gemini"

    def __init__(self, api_key: str, model: str = "gemini-2.5-flash") -> None:
        self._api_key = api_key
        self._model = model
        self._url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        )

    async def extract(self, system: str, user: str, schema: dict) -> dict:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": _strip_additional_properties(schema),
                "temperature": 0.0,
            },
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            try:
                resp = await client.post(
                    self._url,
                    headers={"X-Goog-Api-Key": self._api_key},
                    json=body,
                )
            except httpx.HTTPError as e:
                raise ProviderError(f"gemini network error: {e}") from e

        if resp.status_code == 429:
            raise RateLimitError(f"gemini 429: {resp.text[:200]}")
        if resp.status_code == 413:
            raise PayloadTooLargeError(f"gemini 413: {resp.text[:200]}")
        if resp.status_code >= 400:
            raise ProviderError(f"gemini {resp.status_code}: {resp.text[:200]}")

        try:
            payload = resp.json()
        except json.JSONDecodeError as e:
            raise ProviderError(f"gemini 200 but non-JSON body: {e}") from e
        try:
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as e:
            raise ProviderError(f"gemini malformed response: {e}") from e
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise ProviderError(f"gemini returned non-JSON: {e}") from e


class OpenAIProvider:
    """OpenAI via official SDK with strict json_schema response format."""

    name = "openai"

    def __init__(self, api_key: str, model: str = "gpt-4o-mini") -> None:
        self._model = model
        self._client = AsyncOpenAI(api_key=api_key)

    async def extract(self, system: str, user: str, schema: dict) -> dict:
        try:
            resp = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.0,
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "extract_result",
                        "schema": schema,
                        "strict": True,
                    },
                },
            )
        except OpenAIRateLimit as e:
            raise RateLimitError(f"openai 429: {e}") from e
        except OpenAIAPIError as e:
            raise ProviderError(f"openai api error: {e}") from e

        try:
            content = resp.choices[0].message.content or ""
        except IndexError as e:
            raise ProviderError(f"openai returned empty choices: {e}") from e
        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            raise ProviderError(f"openai returned non-JSON: {e}") from e


class ZaiProvider:
    """Z.ai via OpenAI-compatible SDK."""

    name = "zai"

    def __init__(self, api_key: str, model: str = "glm-4.7") -> None:
        self._model = model
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.z.ai/api/paas/v4/",
        )

    async def extract(self, system: str, user: str, schema: dict) -> dict:
        try:
            resp = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.0,
                response_format={"type": "json_object"},
            )
        except Exception as e:
            msg = str(e).lower()
            if "413" in msg or "request too large" in msg or "tokens per minute" in msg:
                raise PayloadTooLargeError(f"zai 413: {e}") from e
            if "rate" in msg and ("limit" in msg or "quota" in msg or "429" in msg):
                raise RateLimitError(f"zai 429: {e}") from e
            raise ProviderError(f"zai api error: {e}") from e

        try:
            content = resp.choices[0].message.content or ""
        except IndexError as e:
            raise ProviderError(f"zai returned empty choices: {e}") from e
        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            raise ProviderError(f"zai returned non-JSON: {e}") from e
