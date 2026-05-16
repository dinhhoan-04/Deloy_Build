import asyncio
import random
import time
import httpx
from dataclasses import dataclass
from typing import Optional

OPENALEX_BASE = "https://api.openalex.org"
_OPENALEX_MAILTO = "research@researchkit.app"
_OPENALEX_TIMEOUT = 12.0
_OPENALEX_MAX_RETRIES = 4
_OPENALEX_MIN_INTERVAL_SEC = 0.8
_CACHE_TTL_SEC = 600.0
_CACHE_MISS = object()

# Process-local cache + rate-limit state.
_cache: dict[str, tuple[float, Optional["PaperInfo"]]] = {}
_last_openalex_req_at: float = 0.0
_openalex_lock = asyncio.Lock()

@dataclass
class PaperInfo:
    doi: Optional[str]
    title: str
    fulltext_url: Optional[str]
    authors: list[str]
    year: Optional[int]

async def lookup_paper(
    doi: Optional[str] = None,
    title: Optional[str] = None
) -> Optional[PaperInfo]:
    """Lookup paper via OpenAlex. Returns None if not found."""
    cache_key = _build_cache_key(doi=doi, title=title)
    cached = _cache_get(cache_key)
    if cached is not _CACHE_MISS:
        return cached

    async with httpx.AsyncClient(timeout=_OPENALEX_TIMEOUT) as client:
        if doi:
            clean_doi = doi.replace("https://doi.org/", "").strip()
            url = f"{OPENALEX_BASE}/works/doi:{clean_doi}"
            resp = await _openalex_get(client, url, {"mailto": _OPENALEX_MAILTO})
            if resp is None or resp.status_code != 200:
                _cache_set(cache_key, None)
                return None
            data = resp.json()
            parsed = _parse_work(data)
            _cache_set(cache_key, parsed)
            return parsed

        if title:
            resp = await _openalex_get(
                client,
                f"{OPENALEX_BASE}/works",
                {"search": title, "per_page": 1, "mailto": _OPENALEX_MAILTO},
            )
            if resp is None or resp.status_code != 200:
                _cache_set(cache_key, None)
                return None
            results = resp.json().get("results", [])
            if not results:
                _cache_set(cache_key, None)
                return None
            parsed = _parse_work(results[0])
            _cache_set(cache_key, parsed)
            return parsed

    _cache_set(cache_key, None)
    return None


def _build_cache_key(doi: Optional[str], title: Optional[str]) -> str:
    if doi:
        clean = doi.replace("https://doi.org/", "").strip().lower()
        return f"doi:{clean}"
    if title:
        return f"title:{' '.join(title.strip().lower().split())}"
    return "empty"


def _cache_get(key: str) -> Optional[PaperInfo] | object:
    item = _cache.get(key)
    if not item:
        return _CACHE_MISS
    ts, value = item
    if (time.monotonic() - ts) > _CACHE_TTL_SEC:
        _cache.pop(key, None)
        return _CACHE_MISS
    return value


def _cache_set(key: str, value: Optional[PaperInfo]) -> None:
    _cache[key] = (time.monotonic(), value)


async def _openalex_rate_limit() -> None:
    global _last_openalex_req_at
    async with _openalex_lock:
        now = time.monotonic()
        wait = _OPENALEX_MIN_INTERVAL_SEC - (now - _last_openalex_req_at)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_openalex_req_at = time.monotonic()


async def _openalex_get(
    client: httpx.AsyncClient, url: str, params: dict
) -> httpx.Response | None:
    last_resp: httpx.Response | None = None
    for i in range(_OPENALEX_MAX_RETRIES):
        await _openalex_rate_limit()
        try:
            resp = await client.get(url, params=params)
        except httpx.HTTPError:
            if i < _OPENALEX_MAX_RETRIES - 1:
                await asyncio.sleep(min(3.0, 0.4 * (2 ** i) + random.uniform(0, 0.2)))
                continue
            return None

        last_resp = resp
        if resp.status_code == 429:
            if i < _OPENALEX_MAX_RETRIES - 1:
                await asyncio.sleep(min(6.0, 0.8 * (2 ** i) + random.uniform(0, 0.3)))
                continue
            return resp
        if resp.status_code >= 500:
            if i < _OPENALEX_MAX_RETRIES - 1:
                await asyncio.sleep(min(4.0, 0.5 * (2 ** i) + random.uniform(0, 0.2)))
                continue
        return resp
    return last_resp

def _parse_work(data: dict) -> PaperInfo:
    doi_raw = data.get("doi", "")
    doi = doi_raw.replace("https://doi.org/", "") if doi_raw else None

    fulltext_url = None
    best_loc = data.get("best_oa_location")
    if best_loc:
        fulltext_url = best_loc.get("pdf_url") or best_loc.get("landing_page_url")
    if not fulltext_url:
        oa = data.get("open_access", {})
        fulltext_url = oa.get("oa_url")

    authors = [
        a["author"]["display_name"]
        for a in data.get("authorships", [])
        if a.get("author", {}).get("display_name")
    ]

    return PaperInfo(
        doi=doi,
        title=data.get("title", ""),
        fulltext_url=fulltext_url,
        authors=authors,
        year=data.get("publication_year"),
    )
