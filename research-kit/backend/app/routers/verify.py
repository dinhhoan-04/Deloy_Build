"""Verify endpoint — fetch PDF first, then call LLM.

Status semantics:
  verified     — verbatim quote found in paper text.
  partial      — paper is on-topic but claim not stated literally.
  not_found    — paper unrelated, no support, or evidence contradicts claim.
  inaccessible — paper could not be fetched (blocked, paywall, no URL).

Endpoints:
  POST /v1/verify          — auto-fetch PDF by doi/url, then LLM verify.
  POST /v1/verify/upload   — user-supplied PDF bytes, then LLM verify.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.deps import db
from app.llm.providers import (
    GeminiProvider,
    ZaiProvider,
    LLMProvider,
    OpenAIProvider,
    PayloadTooLargeError,
    ProviderError,
    RateLimitError,
)
from app.logging import get_logger
from app.pdf_fetch import _parse_pdf, fetch_paper_content
from app.repos.paper_cache import PaperCacheRepo
from app.repos.verify_cache import VerifyCacheRepo

log = get_logger("verify")

router = APIRouter(prefix="/v1", tags=["verify"])

VerifyStatus = Literal["verified", "partial", "not_found", "inaccessible", "error"]

_MAX_TEXT_CHARS = 40_000


class VerifyRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    claim: str
    doi: str | None = None
    paper_url: str | None = None
    paper_title: str | None = None


class VerifyResponse(BaseModel):
    status: VerifyStatus
    verbatim_quote: str | None = None
    confidence: float = 0.0
    reason: str = ""
    paper_title: str | None = None
    doi: str | None = None


@dataclass(frozen=True)
class Scope:
    user_id: UUID
    project_id: UUID


_RESPONSE_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["status", "verbatim_quote", "confidence", "reason"],
    "properties": {
        "status": {"type": "string", "enum": ["verified", "partial", "not_found"]},
        "verbatim_quote": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
    },
}

_SYSTEM_FULLTEXT = """You verify a scientific claim against the provided paper text.

Rules:
- Return "verified" only when the paper text explicitly and directly supports the claim.
  Copy verbatim_quote EXACTLY from the text (max 200 chars). This is the sentence or phrase
  that directly confirms the claim.
- Return "partial" when the paper topic is clearly related but the specific claim is not
  stated literally. verbatim_quote may be the closest relevant sentence.
- Return "not_found" when: the paper is unrelated, provides no support, or the evidence
  in the paper directly contradicts the claim.
- confidence: 0.0–1.0.
- reason: one short sentence.
- Respond with JSON only. Never fabricate quotes."""


def _provider_chain() -> list[LLMProvider]:
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
    chain: list[LLMProvider] = []
    if s.llm_primary_provider == "gemini":
        if gemini:
            chain.append(gemini)
        if zai:
            chain.append(zai)
        if openai:
            chain.append(openai)
    elif s.llm_primary_provider == "zai":
        if zai:
            chain.append(zai)
        if gemini:
            chain.append(gemini)
        if openai:
            chain.append(openai)
    else:
        if openai:
            chain.append(openai)
        if gemini:
            chain.append(gemini)
        if zai:
            chain.append(zai)
    return chain


def _max_chars_for_provider(provider: LLMProvider) -> int:
    s = get_settings()
    if provider.name == "zai":
        return max(2_000, s.verify_max_chars_zai)
    if provider.name == "gemini":
        return max(2_000, s.verify_max_chars_gemini)
    return max(2_000, s.verify_max_chars_openai)


def _trim_for_budget(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars]


def _classify_error(e: Exception) -> str:
    if isinstance(e, PayloadTooLargeError):
        return "payload_too_large"
    if isinstance(e, RateLimitError):
        return "rate_limited"
    if isinstance(e, ProviderError):
        return "provider_error"
    return "unknown"


async def _call_llm(
    system: str, claim: str, title: str | None, doi: str | None, paper_text: str
) -> tuple[dict, str]:
    providers = _provider_chain()
    if not providers:
        raise HTTPException(
            status_code=503,
            detail={"code": "verify_unavailable", "message": "No LLM provider configured"},
        )

    t0 = time.perf_counter()
    last_err: Exception | None = None
    for idx, provider in enumerate(providers):
        max_chars = _max_chars_for_provider(provider)
        trimmed = _trim_for_budget(paper_text, max_chars)
        user_msg = _build_user_msg(claim, title, doi, trimmed)
        token_est = len(trimmed) // 4
        try:
            data = await provider.extract(system, user_msg, _RESPONSE_SCHEMA)
            elapsed = int((time.perf_counter() - t0) * 1000)
            log.info(
                "llm_done",
                elapsed_ms=elapsed,
                provider=provider.name,
                chars_sent=len(trimmed),
                token_estimate=token_est,
                fallback_step=idx,
            )
            return data, provider.name
        except PayloadTooLargeError as e:
            last_err = e
            log.warning(
                "verify_provider_failed",
                provider=provider.name,
                error=str(e),
                error_class=_classify_error(e),
                chars_sent=len(trimmed),
                token_estimate=token_est,
                fallback_step=idx,
            )
            retry_chars = max(2_000, len(trimmed) // 2)
            retry_msg = _build_user_msg(claim, title, doi, _trim_for_budget(trimmed, retry_chars))
            retry_est = retry_chars // 4
            try:
                data = await provider.extract(system, retry_msg, _RESPONSE_SCHEMA)
                elapsed = int((time.perf_counter() - t0) * 1000)
                log.info(
                    "llm_done",
                    elapsed_ms=elapsed,
                    provider=provider.name,
                    chars_sent=retry_chars,
                    token_estimate=retry_est,
                    fallback_step=idx,
                    retry=True,
                )
                return data, provider.name
            except (
                PayloadTooLargeError,
                RateLimitError,
                ProviderError,
                json.JSONDecodeError,
            ) as e2:
                last_err = e2
                log.warning(
                    "verify_provider_failed",
                    provider=provider.name,
                    error=str(e2),
                    error_class=_classify_error(e2),
                    chars_sent=retry_chars,
                    token_estimate=retry_est,
                    fallback_step=idx,
                    retry=True,
                )
                continue
        except (RateLimitError, ProviderError, json.JSONDecodeError) as e:
            last_err = e
            log.warning(
                "verify_provider_failed",
                provider=provider.name,
                error=str(e),
                error_class=_classify_error(e),
                chars_sent=len(trimmed),
                token_estimate=token_est,
                fallback_step=idx,
            )
            continue

    raise HTTPException(
        status_code=503,
        detail={
            "code": "verify_provider_error",
            "message": str(last_err or "all providers failed"),
        },
    )


def _build_user_msg(claim: str, paper_title: str | None, doi: str | None, text: str) -> str:
    return (
        f"CLAIM: {claim}\n\n"
        f"PAPER TITLE: {paper_title or '(none)'}\n"
        f"DOI: {doi or '(none)'}\n\n"
        f"PAPER TEXT (may be truncated):\n{text}"
    )


async def _llm_verify(
    req_claim: str,
    req_doi: str | None,
    req_title: str | None,
    paper_text: str,
) -> tuple[VerifyResponse, str]:
    """Run LLM verification and return a VerifyResponse (no inaccessible here)."""
    try:
        data, provider = await _call_llm(
            _SYSTEM_FULLTEXT, req_claim, req_title, req_doi, paper_text
        )
    except json.JSONDecodeError as e:
        log.warning("llm_malformed_json", error=str(e))
        raise HTTPException(status_code=503, detail={"code": "verify_malformed", "message": str(e)})
    return VerifyResponse(
        status=data.get("status", "not_found"),
        verbatim_quote=data.get("verbatim_quote"),
        confidence=float(data.get("confidence") or 0.0),
        reason=data.get("reason", ""),
        paper_title=req_title,
        doi=req_doi,
    ), provider


def _normalize_doi(doi: str | None) -> str | None:
    if not doi:
        return None
    return doi.strip().lower().removeprefix("https://doi.org/").lstrip("/")


def _normalize_url(url: str | None) -> str | None:
    if not url:
        return None
    return url.strip().lower()


def _paper_key(doi: str | None, paper_url: str | None, paper_title: str | None) -> str:
    nd = _normalize_doi(doi)
    if nd:
        return f"doi:{nd}"
    nu = _normalize_url(paper_url)
    if nu:
        return f"url:{nu}"
    title = (paper_title or "").strip().lower()
    return f"title:{hashlib.sha256(title.encode()).hexdigest()}"


def _claim_hash(claim: str) -> str:
    normalized = " ".join(claim.strip().lower().split())
    return hashlib.sha256(normalized.encode()).hexdigest()


def _parse_scope(user_id: str | None, project_id: str | None) -> Scope | None:
    if not user_id or not project_id:
        return None
    try:
        return Scope(user_id=UUID(user_id), project_id=UUID(project_id))
    except ValueError:
        return None


# ── POST /v1/verify ──────────────────────────────────────────────────────────


@router.post("/verify", response_model=VerifyResponse)
async def verify(
    req: VerifyRequest,
    s: AsyncSession = Depends(db),
    x_rk_user_id: str | None = Header(default=None, alias="X-RK-User-Id"),
    x_rk_project_id: str | None = Header(default=None, alias="X-RK-Project-Id"),
) -> VerifyResponse:
    t_start = time.perf_counter()
    log.info(
        "request", claim=req.claim[:80], doi=req.doi, paper_url=req.paper_url, title=req.paper_title
    )

    if not (req.paper_title or req.doi or req.paper_url):
        return VerifyResponse(
            status="inaccessible",
            reason="No paper metadata provided — nothing to fetch.",
            paper_title=req.paper_title,
            doi=req.doi,
        )

    scope = _parse_scope(x_rk_user_id, x_rk_project_id)
    pk = _paper_key(req.doi, req.paper_url, req.paper_title)
    ck = _claim_hash(req.claim)
    settings = get_settings()

    if scope:
        vcache = VerifyCacheRepo(s, ttl_days=settings.verify_cache_ttl_days)
        cached_verify = await vcache.get(scope.user_id, scope.project_id, pk, ck)
        if cached_verify:
            log.info("verify_cache_hit", cache="verify_result", paper_key=pk)
            return VerifyResponse(
                status=cached_verify.status,
                verbatim_quote=cached_verify.verbatim_quote,
                confidence=cached_verify.confidence,
                reason=cached_verify.reason,
                paper_title=req.paper_title,
                doi=req.doi,
            )

    paper_text: str | None = None
    fetch_source = "unknown"
    if scope:
        pcache = PaperCacheRepo(s, ttl_days=settings.paper_cache_ttl_days)
        cached_paper = await pcache.get(scope.user_id, scope.project_id, pk)
        if cached_paper:
            paper_text = cached_paper.text
            fetch_source = f"cache:{cached_paper.fetch_source}"
            log.info("verify_cache_hit", cache="paper_content", paper_key=pk, chars=len(paper_text))

    # Step 1: fetch PDF and parse — must complete before LLM call
    if not paper_text:
        paper_text, fetch_source = await fetch_paper_content(
            doi=req.doi,
            paper_url=req.paper_url,
            paper_title=req.paper_title,
        )
        if paper_text and scope:
            await PaperCacheRepo(s, ttl_days=settings.paper_cache_ttl_days).set(
                user_id=scope.user_id,
                project_id=scope.project_id,
                paper_key=pk,
                paper_title=req.paper_title,
                doi=req.doi,
                source_url=req.paper_url,
                text=paper_text,
                fetch_source=fetch_source,
            )

    if not paper_text:
        total_ms = int((time.perf_counter() - t_start) * 1000)
        log.info("fetch_failed_inaccessible", total_ms=total_ms, fetch_source=fetch_source)
        return VerifyResponse(
            status="inaccessible",
            reason="Paper could not be fetched (blocked or unavailable).",
            paper_title=req.paper_title,
            doi=req.doi,
        )

    # Step 2: LLM verify against full text
    result, provider = await _llm_verify(req.claim, req.doi, req.paper_title, paper_text)

    if scope:
        await VerifyCacheRepo(s, ttl_days=settings.verify_cache_ttl_days).set(
            user_id=scope.user_id,
            project_id=scope.project_id,
            paper_key=pk,
            claim_hash=ck,
            status=result.status,
            verbatim_quote=result.verbatim_quote,
            confidence=result.confidence,
            reason=result.reason,
            provider_used=provider,
        )
        await s.commit()

    total_ms = int((time.perf_counter() - t_start) * 1000)
    log.info(
        "done",
        status=result.status,
        confidence=round(result.confidence, 2),
        fetch_source=fetch_source,
        provider=provider,
        total_ms=total_ms,
    )
    return result


# ── POST /v1/verify/upload ───────────────────────────────────────────────────


@router.post("/verify/upload", response_model=VerifyResponse)
async def verify_upload(
    pdf: UploadFile,
    claim: str = Form(...),
    doi: str | None = Form(None),
    paper_title: str | None = Form(None),
    s: AsyncSession = Depends(db),
    x_rk_user_id: str | None = Header(default=None, alias="X-RK-User-Id"),
    x_rk_project_id: str | None = Header(default=None, alias="X-RK-Project-Id"),
) -> VerifyResponse:
    t_start = time.perf_counter()
    log.info(
        "upload_request",
        claim=claim[:80],
        doi=doi,
        title=paper_title,
        filename=pdf.filename,
        content_type=pdf.content_type,
    )

    pdf_bytes = await pdf.read()
    log.info("upload_received", bytes=len(pdf_bytes))

    paper_text = _parse_pdf(pdf_bytes)
    if not paper_text:
        return VerifyResponse(
            status="inaccessible",
            reason="Could not extract text from the uploaded PDF.",
            paper_title=paper_title,
            doi=doi,
        )

    scope = _parse_scope(x_rk_user_id, x_rk_project_id)
    settings = get_settings()
    pk = _paper_key(doi, None, paper_title)
    ck = _claim_hash(claim)

    if scope:
        cached_verify = await VerifyCacheRepo(s, ttl_days=settings.verify_cache_ttl_days).get(
            scope.user_id, scope.project_id, pk, ck
        )
        if cached_verify:
            log.info("verify_cache_hit", cache="verify_result_upload", paper_key=pk)
            return VerifyResponse(
                status=cached_verify.status,
                verbatim_quote=cached_verify.verbatim_quote,
                confidence=cached_verify.confidence,
                reason=cached_verify.reason,
                paper_title=paper_title,
                doi=doi,
            )

    result, provider = await _llm_verify(claim, doi, paper_title, paper_text[:_MAX_TEXT_CHARS])

    if scope:
        await VerifyCacheRepo(s, ttl_days=settings.verify_cache_ttl_days).set(
            user_id=scope.user_id,
            project_id=scope.project_id,
            paper_key=pk,
            claim_hash=ck,
            status=result.status,
            verbatim_quote=result.verbatim_quote,
            confidence=result.confidence,
            reason=result.reason,
            provider_used=provider,
        )
        await s.commit()

    total_ms = int((time.perf_counter() - t_start) * 1000)
    log.info(
        "upload_done",
        status=result.status,
        confidence=round(result.confidence, 2),
        provider=provider,
        total_ms=total_ms,
    )
    return result
