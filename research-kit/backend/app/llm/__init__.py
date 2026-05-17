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
    ZaiProvider,
    LLMProvider,
    OpenAIProvider,
    PayloadTooLargeError,
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
    gemini = (
        GeminiProvider(api_key=s.gemini_api_key, model=s.llm_gemini_model)
        if s.gemini_api_key
        else None
    )
    zai = ZaiProvider(api_key=s.zai_api_key, model=s.llm_zai_model) if s.zai_api_key else None
    openai = (
        OpenAIProvider(api_key=s.openai_api_key, model=s.llm_openai_model)
        if s.openai_api_key
        else None
    )
    order: list[LLMProvider] = []
    if s.llm_primary_provider == "gemini":
        if gemini:
            order.append(gemini)
        if zai:
            order.append(zai)
        if openai:
            order.append(openai)
    elif s.llm_primary_provider == "zai":
        if zai:
            order.append(zai)
        if gemini:
            order.append(gemini)
        if openai:
            order.append(openai)
    else:
        if openai:
            order.append(openai)
        if gemini:
            order.append(gemini)
        if zai:
            order.append(zai)
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
        if providers is not None:
            raise ExtractFailed("no providers in chain (empty list passed explicitly)")
        raise ExtractFailed(
            "no providers configured (set GEMINI_API_KEY or ZAI_API_KEY or OPENAI_API_KEY)"
        )

    user = build_user(markdown, site, url)
    last_err: Exception | None = None
    for provider in chain:
        t0 = time.perf_counter()
        try:
            raw = await provider.extract(SYSTEM_PROMPT, user, EXTRACT_SCHEMA)
        except (RateLimitError, ProviderError, PayloadTooLargeError) as e:
            log.warning("provider=%s failed: %s", provider.name, e)
            last_err = e
            continue
        cleaned, warnings = validate_correspondence(raw, host_url=url)
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
