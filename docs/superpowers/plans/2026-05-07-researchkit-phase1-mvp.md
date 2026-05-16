# ResearchKit Phase 1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Auto-Verify Badge — a Chrome extension that automatically verifies AI-generated claims on Elicit/Consensus/SciSpace pages, injecting inline ✅⚠️❌ badges with verbatim quotes from source papers.

**Architecture:** content.ts extracts claims using a Hybrid Adapter (DOM selectors first, LLM fallback), sends to background service worker which queues verify jobs against the FastAPI backend; backend resolves paper full-text via OpenAlex API then uses Claude to find the verbatim quote; results stream back to content.ts which updates badge DOM nodes progressively.

**Tech Stack:** TypeScript + React (extension), FastAPI + Python 3.11 (backend), Claude API (`claude-sonnet-4-6`) with prompt caching, OpenAlex REST API (free), `chrome.storage.local` for persistence.

---

## File Map

### Backend — New files
| File | Responsibility |
|------|---------------|
| `research-kit/backend/app/openalex.py` | OpenAlex + Unpaywall API client — lookup paper by DOI/title, return full-text URL |
| `research-kit/backend/app/verify_service.py` | Verify logic — fetch paper text, call Claude, return VerifyResult |
| `research-kit/backend/app/extract_service.py` | LLM claim extraction — given raw page text, return structured claims (used by hybrid adapter fallback) |
| `research-kit/backend/tests/test_openalex.py` | Unit tests for OpenAlex client (mocked HTTP) |
| `research-kit/backend/tests/test_verify_service.py` | Unit tests for verify service (mocked Claude + HTTP) |
| `research-kit/backend/tests/test_extract_service.py` | Unit tests for extract service (mocked Claude) |

### Backend — Modified files
| File | Change |
|------|--------|
| `research-kit/backend/app/main_openai.py` | Add `POST /verify` and `POST /extract` routes; add in-memory DOI cache |
| `research-kit/backend/requirements.txt` | Add `anthropic httpx` (openai+groq already present) |

### Extension — New files
| File | Responsibility |
|------|---------------|
| `research-kit/extension/src/shared/verify-types.ts` | Shared types: `ClaimItem`, `VerifyResult`, `VerifyStatus`, verify message constants |
| `research-kit/extension/src/adapters/hybrid.ts` | Hybrid adapter — try DOM extraction, fall back to backend `/extract` if low yield |
| `research-kit/extension/src/content/badge.ts` | DOM badge injection — create/update/remove badge nodes next to claim text |
| `research-kit/extension/src/sidebar/VerifyTab.tsx` | Sidebar "Verify" tab — claim list, filter by status, Save to Inbox stub |
| `research-kit/extension/src/sidebar/ProgressBar.tsx` | Persistent progress bar component with pause/resume |
| `research-kit/extension/src/sidebar/useVerify.ts` | Hook — subscribe to verify progress from background via chrome.runtime messages |

### Extension — Modified files
| File | Change |
|------|--------|
| `research-kit/extension/src/shared/messages.ts` | Add verify message types: `claims:extracted`, `verify:progress`, `verify:result`, `verify:toggle` |
| `research-kit/extension/src/content.ts` | Use hybrid adapter on page load; listen for `verify:result` from background; call badge.ts |
| `research-kit/extension/src/background_minimal.ts` | Add verify job queue (3 concurrent), progress tracking, toggle state, persist results |
| `research-kit/extension/src/sidebar/App.tsx` | Add VerifyTab + ProgressBar; add verify toggle in settings |
| `research-kit/extension/manifest.json` | Ensure `storage` permission present |

---

## Task 1: Backend — OpenAlex API Client

**Files:**
- Create: `research-kit/backend/app/openalex.py`
- Create: `research-kit/backend/tests/test_openalex.py`

- [ ] **Step 1: Write the failing tests**

```python
# research-kit/backend/tests/test_openalex.py
import pytest
from unittest.mock import AsyncMock, patch
from app.openalex import lookup_paper, PaperInfo

@pytest.mark.asyncio
async def test_lookup_by_doi_returns_paper_info():
    mock_response = {
        "doi": "https://doi.org/10.1234/test",
        "title": "Effects of sleep on memory",
        "open_access": {"oa_url": "https://open.example.com/paper.pdf", "is_oa": True},
        "authorships": [{"author": {"display_name": "Walker M"}}],
        "publication_year": 2017,
        "best_oa_location": {"pdf_url": "https://open.example.com/paper.pdf"}
    }
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = mock_response
        result = await lookup_paper(doi="10.1234/test")
    assert result is not None
    assert result.title == "Effects of sleep on memory"
    assert result.fulltext_url == "https://open.example.com/paper.pdf"
    assert result.year == 2017

@pytest.mark.asyncio
async def test_lookup_not_found_returns_none():
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value.status_code = 404
        result = await lookup_paper(doi="10.9999/notreal")
    assert result is None

@pytest.mark.asyncio
async def test_lookup_by_title_fuzzy():
    mock_response = {
        "results": [{
            "doi": "https://doi.org/10.1234/test",
            "title": "Effects of sleep on memory consolidation",
            "open_access": {"oa_url": None, "is_oa": False},
            "authorships": [],
            "publication_year": 2017,
            "best_oa_location": None
        }]
    }
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = mock_response
        result = await lookup_paper(title="Effects of sleep on memory")
    assert result is not None
    assert result.doi == "10.1234/test"
    assert result.fulltext_url is None
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
cd research-kit/backend
pytest tests/test_openalex.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.openalex'`

- [ ] **Step 3: Implement `openalex.py`**

```python
# research-kit/backend/app/openalex.py
from dataclasses import dataclass
from typing import Optional
import httpx

OPENALEX_BASE = "https://api.openalex.org"

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
    async with httpx.AsyncClient(timeout=10.0) as client:
        if doi:
            clean_doi = doi.replace("https://doi.org/", "").strip()
            url = f"{OPENALEX_BASE}/works/doi:{clean_doi}"
            resp = await client.get(url, params={"mailto": "research@researchkit.app"})
            if resp.status_code != 200:
                return None
            data = resp.json()
            return _parse_work(data)

        if title:
            resp = await client.get(
                f"{OPENALEX_BASE}/works",
                params={"search": title, "per_page": 1, "mailto": "research@researchkit.app"}
            )
            if resp.status_code != 200:
                return None
            results = resp.json().get("results", [])
            if not results:
                return None
            return _parse_work(results[0])

    return None

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
```

- [ ] **Step 4: Run tests — confirm PASS**

```bash
pytest tests/test_openalex.py -v
```
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app/openalex.py research-kit/backend/tests/test_openalex.py
git commit -m "feat(backend): OpenAlex API client with DOI and title lookup"
```

---

## Task 2: Backend — Verify Service

**Files:**
- Create: `research-kit/backend/app/verify_service.py`
- Create: `research-kit/backend/tests/test_verify_service.py`
- Modify: `research-kit/backend/requirements.txt` — add `anthropic`

- [ ] **Step 1: Add anthropic to requirements**

```
# research-kit/backend/requirements.txt  (add this line)
anthropic>=0.40.0
```

```bash
cd research-kit/backend
pip install anthropic
```

- [ ] **Step 2: Write failing tests**

```python
# research-kit/backend/tests/test_verify_service.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.verify_service import verify_claim, VerifyResult, VerifyStatus
from app.openalex import PaperInfo

FAKE_PAPER = PaperInfo(
    doi="10.1234/test",
    title="Effects of sleep on memory",
    fulltext_url="https://open.example.com/paper.html",
    authors=["Walker M"],
    year=2017,
)

FAKE_FULLTEXT = """
Abstract: Sleep plays a critical role in memory consolidation.
Results: Participants who slept showed a 40% improvement in recall tasks
compared to those who remained awake (p<0.001).
"""

@pytest.mark.asyncio
async def test_verify_found_returns_verified_with_quote():
    with patch("app.verify_service.lookup_paper", new_callable=AsyncMock, return_value=FAKE_PAPER), \
         patch("app.verify_service._fetch_text", new_callable=AsyncMock, return_value=FAKE_FULLTEXT), \
         patch("app.verify_service._call_claude", new_callable=AsyncMock) as mock_claude:
        mock_claude.return_value = {
            "status": "verified",
            "verbatim_quote": "Participants who slept showed a 40% improvement in recall tasks",
            "confidence": 0.95
        }
        result = await verify_claim(
            claim="Sleep improves memory recall by 40%",
            doi="10.1234/test",
            paper_title="Effects of sleep on memory"
        )
    assert result.status == VerifyStatus.VERIFIED
    assert "40%" in result.verbatim_quote
    assert result.confidence >= 0.9

@pytest.mark.asyncio
async def test_verify_paper_not_found_returns_not_found():
    with patch("app.verify_service.lookup_paper", new_callable=AsyncMock, return_value=None):
        result = await verify_claim(claim="Some claim", doi="10.9999/none", paper_title="Unknown")
    assert result.status == VerifyStatus.NOT_FOUND
    assert result.verbatim_quote is None

@pytest.mark.asyncio
async def test_verify_no_fulltext_returns_partial():
    paper_no_fulltext = PaperInfo(
        doi="10.1234/test", title="Effects of sleep",
        fulltext_url=None, authors=["Walker M"], year=2017
    )
    with patch("app.verify_service.lookup_paper", new_callable=AsyncMock, return_value=paper_no_fulltext):
        result = await verify_claim(claim="Sleep improves memory", doi="10.1234/test", paper_title="Effects of sleep")
    assert result.status == VerifyStatus.PARTIAL
    assert "abstract" in result.reason.lower() or "paywall" in result.reason.lower()
```

- [ ] **Step 3: Run to confirm FAIL**

```bash
pytest tests/test_verify_service.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.verify_service'`

- [ ] **Step 4: Implement `verify_service.py`**

```python
# research-kit/backend/app/verify_service.py
import os
from dataclasses import dataclass
from enum import Enum
from typing import Optional
import httpx
import anthropic

from app.openalex import lookup_paper, PaperInfo

_claude = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

class VerifyStatus(str, Enum):
    VERIFIED = "verified"
    PARTIAL = "partial"
    NOT_FOUND = "not_found"

@dataclass
class VerifyResult:
    status: VerifyStatus
    verbatim_quote: Optional[str]
    confidence: float
    reason: str
    paper_title: Optional[str] = None
    doi: Optional[str] = None

async def verify_claim(
    claim: str,
    doi: Optional[str] = None,
    paper_url: Optional[str] = None,
    paper_title: Optional[str] = None,
) -> VerifyResult:
    paper = await lookup_paper(doi=doi, title=paper_title)
    if paper is None:
        return VerifyResult(
            status=VerifyStatus.NOT_FOUND,
            verbatim_quote=None,
            confidence=0.0,
            reason="Paper not found in OpenAlex"
        )

    fulltext = None
    if paper.fulltext_url:
        fulltext = await _fetch_text(paper.fulltext_url)

    if not fulltext:
        return VerifyResult(
            status=VerifyStatus.PARTIAL,
            verbatim_quote=None,
            confidence=0.0,
            reason="Full text unavailable (paywall or no open access)",
            paper_title=paper.title,
            doi=paper.doi,
        )

    result = await _call_claude(claim=claim, fulltext=fulltext)
    return VerifyResult(
        status=VerifyStatus(result["status"]),
        verbatim_quote=result.get("verbatim_quote"),
        confidence=result.get("confidence", 0.0),
        reason=result.get("reason", ""),
        paper_title=paper.title,
        doi=paper.doi,
    )

async def _fetch_text(url: str) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "ResearchKit/1.0 (mailto:research@researchkit.app)"})
            if resp.status_code != 200:
                return None
            # Crude text extraction — strip HTML tags for now
            text = resp.text
            if "<html" in text.lower():
                import re
                text = re.sub(r"<[^>]+>", " ", text)
                text = re.sub(r"\s+", " ", text)
            return text[:50000]  # Cap at 50k chars for Claude context
    except Exception:
        return None

async def _call_claude(claim: str, fulltext: str) -> dict:
    prompt = f"""You are a scientific claim verifier. Given a claim and a paper's full text, determine if the claim is supported.

CLAIM: {claim}

PAPER TEXT (may be truncated):
{fulltext}

Respond with JSON only:
{{
  "status": "verified" | "not_found",
  "verbatim_quote": "<exact quote from paper that supports/refutes, or null>",
  "confidence": <0.0-1.0>,
  "reason": "<one sentence explanation>"
}}"""

    response = await _claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
        system="You verify scientific claims against paper text. Always respond with valid JSON only.",
    )
    import json
    text = response.content[0].text.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())
```

- [ ] **Step 5: Run tests — confirm PASS**

```bash
pytest tests/test_verify_service.py -v
```
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add research-kit/backend/app/verify_service.py research-kit/backend/tests/test_verify_service.py research-kit/backend/requirements.txt
git commit -m "feat(backend): verify service with OpenAlex + Claude verbatim quote verification"
```

---

## Task 3: Backend — Extract Service (Hybrid Adapter Fallback)

**Files:**
- Create: `research-kit/backend/app/extract_service.py`
- Create: `research-kit/backend/tests/test_extract_service.py`

- [ ] **Step 1: Write failing tests**

```python
# research-kit/backend/tests/test_extract_service.py
import pytest
from unittest.mock import AsyncMock, patch
from app.extract_service import extract_claims, ClaimExtraction

SAMPLE_PAGE_TEXT = """
Research question: Does sleep improve memory?

Walker 2017 found that participants who slept showed improved recall.
Citation: Walker, M. (2017). Why We Sleep. doi:10.1234/walker2017

Smith 2020 reported that REM sleep accounts for consolidation.
Citation: Smith et al. (2020). Sleep Science. doi:10.1234/smith2020
"""

@pytest.mark.asyncio
async def test_extract_returns_claims_with_dois():
    mock_result = [
        {"claim": "participants who slept showed improved recall", "paper_title": "Why We Sleep", "doi": "10.1234/walker2017", "authors": ["Walker M"], "year": 2017},
        {"claim": "REM sleep accounts for consolidation", "paper_title": "Sleep Science", "doi": "10.1234/smith2020", "authors": ["Smith"], "year": 2020},
    ]
    with patch("app.extract_service._call_claude", new_callable=AsyncMock, return_value=mock_result):
        results = await extract_claims(page_text=SAMPLE_PAGE_TEXT, site="elicit")
    assert len(results) == 2
    assert results[0].doi == "10.1234/walker2017"
    assert "recall" in results[0].claim

@pytest.mark.asyncio
async def test_extract_empty_page_returns_empty():
    with patch("app.extract_service._call_claude", new_callable=AsyncMock, return_value=[]):
        results = await extract_claims(page_text="   ", site="elicit")
    assert results == []
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
pytest tests/test_extract_service.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.extract_service'`

- [ ] **Step 3: Implement `extract_service.py`**

```python
# research-kit/backend/app/extract_service.py
import os
import json
from dataclasses import dataclass
from typing import Optional
import anthropic

_claude = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

@dataclass
class ClaimExtraction:
    claim: str
    paper_title: Optional[str]
    doi: Optional[str]
    authors: list[str]
    year: Optional[int]

async def extract_claims(page_text: str, site: str) -> list[ClaimExtraction]:
    if not page_text.strip():
        return []
    raw = await _call_claude(page_text=page_text[:30000], site=site)
    return [
        ClaimExtraction(
            claim=item.get("claim", ""),
            paper_title=item.get("paper_title"),
            doi=item.get("doi"),
            authors=item.get("authors", []),
            year=item.get("year"),
        )
        for item in raw
        if item.get("claim")
    ]

async def _call_claude(page_text: str, site: str) -> list[dict]:
    prompt = f"""Extract all AI-generated claims and their cited papers from this {site} research tool page.

PAGE TEXT:
{page_text}

Return a JSON array. Each item:
{{
  "claim": "<the specific factual claim made>",
  "paper_title": "<title of cited paper or null>",
  "doi": "<DOI without https://doi.org/ prefix, or null>",
  "authors": ["<last name>"],
  "year": <year or null>
}}

Return [] if no claims found. JSON only, no explanation."""

    response = await _claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
        system="Extract structured claim data. Respond with valid JSON array only.",
    )
    text = response.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())
```

- [ ] **Step 4: Run tests — confirm PASS**

```bash
pytest tests/test_extract_service.py -v
```
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app/extract_service.py research-kit/backend/tests/test_extract_service.py
git commit -m "feat(backend): LLM claim extraction service for hybrid adapter fallback"
```

---

## Task 4: Backend — Wire Routes into FastAPI App

**Files:**
- Modify: `research-kit/backend/app/main_openai.py`

- [ ] **Step 1: Add Pydantic models + routes to `main_openai.py`**

Open `research-kit/backend/app/main_openai.py`. After the existing imports block (after line ~22), add:

```python
from pydantic import BaseModel
from typing import Optional
from app.verify_service import verify_claim, VerifyResult
from app.extract_service import extract_claims, ClaimExtraction

# In-memory DOI cache — key: doi, value: VerifyResult
_verify_cache: dict[str, VerifyResult] = {}

class VerifyRequest(BaseModel):
    claim: str
    doi: Optional[str] = None
    paper_url: Optional[str] = None
    paper_title: Optional[str] = None

class ExtractRequest(BaseModel):
    page_text: str
    site: str  # "elicit" | "consensus" | "scispace"
```

Then after the existing `/health` route, add:

```python
@app.post("/verify")
async def verify_endpoint(req: VerifyRequest):
    cache_key = req.doi or req.paper_title or req.claim[:80]
    if cache_key in _verify_cache:
        return _verify_cache[cache_key]
    result = await verify_claim(
        claim=req.claim,
        doi=req.doi,
        paper_url=req.paper_url,
        paper_title=req.paper_title,
    )
    if result.status != "not_found":
        _verify_cache[cache_key] = result
    return result

@app.post("/extract")
async def extract_endpoint(req: ExtractRequest):
    claims = await extract_claims(page_text=req.page_text, site=req.site)
    return {"claims": [vars(c) for c in claims]}
```

- [ ] **Step 2: Test routes manually**

```bash
cd research-kit/backend
python -m uvicorn app.main_openai:app --port 9000
```

In a second terminal:
```bash
curl -s http://localhost:9000/health
# Expected: {"status":"healthy",...}

curl -s -X POST http://localhost:9000/extract \
  -H "Content-Type: application/json" \
  -d '{"page_text":"Walker 2017 found sleep improves memory doi:10.1038/test","site":"elicit"}'
# Expected: {"claims":[{"claim":...,"doi":"10.1038/test",...}]}
```

- [ ] **Step 3: Commit**

```bash
git add research-kit/backend/app/main_openai.py
git commit -m "feat(backend): add /verify and /extract REST endpoints with DOI cache"
```

---

## Task 5: Extension — Shared Verify Types & Messages

**Files:**
- Create: `research-kit/extension/src/shared/verify-types.ts`
- Modify: `research-kit/extension/src/shared/messages.ts`

- [ ] **Step 1: Create `verify-types.ts`**

```typescript
// research-kit/extension/src/shared/verify-types.ts

export type VerifyStatus = 'verified' | 'partial' | 'not_found' | 'pending' | 'error'

export interface ClaimItem {
  id: string           // unique per claim on page, e.g. sha1 of claim text
  claim: string
  doi: string | null
  paperTitle: string | null
  paperUrl: string | null
  sourceToolSite: string  // 'elicit' | 'consensus' | 'scispace'
  domAnchor: string    // CSS selector or text snippet to find the DOM node
}

export interface VerifyResult {
  claimId: string
  status: VerifyStatus
  verbatimQuote: string | null
  confidence: number
  reason: string
  paperTitle: string | null
  doi: string | null
}

export interface VerifyProgress {
  tabId: number
  total: number
  completed: number
  running: number
  paused: boolean
}
```

- [ ] **Step 2: Update `messages.ts`**

Replace the entire content of `research-kit/extension/src/shared/messages.ts` with:

```typescript
// existing constants kept, new ones added
export const MSG_READY = 'site:ready'
export const MSG_EXTRACT = 'panel:extract'
export const MSG_VERIFY = 'panel:verify'
export const MSG_STATE_UPDATE = 'bg:state:update'
export const MSG_STATE_INIT = 'bg:state:init'

// New verify pipeline messages
export const MSG_CLAIMS_EXTRACTED = 'claims:extracted'
export const MSG_VERIFY_PROGRESS = 'verify:progress'
export const MSG_VERIFY_RESULT = 'verify:result'
export const MSG_VERIFY_TOGGLE = 'verify:toggle'
export const MSG_VERIFY_PAUSE = 'verify:pause'

import type { ClaimItem, VerifyResult, VerifyProgress } from './verify-types'

export interface MessageReady { type: typeof MSG_READY; hasContent: boolean }
export interface MessageExtract { type: typeof MSG_EXTRACT }
export interface MessageVerify { type: typeof MSG_VERIFY }
export interface MessageStateUpdate { type: typeof MSG_STATE_UPDATE; state: Map<number, any> }
export interface MessageStateInit { type: typeof MSG_STATE_INIT; state: Map<number, any> }
export interface MessageClaimsExtracted { type: typeof MSG_CLAIMS_EXTRACTED; tabId: number; claims: ClaimItem[] }
export interface MessageVerifyProgress { type: typeof MSG_VERIFY_PROGRESS; progress: VerifyProgress }
export interface MessageVerifyResult { type: typeof MSG_VERIFY_RESULT; result: VerifyResult }
export interface MessageVerifyToggle { type: typeof MSG_VERIFY_TOGGLE; enabled: boolean }
export interface MessageVerifyPause { type: typeof MSG_VERIFY_PAUSE; paused: boolean }
```

- [ ] **Step 3: Build to confirm TypeScript compiles**

```bash
cd research-kit/extension
npm run build 2>&1 | tail -20
```
Expected: build succeeds (0 errors)

- [ ] **Step 4: Commit**

```bash
git add research-kit/extension/src/shared/verify-types.ts research-kit/extension/src/shared/messages.ts
git commit -m "feat(extension): add verify types and message constants"
```

---

## Task 6: Extension — Hybrid Adapter

**Files:**
- Create: `research-kit/extension/src/adapters/hybrid.ts`

The hybrid adapter tries DOM extraction (existing adapters) first. If yield is below threshold (< 2 claims), it calls the backend `/extract` endpoint with the page's raw text.

- [ ] **Step 1: Create `hybrid.ts`**

```typescript
// research-kit/extension/src/adapters/hybrid.ts
import { registry } from './registry'
import type { ClaimItem } from '../shared/verify-types'

const BACKEND_URL = 'http://localhost:9000'
const MIN_DOM_CLAIMS = 2  // fall back to LLM if DOM yields fewer than this

export async function extractClaimsHybrid(
  url: string,
  site: 'elicit' | 'consensus' | 'scispace'
): Promise<ClaimItem[]> {
  // Step 1: Try DOM extraction via existing adapter
  const adapter = registry.getAdapter(url)
  let domClaims: ClaimItem[] = []

  if (adapter) {
    try {
      const pageModel = await adapter.extract()
      if (pageModel) {
        domClaims = pageModelToClaims(pageModel, site)
      }
    } catch {
      // DOM extraction failed silently — proceed to LLM fallback
    }
  }

  if (domClaims.length >= MIN_DOM_CLAIMS) {
    return domClaims
  }

  // Step 2: LLM fallback — send page text to backend /extract
  const pageText = document.body.innerText.slice(0, 30000)
  try {
    const resp = await fetch(`${BACKEND_URL}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_text: pageText, site }),
    })
    if (!resp.ok) return domClaims

    const data = await resp.json()
    const llmClaims: ClaimItem[] = (data.claims ?? []).map((c: any, i: number) =>
      rawToClaim(c, site, `llm-${i}`)
    )

    // Merge: LLM claims take priority, dedupe by doi
    const merged = new Map<string, ClaimItem>()
    for (const c of [...domClaims, ...llmClaims]) {
      const key = c.doi ?? c.claim.slice(0, 60)
      merged.set(key, c)
    }
    return Array.from(merged.values())
  } catch {
    return domClaims
  }
}

function pageModelToClaims(
  pageModel: import('./types').PageModel,
  site: string
): ClaimItem[] {
  const claims: ClaimItem[] = []
  for (const citation of pageModel.citations ?? []) {
    if (!citation.title && !citation.doi) continue
    claims.push({
      id: `dom-${citation.id}`,
      claim: citation.label ?? citation.title ?? '',
      doi: citation.doi ?? null,
      paperTitle: citation.title ?? null,
      paperUrl: citation.url ?? null,
      sourceToolSite: site,
      domAnchor: citation.rawAnchorText,
    })
  }
  // Also extract from answer paragraphs if present
  if (pageModel.answer?.paragraphs) {
    for (const para of pageModel.answer.paragraphs) {
      if (para.text.length > 20) {
        claims.push({
          id: `dom-para-${para.id}`,
          claim: para.text,
          doi: null,
          paperTitle: null,
          paperUrl: null,
          sourceToolSite: site,
          domAnchor: para.text.slice(0, 50),
        })
      }
    }
  }
  return claims
}

function rawToClaim(raw: any, site: string, fallbackId: string): ClaimItem {
  const id = raw.doi ? `claim-${raw.doi}` : `claim-${fallbackId}`
  return {
    id,
    claim: raw.claim ?? '',
    doi: raw.doi ?? null,
    paperTitle: raw.paper_title ?? null,
    paperUrl: null,
    sourceToolSite: site,
    domAnchor: (raw.claim ?? '').slice(0, 60),
  }
}
```

- [ ] **Step 2: Build to confirm no TypeScript errors**

```bash
cd research-kit/extension
npm run build 2>&1 | grep -E "error|warning" | head -20
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add research-kit/extension/src/adapters/hybrid.ts
git commit -m "feat(extension): hybrid adapter — DOM extraction with LLM fallback"
```

---

## Task 7: Extension — Badge Injection

**Files:**
- Create: `research-kit/extension/src/content/badge.ts`

Badges are `<span>` nodes injected next to claim text in the page DOM. Each badge has a stable `data-rk-claim-id` attribute so it can be updated when verify results arrive.

- [ ] **Step 1: Create `badge.ts`**

```typescript
// research-kit/extension/src/content/badge.ts
import type { VerifyResult, VerifyStatus } from '../shared/verify-types'

const BADGE_CLASS = 'rk-verify-badge'

const STATUS_CONFIG: Record<VerifyStatus, { icon: string; bg: string; label: string }> = {
  pending:   { icon: '⋯', bg: '#1e293b', label: 'Verifying...' },
  verified:  { icon: '✓', bg: '#166534', label: 'Verified' },
  partial:   { icon: '~', bg: '#713f12', label: 'Partial — limited access' },
  not_found: { icon: '✗', bg: '#7f1d1d', label: 'Not found in paper' },
  error:     { icon: '!', bg: '#4a1d1d', label: 'Error during verify' },
}

export function injectPendingBadge(claimId: string, domAnchor: string): void {
  // Find the DOM node containing this text anchor
  const node = findTextNode(domAnchor)
  if (!node || document.querySelector(`[data-rk-claim-id="${claimId}"]`)) return

  const badge = createBadge(claimId, 'pending')
  node.parentElement?.insertAdjacentElement('afterend', badge)
}

export function updateBadge(result: VerifyResult): void {
  const badge = document.querySelector(`[data-rk-claim-id="${result.claimId}"]`) as HTMLElement
  if (!badge) return

  const cfg = STATUS_CONFIG[result.status]
  badge.textContent = cfg.icon
  badge.style.background = cfg.bg
  badge.title = buildTooltipText(result)
  badge.setAttribute('data-rk-status', result.status)
}

export function clearAllBadges(): void {
  document.querySelectorAll(`.${BADGE_CLASS}`).forEach(el => el.remove())
}

function createBadge(claimId: string, status: VerifyStatus): HTMLElement {
  const cfg = STATUS_CONFIG[status]
  const badge = document.createElement('span')
  badge.className = BADGE_CLASS
  badge.setAttribute('data-rk-claim-id', claimId)
  badge.setAttribute('data-rk-status', status)
  badge.textContent = cfg.icon
  badge.style.cssText = `
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 50%;
    background: ${cfg.bg}; color: white; font-size: 10px; font-weight: bold;
    margin-left: 4px; cursor: help; vertical-align: middle;
    font-family: monospace; line-height: 1; flex-shrink: 0;
  `
  badge.title = cfg.label
  return badge
}

function buildTooltipText(result: VerifyResult): string {
  const parts = [STATUS_CONFIG[result.status].label]
  if (result.paperTitle) parts.push(`Paper: ${result.paperTitle}`)
  if (result.verbatimQuote) parts.push(`Quote: "${result.verbatimQuote}"`)
  if (result.reason) parts.push(`Note: ${result.reason}`)
  return parts.join('\n')
}

function findTextNode(anchor: string): Element | null {
  if (!anchor || anchor.length < 5) return null
  const searchText = anchor.slice(0, 50).toLowerCase()

  // Walk all text-containing elements, find first match
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.textContent?.toLowerCase().includes(searchText)) {
      return node.parentElement
    }
  }
  return null
}
```

- [ ] **Step 2: Build**

```bash
cd research-kit/extension && npm run build 2>&1 | grep error | head -10
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add research-kit/extension/src/content/badge.ts
git commit -m "feat(extension): badge injection module for inline claim verification status"
```

---

## Task 8: Extension — Background Verify Queue

**Files:**
- Modify: `research-kit/extension/src/background_minimal.ts`

The background service worker manages the verify queue. It runs even when the sidebar is closed.

- [ ] **Step 1: Replace `background_minimal.ts` entirely**

```typescript
// research-kit/extension/src/background_minimal.ts
import {
  MSG_CLAIMS_EXTRACTED, MSG_VERIFY_PROGRESS, MSG_VERIFY_RESULT,
  MSG_VERIFY_TOGGLE, MSG_VERIFY_PAUSE,
  type MessageClaimsExtracted, type MessageVerifyToggle, type MessageVerifyPause
} from './shared/messages'
import type { ClaimItem, VerifyResult, VerifyProgress } from './shared/verify-types'

const BACKEND_URL = 'http://localhost:9000'
const MAX_CONCURRENT = 3

// State
let verifyEnabled = true
let paused = false
const queue: ClaimItem[] = []
const inFlight = new Set<string>()
const results = new Map<string, VerifyResult>()  // claimId → result
const progressByTab = new Map<number, VerifyProgress>()

// Open side panel on icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('verifyEnabled', ({ verifyEnabled: v }) => {
    if (v !== undefined) verifyEnabled = v
  })
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MSG_CLAIMS_EXTRACTED) {
    const { tabId, claims } = msg as MessageClaimsExtracted
    if (!verifyEnabled) return
    enqueueForTab(tabId, claims)
    sendResponse({ ok: true })
    return
  }
  if (msg.type === MSG_VERIFY_TOGGLE) {
    verifyEnabled = (msg as MessageVerifyToggle).enabled
    chrome.storage.local.set({ verifyEnabled })
    if (!verifyEnabled) { queue.length = 0; inFlight.clear() }
    return
  }
  if (msg.type === MSG_VERIFY_PAUSE) {
    paused = (msg as MessageVerifyPause).paused
    if (!paused) pump()
    return
  }
  // Sidebar requesting all stored results for current tab
  if (msg.type === 'verify:get_results') {
    sendResponse({ results: Object.fromEntries(results) })
    return true  // async
  }
})

function enqueueForTab(tabId: number, claims: ClaimItem[]) {
  const existing = new Set(queue.map(c => c.id))
  const fresh = claims.filter(c => !existing.has(c.id) && !results.has(c.id))
  queue.push(...fresh)

  progressByTab.set(tabId, {
    tabId,
    total: (progressByTab.get(tabId)?.total ?? 0) + fresh.length,
    completed: progressByTab.get(tabId)?.completed ?? 0,
    running: inFlight.size,
    paused,
  })
  broadcastProgress(tabId)
  pump()
}

function pump() {
  if (paused || !verifyEnabled) return
  while (inFlight.size < MAX_CONCURRENT && queue.length > 0) {
    const claim = queue.shift()!
    inFlight.add(claim.id)
    verifyOne(claim).then(() => {
      inFlight.delete(claim.id)
      pump()
    })
  }
}

async function verifyOne(claim: ClaimItem) {
  try {
    const resp = await fetch(`${BACKEND_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claim: claim.claim,
        doi: claim.doi,
        paper_url: claim.paperUrl,
        paper_title: claim.paperTitle,
      }),
    })
    const data = await resp.json()
    const result: VerifyResult = {
      claimId: claim.id,
      status: data.status,
      verbatimQuote: data.verbatim_quote ?? null,
      confidence: data.confidence ?? 0,
      reason: data.reason ?? '',
      paperTitle: data.paper_title ?? claim.paperTitle,
      doi: data.doi ?? claim.doi,
    }
    results.set(claim.id, result)
    broadcastResult(result)
  } catch {
    const errorResult: VerifyResult = {
      claimId: claim.id, status: 'error',
      verbatimQuote: null, confidence: 0, reason: 'Network error',
      paperTitle: claim.paperTitle, doi: claim.doi,
    }
    results.set(claim.id, errorResult)
    broadcastResult(errorResult)
  }

  // Update progress for all tabs
  for (const [tabId, prog] of progressByTab) {
    progressByTab.set(tabId, { ...prog, completed: prog.completed + 1, running: inFlight.size })
    broadcastProgress(tabId)
  }
}

function broadcastResult(result: VerifyResult) {
  // To content scripts in all tabs
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: MSG_VERIFY_RESULT, result }).catch(() => {})
      }
    }
  })
  // To sidebar
  chrome.runtime.sendMessage({ type: MSG_VERIFY_RESULT, result }).catch(() => {})
}

function broadcastProgress(tabId: number) {
  const progress = progressByTab.get(tabId)
  if (!progress) return
  chrome.runtime.sendMessage({ type: MSG_VERIFY_PROGRESS, progress }).catch(() => {})
}
```

- [ ] **Step 2: Build**

```bash
cd research-kit/extension && npm run build 2>&1 | grep error | head -10
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add research-kit/extension/src/background_minimal.ts
git commit -m "feat(extension): background verify queue — 3 concurrent, progress tracking, survives panel close"
```

---

## Task 9: Extension — Update content.ts

**Files:**
- Modify: `research-kit/extension/src/content.ts`

- [ ] **Step 1: Replace `content.ts`**

Read the current file first to understand existing `page-detected` logic, then replace with:

```typescript
// research-kit/extension/src/content.ts
import { detectSite } from './shared/site-detect'
import { extractClaimsHybrid } from './adapters/hybrid'
import { injectPendingBadge, updateBadge, clearAllBadges } from './content/badge'
import { MSG_CLAIMS_EXTRACTED, MSG_VERIFY_RESULT, type MessageVerifyResult } from './shared/messages'

const site = detectSite(window.location.href)
if (!site) {
  // Not a supported research site — do nothing
} else {
  init()
}

async function init() {
  // Notify background that page is loaded on a supported site
  chrome.runtime.sendMessage({ type: 'site:ready', hasContent: true })

  // Wait a moment for the page to fully render (SPA delay)
  await new Promise(r => setTimeout(r, 1500))

  await runExtraction()

  // Re-run on URL changes (SPA navigation)
  let lastUrl = location.href
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      clearAllBadges()
      setTimeout(runExtraction, 1500)
    }
  }).observe(document, { subtree: true, childList: true })

  // Listen for verify results from background → update badges
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MSG_VERIFY_RESULT) {
      const { result } = msg as MessageVerifyResult
      updateBadge(result)
    }
  })
}

async function runExtraction() {
  const claims = await extractClaimsHybrid(window.location.href, site!)
  if (claims.length === 0) return

  const tabId = await getTabId()

  // Inject pending badges immediately
  for (const claim of claims) {
    injectPendingBadge(claim.id, claim.domAnchor)
  }

  // Send claims to background for verify queue
  chrome.runtime.sendMessage({
    type: MSG_CLAIMS_EXTRACTED,
    tabId,
    claims,
  })
}

async function getTabId(): Promise<number> {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'get:tabid' }, (resp) => {
      resolve(resp?.tabId ?? 0)
    })
  })
}
```

Also add to `background_minimal.ts` — inside the `onMessage` listener, add this handler:

```typescript
  if (msg.type === 'get:tabid') {
    sendResponse({ tabId: sender.tab?.id ?? 0 })
    return true
  }
```

- [ ] **Step 2: Build**

```bash
cd research-kit/extension && npm run build 2>&1 | grep error | head -10
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add research-kit/extension/src/content.ts research-kit/extension/src/background_minimal.ts
git commit -m "feat(extension): content script extracts claims + injects pending badges on page load"
```

---

## Task 10: Extension — Sidebar Verify Tab

**Files:**
- Create: `research-kit/extension/src/sidebar/ProgressBar.tsx`
- Create: `research-kit/extension/src/sidebar/VerifyTab.tsx`
- Create: `research-kit/extension/src/sidebar/useVerify.ts`
- Modify: `research-kit/extension/src/sidebar/App.tsx`

- [ ] **Step 1: Create `useVerify.ts`**

```typescript
// research-kit/extension/src/sidebar/useVerify.ts
import { useState, useEffect } from 'react'
import { MSG_VERIFY_PROGRESS, MSG_VERIFY_RESULT, MSG_VERIFY_TOGGLE, MSG_VERIFY_PAUSE } from '../shared/messages'
import type { VerifyResult, VerifyProgress } from '../shared/verify-types'

export function useVerify() {
  const [results, setResults] = useState<Record<string, VerifyResult>>({})
  const [progress, setProgress] = useState<VerifyProgress | null>(null)
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    chrome.storage.local.get('verifyEnabled', ({ verifyEnabled }) => {
      if (verifyEnabled !== undefined) setEnabled(verifyEnabled)
    })

    const listener = (msg: any) => {
      if (msg.type === MSG_VERIFY_RESULT) {
        setResults(prev => ({ ...prev, [msg.result.claimId]: msg.result }))
      }
      if (msg.type === MSG_VERIFY_PROGRESS) {
        setProgress(msg.progress)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const toggleEnabled = (val: boolean) => {
    setEnabled(val)
    chrome.runtime.sendMessage({ type: MSG_VERIFY_TOGGLE, enabled: val })
  }

  const togglePause = () => {
    const newPaused = !progress?.paused
    chrome.runtime.sendMessage({ type: MSG_VERIFY_PAUSE, paused: newPaused })
    if (progress) setProgress({ ...progress, paused: newPaused })
  }

  return { results, progress, enabled, toggleEnabled, togglePause }
}
```

- [ ] **Step 2: Create `ProgressBar.tsx`**

```tsx
// research-kit/extension/src/sidebar/ProgressBar.tsx
import type { VerifyProgress } from '../shared/verify-types'

interface Props {
  progress: VerifyProgress | null
  enabled: boolean
  onTogglePause: () => void
}

export function ProgressBar({ progress, enabled, onTogglePause }: Props) {
  if (!enabled || !progress || progress.total === 0) return null

  const pct = Math.round((progress.completed / progress.total) * 100)
  const done = progress.completed >= progress.total

  return (
    <div style={{ padding: '6px 12px', background: '#1c1f2e', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap' }}>
        {done ? `✓ ${progress.total} verified` : `Verifying ${progress.completed}/${progress.total}`}
      </span>
      <div style={{ flex: 1, height: 4, background: '#1e293b', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: done ? '#166534' : '#f59e0b', borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 9, color: '#64748b' }}>{pct}%</span>
      {!done && (
        <button
          onClick={onTogglePause}
          style={{ fontSize: 9, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
        >
          {progress.paused ? '▶' : '⏸'}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create `VerifyTab.tsx`**

```tsx
// research-kit/extension/src/sidebar/VerifyTab.tsx
import type { VerifyResult, VerifyStatus } from '../shared/verify-types'

interface Props {
  results: Record<string, VerifyResult>
  enabled: boolean
  onToggleEnabled: (val: boolean) => void
}

const STATUS_LABEL: Record<VerifyStatus, string> = {
  verified: '✅ Verified',
  partial: '⚠️ Partial',
  not_found: '❌ Not Found',
  pending: '⋯ Pending',
  error: '! Error',
}

const STATUS_COLOR: Record<VerifyStatus, string> = {
  verified: '#4ade80', partial: '#fbbf24', not_found: '#f87171',
  pending: '#94a3b8', error: '#f87171',
}

export function VerifyTab({ results, enabled, onToggleEnabled }: Props) {
  const list = Object.values(results)
  const counts = { verified: 0, partial: 0, not_found: 0 }
  for (const r of list) {
    if (r.status in counts) counts[r.status as keyof typeof counts]++
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
      {/* Toggle row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>Auto-verify</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => onToggleEnabled(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span style={{ fontSize: 11, color: enabled ? '#4ade80' : '#64748b' }}>{enabled ? 'ON' : 'OFF'}</span>
        </label>
      </div>

      {/* Summary row */}
      {list.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {(['verified', 'partial', 'not_found'] as const).map(s => (
            counts[s] > 0 && (
              <span key={s} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#1e293b', color: STATUS_COLOR[s] }}>
                {counts[s]} {s === 'not_found' ? 'not found' : s}
              </span>
            )
          ))}
        </div>
      )}

      {/* Claim list */}
      {list.length === 0 && (
        <p style={{ fontSize: 11, color: '#475569', textAlign: 'center', marginTop: 24 }}>
          {enabled ? 'No claims verified yet on this page.' : 'Auto-verify is off.'}
        </p>
      )}
      {list.map(result => (
        <div key={result.claimId} style={{
          background: '#0f172a', border: `1px solid ${STATUS_COLOR[result.status]}33`,
          borderRadius: 8, padding: 10,
        }}>
          <div style={{ fontSize: 10, color: STATUS_COLOR[result.status], marginBottom: 3 }}>
            {STATUS_LABEL[result.status]}
          </div>
          {result.paperTitle && (
            <div style={{ fontSize: 10, color: '#cbd5e1', marginBottom: 3 }}>{result.paperTitle}</div>
          )}
          {result.verbatimQuote && (
            <div style={{
              fontSize: 10, color: '#94a3b8', fontStyle: 'italic',
              background: '#1e293b', borderRadius: 4, padding: '4px 8px', marginTop: 4
            }}>
              "{result.verbatimQuote.slice(0, 120)}{result.verbatimQuote.length > 120 ? '…' : ''}"
            </div>
          )}
          {result.reason && !result.verbatimQuote && (
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>{result.reason}</div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Update `App.tsx` to add Verify tab**

Open `research-kit/extension/src/sidebar/App.tsx`. Add these imports at the top:

```typescript
import { VerifyTab } from './VerifyTab'
import { ProgressBar } from './ProgressBar'
import { useVerify } from './useVerify'
```

Inside the `App` component, add:

```typescript
const { results, progress, enabled, toggleEnabled, togglePause } = useVerify()
const [activeTab, setActiveTab] = useState<'verify' | 'chat'>('verify')
```

Replace the existing return JSX to add a tab bar at the top with Verify as the first tab:

```tsx
return (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
    {/* Header */}
    <div style={{ padding: '8px 12px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>🔬 ResearchKit</span>
    </div>

    {/* Progress bar — always visible when running */}
    <ProgressBar progress={progress} enabled={enabled} onTogglePause={togglePause} />

    {/* Tab nav */}
    <div style={{ display: 'flex', borderBottom: '1px solid #334155' }}>
      {(['verify', 'chat'] as const).map(tab => (
        <button key={tab} onClick={() => setActiveTab(tab)} style={{
          flex: 1, padding: '7px 0', fontSize: 11, fontWeight: 600,
          background: 'none', border: 'none', cursor: 'pointer',
          color: activeTab === tab ? '#60a5fa' : '#64748b',
          borderBottom: activeTab === tab ? '2px solid #60a5fa' : '2px solid transparent',
        }}>
          {tab === 'verify' ? '✓ Verify' : '💬 Chat'}
        </button>
      ))}
    </div>

    {/* Tab content */}
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {activeTab === 'verify' && (
        <VerifyTab results={results} enabled={enabled} onToggleEnabled={toggleEnabled} />
      )}
      {activeTab === 'chat' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Existing chat UI goes here — keep all existing chat JSX */}
          <ActiveContextStrip tabs={tabs} selectedTabIds={selectedTabIds} onToggle={toggleTabSelection} />
          <ChatThread messages={messages} />
          {/* ... rest of existing chat UI */}
        </div>
      )}
    </div>
  </div>
)
```

> Note: preserve all existing chat state and hooks (`useOpenClawAgent`, `usePageModels`, etc.) — only add the new tab structure around them.

- [ ] **Step 5: Build**

```bash
cd research-kit/extension && npm run build 2>&1 | grep error | head -10
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/sidebar/
git commit -m "feat(extension): sidebar VerifyTab with progress bar, claim list, and toggle"
```

---

## Task 11: Integration Smoke Test

Manual test to confirm the full pipeline works end-to-end.

- [ ] **Step 1: Start backend**

```bash
cd research-kit/backend
python -m uvicorn app.main_openai:app --port 9000 --reload
# Verify: curl http://localhost:9000/health → {"status":"healthy"}
```

- [ ] **Step 2: Build and load extension**

```bash
cd research-kit/extension && npm run build
```
In Chrome: `chrome://extensions/` → Enable Developer Mode → Load unpacked → select `research-kit/extension/dist/`

- [ ] **Step 3: Test extraction**

Open `https://elicit.com`, search for any topic. Open DevTools console.
Expected: no JS errors. Background service worker logs should show "claims extracted".

- [ ] **Step 4: Test verify badge**

With the page loaded, open the sidebar (click extension icon or from side panel).
Expected:
- Progress bar appears: "Verifying X/Y claims..."
- After ~5-30s (depending on number of claims), badges ✅/⚠️/❌ appear inline next to AI-generated text
- Hover over a badge → tooltip shows verbatim quote or reason

- [ ] **Step 5: Test toggle**

In the sidebar Verify tab, toggle "Auto-verify" OFF.
Expected: progress bar disappears, no new API calls. Toggle ON → verification resumes.

- [ ] **Step 6: Test pause**

Click ⏸ on progress bar.
Expected: progress freezes. Click ▶ → resumes.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: ResearchKit Phase 1 MVP complete — auto-verify badges with OpenAlex + Claude"
```

---

## Checklist: Spec Coverage

| Spec requirement | Covered by |
|-----------------|-----------|
| Auto-Verify Badge inline on DOM | Task 7 (badge.ts) + Task 9 (content.ts) |
| Verify Progress Indicator with pause/resume | Task 10 (ProgressBar.tsx) + Task 8 (background queue) |
| Claim Tooltip with verbatim quote | Task 7 (badge tooltip) |
| Verify Toggle global on/off | Task 8 (background) + Task 10 (VerifyTab toggle) |
| Verify Summary Panel | Task 10 (VerifyTab) |
| Hybrid Adapter (DOM + LLM fallback) | Task 3 (extract_service) + Task 6 (hybrid.ts) |
| OpenAlex API paper lookup | Task 1 (openalex.py) |
| Claude verbatim quote verification | Task 2 (verify_service.py) |
| Verify runs in background, survives sidebar close | Task 8 (background service worker queue) |
| User can turn off anything | Task 8 + Task 10 toggle |
| not_found is honest, never fabricated | Task 2 invariant |
| DOI-level cache | Task 4 (main_openai.py `_verify_cache`) |
