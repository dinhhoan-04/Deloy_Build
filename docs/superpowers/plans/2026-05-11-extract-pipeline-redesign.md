# Extract Pipeline Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken site-adapter extraction pipeline with a pure-LLM pipeline. Backend serves `POST /v1/extract` that calls Gemini (primary) or OpenAI (fallback) with a structured-output schema that binds `claims[]` to `papers[]` via `paperIds`. Extension's content script triggers extraction on result pages, flattens response into `ClaimItem[]`, and hands them to the existing verify queue.

**Architecture:** One LLM call returns `{papers, claims}` with id-based correspondence. Backend validates correspondence (drops orphan refs, merges dup titles). Extension uses pure-LLM (no DOM adapters). URL gate skips homepages. No caching in v1.

**Tech Stack:** Python 3.12 / FastAPI / httpx / openai SDK / pytest+respx; TypeScript / Vite / vitest+jsdom / Chrome extension MV3.

**Reference spec:** `docs/superpowers/specs/2026-05-11-extract-pipeline-redesign.md`

---

## File Structure

### Backend — `research-kit/backend/`

| Path | Action | Responsibility |
|---|---|---|
| `app/config.py` | modify | Add `gemini_api_key`, `openai_api_key`, `llm_primary_provider`; switch `env_file` to `../infra/.env` |
| `app/llm/__init__.py` | create | Public surface: `extract_via_llm()`, `ExtractFailed` exception |
| `app/llm/schema.py` | create | Static JSON schema for `{papers, claims}` |
| `app/llm/prompt.py` | create | System prompt constant + `build_user()` helper |
| `app/llm/validator.py` | create | `validate_correspondence()` — orphan/dup checks |
| `app/llm/providers.py` | create | `LLMProvider` protocol, `GeminiProvider`, `OpenAIProvider`, `RateLimitError`, `ProviderError` |
| `app/schemas/extract.py` | create | Pydantic request/response models |
| `app/routers/extract.py` | create | `POST /v1/extract` endpoint |
| `app/main.py` | modify | Register `extract` router |
| `app/extract_service.py` | delete | Old Anthropic-based service |
| `app/main_openai.py` | modify | Remove import of `extract_service` (file is legacy but must still parse) |
| `tests/unit/test_extract_validator.py` | create | Unit tests for validator |
| `tests/unit/test_extract_providers.py` | create | Unit tests for providers (respx-mocked) |
| `tests/unit/test_extract_router.py` | create | Integration test for `/v1/extract` |
| `infra/.env.example` | modify | Document new env vars |

### Extension — `research-kit/extension/`

| Path | Action | Responsibility |
|---|---|---|
| `src/shared/site-detect.ts` | modify | Add `shouldExtract(url)`; remove `Site` import from deleted module |
| `src/shared/verify-types.ts` | modify | Add `claimGroupId?: string` to `ClaimItem` |
| `src/adapters/dom-serializer.ts` | modify | Keep all `<a>` hrefs, `<sup>` text, `data-citation-id`/`data-doi` attributes |
| `src/extract/types.ts` | create | `ExtractedPaper`, `ExtractedClaim`, `ExtractResponse` (mirror backend) |
| `src/extract/run-extract.ts` | create | Orchestrator: serialize → POST → flatten |
| `src/content.ts` | modify | Wire pipeline (URL gate, debounce, in-flight flag, sendMessage) |
| `src/sidebar/usePageModels.ts` | modify | Replace old `PageModel` import with new `ExtractResponse` shape |
| `src/adapters/elicit-adapter.ts` | delete | Per spec |
| `src/adapters/scispace-adapter.ts` | delete | Per spec |
| `src/adapters/consensus-adapter.ts` | delete | Per spec |
| `src/adapters/hybrid.ts` | delete | Per spec |
| `src/adapters/registry.ts` | delete | Per spec |
| `src/adapters/index.ts` | delete | Per spec |
| `src/adapters/types.ts` | delete | Per spec |
| `src/shared/__tests__/site-detect.test.ts` | create | Tests for `shouldExtract` |
| `src/extract/__tests__/run-extract.test.ts` | create | Tests for flatten + dispatch |
| `src/adapters/__tests__/dom-serializer.test.ts` | create | Tests for tweaked serializer behavior |

---

## Backend Tasks

### Task 1: Config — Settings & env loading

**Files:**
- Modify: `research-kit/backend/app/config.py`
- Modify: `research-kit/infra/.env.example`

- [ ] **Step 1: Update `Settings` class**

Replace the body of `research-kit/backend/app/config.py`:

```python
from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Single source of truth = research-kit/infra/.env (read by docker-compose `env_file: .env`
# in infra/docker-compose.yml). For local dev (uvicorn outside docker) we point pydantic
# at the same file via a relative path from this module.
_INFRA_ENV = Path(__file__).resolve().parents[2] / "infra" / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_INFRA_ENV) if _INFRA_ENV.exists() else None,
        case_sensitive=False,
        extra="ignore",
    )

    env: str = "development"
    log_level: str = "INFO"

    database_url: str
    redis_url: str

    google_client_id: str
    session_secret: str = Field(min_length=32)

    dev_auth_bypass: bool = False

    # LLM extract service
    gemini_api_key: str = ""
    openai_api_key: str = ""
    llm_primary_provider: Literal["gemini", "openai"] = "gemini"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings
```

- [ ] **Step 2: Update `infra/.env.example`**

Add to the bottom of `research-kit/infra/.env.example`:

```bash

# Extract service (backend) — separate from GoClaw keys above.
# Standard names so official SDKs auto-detect. Reuse the same key value as
# GOCLAW_GEMINI_API_KEY / GOCLAW_OPENAI_API_KEY if you only have one of each.
GEMINI_API_KEY=
OPENAI_API_KEY=
LLM_PRIMARY_PROVIDER=gemini   # gemini | openai
```

- [ ] **Step 3: Verify config loads**

Run from `research-kit/backend/`:
```bash
python -c "from app.config import get_settings; s = get_settings(); print(s.llm_primary_provider, repr(s.gemini_api_key))"
```
Expected: prints `gemini` and either `''` or the value from `infra/.env`.

- [ ] **Step 4: Commit**

```bash
git add research-kit/backend/app/config.py research-kit/infra/.env.example
git commit -m "feat(config): add LLM extract settings, load from infra/.env"
```

---

### Task 2: Static LLM schema and prompt

**Files:**
- Create: `research-kit/backend/app/llm/__init__.py` (empty placeholder for now)
- Create: `research-kit/backend/app/llm/schema.py`
- Create: `research-kit/backend/app/llm/prompt.py`

- [ ] **Step 1: Create empty package init**

Create `research-kit/backend/app/llm/__init__.py` with one line:
```python
# Public surface populated by extract_via_llm in this package.
```

- [ ] **Step 2: Create the JSON schema**

Create `research-kit/backend/app/llm/schema.py`:

```python
"""JSON schema for structured extraction output.

Used for BOTH Gemini `responseSchema` and OpenAI `response_format=json_schema`
(strict mode). Keep flat and explicit — provider strict-mode parsers reject
exotic constructs.
"""

EXTRACT_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["papers", "claims"],
    "properties": {
        "papers": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "title", "doi", "url", "authors", "year", "anchorText"],
                "properties": {
                    "id": {"type": "string", "description": "Local sequential id like p1, p2, ..."},
                    "title": {"type": "string"},
                    "doi": {"type": ["string", "null"]},
                    "url": {"type": ["string", "null"]},
                    "authors": {"type": "array", "items": {"type": "string"}},
                    "year": {"type": ["integer", "null"]},
                    "anchorText": {"type": "string", "description": "Marker as it appears on page, e.g. [1], (Smith 2023)"},
                },
            },
        },
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "text", "paperIds"],
                "properties": {
                    "id": {"type": "string", "description": "Local sequential id like c1, c2, ..."},
                    "text": {"type": "string"},
                    "paperIds": {
                        "type": "array",
                        "minItems": 1,
                        "items": {"type": "string"},
                    },
                },
            },
        },
    },
}
```

- [ ] **Step 3: Create the prompt module**

Create `research-kit/backend/app/llm/prompt.py`:

```python
"""System prompt and user-template for extract task."""

SYSTEM_PROMPT = """You extract claims and their cited papers from AI-research-tool pages (Elicit, SciSpace, Consensus).

Follow this exact procedure:

1. First, scan the entire page and list ALL papers/citations referenced.
   Assign each a unique id (p1, p2, ...). Extract title/doi/authors/year
   ONLY from text that appears on this page — do not invent.

2. Then, for each AI-generated factual claim, identify which paper(s)
   from your list above support it (by id). If a claim has no clear
   citation on this page, EXCLUDE it entirely.

3. Never copy a paper title into claim.text. Claims are claims, papers
   are papers — they reference by id only.

Return JSON matching the provided schema. No prose, no markdown fences."""


def build_user(markdown: str, site: str, url: str) -> str:
    return f"""SITE: {site}
URL: {url}

PAGE CONTENT (markdown):
{markdown}"""
```

- [ ] **Step 4: Verify imports**

Run from `research-kit/backend/`:
```bash
python -c "from app.llm.schema import EXTRACT_SCHEMA; from app.llm.prompt import SYSTEM_PROMPT, build_user; print(len(EXTRACT_SCHEMA['properties']), len(SYSTEM_PROMPT))"
```
Expected: prints `2 <some_int>`.

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app/llm/__init__.py research-kit/backend/app/llm/schema.py research-kit/backend/app/llm/prompt.py
git commit -m "feat(llm): add extract schema and prompt"
```

---

### Task 3: Validator with correspondence checks (TDD)

**Files:**
- Create: `research-kit/backend/app/llm/validator.py`
- Create: `research-kit/backend/tests/unit/test_extract_validator.py`

- [ ] **Step 1: Write failing tests**

Create `research-kit/backend/tests/unit/test_extract_validator.py`:

```python
from app.llm.validator import validate_correspondence


def test_passthrough_when_valid():
    raw = {
        "papers": [{"id": "p1", "title": "A", "doi": None, "url": None, "authors": [], "year": None, "anchorText": "[1]"}],
        "claims": [{"id": "c1", "text": "claim text", "paperIds": ["p1"]}],
    }
    cleaned, warnings = validate_correspondence(raw)
    assert cleaned["papers"] == raw["papers"]
    assert cleaned["claims"] == raw["claims"]
    assert warnings == []


def test_drops_claim_with_orphan_paper_id():
    raw = {
        "papers": [{"id": "p1", "title": "A", "doi": None, "url": None, "authors": [], "year": None, "anchorText": ""}],
        "claims": [
            {"id": "c1", "text": "ok", "paperIds": ["p1"]},
            {"id": "c2", "text": "orphan", "paperIds": ["p99"]},
        ],
    }
    cleaned, warnings = validate_correspondence(raw)
    assert [c["id"] for c in cleaned["claims"]] == ["c1"]
    assert any("c2" in w and "p99" in w for w in warnings)


def test_drops_claim_when_some_paper_ids_orphan():
    raw = {
        "papers": [{"id": "p1", "title": "A", "doi": None, "url": None, "authors": [], "year": None, "anchorText": ""}],
        "claims": [{"id": "c1", "text": "mixed", "paperIds": ["p1", "p99"]}],
    }
    cleaned, warnings = validate_correspondence(raw)
    assert cleaned["claims"] == []
    assert any("c1" in w and "p99" in w for w in warnings)


def test_merges_duplicate_titles():
    raw = {
        "papers": [
            {"id": "p1", "title": "Same Title", "doi": "10.1/a", "url": None, "authors": [], "year": None, "anchorText": "[1]"},
            {"id": "p2", "title": "Same Title", "doi": None, "url": "http://x", "authors": [], "year": None, "anchorText": "[2]"},
        ],
        "claims": [
            {"id": "c1", "text": "first", "paperIds": ["p1"]},
            {"id": "c2", "text": "second", "paperIds": ["p2"]},
        ],
    }
    cleaned, warnings = validate_correspondence(raw)
    assert len(cleaned["papers"]) == 1
    assert cleaned["papers"][0]["id"] == "p1"
    # both claims now reference p1
    assert all("p1" in c["paperIds"] for c in cleaned["claims"])
    assert any("merged" in w.lower() for w in warnings)


def test_handles_empty_input():
    cleaned, warnings = validate_correspondence({"papers": [], "claims": []})
    assert cleaned == {"papers": [], "claims": []}
    assert warnings == []


def test_dedup_within_single_claim_paper_ids():
    raw = {
        "papers": [{"id": "p1", "title": "A", "doi": None, "url": None, "authors": [], "year": None, "anchorText": ""}],
        "claims": [{"id": "c1", "text": "x", "paperIds": ["p1", "p1"]}],
    }
    cleaned, _ = validate_correspondence(raw)
    assert cleaned["claims"][0]["paperIds"] == ["p1"]
```

- [ ] **Step 2: Run tests to confirm they fail**

Run from `research-kit/backend/`:
```bash
pytest tests/unit/test_extract_validator.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.llm.validator'`.

- [ ] **Step 3: Write the validator**

Create `research-kit/backend/app/llm/validator.py`:

```python
"""Post-LLM correspondence checks: orphan paperIds, duplicate titles.

Principle: never auto-fix orphan references — silently rewriting which paper
a claim cites would produce wrong verify results. Drop the claim and warn.
"""
from __future__ import annotations


def _norm_title(t: str) -> str:
    return " ".join(t.lower().split())


def validate_correspondence(raw: dict) -> tuple[dict, list[str]]:
    papers = list(raw.get("papers", []))
    claims = list(raw.get("claims", []))
    warnings: list[str] = []

    # 1. Merge duplicate titles (different ids, same normalized title).
    title_to_canonical: dict[str, str] = {}
    id_remap: dict[str, str] = {}
    deduped: list[dict] = []
    for p in papers:
        key = _norm_title(p.get("title", ""))
        if not key:
            deduped.append(p)
            continue
        if key in title_to_canonical:
            canonical = title_to_canonical[key]
            id_remap[p["id"]] = canonical
            warnings.append(f"merged_duplicate_paper: {p['id']}<-{canonical} (same title)")
        else:
            title_to_canonical[key] = p["id"]
            deduped.append(p)
    papers = deduped

    valid_ids = {p["id"] for p in papers}

    # 2. Remap and validate claims.
    kept: list[dict] = []
    for c in claims:
        # Remap and dedupe within-claim references.
        seen: set[str] = set()
        remapped: list[str] = []
        for pid in c.get("paperIds", []):
            mapped = id_remap.get(pid, pid)
            if mapped in seen:
                continue
            seen.add(mapped)
            remapped.append(mapped)
        # Drop the claim if ANY reference is orphan.
        orphans = [pid for pid in remapped if pid not in valid_ids]
        if orphans:
            warnings.append(
                f"dropped_orphan_claim: {c['id']} referenced {','.join(orphans)}"
            )
            continue
        kept.append({**c, "paperIds": remapped})

    return {"papers": papers, "claims": kept}, warnings
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest tests/unit/test_extract_validator.py -v
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app/llm/validator.py research-kit/backend/tests/unit/test_extract_validator.py
git commit -m "feat(llm): add validate_correspondence with orphan/dup handling"
```

---

### Task 4: Provider abstraction + Gemini provider (TDD)

**Files:**
- Create: `research-kit/backend/app/llm/providers.py`
- Create: `research-kit/backend/tests/unit/test_extract_providers.py`

- [ ] **Step 1: Write failing tests for Gemini**

Create `research-kit/backend/tests/unit/test_extract_providers.py`:

```python
import json
import pytest
import respx
from httpx import Response

from app.llm.providers import (
    GeminiProvider,
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/unit/test_extract_providers.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.llm.providers'`.

- [ ] **Step 3: Implement the providers module (Gemini only for now)**

Create `research-kit/backend/app/llm/providers.py`:

```python
"""LLM provider abstraction for extract.

Each provider implements `extract(system, user, schema) -> dict`. Errors must
be normalized to RateLimitError or ProviderError so the orchestrator can
fall back cleanly.
"""
from __future__ import annotations

import json
from typing import Protocol

import httpx


class RateLimitError(Exception):
    """Provider hit a quota/throughput limit. Caller should try fallback."""


class ProviderError(Exception):
    """Any other provider failure (5xx, network, bad JSON). Caller should try fallback."""


class LLMProvider(Protocol):
    name: str

    async def extract(self, system: str, user: str, schema: dict) -> dict: ...


_TIMEOUT = httpx.Timeout(60.0, connect=10.0)


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
                "responseSchema": schema,
                "temperature": 0.0,
            },
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            try:
                resp = await client.post(
                    self._url,
                    params={"key": self._api_key},
                    json=body,
                )
            except httpx.HTTPError as e:
                raise ProviderError(f"gemini network error: {e}") from e

        if resp.status_code == 429:
            raise RateLimitError(f"gemini 429: {resp.text[:200]}")
        if resp.status_code >= 400:
            raise ProviderError(f"gemini {resp.status_code}: {resp.text[:200]}")

        payload = resp.json()
        try:
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as e:
            raise ProviderError(f"gemini malformed response: {e}") from e
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise ProviderError(f"gemini returned non-JSON: {e}") from e
```

- [ ] **Step 4: Run tests to confirm Gemini tests pass**

```bash
pytest tests/unit/test_extract_providers.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app/llm/providers.py research-kit/backend/tests/unit/test_extract_providers.py
git commit -m "feat(llm): add Gemini provider with rate-limit/error handling"
```

---

### Task 5: OpenAI provider

**Files:**
- Modify: `research-kit/backend/app/llm/providers.py`
- Modify: `research-kit/backend/tests/unit/test_extract_providers.py`

- [ ] **Step 1: Add failing tests for OpenAI**

Append to `research-kit/backend/tests/unit/test_extract_providers.py`:

```python
from unittest.mock import AsyncMock, MagicMock, patch

from app.llm.providers import OpenAIProvider


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
```

- [ ] **Step 2: Run tests to confirm OpenAI tests fail**

```bash
pytest tests/unit/test_extract_providers.py -v
```
Expected: 3 new failures with `ImportError` for `OpenAIProvider`.

- [ ] **Step 3: Add OpenAI provider**

Append to `research-kit/backend/app/llm/providers.py`:

```python
from openai import AsyncOpenAI
from openai import APIError as OpenAIAPIError
from openai import RateLimitError as OpenAIRateLimit


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

        content = resp.choices[0].message.content or ""
        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            raise ProviderError(f"openai returned non-JSON: {e}") from e
```

- [ ] **Step 4: Run tests to confirm all provider tests pass**

```bash
pytest tests/unit/test_extract_providers.py -v
```
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app/llm/providers.py research-kit/backend/tests/unit/test_extract_providers.py
git commit -m "feat(llm): add OpenAI provider with strict json_schema"
```

---

### Task 6: Orchestrator `extract_via_llm`

**Files:**
- Modify: `research-kit/backend/app/llm/__init__.py`
- Modify: `research-kit/backend/tests/unit/test_extract_providers.py` (add orchestrator tests)

- [ ] **Step 1: Add failing tests for orchestrator**

Append to `research-kit/backend/tests/unit/test_extract_providers.py`:

```python
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/unit/test_extract_providers.py -v -k "orchestrator"
```
Expected: 4 failures with `ImportError`.

- [ ] **Step 3: Implement the orchestrator**

Replace `research-kit/backend/app/llm/__init__.py` with:

```python
"""Public surface for extract pipeline."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Sequence

from app.config import get_settings
from app.llm.prompt import SYSTEM_PROMPT, build_user
from app.llm.providers import (
    GeminiProvider,
    LLMProvider,
    OpenAIProvider,
    ProviderError,
    RateLimitError,
)
from app.llm.schema import EXTRACT_SCHEMA
from app.llm.validator import validate_correspondence

log = logging.getLogger(__name__)


class ExtractFailed(Exception):
    """All configured providers failed."""


@dataclass
class ExtractResult:
    papers: list[dict[str, Any]]
    claims: list[dict[str, Any]]
    meta: dict[str, Any] = field(default_factory=dict)


def _default_providers() -> list[LLMProvider]:
    s = get_settings()
    gemini = GeminiProvider(api_key=s.gemini_api_key) if s.gemini_api_key else None
    openai = OpenAIProvider(api_key=s.openai_api_key) if s.openai_api_key else None
    order: list[LLMProvider] = []
    if s.llm_primary_provider == "gemini":
        if gemini: order.append(gemini)
        if openai: order.append(openai)
    else:
        if openai: order.append(openai)
        if gemini: order.append(gemini)
    return order


async def extract_via_llm(
    *,
    markdown: str,
    site: str,
    url: str,
    providers: Sequence[LLMProvider] | None = None,
) -> ExtractResult:
    chain = list(providers) if providers is not None else _default_providers()
    if not chain:
        raise ExtractFailed("no providers configured (set GEMINI_API_KEY or OPENAI_API_KEY)")

    user = build_user(markdown, site, url)
    last_err: Exception | None = None
    for provider in chain:
        t0 = time.perf_counter()
        try:
            raw = await provider.extract(SYSTEM_PROMPT, user, EXTRACT_SCHEMA)
        except (RateLimitError, ProviderError) as e:
            log.warning("provider=%s failed: %s", provider.name, e)
            last_err = e
            continue
        cleaned, warnings = validate_correspondence(raw)
        latency_ms = int((time.perf_counter() - t0) * 1000)
        return ExtractResult(
            papers=cleaned["papers"],
            claims=cleaned["claims"],
            meta={
                "provider": provider.name,
                "latencyMs": latency_ms,
                "inputChars": len(markdown),
                "papersCount": len(cleaned["papers"]),
                "claimsCount": len(cleaned["claims"]),
                "warnings": warnings,
            },
        )
    raise ExtractFailed(f"all providers exhausted; last error: {last_err}")
```

- [ ] **Step 4: Run all extract tests**

```bash
pytest tests/unit/test_extract_validator.py tests/unit/test_extract_providers.py -v
```
Expected: 17 passed total (6 validator + 11 provider/orchestrator).

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app/llm/__init__.py research-kit/backend/tests/unit/test_extract_providers.py
git commit -m "feat(llm): add extract_via_llm orchestrator with provider fallback"
```

---

### Task 7: Pydantic schemas and `/v1/extract` router

**Files:**
- Create: `research-kit/backend/app/schemas/extract.py`
- Create: `research-kit/backend/app/routers/extract.py`
- Create: `research-kit/backend/tests/unit/test_extract_router.py`

- [ ] **Step 1: Write failing router test**

Create `research-kit/backend/tests/unit/test_extract_router.py`:

```python
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
        papers=[{"id": "p1", "title": "X", "doi": None, "url": None, "authors": [], "year": None, "anchorText": ""}],
        claims=[{"id": "c1", "text": "y", "paperIds": ["p1"]}],
        meta={"provider": "gemini", "latencyMs": 100, "inputChars": 5, "papersCount": 1, "claimsCount": 1, "warnings": []},
    )
    with patch("app.routers.extract.extract_via_llm", new=AsyncMock(return_value=fake)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            r = await c.post(
                "/v1/extract",
                json={"url": "http://elicit.com/notebook/abc", "site": "elicit", "page_markdown": "hello"},
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
    assert r.json()["detail"]["code"] == "extract_unavailable"


@pytest.mark.asyncio
async def test_extract_endpoint_rejects_invalid_site(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post(
            "/v1/extract",
            json={"url": "http://x", "site": "wikipedia", "page_markdown": "hello"},
        )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_extract_endpoint_rejects_empty_markdown(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post(
            "/v1/extract",
            json={"url": "http://x", "site": "elicit", "page_markdown": ""},
        )
    assert r.status_code == 422
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/unit/test_extract_router.py -v
```
Expected: failures due to missing router.

- [ ] **Step 3: Create Pydantic schemas**

Create `research-kit/backend/app/schemas/extract.py`:

```python
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict


SiteId = Literal["elicit", "scispace", "consensus"]


class ExtractRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1)
    site: SiteId
    page_markdown: str = Field(min_length=1)


class PaperOut(BaseModel):
    id: str
    title: str
    doi: str | None = None
    url: str | None = None
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    anchorText: str = ""


class ClaimOut(BaseModel):
    id: str
    text: str
    paperIds: list[str]


class ExtractMeta(BaseModel):
    provider: str
    latencyMs: int
    inputChars: int
    papersCount: int
    claimsCount: int
    warnings: list[str] = Field(default_factory=list)


class ExtractResponse(BaseModel):
    papers: list[PaperOut]
    claims: list[ClaimOut]
    extractMeta: ExtractMeta
```

- [ ] **Step 4: Create the router**

Create `research-kit/backend/app/routers/extract.py`:

```python
from fastapi import APIRouter, HTTPException

from app.llm import ExtractFailed, extract_via_llm
from app.schemas.extract import (
    ClaimOut,
    ExtractMeta,
    ExtractRequest,
    ExtractResponse,
    PaperOut,
)

router = APIRouter(prefix="/v1", tags=["extract"])


@router.post("/extract", response_model=ExtractResponse)
async def extract(req: ExtractRequest) -> ExtractResponse:
    try:
        result = await extract_via_llm(
            markdown=req.page_markdown,
            site=req.site,
            url=req.url,
        )
    except ExtractFailed as e:
        raise HTTPException(
            status_code=503,
            detail={"code": "extract_unavailable", "message": str(e)},
        )
    return ExtractResponse(
        papers=[PaperOut(**p) for p in result.papers],
        claims=[ClaimOut(**c) for c in result.claims],
        extractMeta=ExtractMeta(**result.meta),
    )
```

- [ ] **Step 5: Run tests (still failing — router not registered)**

```bash
pytest tests/unit/test_extract_router.py -v
```
Expected: 404 on the happy-path test because router isn't mounted yet.

- [ ] **Step 6: Commit (Task 8 will register)**

```bash
git add research-kit/backend/app/schemas/extract.py research-kit/backend/app/routers/extract.py research-kit/backend/tests/unit/test_extract_router.py
git commit -m "feat(api): add POST /v1/extract router and schemas"
```

---

### Task 8: Register router + clean up legacy

**Files:**
- Modify: `research-kit/backend/app/main.py`
- Delete: `research-kit/backend/app/extract_service.py`
- Modify: `research-kit/backend/app/main_openai.py`

- [ ] **Step 1: Register the extract router**

In `research-kit/backend/app/main.py`, locate the router imports block (around line 28-39) and add:

```python
    from app.routers import extract as extract_router
```

Add to the include block:

```python
    app.include_router(extract_router.router)
```

- [ ] **Step 2: Run router tests to confirm they pass**

```bash
pytest tests/unit/test_extract_router.py -v
```
Expected: 4 passed.

- [ ] **Step 3: Delete legacy `extract_service.py`**

```bash
git rm research-kit/backend/app/extract_service.py
```

- [ ] **Step 4: Fix `main_openai.py` import**

In `research-kit/backend/app/main_openai.py`, find:
```python
from app.extract_service import extract_claims
```
Replace with:
```python
# Legacy module — extract_service.py has been removed.
# Use `from app.llm import extract_via_llm` if you need the new pipeline here.
```

If `extract_claims` is referenced elsewhere in `main_openai.py`, comment out or stub those references — the file is legacy and not mounted by `main.py`.

- [ ] **Step 5: Verify module imports**

```bash
python -c "from app.main import create_app; create_app(); print('ok')"
```
Expected: prints `ok` (no ImportError).

- [ ] **Step 6: Run the full backend test suite**

```bash
pytest tests/unit -v
```
Expected: all existing tests still pass; the 4 new router tests pass.

- [ ] **Step 7: Commit**

```bash
git add research-kit/backend/app/main.py research-kit/backend/app/main_openai.py
git commit -m "feat(api): wire /v1/extract, retire extract_service.py"
```

---

## Extension Tasks

### Task 9: `shouldExtract(url)` URL gate

**Files:**
- Modify: `research-kit/extension/src/shared/site-detect.ts`
- Create: `research-kit/extension/src/shared/__tests__/site-detect.test.ts`

- [ ] **Step 1: Write failing tests**

Create `research-kit/extension/src/shared/__tests__/site-detect.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { shouldExtract, detectSite } from '../site-detect'

describe('shouldExtract', () => {
  // Elicit
  it('extracts on elicit notebook page', () => {
    expect(shouldExtract('https://elicit.com/notebook/abc-123')).toBe(true)
  })
  it('extracts on elicit sharable page', () => {
    expect(shouldExtract('https://elicit.com/sharable/xyz')).toBe(true)
  })
  it('skips elicit homepage', () => {
    expect(shouldExtract('https://elicit.com/')).toBe(false)
  })
  it('skips elicit notebooks list', () => {
    expect(shouldExtract('https://elicit.com/notebooks')).toBe(false)
  })
  it('skips elicit login', () => {
    expect(shouldExtract('https://elicit.com/login')).toBe(false)
  })

  // SciSpace
  it('extracts on scispace search', () => {
    expect(shouldExtract('https://scispace.com/search?q=foo')).toBe(true)
  })
  it('extracts on scispace literature-review', () => {
    expect(shouldExtract('https://scispace.com/literature-review/abc')).toBe(true)
  })
  it('extracts on scispace papers', () => {
    expect(shouldExtract('https://scispace.com/papers/xyz')).toBe(true)
  })
  it('extracts on scispace chat', () => {
    expect(shouldExtract('https://scispace.com/chat/123')).toBe(true)
  })
  it('skips scispace homepage', () => {
    expect(shouldExtract('https://scispace.com/')).toBe(false)
  })
  it('skips scispace pricing', () => {
    expect(shouldExtract('https://scispace.com/pricing')).toBe(false)
  })

  // Consensus
  it('extracts on consensus results', () => {
    expect(shouldExtract('https://consensus.app/results?q=foo')).toBe(true)
  })
  it('extracts on consensus paper page', () => {
    expect(shouldExtract('https://consensus.app/papers/123')).toBe(true)
  })
  it('skips consensus homepage', () => {
    expect(shouldExtract('https://consensus.app/')).toBe(false)
  })
  it('skips consensus login', () => {
    expect(shouldExtract('https://consensus.app/login')).toBe(false)
  })

  // Unsupported
  it('returns false for unsupported site', () => {
    expect(shouldExtract('https://google.com/')).toBe(false)
  })
  it('returns false for invalid url', () => {
    expect(shouldExtract('not-a-url')).toBe(false)
  })
})

describe('detectSite (unchanged behavior)', () => {
  it('detects elicit', () => {
    expect(detectSite('https://elicit.com/notebook/x')).toBe('elicit')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd research-kit/extension && npx vitest run src/shared/__tests__/site-detect.test.ts
```
Expected: `shouldExtract is not exported` errors.

- [ ] **Step 3: Replace `site-detect.ts` body**

Replace the entire content of `research-kit/extension/src/shared/site-detect.ts`:

```typescript
import type { SiteId } from './verify-types'

// Per-site URL rules. shouldExtract returns true ONLY when the path matches an
// "extract" pattern AND does not match a "skip" pattern. Default = false.
//
// Keep the table conservative. False negatives (skipping a real result page) are
// recoverable — user can reload. False positives (extracting an empty homepage)
// burn LLM quota and produce zero claims.

const SITE_RULES: Record<SiteId, { extract: RegExp[]; skip: RegExp[] }> = {
  elicit: {
    extract: [
      /^\/notebooks?\/[^/]+/,
      /^\/sharable\/[^/]+/,
    ],
    skip: [
      /^\/?$/,
      /^\/notebooks\/?$/,
      /^\/login/,
      /^\/settings/,
    ],
  },
  scispace: {
    extract: [
      /^\/search/,
      /^\/literature-review\/[^/]+/,
      /^\/papers\/[^/]+/,
      /^\/chat\/[^/]+/,
    ],
    skip: [
      /^\/?$/,
      /^\/login/,
      /^\/pricing/,
    ],
  },
  consensus: {
    extract: [
      /^\/results/,
      /^\/papers\/[^/]+/,
    ],
    skip: [
      /^\/?$/,
      /^\/search\/?$/,
      /^\/login/,
    ],
  },
}

export type ElicitMode = 'notebook' | 'research' | 'list' | 'paper' | 'search' | null

export function detectElicitMode(url: string): ElicitMode {
  const patterns = {
    notebook: /\/notebooks?\/[^/]+/,
    research: /\/research\/[^/]+/,
    list: /\/lists?\/[^/]+/,
    paper: /\/papers?\/[^/]+/,
    search: /\/search/,
  }
  for (const [mode, pattern] of Object.entries(patterns)) {
    if (pattern.test(url)) return mode as ElicitMode
  }
  return null
}

export function detectSite(url: string): SiteId | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname.includes('elicit.com')) return 'elicit'
    if (hostname.includes('scispace.com')) return 'scispace'
    if (hostname.includes('consensus.app')) return 'consensus'
    return null
  } catch {
    return null
  }
}

export function shouldExtract(url: string): boolean {
  const site = detectSite(url)
  if (!site) return false
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return false
  }
  const rules = SITE_RULES[site]
  if (rules.skip.some((rx) => rx.test(path))) return false
  return rules.extract.some((rx) => rx.test(path))
}

export function detectToolName(url: string): 'chatgpt' | 'perplexity' | 'elicit' | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) return 'chatgpt'
    if (hostname.includes('perplexity.ai')) return 'perplexity'
    if (hostname.includes('elicit.com')) return 'elicit'
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd research-kit/extension && npx vitest run src/shared/__tests__/site-detect.test.ts
```
Expected: 18 passed.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/shared/site-detect.ts research-kit/extension/src/shared/__tests__/site-detect.test.ts
git commit -m "feat(ext): add shouldExtract URL gate, switch Site import to SiteId"
```

---

### Task 10: Tweak `dom-serializer.ts`

**Files:**
- Modify: `research-kit/extension/src/adapters/dom-serializer.ts`
- Create: `research-kit/extension/src/adapters/__tests__/dom-serializer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `research-kit/extension/src/adapters/__tests__/dom-serializer.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { serializeDOMToMarkdown } from '../dom-serializer'

function setBody(html: string) {
  document.body.innerHTML = html
}

describe('serializeDOMToMarkdown', () => {
  it('preserves DOI link with href', () => {
    setBody('<p>Cited <a href="https://doi.org/10.1/abc">[1]</a></p>')
    const md = serializeDOMToMarkdown()
    expect(md).toContain('[[1]](https://doi.org/10.1/abc)')
  })

  it('preserves non-DOI link href too', () => {
    setBody('<p>See <a href="https://example.com/paper">paper</a></p>')
    const md = serializeDOMToMarkdown()
    expect(md).toContain('[paper](https://example.com/paper)')
  })

  it('preserves sup citation markers', () => {
    setBody('<p>Some claim<sup>[1,2]</sup>.</p>')
    const md = serializeDOMToMarkdown()
    expect(md).toContain('[1,2]')
  })

  it('preserves elements with data-citation-id', () => {
    setBody('<p>x <span data-citation-id="p1">smith2020</span> y</p>')
    const md = serializeDOMToMarkdown()
    expect(md).toContain('smith2020')
  })

  it('preserves elements with data-doi attribute as link', () => {
    setBody('<p>Ref <span data-doi="10.1/xyz">[1]</span></p>')
    const md = serializeDOMToMarkdown()
    expect(md).toContain('10.1/xyz')
  })

  it('still skips script and style tags', () => {
    setBody('<p>visible</p><script>alert(1)</script><style>p{}</style>')
    const md = serializeDOMToMarkdown()
    expect(md).toContain('visible')
    expect(md).not.toContain('alert')
    expect(md).not.toContain('p{}')
  })

  it('respects 60K byte budget', () => {
    const huge = '<p>' + 'x '.repeat(40000) + '</p>'
    setBody(huge)
    const md = serializeDOMToMarkdown()
    expect(md.length).toBeLessThanOrEqual(60_000 + 1000)  // some slack from trailing parts
  })
})
```

- [ ] **Step 2: Run tests to confirm some fail**

```bash
cd research-kit/extension && npx vitest run src/adapters/__tests__/dom-serializer.test.ts
```
Expected: non-DOI link, sup, data-doi tests fail.

- [ ] **Step 3: Replace the serializer**

Replace `research-kit/extension/src/adapters/dom-serializer.ts`:

```typescript
// DOM → markdown serializer for LLM-based extract.
//
// Design notes:
// - Keep ALL anchor hrefs (LLM will pick papers from arxiv/pubmed/publisher URLs).
// - Keep <sup> text since citation markers live there ([1], [1,2]).
// - Surface data-citation-id and data-doi attributes — Elicit/SciSpace use them.
// - Hard byte budget so a runaway page can't blow up the LLM input.

const SKIP_TAGS = new Set(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'svg', 'iframe'])
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'li', 'tr', 'blockquote'])
const HEADING_TAGS: Record<string, string> = { h1: '# ', h2: '## ', h3: '### ', h4: '#### ', h5: '##### ', h6: '###### ' }

const MAX_BYTES = 60_000

export function serializeDOMToMarkdown(root: Element = document.body): string {
  const parts: string[] = []
  let bytes = 0

  function push(s: string) {
    parts.push(s)
    bytes += s.length
  }

  function walk(node: Node) {
    if (bytes >= MAX_BYTES) return
    if (node.nodeType === Node.COMMENT_NODE) return

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      const tag = el.tagName.toLowerCase()

      if (SKIP_TAGS.has(tag)) return
      if (el.getAttribute('aria-hidden') === 'true') return
      if (el.getAttribute('role') === 'presentation') return

      // Inline DOI hint from data attribute (LLM-friendly).
      const dataDoi = el.getAttribute('data-doi')
      if (dataDoi) {
        push(` [data-doi:${dataDoi}] `)
      }
      const dataCid = el.getAttribute('data-citation-id')
      if (dataCid) {
        push(` [cite:${dataCid}] `)
      }

      // Headings
      if (tag in HEADING_TAGS) {
        const text = el.textContent?.trim()
        if (text) push(`\n${HEADING_TAGS[tag]}${text}\n`)
        return
      }

      // <a> — keep every href so the LLM can pick paper URLs by content.
      if (tag === 'a') {
        const href = (el as HTMLAnchorElement).href
        const text = el.textContent?.trim()
        if (!text) return
        if (href) push(`[${text}](${href})`)
        else push(text)
        return
      }

      // <sup> — citation markers live here.
      if (tag === 'sup') {
        const text = el.textContent?.trim()
        if (text) push(text)
        return
      }

      // List items and table cells.
      if (tag === 'li' || tag === 'td' || tag === 'th') {
        const text = el.textContent?.trim()
        if (text) push(`\n- ${text}`)
        return
      }

      // Block elements.
      if (BLOCK_TAGS.has(tag)) {
        push('\n')
        for (const child of el.childNodes) walk(child)
        push('\n')
        return
      }

      for (const child of el.childNodes) walk(child)
      return
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.replace(/\s+/g, ' ').trim()
      if (text) push(text + ' ')
    }
  }

  walk(root)
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd research-kit/extension && npx vitest run src/adapters/__tests__/dom-serializer.test.ts
```
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/adapters/dom-serializer.ts research-kit/extension/src/adapters/__tests__/dom-serializer.test.ts
git commit -m "feat(ext): broaden dom-serializer for LLM extract (anchors, sup, data attrs)"
```

---

### Task 11: New `src/extract/` module — types and orchestrator (TDD on flatten)

**Files:**
- Modify: `research-kit/extension/src/shared/verify-types.ts`
- Create: `research-kit/extension/src/extract/types.ts`
- Create: `research-kit/extension/src/extract/run-extract.ts`
- Create: `research-kit/extension/src/extract/__tests__/run-extract.test.ts`

- [ ] **Step 1: Add `claimGroupId` to `ClaimItem`**

In `research-kit/extension/src/shared/verify-types.ts`, modify the `ClaimItem` interface to add `claimGroupId?: string` after `id`:

```typescript
export interface ClaimItem {
  id: string
  claimGroupId?: string  // groups (claim × paper) rows back under their original claim for UI
  text: string
  paperTitle: string | null
  ...
}
```

- [ ] **Step 2: Write failing tests for flatten**

Create `research-kit/extension/src/extract/__tests__/run-extract.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flattenForVerifyQueue, runExtract } from '../run-extract'

describe('flattenForVerifyQueue', () => {
  it('produces one ClaimItem per (claim × paper) pair', () => {
    const resp = {
      papers: [
        { id: 'p1', title: 'Paper A', doi: '10.1/a', url: null, authors: ['Smith'], year: 2020, anchorText: '[1]' },
        { id: 'p2', title: 'Paper B', doi: null, url: 'http://x', authors: ['Doe'], year: 2021, anchorText: '[2]' },
      ],
      claims: [
        { id: 'c1', text: 'multi-cite claim', paperIds: ['p1', 'p2'] },
        { id: 'c2', text: 'single', paperIds: ['p1'] },
      ],
      extractMeta: { provider: 'gemini', latencyMs: 100, inputChars: 5, papersCount: 2, claimsCount: 2, warnings: [] },
    }
    const items = flattenForVerifyQueue(resp, {
      site: 'elicit', tabId: 7, pageUrl: 'http://elicit.com/notebook/x',
    })
    expect(items).toHaveLength(3)
    expect(items[0].id).toBe('c1::p1')
    expect(items[0].claimGroupId).toBe('c1')
    expect(items[0].text).toBe('multi-cite claim')
    expect(items[0].paperTitle).toBe('Paper A')
    expect(items[0].doi).toBe('10.1/a')
    expect(items[1].id).toBe('c1::p2')
    expect(items[1].claimGroupId).toBe('c1')
    expect(items[1].paperUrl).toBe('http://x')
    expect(items[2].id).toBe('c2::p1')
  })

  it('drops claim×paper combos where paper id is unknown', () => {
    const resp = {
      papers: [{ id: 'p1', title: 'A', doi: null, url: null, authors: [], year: null, anchorText: '' }],
      claims: [{ id: 'c1', text: 't', paperIds: ['pX'] }],
      extractMeta: { provider: 'gemini', latencyMs: 0, inputChars: 0, papersCount: 1, claimsCount: 1, warnings: [] },
    }
    const items = flattenForVerifyQueue(resp, { site: 'elicit', tabId: 0, pageUrl: '' })
    expect(items).toEqual([])
  })

  it('stamps tabId, pageUrl, site, extractedAt on every item', () => {
    const resp = {
      papers: [{ id: 'p1', title: 'A', doi: null, url: null, authors: [], year: null, anchorText: '' }],
      claims: [{ id: 'c1', text: 't', paperIds: ['p1'] }],
      extractMeta: { provider: 'gemini', latencyMs: 0, inputChars: 0, papersCount: 1, claimsCount: 1, warnings: [] },
    }
    const items = flattenForVerifyQueue(resp, { site: 'consensus', tabId: 42, pageUrl: 'http://c' })
    expect(items[0].site).toBe('consensus')
    expect(items[0].tabId).toBe(42)
    expect(items[0].pageUrl).toBe('http://c')
    expect(typeof items[0].extractedAt).toBe('number')
  })
})

describe('runExtract', () => {
  beforeEach(() => {
    document.body.innerHTML = '<p>some <a href="https://doi.org/10.1/x">[1]</a> claim</p>'
    global.fetch = vi.fn() as any
  })

  it('POSTs serialized markdown to /v1/extract and returns ClaimItem[]', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        papers: [{ id: 'p1', title: 'X', doi: null, url: null, authors: [], year: null, anchorText: '' }],
        claims: [{ id: 'c1', text: 'y', paperIds: ['p1'] }],
        extractMeta: { provider: 'gemini', latencyMs: 0, inputChars: 0, papersCount: 1, claimsCount: 1, warnings: [] },
      }),
    })
    const items = await runExtract({
      url: 'http://elicit.com/notebook/x', site: 'elicit', tabId: 1,
    })
    expect(items).toHaveLength(1)
    expect(items[0].claimGroupId).toBe('c1')
    const call = (global.fetch as any).mock.calls[0]
    expect(call[0]).toMatch(/\/v1\/extract$/)
    const body = JSON.parse(call[1].body)
    expect(body.site).toBe('elicit')
    expect(body.page_markdown.length).toBeGreaterThan(0)
  })

  it('returns empty array on backend 503', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    const items = await runExtract({ url: 'http://elicit.com/notebook/x', site: 'elicit', tabId: 1 })
    expect(items).toEqual([])
  })

  it('returns empty array when markdown too small', async () => {
    document.body.innerHTML = '<p>hi</p>'
    const items = await runExtract({ url: 'http://elicit.com/notebook/x', site: 'elicit', tabId: 1 })
    expect(items).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd research-kit/extension && npx vitest run src/extract/__tests__/run-extract.test.ts
```
Expected: module not found.

- [ ] **Step 4: Create extract types**

Create `research-kit/extension/src/extract/types.ts`:

```typescript
// Mirror of backend app/schemas/extract.py response shape.
// Keep in sync if backend schema changes.

export interface ExtractedPaper {
  id: string
  title: string
  doi: string | null
  url: string | null
  authors: string[]
  year: number | null
  anchorText: string
}

export interface ExtractedClaim {
  id: string
  text: string
  paperIds: string[]
}

export interface ExtractMeta {
  provider: string
  latencyMs: number
  inputChars: number
  papersCount: number
  claimsCount: number
  warnings: string[]
}

export interface ExtractResponse {
  papers: ExtractedPaper[]
  claims: ExtractedClaim[]
  extractMeta: ExtractMeta
}
```

- [ ] **Step 5: Create `run-extract.ts`**

Create `research-kit/extension/src/extract/run-extract.ts`:

```typescript
import { serializeDOMToMarkdown } from '../adapters/dom-serializer'
import type { ClaimItem, SiteId } from '../shared/verify-types'
import type { ExtractResponse } from './types'

const BACKEND_URL = 'http://localhost:8000/v1'
const MIN_MARKDOWN_CHARS = 500  // skip empty/loading pages

export interface RunExtractOptions {
  url: string
  site: SiteId
  tabId: number
}

export interface FlattenContext {
  site: SiteId
  tabId: number
  pageUrl: string
}

// Flatten {papers, claims} into 1 ClaimItem per (claim × paper) pair.
//
// WHY THIS EXISTS: the current backend POST /v1/verify accepts 1 claim × 1 paper.
// The extract response uses claims[i].paperIds[] to bind correctly (one claim
// can cite multiple papers). We expand here so the existing verify queue in
// background_minimal.ts can consume it without change.
//
// IF YOU REFACTOR /v1/verify TO ACCEPT {claims, papers} DIRECTLY, delete this
// flatten step and pass the response through unchanged.
export function flattenForVerifyQueue(
  resp: ExtractResponse,
  ctx: FlattenContext,
): ClaimItem[] {
  const paperById = new Map(resp.papers.map((p) => [p.id, p]))
  const now = Date.now()
  const items: ClaimItem[] = []
  for (const claim of resp.claims) {
    for (const paperId of claim.paperIds) {
      const paper = paperById.get(paperId)
      if (!paper) continue  // defensive — backend validator should already drop these
      items.push({
        id: `${claim.id}::${paperId}`,
        claimGroupId: claim.id,
        text: claim.text,
        paperTitle: paper.title,
        doi: paper.doi,
        paperUrl: paper.url,
        page: '',
        site: ctx.site,
        status: 'pending',
        confidence: 0,
        quote: null,
        reason: '',
        saved: false,
        domAnchor: paper.anchorText,
        tabId: ctx.tabId,
        pageUrl: ctx.pageUrl,
        extractedAt: now,
      })
    }
  }
  return items
}

export async function runExtract(opts: RunExtractOptions): Promise<ClaimItem[]> {
  const markdown = serializeDOMToMarkdown()
  if (markdown.length < MIN_MARKDOWN_CHARS) {
    console.log('[extract] skip: markdown too short', markdown.length)
    return []
  }

  let resp: Response
  try {
    resp = await fetch(`${BACKEND_URL}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: opts.url,
        site: opts.site,
        page_markdown: markdown,
      }),
    })
  } catch (e) {
    console.error('[extract] network error', e)
    return []
  }

  if (!resp.ok) {
    console.warn('[extract] backend returned', resp.status)
    return []
  }

  const data = (await resp.json()) as ExtractResponse
  console.log('[extract] success', data.extractMeta)
  return flattenForVerifyQueue(data, {
    site: opts.site,
    tabId: opts.tabId,
    pageUrl: opts.url,
  })
}
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd research-kit/extension && npx vitest run src/extract/__tests__/run-extract.test.ts
```
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/shared/verify-types.ts research-kit/extension/src/extract
git commit -m "feat(ext): add extract module with flatten and POST /v1/extract"
```

---

### Task 12: Wire `content.ts`

**Files:**
- Modify: `research-kit/extension/src/content.ts`

- [ ] **Step 1: Replace `content.ts`**

Replace the entire content of `research-kit/extension/src/content.ts`:

```typescript
import { detectSite, shouldExtract } from './shared/site-detect'
import { updateBadge, clearAllBadges } from './content/badge'
import { runExtract } from './extract/run-extract'
import {
  MSG_VERIFY_RESULT,
  MSG_CLAIMS_EXTRACTED,
  type MessageVerifyResult,
} from './shared/messages'

const DEBOUNCE_MS = 1500

const site = detectSite(window.location.href)
if (site) init()

async function init() {
  chrome.runtime.sendMessage({ type: 'site:ready', hasContent: true })

  // Per-tab in-flight flag (set when an extract is running for the current URL).
  let inFlight = false
  let lastExtractedUrl = ''
  let debounceTimer: number | undefined

  const myTabId = await getTabId()

  function scheduleExtract() {
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => triggerExtract(), DEBOUNCE_MS)
  }

  async function triggerExtract() {
    const currentUrl = location.href
    if (!shouldExtract(currentUrl)) return
    if (inFlight) return
    if (currentUrl === lastExtractedUrl) return
    if (!site) return
    inFlight = true
    try {
      const claims = await runExtract({ url: currentUrl, site, tabId: myTabId })
      // Drop response if user navigated away mid-extract.
      if (location.href !== currentUrl) return
      lastExtractedUrl = currentUrl
      if (claims.length > 0) {
        chrome.runtime.sendMessage({
          type: MSG_CLAIMS_EXTRACTED,
          tabId: myTabId,
          claims,
        })
      }
    } finally {
      inFlight = false
    }
  }

  // Initial extract once DOM has settled.
  scheduleExtract()

  // SPA navigation: URL changes without full reload.
  let lastUrl = location.href
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      clearAllBadges()
      scheduleExtract()
    }
  }).observe(document, { subtree: true, childList: true })

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MSG_VERIFY_RESULT) {
      const { result } = msg as MessageVerifyResult
      updateBadge(result)
    }
  })
}

async function getTabId(): Promise<number> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'get:tabid' }, (resp) => {
      resolve(resp?.tabId ?? 0)
    })
  })
}
```

- [ ] **Step 2: Run the existing extension test suite**

```bash
cd research-kit/extension && npm test
```
Expected: all tests pass (including the new ones).

- [ ] **Step 3: Build to verify TypeScript compiles**

```bash
cd research-kit/extension && npm run build
```
Expected: build succeeds. If type errors mention `'../adapters'`, those will be addressed in Task 13.

- [ ] **Step 4: Commit**

```bash
git add research-kit/extension/src/content.ts
git commit -m "feat(ext): wire content script to runExtract pipeline"
```

---

### Task 13: Delete legacy adapters + fix consumers

**Files:**
- Delete: `research-kit/extension/src/adapters/elicit-adapter.ts`
- Delete: `research-kit/extension/src/adapters/scispace-adapter.ts`
- Delete: `research-kit/extension/src/adapters/consensus-adapter.ts`
- Delete: `research-kit/extension/src/adapters/hybrid.ts`
- Delete: `research-kit/extension/src/adapters/registry.ts`
- Delete: `research-kit/extension/src/adapters/index.ts`
- Delete: `research-kit/extension/src/adapters/types.ts`
- Modify: `research-kit/extension/src/sidebar/usePageModels.ts`

- [ ] **Step 1: Delete the adapter files**

```bash
git rm research-kit/extension/src/adapters/elicit-adapter.ts \
       research-kit/extension/src/adapters/scispace-adapter.ts \
       research-kit/extension/src/adapters/consensus-adapter.ts \
       research-kit/extension/src/adapters/hybrid.ts \
       research-kit/extension/src/adapters/registry.ts \
       research-kit/extension/src/adapters/index.ts \
       research-kit/extension/src/adapters/types.ts
```

`dom-serializer.ts` stays — it's the only adapter file that survives.

- [ ] **Step 2: Find all consumers of the deleted modules**

```bash
cd research-kit/extension && npx tsc --noEmit 2>&1 | grep -E "Cannot find module|has no exported member" | head -40
```
Note every file path that errors. Expected: at least `src/sidebar/usePageModels.ts`.

- [ ] **Step 3: Rewrite `usePageModels.ts` against the new shape**

Replace `research-kit/extension/src/sidebar/usePageModels.ts` with:

```typescript
import { useState, useEffect } from 'react'
import { detectSite, shouldExtract } from '../shared/site-detect'
import type { SiteId } from '../shared/verify-types'
import type { ExtractResponse } from '../extract/types'
import { serializeDOMToMarkdown } from '../adapters/dom-serializer'

interface TabInfo {
  tabId: number
  title: string
  url: string
  site?: SiteId
  extract?: ExtractResponse
  isLoading?: boolean
  error?: string
}

const BACKEND_URL = 'http://localhost:8000/v1'

export function usePageModels() {
  const [tabs, setTabs] = useState<Map<number, TabInfo>>(new Map())
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    chrome.tabs.query({}, (allTabs) => {
      const supported = new Map<number, TabInfo>()
      for (const tab of allTabs) {
        if (tab.id && tab.url) {
          const site = detectSite(tab.url)
          if (site && shouldExtract(tab.url)) {
            supported.set(tab.id, { tabId: tab.id, title: tab.title || 'Untitled', url: tab.url, site })
          }
        }
      }
      setTabs(supported)
    })
  }, [])

  const fetchExtract = async (tabId: number) => {
    const info = tabs.get(tabId)
    if (!info || !info.site) return
    setTabs((prev) => {
      const next = new Map(prev)
      const t = next.get(tabId)
      if (t) t.isLoading = true
      return next
    })
    try {
      // Serialize markdown by asking the content script to do it via DOM access.
      // For sidebar-initiated extract we POST directly to the backend; the content
      // script does its own auto-extract independently.
      const md = await chrome.tabs.sendMessage(tabId, { type: 'content:serialize' }).catch(() => null)
      const markdown = typeof md === 'string' ? md : serializeDOMToMarkdown()
      const resp = await fetch(`${BACKEND_URL}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: info.url, site: info.site, page_markdown: markdown }),
      })
      if (!resp.ok) throw new Error(`backend ${resp.status}`)
      const data = (await resp.json()) as ExtractResponse
      setTabs((prev) => {
        const next = new Map(prev)
        const t = next.get(tabId)
        if (t) {
          t.extract = data
          t.isLoading = false
          t.error = undefined
        }
        return next
      })
    } catch (e) {
      setTabs((prev) => {
        const next = new Map(prev)
        const t = next.get(tabId)
        if (t) {
          t.error = e instanceof Error ? e.message : String(e)
          t.isLoading = false
        }
        return next
      })
    }
  }

  const toggleTabSelection = (tabId: number) => {
    setSelectedTabIds((prev) => {
      const next = new Set(prev)
      if (next.has(tabId)) next.delete(tabId)
      else {
        next.add(tabId)
        fetchExtract(tabId)
      }
      return next
    })
  }

  const getSelectedExtracts = (): ExtractResponse[] =>
    Array.from(selectedTabIds)
      .map((id) => tabs.get(id)?.extract)
      .filter((e): e is ExtractResponse => !!e)

  return {
    tabs: Array.from(tabs.values()),
    selectedTabIds,
    toggleTabSelection,
    getSelectedExtracts,
  }
}
```

- [ ] **Step 4: Re-run typecheck**

```bash
cd research-kit/extension && npx tsc --noEmit
```
Expected: clean. If any other file still imports from `'../adapters'` (other than the surviving `dom-serializer`), update it: change `import { ... } from '../adapters'` to import `SiteId` from `'../shared/verify-types'` and any extract types from `'../extract/types'`.

- [ ] **Step 5: Run full extension test suite**

```bash
cd research-kit/extension && npm test
```
Expected: all tests pass.

- [ ] **Step 6: Build**

```bash
cd research-kit/extension && npm run build
```
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/adapters research-kit/extension/src/sidebar/usePageModels.ts
git commit -m "refactor(ext): delete site adapters, migrate consumers to ExtractResponse"
```

---

## Final Verification

### Task 14: End-to-end smoke

**Files:** none modified

- [ ] **Step 1: Start backend with at least one API key set**

In a separate terminal:
```bash
cd research-kit/backend
# Ensure GEMINI_API_KEY or OPENAI_API_KEY is set in ../infra/.env
uvicorn app.main:app --reload
```

- [ ] **Step 2: Load the unpacked extension**

In Chrome → `chrome://extensions` → "Load unpacked" → select `research-kit/extension/dist`.

- [ ] **Step 3: Test on each site**

For each of these URLs, open the sidebar and confirm claims appear in the Verify tab:

- `https://elicit.com/notebook/<any-existing-notebook-id>` — must extract.
- `https://elicit.com/` — must NOT extract (no claims appear, no backend call in network tab).
- `https://scispace.com/search?q=climate%20change` — must extract.
- `https://consensus.app/results?q=sleep` — must extract.

- [ ] **Step 4: Verify correspondence**

Pick one claim in the sidebar. Check that `paperTitle` and `doi`/`paperUrl` shown on the card actually match a citation visible on the page. If they don't, capture the `extractMeta.warnings` from the backend log and the raw `/v1/extract` response — that indicates the system prompt isn't strong enough or the LLM is mis-correspondeing, which is a tuning task beyond this plan.

- [ ] **Step 5: Verify fallback (optional)**

Temporarily set `LLM_PRIMARY_PROVIDER=gemini` but use an invalid `GEMINI_API_KEY`. Confirm backend logs `provider=gemini failed: ...` then succeeds via OpenAI (assuming `OPENAI_API_KEY` is valid).

---

## Self-Review

**Spec coverage** (vs `docs/superpowers/specs/2026-05-11-extract-pipeline-redesign.md`):

- Architecture & pipeline → Tasks 1–13 cover every box of the diagram.
- Data contract (schema, validator, prompt) → Tasks 2, 3.
- Flatten with comment → Task 11, flatten function carries the WHY/refactor-instruction comment.
- URL gate → Task 9 with 18 tests across all 3 sites.
- Provider abstraction → Tasks 4, 5.
- Orchestrator with fallback → Task 6.
- Backend env via `infra/.env` → Task 1 (`_INFRA_ENV` path resolution).
- Failure modes — backend 503, network errors, schema-invalid JSON, orphan ids, dup titles → covered in validator tests (Task 3), provider tests (Tasks 4, 5), router tests (Task 7), run-extract tests (Task 11).
- `extractMeta` observability → Task 6 (`ExtractResult.meta`) and Task 7 (`ExtractMeta` in response).
- File deletions → Task 13.

**Placeholders:** none — every code block is complete, every command is concrete.

**Type consistency:** `ExtractResponse`/`ExtractedPaper`/`ExtractedClaim` (TS) mirror `ExtractResponse`/`PaperOut`/`ClaimOut` (Python). `claimGroupId` is added in Task 11 Step 1 before being used in Task 11 Step 5. `shouldExtract` exported in Task 9 before being imported in Tasks 12 and 13.

**Out of scope** (deferred per spec): URL/content-hash caching, pagination, streaming, retry-with-backoff, per-user quotas.
