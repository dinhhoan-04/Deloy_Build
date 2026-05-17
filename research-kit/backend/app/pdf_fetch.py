"""Robust PDF fetcher for the verify flow.

Fetch order for a given claim:
  1. doi.org/<doi>        — follow redirect; if PDF → parse; if HTML → scrape for PDF link
  2. paper_url            — same treatment
  3. OpenAlex OA lookup   — best_oa_location.pdf_url / oa_url as last resort

If none succeed → returns (None, None, reason_str).
If PDF obtained  → parse with pypdf → return (pdf_bytes, text, "ok_via_<source>").

Caller contract:
  - Always await this before calling the LLM.
  - If text is None, do NOT call the LLM — return not_found directly.
"""

from __future__ import annotations

import asyncio
import io
import random
import re
import time
from urllib.parse import urljoin, urlparse

import httpx

from app.logging import get_logger
from app.openalex import lookup_paper

log = get_logger("pdf_fetch")

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

_PDF_HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.IGNORECASE)
_PDF_HINT_RE = re.compile(
    r"(?:\.pdf(?:$|\?)|/pdf(?:$|/|\?)|download.*pdf|fulltext.*pdf)", re.IGNORECASE
)
_MAX_TEXT_CHARS = 40_000
_FETCH_TIMEOUT = httpx.Timeout(20.0, connect=8.0)

# Per-domain rate limiting (shared process-wide)
_domain_locks: dict[str, asyncio.Lock] = {}
_domain_last_req: dict[str, float] = {}


def _is_pdf(response: httpx.Response, final_url: str) -> bool:
    ctype = (response.headers.get("content-type") or "").lower()
    return "application/pdf" in ctype or str(final_url).lower().endswith(".pdf")


def _scrape_pdf_link(html: str, base_url: str) -> str | None:
    """Return the best PDF candidate URL found in an HTML page."""
    meta_patterns = [
        re.compile(
            r'<meta[^>]+name=["\']citation_pdf_url["\'][^>]+content=["\']([^"\']+)["\']',
            re.IGNORECASE,
        ),
        re.compile(
            r'<meta[^>]+property=["\']og:pdf["\'][^>]+content=["\']([^"\']+)["\']',
            re.IGNORECASE,
        ),
    ]
    for p in meta_patterns:
        m = p.search(html)
        if m:
            return urljoin(base_url, m.group(1))
    for m in _PDF_HREF_RE.finditer(html):
        candidate = m.group(1)
        if candidate and _PDF_HINT_RE.search(candidate):
            return urljoin(base_url, candidate)
    return None


async def _rate_limit(url: str, min_interval: float = 0.75) -> None:
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return
    lock = _domain_locks.setdefault(host, asyncio.Lock())
    async with lock:
        now = time.monotonic()
        wait = min_interval - (now - _domain_last_req.get(host, 0.0))
        if wait > 0:
            await asyncio.sleep(wait)
        _domain_last_req[host] = time.monotonic()


async def _get_once(client: httpx.AsyncClient, url: str) -> tuple[bytes | None, str, str]:
    """Single attempt. Returns (bytes_or_None, final_url, reason)."""
    await _rate_limit(url)
    try:
        resp = await client.get(url)
        final_url = str(resp.url)
        ctype = (resp.headers.get("content-type") or "").lower()
        log.info(
            "fetch_response",
            url=url,
            final_url=final_url,
            status=resp.status_code,
            content_type=ctype,
            size=len(resp.content),
        )

        if resp.status_code >= 400:
            return None, final_url, f"http_{resp.status_code}"

        if _is_pdf(resp, final_url):
            log.info("fetch_is_pdf", url=final_url, bytes=len(resp.content))
            return resp.content, final_url, "ok"

        if "text/html" in ctype:
            html = resp.text[:500_000]
            candidate = _scrape_pdf_link(html, final_url)
            log.info("fetch_html_scrape", url=final_url, pdf_candidate=candidate)
            if candidate:
                await _rate_limit(candidate)
                nested = await client.get(candidate)
                nested_ctype = (nested.headers.get("content-type") or "").lower()
                log.info(
                    "fetch_nested",
                    url=candidate,
                    status=nested.status_code,
                    content_type=nested_ctype,
                    bytes=len(nested.content),
                )
                if nested.status_code < 400 and _is_pdf(nested, str(nested.url)):
                    return nested.content, str(nested.url), "ok_via_html"
                return None, final_url, f"nested_not_pdf:{nested.status_code}"
            return None, final_url, "html_no_pdf_link"

        return None, final_url, f"not_pdf:{ctype or 'unknown'}"

    except httpx.TimeoutException:
        return None, url, "timeout"
    except httpx.HTTPError as e:
        return None, url, f"http_error:{e}"
    except Exception as e:
        return None, url, f"unknown:{e}"


async def _fetch_with_backoff(url: str, attempts: int = 3) -> tuple[bytes | None, str]:
    reason = "unknown"
    async with httpx.AsyncClient(
        timeout=_FETCH_TIMEOUT,
        follow_redirects=True,
        headers=_BROWSER_HEADERS,
    ) as client:
        for i in range(attempts):
            data, _, reason = await _get_once(client, url)
            if data is not None:
                return data, reason
            if reason.startswith(("http_403", "http_429", "timeout")):
                await asyncio.sleep(min(4.0, 0.6 * (2**i) + random.uniform(0, 0.35)))
            elif i < attempts - 1:
                await asyncio.sleep(0.5 + random.uniform(0, 0.2))
            else:
                break
    return None, reason


def _parse_pdf(pdf_bytes: bytes) -> str | None:
    """Extract text from PDF bytes using pypdf. Returns None on failure."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(pdf_bytes))
        parts: list[str] = []
        for page in reader.pages:
            text = page.extract_text() or ""
            parts.append(text)
        full = "\n".join(parts).strip()
        if not full:
            log.warning("pdf_parse_empty_text", pages=len(reader.pages))
            return None
        chars_raw = len(full)
        capped = full[:_MAX_TEXT_CHARS]
        log.info(
            "pdf_parsed",
            pages=len(reader.pages),
            chars_raw=chars_raw,
            chars_capped=len(capped),
            preview=capped[:120].replace("\n", " "),
        )
        return capped
    except Exception as e:
        log.warning("pdf_parse_failed", error=str(e))
        return None


async def fetch_paper_content(
    doi: str | None,
    paper_url: str | None,
    paper_title: str | None = None,
) -> tuple[str | None, str]:
    """Return (parsed_text, source_reason).

    parsed_text is None if no PDF could be fetched and parsed.
    """
    candidates: list[tuple[str, str]] = []
    if doi:
        clean = doi.lstrip("/").replace("https://doi.org/", "")
        candidates.append((f"https://doi.org/{clean}", "doi"))
    if paper_url:
        candidates.append((paper_url, "paper_url"))

    for url, label in candidates:
        log.info("fetch_attempt", url=url, source=label)
        pdf_bytes, reason = await _fetch_with_backoff(url)
        if pdf_bytes:
            text = _parse_pdf(pdf_bytes)
            if text:
                log.info("fetch_ok", source=label, reason=reason, chars=len(text))
                return text, f"ok_via_{label}"
            log.warning("pdf_parse_empty", source=label)

    # OpenAlex fallback
    if doi or paper_title:
        log.info("openalex_lookup", doi=doi, title=paper_title)
        try:
            info = await lookup_paper(doi=doi, title=paper_title)
            if info and info.fulltext_url:
                oa_url = info.fulltext_url
                log.info("openalex_url_found", url=oa_url)
                pdf_bytes, reason = await _fetch_with_backoff(oa_url)
                if pdf_bytes:
                    text = _parse_pdf(pdf_bytes)
                    if text:
                        log.info("fetch_ok", source="openalex", reason=reason, chars=len(text))
                        return text, "ok_via_openalex"
        except Exception as e:
            log.warning("openalex_error", error=str(e))

    log.info("fetch_exhausted", doi=doi, paper_url=paper_url)
    return None, "fetch_failed"
