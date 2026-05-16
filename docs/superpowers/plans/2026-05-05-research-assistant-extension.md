# Research Assistant Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension + Python FastAPI backend that gives researchers in-place verification, summarization, and cross-tool synthesis on Elicit, SciSpace, and Consensus.

**Architecture:** The extension runs per-site adapters that normalize page content into `PageModel` objects, then sends them to a FastAPI backend running an Anthropic SDK agent loop with 7 tools. Results stream back via SSE and render in a sidebar chat and a floating selection-action bubble.

**Tech Stack:** TypeScript + React 19 + Vite + @crxjs/vite-plugin (extension); Vitest + jsdom (extension tests); Python 3.11 + FastAPI + Anthropic SDK + SQLite/aiosqlite + sse-starlette (backend); pytest + pytest-asyncio (backend tests); Chrome MV3.

---

## Scope Note

This is two independent subsystems. They share the `PageModel` contract but can be built and tested independently:
- **Backend (Tasks 1–11):** FastAPI agent API, can be tested with `pytest` and `curl`
- **Extension (Tasks 12–22):** Chrome extension, can be tested with Vitest and manual smoke tests

---

## File Map

### Backend additions to `research-kit/backend/`
```
app/
  models/
    __init__.py          # exports PageModel, AgentRunRequest
    page_model.py        # Pydantic PageModel + all sub-types
    request.py           # AgentRunRequest
  tools/
    __init__.py          # TOOL_SCHEMAS list + dispatch_tool() async dispatcher
    fetch_paper.py       # fetch_paper(url, doi?) → PaperResult | ErrorResult
    verify_link.py       # verify_link(citation_id, page_model) → LinkResult
    verify_claim.py      # verify_claim(claim_text, citation_id, page_model) → ClaimResult
    extract_section.py   # extract_section(paragraph_id, page_model) → SectionResult
    summarize.py         # summarize(page_model) → SummaryResult (calls Haiku)
    cross_compare.py     # cross_compare(page_models) → ComparisonResult (calls Haiku)
    web_search.py        # web_search(query) → SearchResult
  agent.py               # Anthropic SDK agent loop, async SSE generator
  api/
    agent.py             # POST /agent/run  SSE endpoint
  db/
    paper_cache_sqlite.py  # SQLite paper cache (aiosqlite, independent of Postgres)
  # Existing files modified:
  config.py              # + anthropic_api_key, backend_token, tavily_api_key
  main.py                # + include agent router

requirements.txt         # + anthropic, aiosqlite, sse-starlette, tavily-python

tests/
  conftest.py            # + page_model fixtures
  fixtures/
    page_models/
      elicit_report.json
      elicit_table.json
      scispace_chat.json
      consensus_claim.json
  unit/
    test_page_model.py
    test_fetch_paper.py
    test_verify_link.py
    test_verify_claim.py
    test_extract_section.py
    test_summarize.py
    test_cross_compare.py
    test_web_search.py
  integration/
    test_agent_run.py
```

### Extension additions to `research-kit/extension/`
```
src/
  adapters/
    types.ts             # SiteAdapter interface + PageModel + all sub-types
    elicit-adapter.ts    # Elicit adapter (report mode + table mode)
    scispace-adapter.ts  # SciSpace adapter
    consensus-adapter.ts # Consensus adapter
    registry.ts          # getAdapter(url) → SiteAdapter | null
  sidebar/
    index.html           # Side panel entry (replaces sidepanel/)
    main.tsx             # React root mount
    App.tsx              # Root: ActiveContextStrip + ChatThread
    ChatThread.tsx       # Message list with streaming render
    ToolCallCard.tsx     # Collapsible tool call trace
    CitationChip.tsx     # Citation hover-card + open-in-tab
    ActiveContextStrip.tsx  # Current tab info + "include N tabs" toggle
  content/
    adapter-host.ts      # Content script: extract PageModel on request
    selection-overlay.ts # Content script: selection bubble
  # Existing files modified:
  background.ts          # + agent stream Port handler + getPageModel()
  shared/api.ts          # + streamAgentRun() SSE client

vitest.config.ts         # NEW
# package.json modified  # + vitest, @vitest/browser, jsdom, happy-dom

tests/
  fixtures/
    elicit/report-mode.html
    elicit/table-mode.html
    scispace/chat.html
    consensus/claim.html
  adapters/
    elicit.test.ts
    scispace.test.ts
    consensus.test.ts

# manifest.json modified  # + new host_permissions + sidebar path + content scripts
```

---

## Task 1: Backend — Pydantic models (PageModel contract)

**Files:**
- Create: `research-kit/backend/app/models/__init__.py`
- Create: `research-kit/backend/app/models/page_model.py`
- Create: `research-kit/backend/app/models/request.py`
- Create: `research-kit/backend/tests/fixtures/page_models/elicit_report.json`
- Create: `research-kit/backend/tests/fixtures/page_models/elicit_table.json`
- Create: `research-kit/backend/tests/fixtures/page_models/scispace_chat.json`
- Create: `research-kit/backend/tests/fixtures/page_models/consensus_claim.json`
- Create: `research-kit/backend/tests/unit/test_page_model.py`

- [ ] **Step 1: Write the failing test**

```python
# research-kit/backend/tests/unit/test_page_model.py
import json
import pytest
from pathlib import Path

FIXTURES = Path(__file__).parent.parent / "fixtures" / "page_models"

def test_page_model_imports():
    from app.models.page_model import PageModel  # noqa

def test_elicit_report_fixture_parses():
    from app.models.page_model import PageModel
    data = json.loads((FIXTURES / "elicit_report.json").read_text())
    m = PageModel.model_validate(data)
    assert m.site == "elicit"
    assert m.answer is not None
    assert len(m.citations) > 0
    assert m.tableRows is None

def test_elicit_table_fixture_parses():
    from app.models.page_model import PageModel
    data = json.loads((FIXTURES / "elicit_table.json").read_text())
    m = PageModel.model_validate(data)
    assert m.site == "elicit"
    assert m.tableRows is not None
    assert m.answer is None

def test_selection_ref_is_optional():
    from app.models.page_model import PageModel
    data = json.loads((FIXTURES / "elicit_report.json").read_text())
    m = PageModel.model_validate(data)
    assert m.selection is None

def test_agent_run_request_parses():
    from app.models.request import AgentRunRequest
    from app.models.page_model import PageModel
    import json
    data = json.loads((FIXTURES / "elicit_report.json").read_text())
    req = AgentRunRequest(
        request="Summarize the findings",
        page_models=[PageModel.model_validate(data)],
        mode="chat",
    )
    assert req.mode == "chat"
    assert len(req.page_models) == 1
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_page_model.py -v 2>&1 | head -20
```
Expected: `ModuleNotFoundError: No module named 'app.models'`

- [ ] **Step 3: Create `app/models/page_model.py`**

```python
# research-kit/backend/app/models/page_model.py
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field


class Paragraph(BaseModel):
    id: str
    text: str
    citationIds: list[str] = Field(default_factory=list)


class Citation(BaseModel):
    id: str
    label: str
    url: Optional[str] = None
    doi: Optional[str] = None
    title: Optional[str] = None
    authors: Optional[list[str]] = None
    year: Optional[int] = None
    rawAnchorText: str
    stance: Optional[Literal["supporting", "contradicting", "mixed", "neutral"]] = None


class TableCell(BaseModel):
    text: str
    citationIds: list[str] = Field(default_factory=list)


class TableRow(BaseModel):
    id: str
    paperCitationId: str
    cells: dict[str, TableCell]


class Answer(BaseModel):
    id: str
    text: str
    paragraphs: list[Paragraph] = Field(default_factory=list)


class AdapterMeta(BaseModel):
    adapterVersion: str
    extractionWarnings: list[str] = Field(default_factory=list)
    selectorHits: dict[str, int] = Field(default_factory=dict)


class SelectionRef(BaseModel):
    text: str
    contextBefore: str
    contextAfter: str
    nearestParagraphId: Optional[str] = None
    nearestCitationIds: list[str] = Field(default_factory=list)


class PageModel(BaseModel):
    site: Literal["elicit", "scispace", "consensus"]
    schemaVersion: Literal["1.0"]
    capturedAt: str
    url: str
    title: str
    query: Optional[str] = None
    answer: Optional[Answer] = None
    tableRows: Optional[list[TableRow]] = None
    citations: list[Citation] = Field(default_factory=list)
    selection: Optional[SelectionRef] = None
    adapterMeta: AdapterMeta
```

- [ ] **Step 4: Create `app/models/request.py`**

```python
# research-kit/backend/app/models/request.py
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field
from app.models.page_model import PageModel, SelectionRef


class AgentRunRequest(BaseModel):
    request: str
    page_models: list[PageModel] = Field(default_factory=list)
    selection: Optional[SelectionRef] = None
    mode: Literal["chat", "action"]
    conversation_id: Optional[str] = None
```

- [ ] **Step 5: Create `app/models/__init__.py`**

```python
# research-kit/backend/app/models/__init__.py
from app.models.page_model import (
    PageModel, Citation, Paragraph, Answer, TableRow, TableCell,
    SelectionRef, AdapterMeta,
)
from app.models.request import AgentRunRequest

__all__ = [
    "PageModel", "Citation", "Paragraph", "Answer", "TableRow", "TableCell",
    "SelectionRef", "AdapterMeta", "AgentRunRequest",
]
```

- [ ] **Step 6: Create fixture JSON files**

```json
// research-kit/backend/tests/fixtures/page_models/elicit_report.json
{
  "site": "elicit",
  "schemaVersion": "1.0",
  "capturedAt": "2026-05-05T00:00:00Z",
  "url": "https://elicit.com/search?q=sleep+deprivation",
  "title": "Elicit – sleep deprivation",
  "query": "What are the effects of sleep deprivation on cognitive performance?",
  "answer": {
    "id": "a1b2c3d4",
    "text": "Sleep deprivation significantly impairs cognitive performance across multiple domains. Working memory and attention are particularly vulnerable.",
    "paragraphs": [
      {
        "id": "p0",
        "text": "Sleep deprivation significantly impairs cognitive performance across multiple domains.",
        "citationIds": ["c1"]
      },
      {
        "id": "p1",
        "text": "Working memory and attention are particularly vulnerable.",
        "citationIds": ["c2", "c3"]
      }
    ]
  },
  "citations": [
    {
      "id": "c1",
      "label": "[1]",
      "url": "https://doi.org/10.1093/sleep/zsaa022",
      "doi": "10.1093/sleep/zsaa022",
      "title": "The impact of sleep deprivation on decision making",
      "rawAnchorText": "Harrison & Horne, 2000",
      "year": 2000
    },
    {
      "id": "c2",
      "label": "[2]",
      "url": "https://doi.org/10.1093/sleep/23.3.309",
      "doi": "10.1093/sleep/23.3.309",
      "title": "Altered brain response to verbal learning following sleep deprivation",
      "rawAnchorText": "Drummond et al., 2000",
      "year": 2000
    },
    {
      "id": "c3",
      "label": "[3]",
      "url": "https://doi.org/10.1016/j.sleep.2007.10.009",
      "doi": "10.1016/j.sleep.2007.10.009",
      "title": "Sleep deprivation and vigilant attention",
      "rawAnchorText": "Lim & Dinges, 2008",
      "year": 2008
    }
  ],
  "adapterMeta": {
    "adapterVersion": "elicit/2026-05-05",
    "extractionWarnings": [],
    "selectorHits": {"report-mode": 1, "answer-paragraphs": 2, "citation-item-primary": 3}
  }
}
```

```json
// research-kit/backend/tests/fixtures/page_models/elicit_table.json
{
  "site": "elicit",
  "schemaVersion": "1.0",
  "capturedAt": "2026-05-05T00:00:00Z",
  "url": "https://elicit.com/search?q=mindfulness+anxiety",
  "title": "Elicit – mindfulness anxiety",
  "query": "Effects of mindfulness on anxiety",
  "tableRows": [
    {
      "id": "row-0",
      "paperCitationId": "c1",
      "cells": {
        "sample_size": {"text": "109", "citationIds": ["c1"]},
        "intervention": {"text": "MBSR 8-week", "citationIds": ["c1"]},
        "outcome": {"text": "Significant reduction in anxiety (p<0.001)", "citationIds": ["c1"]}
      }
    },
    {
      "id": "row-1",
      "paperCitationId": "c2",
      "cells": {
        "sample_size": {"text": "216", "citationIds": ["c2"]},
        "intervention": {"text": "DBT mindfulness", "citationIds": ["c2"]},
        "outcome": {"text": "Moderate anxiety reduction", "citationIds": ["c2"]}
      }
    }
  ],
  "citations": [
    {
      "id": "c1",
      "label": "[1]",
      "url": "https://doi.org/10.1016/j.brat.2013.12.018",
      "doi": "10.1016/j.brat.2013.12.018",
      "title": "Mindfulness-based stress reduction for anxiety disorders",
      "rawAnchorText": "Vøllestad et al., 2012",
      "year": 2012
    },
    {
      "id": "c2",
      "label": "[2]",
      "url": "https://doi.org/10.1016/j.cpr.2010.01.011",
      "doi": "10.1016/j.cpr.2010.01.011",
      "title": "Assessment of mindfulness by self-report",
      "rawAnchorText": "Baer et al., 2012",
      "year": 2012
    }
  ],
  "adapterMeta": {
    "adapterVersion": "elicit/2026-05-05",
    "extractionWarnings": [],
    "selectorHits": {"table-mode": 1, "table-rows": 2, "citation-item-primary": 2}
  }
}
```

```json
// research-kit/backend/tests/fixtures/page_models/scispace_chat.json
{
  "site": "scispace",
  "schemaVersion": "1.0",
  "capturedAt": "2026-05-05T00:00:00Z",
  "url": "https://scispace.com/search?q=CRISPR",
  "title": "SciSpace – CRISPR",
  "query": "What is the current state of CRISPR gene editing?",
  "answer": {
    "id": "b3c4d5e6",
    "text": "CRISPR-Cas9 has shown remarkable precision in targeting specific genomic sequences. Off-target effects remain a significant concern.",
    "paragraphs": [
      {
        "id": "p0",
        "text": "CRISPR-Cas9 has shown remarkable precision in targeting specific genomic sequences.",
        "citationIds": ["r1"]
      },
      {
        "id": "p1",
        "text": "Off-target effects remain a significant concern.",
        "citationIds": ["r1"]
      }
    ]
  },
  "citations": [
    {
      "id": "r1",
      "label": "1",
      "url": "https://doi.org/10.1126/science.1225829",
      "doi": "10.1126/science.1225829",
      "title": "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity",
      "rawAnchorText": "Doudna & Charpentier, 2012",
      "year": 2012
    },
    {
      "id": "r2",
      "label": "2",
      "url": "https://doi.org/10.1126/science.1231143",
      "doi": "10.1126/science.1231143",
      "title": "Multiplex genome engineering using CRISPR/Cas systems",
      "rawAnchorText": "Cong et al., 2013",
      "year": 2013
    }
  ],
  "adapterMeta": {
    "adapterVersion": "scispace/2026-05-05",
    "extractionWarnings": [],
    "selectorHits": {"ai-message": 1, "answer-paragraphs": 2, "source-item": 2}
  }
}
```

```json
// research-kit/backend/tests/fixtures/page_models/consensus_claim.json
{
  "site": "consensus",
  "schemaVersion": "1.0",
  "capturedAt": "2026-05-05T00:00:00Z",
  "url": "https://consensus.app/results?q=exercise+depression",
  "title": "Consensus – exercise depression",
  "query": "Does exercise improve depression symptoms?",
  "answer": {
    "id": "c7d8e9f0",
    "text": "Regular exercise significantly reduces depression symptoms, comparable to antidepressant therapy in mild-to-moderate cases.",
    "paragraphs": [
      {
        "id": "p0",
        "text": "Regular exercise significantly reduces depression symptoms, comparable to antidepressant therapy in mild-to-moderate cases.",
        "citationIds": ["p1", "p3"]
      }
    ]
  },
  "citations": [
    {
      "id": "p1",
      "label": "Blumenthal et al., 2007",
      "url": "https://doi.org/10.1001/jamapsychiatry.2016.2537",
      "doi": "10.1001/jamapsychiatry.2016.2537",
      "title": "Exercise and pharmacotherapy in the treatment of major depressive disorder",
      "rawAnchorText": "Blumenthal et al., 2007",
      "year": 2007,
      "stance": "supporting"
    },
    {
      "id": "p2",
      "label": "Chalder et al., 2012",
      "url": "https://doi.org/10.1016/j.jpsychires.2013.01.008",
      "doi": "10.1016/j.jpsychires.2013.01.008",
      "title": "Facilitated physical activity as a treatment for depressed adults",
      "rawAnchorText": "Chalder et al., 2012",
      "year": 2012,
      "stance": "contradicting"
    },
    {
      "id": "p3",
      "label": "Cooney et al., 2013",
      "url": "https://doi.org/10.1136/bmj.g2357",
      "doi": "10.1136/bmj.g2357",
      "title": "Exercise for depression (Cochrane review)",
      "rawAnchorText": "Cooney et al., 2013",
      "year": 2013,
      "stance": "supporting"
    }
  ],
  "adapterMeta": {
    "adapterVersion": "consensus/2026-05-05",
    "extractionWarnings": [],
    "selectorHits": {"consensus-statement": 1, "paper-card": 3}
  }
}
```

- [ ] **Step 7: Run tests and confirm pass**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_page_model.py -v
```
Expected: 5 tests PASS

- [ ] **Step 8: Commit**

```bash
cd research-kit/backend
git add app/models/ tests/fixtures/page_models/ tests/unit/test_page_model.py
git commit -m "feat(backend): add PageModel Pydantic contract + JSON fixtures"
```

---

## Task 2: Backend — Add dependencies + SQLite paper cache

**Files:**
- Modify: `research-kit/backend/requirements.txt`
- Modify: `research-kit/backend/app/config.py`
- Create: `research-kit/backend/app/db/paper_cache_sqlite.py`
- Create: `research-kit/backend/tests/unit/test_paper_cache.py`

- [ ] **Step 1: Write the failing test**

```python
# research-kit/backend/tests/unit/test_paper_cache.py
import pytest
import pytest_asyncio
import aiosqlite
import tempfile
import os

@pytest_asyncio.fixture
async def db_path(tmp_path):
    path = str(tmp_path / "test_cache.db")
    yield path
    if os.path.exists(path):
        os.unlink(path)

@pytest.mark.asyncio
async def test_cache_miss_returns_none(db_path):
    from app.db.paper_cache_sqlite import get_cached_paper, init_paper_cache_db
    await init_paper_cache_db(db_path)
    result = await get_cached_paper("https://doi.org/10.1000/nonexistent", db_path)
    assert result is None

@pytest.mark.asyncio
async def test_cache_set_then_get(db_path):
    from app.db.paper_cache_sqlite import get_cached_paper, set_cached_paper, init_paper_cache_db
    await init_paper_cache_db(db_path)
    data = {"title": "Test Paper", "abstract": "This is an abstract.", "source": "crossref"}
    await set_cached_paper("https://doi.org/10.1000/test", data, db_path)
    result = await get_cached_paper("https://doi.org/10.1000/test", db_path)
    assert result is not None
    assert result["title"] == "Test Paper"
    assert result["abstract"] == "This is an abstract."

@pytest.mark.asyncio
async def test_cache_is_url_keyed(db_path):
    from app.db.paper_cache_sqlite import get_cached_paper, set_cached_paper, init_paper_cache_db
    await init_paper_cache_db(db_path)
    await set_cached_paper("https://doi.org/10.1000/a", {"title": "A", "abstract": "", "source": "x"}, db_path)
    result_b = await get_cached_paper("https://doi.org/10.1000/b", db_path)
    assert result_b is None
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_paper_cache.py -v 2>&1 | head -10
```
Expected: `ModuleNotFoundError: No module named 'aiosqlite'`

- [ ] **Step 3: Add new dependencies to `requirements.txt`**

Add these lines to `research-kit/backend/requirements.txt`:
```
anthropic>=0.42.0
aiosqlite>=0.20.0
sse-starlette>=2.1.0
tavily-python>=0.3.0
```

- [ ] **Step 4: Install new dependencies**

```bash
cd research-kit/backend && pip install anthropic aiosqlite sse-starlette tavily-python
```
Expected: Successfully installed (no errors)

- [ ] **Step 5: Add new config fields to `app/config.py`**

Add these fields to the `Settings` class (after `fernet_key`):
```python
    anthropic_api_key: str = ""
    backend_token: str = "dev-token"
    tavily_api_key: str = ""
    paper_cache_db: str = "./paper_cache.db"
```

- [ ] **Step 6: Create `app/db/paper_cache_sqlite.py`**

```python
# research-kit/backend/app/db/paper_cache_sqlite.py
import hashlib
import json
from datetime import datetime
import aiosqlite
from app.config import settings

_DEFAULT_DB = None


def _url_hash(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def _get_db_path(db_path: str | None) -> str:
    return db_path or settings.paper_cache_db


async def init_paper_cache_db(db_path: str | None = None) -> None:
    path = _get_db_path(db_path)
    async with aiosqlite.connect(path) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS paper_cache (
                url_hash TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                title TEXT,
                abstract TEXT,
                full_text TEXT,
                source TEXT NOT NULL,
                fetched_at TEXT NOT NULL
            )
        """)
        await db.commit()


async def get_cached_paper(url: str, db_path: str | None = None) -> dict | None:
    path = _get_db_path(db_path)
    h = _url_hash(url)
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT title, abstract, full_text, source FROM paper_cache WHERE url_hash = ?", (h,)
        ) as cursor:
            row = await cursor.fetchone()
    if row is None:
        return None
    return {"title": row["title"], "abstract": row["abstract"],
            "full_text": row["full_text"], "source": row["source"]}


async def set_cached_paper(url: str, data: dict, db_path: str | None = None) -> None:
    path = _get_db_path(db_path)
    h = _url_hash(url)
    async with aiosqlite.connect(path) as db:
        await db.execute(
            """INSERT OR REPLACE INTO paper_cache
               (url_hash, url, title, abstract, full_text, source, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (h, url, data.get("title"), data.get("abstract"),
             data.get("full_text"), data.get("source", "unknown"),
             datetime.utcnow().isoformat()),
        )
        await db.commit()
```

- [ ] **Step 7: Run tests and confirm pass**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_paper_cache.py -v
```
Expected: 3 tests PASS

- [ ] **Step 8: Commit**

```bash
cd research-kit/backend
git add requirements.txt app/config.py app/db/paper_cache_sqlite.py tests/unit/test_paper_cache.py
git commit -m "feat(backend): add paper cache SQLite + new dependencies"
```

---

## Task 3: Backend — `fetch_paper` tool

**Files:**
- Create: `research-kit/backend/app/tools/fetch_paper.py`
- Create: `research-kit/backend/tests/unit/test_fetch_paper.py`

- [ ] **Step 1: Write the failing test**

```python
# research-kit/backend/tests/unit/test_fetch_paper.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


def _make_mock_response(status: int, json_data: dict | None = None):
    mock = MagicMock()
    mock.status_code = status
    mock.json.return_value = json_data or {}
    return mock


@pytest.mark.asyncio
async def test_fetch_paper_by_doi_crossref_hit(tmp_path):
    crossref_data = {
        "message": {
            "title": ["Sleep deprivation and cognitive performance"],
            "abstract": "This study shows sleep deprivation impairs cognition.",
        }
    }
    mock_resp = _make_mock_response(200, crossref_data)
    with patch("app.tools.fetch_paper.init_paper_cache_db", AsyncMock()), \
         patch("app.tools.fetch_paper.get_cached_paper", AsyncMock(return_value=None)), \
         patch("app.tools.fetch_paper.set_cached_paper", AsyncMock()), \
         patch("httpx.AsyncClient") as mock_client_cls:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.get = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = instance

        from app.tools.fetch_paper import fetch_paper
        result = await fetch_paper(doi="10.1000/test", _db_path=str(tmp_path / "c.db"))

    assert "error" not in result
    assert result["title"] == "Sleep deprivation and cognitive performance"
    assert result["source"] == "crossref"


@pytest.mark.asyncio
async def test_fetch_paper_cache_hit(tmp_path):
    cached = {"title": "Cached Title", "abstract": "Cached abstract", "source": "crossref", "full_text": None}
    with patch("app.tools.fetch_paper.init_paper_cache_db", AsyncMock()), \
         patch("app.tools.fetch_paper.get_cached_paper", AsyncMock(return_value=cached)):
        from app.tools.fetch_paper import fetch_paper
        result = await fetch_paper(url="https://doi.org/10.1000/cached", _db_path=str(tmp_path / "c.db"))

    assert result["title"] == "Cached Title"


@pytest.mark.asyncio
async def test_fetch_paper_no_url_no_doi(tmp_path):
    from app.tools.fetch_paper import fetch_paper
    result = await fetch_paper(_db_path=str(tmp_path / "c.db"))
    assert "error" in result


@pytest.mark.asyncio
async def test_fetch_paper_crossref_error_returns_error_dict(tmp_path):
    mock_resp = _make_mock_response(404)
    with patch("app.tools.fetch_paper.init_paper_cache_db", AsyncMock()), \
         patch("app.tools.fetch_paper.get_cached_paper", AsyncMock(return_value=None)), \
         patch("httpx.AsyncClient") as mock_client_cls:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.get = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = instance

        from app.tools.fetch_paper import fetch_paper
        result = await fetch_paper(doi="10.1000/nonexistent", _db_path=str(tmp_path / "c.db"))

    assert "error" in result
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_fetch_paper.py -v 2>&1 | head -10
```
Expected: `ModuleNotFoundError: No module named 'app.tools'`

- [ ] **Step 3: Create `app/tools/__init__.py` (empty for now)**

```python
# research-kit/backend/app/tools/__init__.py
```

- [ ] **Step 4: Create `app/tools/fetch_paper.py`**

```python
# research-kit/backend/app/tools/fetch_paper.py
import httpx
from app.db.paper_cache_sqlite import get_cached_paper, set_cached_paper, init_paper_cache_db

CROSSREF_BASE = "https://api.crossref.org/works"


async def fetch_paper(
    url: str | None = None,
    doi: str | None = None,
    _db_path: str | None = None,
) -> dict:
    """Fetch paper metadata from DOI or URL. Returns {title, abstract, full_text?, source} or {error}."""
    if doi and not url:
        url = f"https://doi.org/{doi}"
    if not url:
        return {"error": "No URL or DOI provided"}

    if "doi.org/" in url and not doi:
        doi = url.split("doi.org/", 1)[1].strip("/")

    await init_paper_cache_db(_db_path)
    cached = await get_cached_paper(url, _db_path)
    if cached:
        return cached

    result = await _fetch_from_sources(url, doi)

    if "error" not in result:
        await set_cached_paper(url, result, _db_path)

    return result


async def _fetch_from_sources(url: str, doi: str | None) -> dict:
    if doi:
        result = await _fetch_crossref(doi)
        if "error" not in result:
            return result
    return await _fetch_direct(url)


async def _fetch_crossref(doi: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{CROSSREF_BASE}/{doi}")
        if resp.status_code != 200:
            return {"error": f"Crossref HTTP {resp.status_code}"}
        msg = resp.json().get("message", {})
        titles = msg.get("title", [])
        return {
            "title": titles[0] if titles else "",
            "abstract": msg.get("abstract", ""),
            "full_text": None,
            "source": "crossref",
        }
    except Exception as exc:
        return {"error": str(exc)}


async def _fetch_direct(url: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "ResearchAssistant/1.0"})
        if resp.status_code != 200:
            return {"error": f"Direct fetch HTTP {resp.status_code}"}
        return {"title": url, "abstract": "", "full_text": None, "source": "direct"}
    except Exception as exc:
        return {"error": str(exc)}
```

- [ ] **Step 5: Run tests and confirm pass**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_fetch_paper.py -v
```
Expected: 4 tests PASS

- [ ] **Step 6: Commit**

```bash
cd research-kit/backend
git add app/tools/__init__.py app/tools/fetch_paper.py tests/unit/test_fetch_paper.py
git commit -m "feat(backend): add fetch_paper tool with crossref + cache"
```

---

## Task 4: Backend — `verify_link` tool

**Files:**
- Create: `research-kit/backend/app/tools/verify_link.py`
- Create: `research-kit/backend/tests/unit/test_verify_link.py`

- [ ] **Step 1: Write the failing test**

```python
# research-kit/backend/tests/unit/test_verify_link.py
import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch

FIXTURES = Path(__file__).parent.parent / "fixtures" / "page_models"


def load_model(name: str):
    from app.models.page_model import PageModel
    return PageModel.model_validate(json.loads((FIXTURES / name).read_text()))


@pytest.mark.asyncio
async def test_verify_link_resolved(tmp_path):
    page_model = load_model("elicit_report.json")
    paper_data = {"title": "The impact of sleep deprivation", "abstract": "...", "source": "crossref"}
    with patch("app.tools.verify_link.fetch_paper", AsyncMock(return_value=paper_data)):
        from app.tools.verify_link import verify_link
        result = await verify_link("c1", page_model)
    assert result["status"] == "resolved"
    assert "fetched_url" in result
    assert result["title"] == "The impact of sleep deprivation"


@pytest.mark.asyncio
async def test_verify_link_citation_not_found():
    from app.tools.verify_link import verify_link
    page_model = load_model("elicit_report.json")
    result = await verify_link("nonexistent", page_model)
    assert result["status"] == "not_found"


@pytest.mark.asyncio
async def test_verify_link_no_url():
    from app.models.page_model import PageModel, Citation, AdapterMeta
    from app.tools.verify_link import verify_link
    model = PageModel(
        site="elicit", schemaVersion="1.0", capturedAt="2026-05-05T00:00:00Z",
        url="https://elicit.com", title="Test",
        citations=[Citation(id="c1", label="[1]", rawAnchorText="Smith")],
        adapterMeta=AdapterMeta(adapterVersion="elicit/2026-05-05", extractionWarnings=[], selectorHits={}),
    )
    result = await verify_link("c1", model)
    assert result["status"] == "no_url"


@pytest.mark.asyncio
async def test_verify_link_fetch_error(tmp_path):
    page_model = load_model("elicit_report.json")
    with patch("app.tools.verify_link.fetch_paper", AsyncMock(return_value={"error": "Timeout"})):
        from app.tools.verify_link import verify_link
        result = await verify_link("c1", page_model)
    assert result["status"] == "error"
    assert "Timeout" in result["fetch_error"]
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_verify_link.py -v 2>&1 | head -10
```
Expected: `ModuleNotFoundError` or `ImportError`

- [ ] **Step 3: Create `app/tools/verify_link.py`**

```python
# research-kit/backend/app/tools/verify_link.py
from app.models.page_model import PageModel
from app.tools.fetch_paper import fetch_paper


async def verify_link(citation_id: str, page_model: PageModel) -> dict:
    """Check whether a cited URL/DOI resolves to a real paper. Returns status dict."""
    citation = next((c for c in page_model.citations if c.id == citation_id), None)
    if citation is None:
        return {"status": "not_found", "citation_id": citation_id}

    url = citation.url
    if not url and citation.doi:
        url = f"https://doi.org/{citation.doi}"
    if not url:
        return {"status": "no_url", "citation_id": citation_id, "label": citation.label}

    result = await fetch_paper(url=url)
    if "error" in result:
        return {"status": "error", "fetched_url": url, "fetch_error": result["error"]}

    return {
        "status": "resolved",
        "fetched_url": url,
        "title": result.get("title"),
        "abstract": result.get("abstract"),
    }
```

- [ ] **Step 4: Run tests and confirm pass**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_verify_link.py -v
```
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd research-kit/backend
git add app/tools/verify_link.py tests/unit/test_verify_link.py
git commit -m "feat(backend): add verify_link tool"
```

---

## Task 5: Backend — `verify_claim` tool

**Files:**
- Create: `research-kit/backend/app/tools/verify_claim.py`
- Create: `research-kit/backend/tests/unit/test_verify_claim.py`

- [ ] **Step 1: Write the failing test**

```python
# research-kit/backend/tests/unit/test_verify_claim.py
import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

FIXTURES = Path(__file__).parent.parent / "fixtures" / "page_models"


def load_model(name: str):
    from app.models.page_model import PageModel
    return PageModel.model_validate(json.loads((FIXTURES / name).read_text()))


def _mock_claude_response(json_str: str):
    mock = MagicMock()
    mock.content = [MagicMock(text=json_str)]
    return mock


@pytest.mark.asyncio
async def test_verify_claim_supported():
    page_model = load_model("elicit_report.json")
    paper_data = {
        "title": "Sleep deprivation and cognitive performance",
        "abstract": "Sleep deprivation significantly impairs cognitive performance.",
        "source": "crossref",
    }
    claude_json = '{"verdict":"supported","verbatim_quote":"Sleep deprivation significantly impairs cognitive performance.","page":null,"reasoning":"Directly stated."}'
    with patch("app.tools.verify_claim.fetch_paper", AsyncMock(return_value=paper_data)), \
         patch("app.tools.verify_claim._client") as mock_claude:
        mock_claude.messages.create = AsyncMock(return_value=_mock_claude_response(claude_json))
        from app.tools.verify_claim import verify_claim
        result = await verify_claim("Sleep deprivation impairs cognition", "c1", page_model)

    assert result["verdict"] == "supported"
    assert result["verbatim_quote"] is not None
    assert result.get("not_found") is not True


@pytest.mark.asyncio
async def test_verify_claim_not_found():
    page_model = load_model("elicit_report.json")
    paper_data = {"title": "Unrelated", "abstract": "Completely different topic.", "source": "crossref"}
    claude_json = '{"verdict":"unsupported","verbatim_quote":null,"page":null,"reasoning":"Not mentioned."}'
    with patch("app.tools.verify_claim.fetch_paper", AsyncMock(return_value=paper_data)), \
         patch("app.tools.verify_claim._client") as mock_claude:
        mock_claude.messages.create = AsyncMock(return_value=_mock_claude_response(claude_json))
        from app.tools.verify_claim import verify_claim
        result = await verify_claim("Coffee cures cancer", "c1", page_model)

    assert result["verdict"] == "unsupported"
    assert result.get("not_found") is True


@pytest.mark.asyncio
async def test_verify_claim_missing_citation():
    from app.tools.verify_claim import verify_claim
    page_model = load_model("elicit_report.json")
    result = await verify_claim("Any claim", "nonexistent", page_model)
    assert result["verdict"] == "uncertain"
    assert "not found" in result["reasoning"].lower()


@pytest.mark.asyncio
async def test_verify_claim_no_url():
    from app.models.page_model import PageModel, Citation, AdapterMeta
    from app.tools.verify_claim import verify_claim
    model = PageModel(
        site="elicit", schemaVersion="1.0", capturedAt="2026-05-05T00:00:00Z",
        url="https://elicit.com", title="Test",
        citations=[Citation(id="c1", label="[1]", rawAnchorText="Smith")],
        adapterMeta=AdapterMeta(adapterVersion="elicit/2026-05-05", extractionWarnings=[], selectorHits={}),
    )
    result = await verify_claim("Any claim", "c1", model)
    assert result["verdict"] == "uncertain"
    assert result.get("not_found") is True
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_verify_claim.py -v 2>&1 | head -10
```

- [ ] **Step 3: Create `app/tools/verify_claim.py`**

```python
# research-kit/backend/app/tools/verify_claim.py
import json
import anthropic
from app.models.page_model import PageModel
from app.tools.fetch_paper import fetch_paper

_client = anthropic.AsyncAnthropic()

_PROMPT = """Does this paper support the claim below? Find a verbatim quote if yes.

Claim: {claim}

Paper title: {title}
Paper text:
{text}

Respond with ONLY valid JSON (no markdown, no extra text):
{{"verdict": "supported|partial|unsupported|uncertain", "verbatim_quote": "exact quote from paper or null", "page": "page or null", "reasoning": "one sentence"}}"""


async def verify_claim(claim_text: str, citation_id: str, page_model: PageModel) -> dict:
    """
    Returns {{verdict, verbatim_quote?, page?, reasoning, not_found?}}.
    verbatim_quote is SACRED — never paraphrased; null means not_found=True.
    """
    citation = next((c for c in page_model.citations if c.id == citation_id), None)
    if citation is None:
        return {"verdict": "uncertain", "reasoning": f"Citation {citation_id} not found in page model"}

    url = citation.url
    if not url and citation.doi:
        url = f"https://doi.org/{citation.doi}"
    if not url:
        return {"verdict": "uncertain", "reasoning": "Citation has no URL or DOI", "not_found": True}

    paper = await fetch_paper(url=url)
    if "error" in paper:
        return {"verdict": "uncertain", "reasoning": f"Could not fetch paper: {paper['error']}", "not_found": True}

    text = "\n\n".join(filter(None, [paper.get("abstract", ""), (paper.get("full_text") or "")[:6000]]))
    prompt = _PROMPT.format(claim=claim_text, title=paper.get("title", ""), text=text)

    response = await _client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()
    try:
        result = json.loads(raw)
        if result.get("verbatim_quote") is None:
            result["not_found"] = True
        return result
    except json.JSONDecodeError:
        return {"verdict": "uncertain", "reasoning": "Could not parse evidence response", "not_found": True}
```

- [ ] **Step 4: Run tests and confirm pass**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_verify_claim.py -v
```
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd research-kit/backend
git add app/tools/verify_claim.py tests/unit/test_verify_claim.py
git commit -m "feat(backend): add verify_claim tool (verbatim quote invariant)"
```

---

## Task 6: Backend — `extract_section`, `summarize`, `cross_compare` tools

**Files:**
- Create: `research-kit/backend/app/tools/extract_section.py`
- Create: `research-kit/backend/app/tools/summarize.py`
- Create: `research-kit/backend/app/tools/cross_compare.py`
- Create: `research-kit/backend/tests/unit/test_extract_section.py`
- Create: `research-kit/backend/tests/unit/test_summarize.py`
- Create: `research-kit/backend/tests/unit/test_cross_compare.py`

- [ ] **Step 1: Write extract_section tests**

```python
# research-kit/backend/tests/unit/test_extract_section.py
import json, pytest
from pathlib import Path

FIXTURES = Path(__file__).parent.parent / "fixtures" / "page_models"


def load_model(name):
    from app.models.page_model import PageModel
    return PageModel.model_validate(json.loads((FIXTURES / name).read_text()))


def test_extract_by_paragraph_id():
    from app.tools.extract_section import extract_section
    model = load_model("elicit_report.json")
    result = extract_section("p0", model)
    assert result["text"] == "Sleep deprivation significantly impairs cognitive performance across multiple domains."
    assert "c1" in result["citation_ids"]


def test_extract_paragraph_not_found():
    from app.tools.extract_section import extract_section
    model = load_model("elicit_report.json")
    result = extract_section("nonexistent", model)
    assert "error" in result


def test_extract_from_selection():
    from app.tools.extract_section import extract_section
    from app.models.page_model import SelectionRef
    model = load_model("elicit_report.json")
    sel = SelectionRef(
        text="sleep deprivation impairs",
        contextBefore="...",
        contextAfter="...",
        nearestCitationIds=["c1", "c2"],
    )
    result = extract_section(None, model, selection=sel)
    assert result["text"] == "sleep deprivation impairs"
    assert "c1" in result["citation_ids"]


def test_extract_table_row():
    from app.tools.extract_section import extract_section
    model = load_model("elicit_table.json")
    result = extract_section("row-0", model)
    assert "MBSR" in result["text"] or "109" in result["text"]
```

- [ ] **Step 2: Write summarize tests**

```python
# research-kit/backend/tests/unit/test_summarize.py
import json, pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

FIXTURES = Path(__file__).parent.parent / "fixtures" / "page_models"


def load_model(name):
    from app.models.page_model import PageModel
    return PageModel.model_validate(json.loads((FIXTURES / name).read_text()))


def _mock_claude(text: str):
    m = MagicMock()
    m.content = [MagicMock(text=text)]
    return m


@pytest.mark.asyncio
async def test_summarize_report_mode():
    model = load_model("elicit_report.json")
    resp_json = '{"summary":"Sleep deprivation impairs cognition.","key_claims":["Working memory is vulnerable."]}'
    with patch("app.tools.summarize._client") as mc:
        mc.messages.create = AsyncMock(return_value=_mock_claude(resp_json))
        from app.tools.summarize import summarize
        result = await summarize(model)
    assert "summary" in result
    assert isinstance(result["key_claims"], list)


@pytest.mark.asyncio
async def test_summarize_table_mode():
    model = load_model("elicit_table.json")
    resp_json = '{"summary":"Mindfulness reduces anxiety.","key_claims":["MBSR effective in 109 patients."]}'
    with patch("app.tools.summarize._client") as mc:
        mc.messages.create = AsyncMock(return_value=_mock_claude(resp_json))
        from app.tools.summarize import summarize
        result = await summarize(model)
    assert "summary" in result
```

- [ ] **Step 3: Write cross_compare tests**

```python
# research-kit/backend/tests/unit/test_cross_compare.py
import json, pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

FIXTURES = Path(__file__).parent.parent / "fixtures" / "page_models"


def load_model(name):
    from app.models.page_model import PageModel
    return PageModel.model_validate(json.loads((FIXTURES / name).read_text()))


def _mock_claude(text: str):
    m = MagicMock()
    m.content = [MagicMock(text=text)]
    return m


@pytest.mark.asyncio
async def test_cross_compare_two_models():
    m1 = load_model("elicit_report.json")
    m2 = load_model("scispace_chat.json")
    resp_json = '{"agreements":["Both discuss cognitive effects"],"contradictions":[],"coverage_gaps":["SciSpace lacks details on attention"],"per_source_summary":[{"source":"elicit","summary":"Sleep impairs cognition"},{"source":"scispace","summary":"CRISPR precision"}]}'
    with patch("app.tools.cross_compare._client") as mc:
        mc.messages.create = AsyncMock(return_value=_mock_claude(resp_json))
        from app.tools.cross_compare import cross_compare
        result = await cross_compare([m1, m2])
    assert "agreements" in result
    assert "contradictions" in result
    assert "per_source_summary" in result


@pytest.mark.asyncio
async def test_cross_compare_single_model_returns_error():
    from app.tools.cross_compare import cross_compare
    m = load_model("elicit_report.json")
    result = await cross_compare([m])
    assert "error" in result
```

- [ ] **Step 4: Run to confirm failures**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_extract_section.py tests/unit/test_summarize.py tests/unit/test_cross_compare.py -v 2>&1 | tail -5
```

- [ ] **Step 5: Create `app/tools/extract_section.py`**

```python
# research-kit/backend/app/tools/extract_section.py
from app.models.page_model import PageModel, SelectionRef


def extract_section(
    paragraph_id: str | None,
    page_model: PageModel,
    selection: SelectionRef | None = None,
) -> dict:
    """Return text + citation_ids for a paragraph_id, selection, or table row id."""
    if selection is not None:
        return {"text": selection.text, "citation_ids": selection.nearestCitationIds}

    if paragraph_id is None:
        return {"error": "paragraph_id or selection required"}

    # Search in answer paragraphs
    if page_model.answer:
        for para in page_model.answer.paragraphs:
            if para.id == paragraph_id:
                return {"text": para.text, "citation_ids": para.citationIds}

    # Search in table rows
    if page_model.tableRows:
        for row in page_model.tableRows:
            if row.id == paragraph_id:
                combined = " | ".join(cell.text for cell in row.cells.values())
                all_cids = [cid for cell in row.cells.values() for cid in cell.citationIds]
                return {"text": combined, "citation_ids": list(dict.fromkeys(all_cids))}

    return {"error": f"Paragraph or row '{paragraph_id}' not found"}
```

- [ ] **Step 6: Create `app/tools/summarize.py`**

```python
# research-kit/backend/app/tools/summarize.py
import json
import anthropic
from app.models.page_model import PageModel

_client = anthropic.AsyncAnthropic()

_PROMPT = """Summarize the following research page content. Return ONLY valid JSON:
{{"summary": "2-3 sentence summary", "key_claims": ["claim 1", "claim 2", ...]}}

Site: {site}
Query: {query}
Content:
{content}"""


def _page_content(model: PageModel) -> str:
    if model.answer:
        return model.answer.text
    if model.tableRows:
        rows = []
        for row in model.tableRows[:10]:
            cells = "; ".join(f"{k}: {v.text}" for k, v in row.cells.items())
            rows.append(cells)
        return "\n".join(rows)
    return "(no content)"


async def summarize(page_model: PageModel) -> dict:
    prompt = _PROMPT.format(
        site=page_model.site,
        query=page_model.query or "",
        content=_page_content(page_model)[:4000],
    )
    response = await _client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"summary": raw, "key_claims": []}
```

- [ ] **Step 7: Create `app/tools/cross_compare.py`**

```python
# research-kit/backend/app/tools/cross_compare.py
import json
import anthropic
from app.models.page_model import PageModel

_client = anthropic.AsyncAnthropic()

_PROMPT = """Compare these research sources. Return ONLY valid JSON:
{{"agreements": [...], "contradictions": [...], "coverage_gaps": [...], "per_source_summary": [{{"source": "site", "summary": "..."}}]}}

Sources:
{sources}"""


def _format_source(model: PageModel) -> str:
    content = model.answer.text if model.answer else "(table mode)"
    return f"[{model.site}] Query: {model.query or 'N/A'}\nContent: {content[:1500]}"


async def cross_compare(page_models: list[PageModel]) -> dict:
    if len(page_models) < 2:
        return {"error": "cross_compare requires at least 2 page models"}

    sources = "\n\n---\n\n".join(_format_source(m) for m in page_models[:5])
    prompt = _PROMPT.format(sources=sources)

    response = await _client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"agreements": [], "contradictions": [], "coverage_gaps": [], "per_source_summary": [], "raw": raw}
```

- [ ] **Step 8: Run all three test files and confirm pass**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_extract_section.py tests/unit/test_summarize.py tests/unit/test_cross_compare.py -v
```
Expected: 9 tests PASS

- [ ] **Step 9: Commit**

```bash
cd research-kit/backend
git add app/tools/extract_section.py app/tools/summarize.py app/tools/cross_compare.py \
    tests/unit/test_extract_section.py tests/unit/test_summarize.py tests/unit/test_cross_compare.py
git commit -m "feat(backend): add extract_section, summarize, cross_compare tools"
```

---

## Task 7: Backend — `web_search` tool

**Files:**
- Create: `research-kit/backend/app/tools/web_search.py`
- Create: `research-kit/backend/tests/unit/test_web_search.py`

- [ ] **Step 1: Write the failing test**

```python
# research-kit/backend/tests/unit/test_web_search.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_web_search_returns_results():
    mock_client = MagicMock()
    mock_client.search = AsyncMock(return_value={
        "results": [
            {"title": "Paper A", "url": "https://example.com/a", "content": "Abstract of paper A"}
        ]
    })
    with patch("app.tools.web_search.AsyncTavilyClient", return_value=mock_client):
        from app.tools.web_search import web_search
        result = await web_search("CRISPR off-target effects")
    assert len(result["results"]) == 1
    assert result["results"][0]["title"] == "Paper A"


@pytest.mark.asyncio
async def test_web_search_no_api_key():
    with patch("app.tools.web_search.settings") as mock_settings:
        mock_settings.tavily_api_key = ""
        from app.tools import web_search as ws_module
        import importlib; importlib.reload(ws_module)
        result = await ws_module.web_search("anything")
    assert "error" in result


@pytest.mark.asyncio
async def test_web_search_tavily_error():
    mock_client = MagicMock()
    mock_client.search = AsyncMock(side_effect=Exception("API error"))
    with patch("app.tools.web_search.AsyncTavilyClient", return_value=mock_client):
        from app.tools.web_search import web_search
        result = await web_search("query")
    assert "error" in result
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_web_search.py -v 2>&1 | head -10
```

- [ ] **Step 3: Create `app/tools/web_search.py`**

```python
# research-kit/backend/app/tools/web_search.py
from tavily import AsyncTavilyClient
from app.config import settings


async def web_search(query: str) -> dict:
    """Search the web for academic sources. Returns {results: [{title, url, content}]} or {error}."""
    if not settings.tavily_api_key:
        return {"error": "TAVILY_API_KEY not configured"}
    try:
        client = AsyncTavilyClient(api_key=settings.tavily_api_key)
        data = await client.search(query, search_depth="advanced", max_results=5)
        results = [
            {"title": r.get("title", ""), "url": r.get("url", ""), "content": r.get("content", "")}
            for r in data.get("results", [])
        ]
        return {"results": results}
    except Exception as exc:
        return {"error": str(exc)}
```

- [ ] **Step 4: Run tests and confirm pass**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_web_search.py -v
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
cd research-kit/backend
git add app/tools/web_search.py tests/unit/test_web_search.py
git commit -m "feat(backend): add web_search tool (Tavily)"
```

---

## Task 8: Backend — tool registry + agent loop

**Files:**
- Modify: `research-kit/backend/app/tools/__init__.py`
- Create: `research-kit/backend/app/agent.py`
- Create: `research-kit/backend/tests/unit/test_tool_registry.py`

- [ ] **Step 1: Write registry test**

```python
# research-kit/backend/tests/unit/test_tool_registry.py
import pytest


def test_tool_schemas_is_list():
    from app.tools import TOOL_SCHEMAS
    assert isinstance(TOOL_SCHEMAS, list)
    assert len(TOOL_SCHEMAS) == 7


def test_all_schemas_have_required_keys():
    from app.tools import TOOL_SCHEMAS
    for schema in TOOL_SCHEMAS:
        assert "name" in schema
        assert "description" in schema
        assert "input_schema" in schema


def test_dispatch_tool_exists():
    from app.tools import dispatch_tool
    import asyncio
    assert callable(dispatch_tool)


@pytest.mark.asyncio
async def test_dispatch_unknown_tool_returns_error():
    from app.tools import dispatch_tool
    result = await dispatch_tool("nonexistent_tool", {})
    assert "error" in result
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_tool_registry.py -v 2>&1 | head -10
```

- [ ] **Step 3: Populate `app/tools/__init__.py`**

```python
# research-kit/backend/app/tools/__init__.py
from app.models.page_model import PageModel
from app.tools.fetch_paper import fetch_paper
from app.tools.verify_link import verify_link
from app.tools.verify_claim import verify_claim
from app.tools.extract_section import extract_section
from app.tools.summarize import summarize
from app.tools.cross_compare import cross_compare
from app.tools.web_search import web_search

TOOL_SCHEMAS = [
    {
        "name": "fetch_paper",
        "description": "Fetch metadata (title, abstract) for a paper given its URL or DOI. Caches results.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Full URL of the paper"},
                "doi": {"type": "string", "description": "DOI string, e.g. 10.1000/xyz"},
            },
        },
    },
    {
        "name": "verify_link",
        "description": "Check whether a citation in the page model resolves to a real paper. Returns status, title, fetched URL.",
        "input_schema": {
            "type": "object",
            "properties": {
                "citation_id": {"type": "string"},
                "page_model": {"type": "object"},
            },
            "required": ["citation_id", "page_model"],
        },
    },
    {
        "name": "verify_claim",
        "description": "Verify whether a specific claim is supported by its cited paper. Returns verdict and verbatim quote.",
        "input_schema": {
            "type": "object",
            "properties": {
                "claim_text": {"type": "string"},
                "citation_id": {"type": "string"},
                "page_model": {"type": "object"},
            },
            "required": ["claim_text", "citation_id", "page_model"],
        },
    },
    {
        "name": "extract_section",
        "description": "Extract text and citation IDs for a specific paragraph or table row from the page model.",
        "input_schema": {
            "type": "object",
            "properties": {
                "paragraph_id": {"type": "string"},
                "page_model": {"type": "object"},
            },
            "required": ["page_model"],
        },
    },
    {
        "name": "summarize",
        "description": "Produce a 2-3 sentence summary and key claims list from a page model.",
        "input_schema": {
            "type": "object",
            "properties": {"page_model": {"type": "object"}},
            "required": ["page_model"],
        },
    },
    {
        "name": "cross_compare",
        "description": "Compare 2-5 page models to find agreements, contradictions, and coverage gaps.",
        "input_schema": {
            "type": "object",
            "properties": {"page_models": {"type": "array", "items": {"type": "object"}}},
            "required": ["page_models"],
        },
    },
    {
        "name": "web_search",
        "description": "Search the web for academic sources as a fallback when citations have no URL/DOI.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
]


async def dispatch_tool(name: str, inputs: dict) -> dict:
    """Route a tool call by name. All tools return dicts; errors return {error: str}."""
    try:
        if name == "fetch_paper":
            return await fetch_paper(**inputs)
        if name == "verify_link":
            pm = PageModel.model_validate(inputs["page_model"])
            return await verify_link(inputs["citation_id"], pm)
        if name == "verify_claim":
            pm = PageModel.model_validate(inputs["page_model"])
            return await verify_claim(inputs["claim_text"], inputs["citation_id"], pm)
        if name == "extract_section":
            pm = PageModel.model_validate(inputs["page_model"])
            return extract_section(inputs.get("paragraph_id"), pm)
        if name == "summarize":
            pm = PageModel.model_validate(inputs["page_model"])
            return await summarize(pm)
        if name == "cross_compare":
            pms = [PageModel.model_validate(m) for m in inputs["page_models"]]
            return await cross_compare(pms)
        if name == "web_search":
            return await web_search(inputs["query"])
        return {"error": f"Unknown tool: {name}"}
    except Exception as exc:
        return {"error": str(exc)}
```

- [ ] **Step 4: Run registry tests**

```bash
cd research-kit/backend && python -m pytest tests/unit/test_tool_registry.py -v
```
Expected: 4 tests PASS

- [ ] **Step 5: Create `app/agent.py`**

```python
# research-kit/backend/app/agent.py
import json
from typing import AsyncGenerator
import anthropic
from app.models.request import AgentRunRequest
from app.tools import TOOL_SCHEMAS, dispatch_tool

_client = anthropic.AsyncAnthropic()

_SYSTEM = """You are a research assistant specialized in academic AI tools (Elicit, SciSpace, Consensus).
Help users verify claims, summarize papers, and compare findings across sources.
Ground every response in the provided PageModel content. Never fabricate citations or evidence.
When verification is requested, always use verify_claim and include the verbatim_quote in your reply."""


async def run_agent(request: AgentRunRequest) -> AsyncGenerator[dict, None]:
    """Yield SSE-style event dicts until end_turn or error."""
    context = json.dumps({
        "page_models": [pm.model_dump() for pm in request.page_models],
        "selection": request.selection.model_dump() if request.selection else None,
    })
    user_content = f"{request.request}\n\n<context>{context}</context>"

    messages: list[dict] = [{"role": "user", "content": user_content}]
    system = [{"type": "text", "text": _SYSTEM, "cache_control": {"type": "ephemeral"}}]

    while True:
        try:
            response = await _client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=4096,
                system=system,
                tools=TOOL_SCHEMAS,
                messages=messages,
            )
        except Exception as exc:
            yield {"event": "error", "data": {"message": str(exc)}}
            return

        tool_uses = []
        for block in response.content:
            if block.type == "text":
                yield {"event": "text", "data": {"delta": block.text}}
            elif block.type == "tool_use":
                yield {"event": "tool_use", "data": {"name": block.name, "input": block.input}}
                result = await dispatch_tool(block.name, block.input)
                yield {"event": "tool_result", "data": {"name": block.name, "output": result}}
                tool_uses.append({"tool_use_id": block.id, "name": block.name, "result": result})

        if response.stop_reason == "end_turn" or response.stop_reason != "tool_use":
            yield {"event": "done", "data": {"stop_reason": response.stop_reason}}
            return

        # Append assistant turn + tool results and loop
        messages.append({"role": "assistant", "content": response.content})
        tool_result_content = [
            {"type": "tool_result", "tool_use_id": t["tool_use_id"], "content": json.dumps(t["result"])}
            for t in tool_uses
        ]
        messages.append({"role": "user", "content": tool_result_content})
```

- [ ] **Step 6: Commit**

```bash
cd research-kit/backend
git add app/tools/__init__.py app/agent.py tests/unit/test_tool_registry.py
git commit -m "feat(backend): add tool registry + Anthropic agent loop"
```

---

## Task 9: Backend — FastAPI `/agent/run` SSE endpoint

**Files:**
- Create: `research-kit/backend/app/api/agent.py`
- Modify: `research-kit/backend/app/main.py`
- Create: `research-kit/backend/tests/integration/test_agent_run.py`

- [ ] **Step 1: Write integration test**

```python
# research-kit/backend/tests/integration/test_agent_run.py
import json, pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport

FIXTURES = Path(__file__).parent.parent / "fixtures" / "page_models"


def load_fixture(name):
    return json.loads((FIXTURES / name).read_text())


async def _fake_agent(request):
    yield {"event": "text", "data": {"delta": "Here is the summary."}}
    yield {"event": "done", "data": {"stop_reason": "end_turn"}}


@pytest.mark.asyncio
async def test_agent_run_streams_events():
    from app.main import app
    payload = {
        "request": "Summarize",
        "page_models": [load_fixture("elicit_report.json")],
        "mode": "chat",
    }
    with patch("app.api.agent.run_agent", side_effect=_fake_agent):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            async with client.stream("POST", "/agent/run", json=payload) as resp:
                assert resp.status_code == 200
                content = b""
                async for chunk in resp.aiter_bytes():
                    content += chunk
    assert b"text" in content
    assert b"Here is the summary." in content


@pytest.mark.asyncio
async def test_agent_run_rejects_invalid_payload():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/agent/run", json={"request": "hi"})  # missing mode
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_agent_run_auth_token():
    from app.main import app
    payload = {"request": "hi", "page_models": [], "mode": "chat"}
    with patch("app.api.agent.settings") as ms:
        ms.backend_token = "secret"
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/agent/run", json=payload,
                                     headers={"Authorization": "Bearer wrong"})
    assert resp.status_code == 401
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd research-kit/backend && python -m pytest tests/integration/test_agent_run.py -v 2>&1 | head -15
```

- [ ] **Step 3: Create `app/api/agent.py`**

```python
# research-kit/backend/app/api/agent.py
import json
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import StreamingResponse
from app.models.request import AgentRunRequest
from app.agent import run_agent
from app.config import settings

router = APIRouter()


def _check_auth(authorization: str | None) -> None:
    token = settings.backend_token
    if not token:
        return  # auth disabled (dev mode)
    if authorization != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="Invalid or missing token")


async def _event_stream(request: AgentRunRequest):
    async for event in run_agent(request):
        data = json.dumps({"event": event["event"], **event["data"]})
        yield f"data: {data}\n\n"


@router.post("/agent/run")
async def agent_run(
    request: AgentRunRequest,
    authorization: str | None = Header(default=None),
):
    _check_auth(authorization)
    return StreamingResponse(
        _event_stream(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

- [ ] **Step 4: Add agent router to `app/main.py`**

Add these two lines to `research-kit/backend/app/main.py` (after the existing router imports):
```python
from app.api.agent import router as agent_router
```
And add after the existing `app.include_router` calls:
```python
app.include_router(agent_router)
```

- [ ] **Step 5: Run integration tests**

```bash
cd research-kit/backend && python -m pytest tests/integration/test_agent_run.py -v
```
Expected: 3 tests PASS

- [ ] **Step 6: Run full backend test suite**

```bash
cd research-kit/backend && python -m pytest tests/ -v --ignore=tests/integration 2>&1 | tail -10
```
Expected: All unit tests PASS

- [ ] **Step 7: Commit**

```bash
cd research-kit/backend
git add app/api/agent.py app/main.py tests/integration/test_agent_run.py
git commit -m "feat(backend): add /agent/run SSE endpoint"
```

---

## Task 10: Extension — Adapter TypeScript contract

**Files:**
- Create: `research-kit/extension/src/adapters/types.ts`
- Create: `research-kit/extension/src/adapters/registry.ts`
- Create: `research-kit/extension/tests/adapters/types.test.ts`

**Goal:** Define the SiteAdapter interface and PageModel TypeScript types that mirror the backend Pydantic models, allowing adapters to normalize page content.

- [ ] **Step 1: Create `src/adapters/types.ts`**

```typescript
// research-kit/extension/src/adapters/types.ts
export type Site = "elicit" | "scispace" | "consensus";
export type SchemaVersion = "1.0";
export type Stance = "supporting" | "contradicting" | "mixed" | "neutral" | undefined;

export interface Paragraph {
  id: string;
  text: string;
  citationIds: string[];
}

export interface Citation {
  id: string;
  label: string;
  url?: string;
  doi?: string;
  title?: string;
  authors?: string[];
  year?: number;
  rawAnchorText: string;
  stance?: Stance;
}

export interface TableCell {
  text: string;
  citationIds: string[];
}

export interface TableRow {
  id: string;
  paperCitationId: string;
  cells: Record<string, TableCell>;
}

export interface Answer {
  id: string;
  text: string;
  paragraphs: Paragraph[];
}

export interface AdapterMeta {
  adapterVersion: string;
  extractionWarnings: string[];
  selectorHits: Record<string, number>;
}

export interface SelectionRef {
  text: string;
  contextBefore: string;
  contextAfter: string;
  nearestParagraphId?: string;
  nearestCitationIds: string[];
}

export interface PageModel {
  site: Site;
  schemaVersion: SchemaVersion;
  capturedAt: string;
  url: string;
  title: string;
  query?: string;
  answer?: Answer;
  tableRows?: TableRow[];
  citations: Citation[];
  selection?: SelectionRef;
  adapterMeta: AdapterMeta;
}

export interface SiteAdapter {
  /** Check if this adapter can handle the current page */
  canHandle(url: string): boolean;
  
  /** Extract PageModel from the current page DOM */
  extract(): Promise<PageModel | null>;
  
  /** Get the current text selection as SelectionRef, or null if none */
  getSelection(): SelectionRef | null;
}
```

- [ ] **Step 2: Create `src/adapters/registry.ts`**

```typescript
// research-kit/extension/src/adapters/registry.ts
import type { SiteAdapter, Site } from './types'

let _adapters: Map<Site, SiteAdapter> = new Map()

export function registerAdapter(site: Site, adapter: SiteAdapter) {
  _adapters.set(site, adapter)
}

export function getAdapter(site: Site): SiteAdapter | null {
  return _adapters.get(site) || null
}

export function getAdapters(): SiteAdapter[] {
  return Array.from(_adapters.values())
}
```

- [ ] **Step 3: Run vitest (will auto-create if missing)**

```bash
cd research-kit/extension && npm test -- src/adapters/types.test.ts 2>&1 | head -10
```
Expected: Tests pass (or vitest auto-creates minimal config)

- [ ] **Step 4: Commit**

```bash
cd research-kit/extension
git add src/adapters/types.ts src/adapters/registry.ts
git commit -m "feat(extension): add SiteAdapter interface + PageModel types"
```

---

## Task 11: Extension — Adapter implementations (Elicit, SciSpace, Consensus)

**Files:**
- Create: `research-kit/extension/src/adapters/elicit-adapter.ts`
- Create: `research-kit/extension/src/adapters/scispace-adapter.ts`
- Create: `research-kit/extension/src/adapters/consensus-adapter.ts`
- Create: `research-kit/extension/src/adapters/index.ts` (register all adapters)
- Create: `research-kit/extension/tests/adapters/elicit.test.ts`
- Create: `research-kit/extension/tests/adapters/scispace.test.ts`
- Create: `research-kit/extension/tests/adapters/consensus.test.ts`

**Goal:** Implement three site-specific adapters that extract content from Elicit (report + table modes), SciSpace (chat), and Consensus (claim result cards) into normalized PageModel objects.

*Note: Each adapter is ~150-200 lines and tests mirror the backend fixture structure.*

- [ ] **Step 1: Implement Elicit adapter**

Create `research-kit/extension/src/adapters/elicit-adapter.ts` (report + table mode detection):
- Extract answer paragraphs or tableRows depending on page layout
- Map citation references from page DOM to Citation[] 
- Detect report mode (answer + paragraphs) vs table mode (tableRows)

```typescript
// research-kit/extension/src/adapters/elicit-adapter.ts
import type { PageModel, SiteAdapter, AdapterMeta } from './types'

export class ElicitAdapter implements SiteAdapter {
  canHandle(url: string): boolean {
    return url.includes('elicit.com')
  }

  async extract(): Promise<PageModel | null> {
    // 1. Extract query from page state or URL
    // 2. Detect mode: report vs table
    // 3. Extract answer paragraphs OR table rows
    // 4. Extract citations
    // 5. Return PageModel
    return null  // Implemented in detailed steps below
  }

  getSelection(): any {
    // Implement in Task 15
    return null
  }
}
```

- [ ] **Step 2: Create remaining adapters (SciSpace, Consensus)**

Similar structure to Elicit but tuned for each site's DOM structure.

- [ ] **Step 3: Register adapters in `src/adapters/index.ts`**

```typescript
// research-kit/extension/src/adapters/index.ts
import { registerAdapter } from './registry'
import { ElicitAdapter } from './elicit-adapter'
import { SciSpaceAdapter } from './scispace-adapter'
import { ConsensusAdapter } from './consensus-adapter'

export * from './types'
export * from './registry'

export function initializeAdapters() {
  registerAdapter('elicit', new ElicitAdapter())
  registerAdapter('scispace', new SciSpaceAdapter())
  registerAdapter('consensus', new ConsensusAdapter())
}
```

- [ ] **Step 4: Add fixture HTML + write tests**

Tests parse fixture HTML snippets and assert PageModel shape matches.

- [ ] **Step 5: Run adapter tests**

```bash
cd research-kit/extension && npm test -- adapters/ 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
cd research-kit/extension
git add src/adapters/ tests/adapters/
git commit -m "feat(extension): implement Elicit, SciSpace, Consensus adapters"
```

---

## Task 12: Extension — Updated manifest + host permissions

**Files:**
- Modify: `research-kit/extension/manifest.json`

**Goal:** Add Elicit, SciSpace, and Consensus to host_permissions; update sidebar path.

- [ ] **Step 1: Update `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Research Kit — Agent Assistant",
  "version": "0.2.0",
  "description": "AI-powered verification and synthesis on academic research platforms",
  "permissions": ["activeTab", "tabs", "storage", "scripting", "sidePanel"],
  "host_permissions": [
    "http://localhost:8000/*",
    "https://elicit.com/*",
    "https://scispace.com/*",
    "https://consensus.app/*"
  ],
  "action": { "default_title": "Research Kit Agent" },
  "side_panel": { "default_path": "src/sidebar/index.html" },
  "background": { "service_worker": "src/background.ts" },
  "content_scripts": [
    {
      "matches": ["https://elicit.com/*"],
      "js": ["src/content/adapter-host.ts"]
    },
    {
      "matches": ["https://scispace.com/*"],
      "js": ["src/content/adapter-host.ts"]
    },
    {
      "matches": ["https://consensus.app/*"],
      "js": ["src/content/adapter-host.ts"]
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
cd research-kit/extension
git add manifest.json
git commit -m "feat(extension): update manifest for Elicit/SciSpace/Consensus + sidebar"
```

---

## Task 13: Extension — Content script refactor (`adapter-host.ts`)

**Files:**
- Create: `research-kit/extension/src/content/adapter-host.ts` (replaces chatgpt.ts, elicit.ts, perplexity.ts)
- Delete: Old content scripts
- Create: `research-kit/extension/tests/content/adapter-host.test.ts`

**Goal:** Single unified content script that uses the adapter registry to extract PageModel on demand, request selection overlay, and handle background messages.

- [ ] **Step 1: Implement `src/content/adapter-host.ts`**

```typescript
// research-kit/extension/src/content/adapter-host.ts
import { initializeAdapters, getAdapter, type PageModel } from '../adapters'
import { detectSite } from '../shared/site-detect'
import { SelectionOverlay } from './selection-overlay'

initializeAdapters()
const overlay = new SelectionOverlay()

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.type === 'content:extract') {
    extractPageModel().then(respond)
    return true  // async response
  }
  if (msg.type === 'content:selection') {
    const sel = overlay.getCurrentSelection()
    respond(sel)
  }
})

async function extractPageModel(): Promise<PageModel | null> {
  const site = detectSite(window.location.href)
  if (!site) return null
  
  const adapter = getAdapter(site)
  if (!adapter || !adapter.canHandle(window.location.href)) return null
  
  return adapter.extract()
}
```

- [ ] **Step 2: Create `src/content/selection-overlay.ts`**

Floating bubble that appears on text selection, offering "Add to context" or "Verify claim" actions.

```typescript
// research-kit/extension/src/content/selection-overlay.ts
import type { SelectionRef } from '../adapters'

export class SelectionOverlay {
  private bubble: HTMLElement | null = null

  constructor() {
    document.addEventListener('mouseup', () => this.onSelection())
  }

  private onSelection() {
    const selection = window.getSelection()
    if (!selection || selection.toString().length < 3) {
      this.hideBubble()
      return
    }

    // Build SelectionRef with context
    const text = selection.toString()
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    // Extract context before/after
    const container = range.commonAncestorContainer.parentElement
    const contextBefore = container?.textContent?.substring(0, 100) || ''
    const contextAfter = container?.textContent?.substring(text.length, 100) || ''

    this.showBubble(rect, { text, contextBefore, contextAfter, nearestCitationIds: [] })
  }

  private showBubble(rect: DOMRect, ref: SelectionRef) {
    if (!this.bubble) {
      this.bubble = document.createElement('div')
      this.bubble.innerHTML = `
        <button id="research-kit-add">+ Add to context</button>
        <button id="research-kit-verify">⚠️ Verify claim</button>
      `
      this.bubble.style.cssText = `
        position: fixed; z-index: 999999; background: #1f2937; border: 1px solid #4b5563;
        border-radius: 6px; padding: 8px; gap: 8px; display: flex;
      `
      document.body.appendChild(this.bubble)
    }

    this.bubble.style.left = rect.left + 'px'
    this.bubble.style.top = (rect.bottom + 10) + 'px'
    this.bubble.style.display = 'flex'

    // Wire up buttons
    this.bubble.querySelector('#research-kit-add')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'selection:add', selection: ref })
    })
    this.bubble.querySelector('#research-kit-verify')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'selection:verify', selection: ref })
    })
  }

  private hideBubble() {
    if (this.bubble) this.bubble.style.display = 'none'
  }

  getCurrentSelection(): SelectionRef | null {
    const selection = window.getSelection()
    if (!selection || selection.toString().length < 3) return null
    
    // Implementation returns SelectionRef or null
    return null
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd research-kit/extension && npm test -- content/
```

- [ ] **Step 4: Commit**

```bash
cd research-kit/extension
git add src/content/adapter-host.ts src/content/selection-overlay.ts \
    tests/content/
git commit -m "feat(extension): unified content script + selection overlay"
```

---

## Task 14: Extension — Update background service worker

**Files:**
- Modify: `research-kit/extension/src/background.ts`

**Goal:** Update to handle SSE agent stream, manage agent sessions, route messages from content scripts and sidebar.

- [ ] **Step 1: Update background.ts**

Replace the old link-verification flow with:
- Handle `content:extract` → call adapter → send PageModel to backend
- Handle `panel:agent-run` → POST to `/agent/run` with PageModel + request
- Stream SSE events back to sidebar via port.postMessage

```typescript
// research-kit/extension/src/background.ts
import { streamAgentRun } from './shared/api'
import type { PageModel } from './adapters'

// ... existing state management code ...

async function handleAgentRun(tabId: number, request: string, pageModels: PageModel[]) {
  const port = panelPorts.values().next().value  // Get first connected panel
  if (!port) return

  try {
    const eventEmitter = streamAgentRun(request, pageModels)
    for await (const event of eventEmitter) {
      port.postMessage({ type: 'agent:event', event })
    }
  } catch (err) {
    port.postMessage({ type: 'agent:error', error: String(err) })
  }
}

function handlePanelMessage(msg: any) {
  if (msg.type === 'panel:agent-run' && msg.tabId) {
    handleAgentRun(msg.tabId, msg.request, msg.pageModels)
  }
  // ... other handlers
}
```

- [ ] **Step 2: Commit**

```bash
cd research-kit/extension
git add src/background.ts
git commit -m "feat(extension): update background for agent stream handling"
```

---

## Task 15: Extension — React sidebar UI (ChatThread, ToolCallCard, CitationChip, ActiveContextStrip)

**Files:**
- Create: `research-kit/extension/src/sidebar/index.html`
- Create: `research-kit/extension/src/sidebar/main.tsx`
- Create: `research-kit/extension/src/sidebar/App.tsx` (new, replaces old)
- Create: `research-kit/extension/src/sidebar/ChatThread.tsx`
- Create: `research-kit/extension/src/sidebar/ToolCallCard.tsx`
- Create: `research-kit/extension/src/sidebar/CitationChip.tsx`
- Create: `research-kit/extension/src/sidebar/ActiveContextStrip.tsx`
- Create: `research-kit/extension/src/sidebar/useAgentStream.ts` (hook)
- Create: `research-kit/extension/tests/sidebar/ChatThread.test.tsx`

**Goal:** Build React 19 UI that renders streamed agent responses, shows tool calls, and manages multi-tab context.

This is a substantial task (~500 lines of React code). Key components:

1. **ChatThread**: Message list with streaming text, tool calls, results
2. **ToolCallCard**: Collapsible trace of a tool invocation with inputs/outputs  
3. **CitationChip**: Hover card showing citation metadata, "open in new tab" button
4. **ActiveContextStrip**: Shows "Currently analyzing: Elicit, SciSpace" with toggle to add/remove tabs

- [ ] **Step 1: Create `src/sidebar/index.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script type="module" src="./main.tsx"></script>
</head>
<body>
  <div id="root"></div>
</body>
</html>
```

- [ ] **Step 2: Create `src/sidebar/main.tsx`**

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 3: Create `src/sidebar/App.tsx`**

Main container managing agent stream state and panel lifecycle.

```typescript
// research-kit/extension/src/sidebar/App.tsx
import { useState, useEffect } from 'react'
import type { PageModel } from '../adapters'
import { ChatThread } from './ChatThread'
import { ActiveContextStrip } from './ActiveContextStrip'

interface AgentMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done'
  [key: string]: any
}

export default function App() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [pageModels, setPageModels] = useState<PageModel[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [input, setInput] = useState('')

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'panel' })
    
    port.onMessage.addListener((msg) => {
      if (msg.type === 'agent:event') {
        setMessages(m => [...m, msg.event])
        if (msg.event.type === 'done') setIsRunning(false)
      }
      if (msg.type === 'agent:error') {
        setMessages(m => [...m, { type: 'error', message: msg.error }])
        setIsRunning(false)
      }
    })

    return () => port.disconnect()
  }, [])

  const handleRun = () => {
    if (!input.trim() || !pageModels.length) return
    setMessages([])
    setIsRunning(true)
    // Send to background
    chrome.runtime.sendMessage({
      type: 'panel:agent-run',
      request: input,
      pageModels,
    })
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-white">
      <ActiveContextStrip models={pageModels} />
      <ChatThread messages={messages} />
      <div className="p-4 border-t border-slate-700">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about the page..."
          className="w-full p-2 bg-slate-900 border border-slate-700 rounded text-white text-sm"
          rows={3}
        />
        <button
          onClick={handleRun}
          disabled={isRunning || !input.trim()}
          className="mt-2 w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 rounded text-sm"
        >
          {isRunning ? 'Running...' : 'Run'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `ChatThread.tsx`**

```typescript
// research-kit/extension/src/sidebar/ChatThread.tsx
import { ToolCallCard } from './ToolCallCard'
import type { AgentMessage } from './App'

export function ChatThread({ messages }: { messages: AgentMessage[] }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.map((msg, i) => {
        if (msg.type === 'text') {
          return (
            <div key={i} className="bg-slate-800 p-3 rounded text-sm">
              {msg.delta}
            </div>
          )
        }
        if (msg.type === 'tool_use') {
          return <ToolCallCard key={i} name={msg.name} input={msg.input} />
        }
        if (msg.type === 'error') {
          return <div key={i} className="bg-red-900/20 p-3 rounded text-red-200">{msg.message}</div>
        }
        return null
      })}
    </div>
  )
}
```

- [ ] **Step 5: Create remaining sidebar components (ToolCallCard, CitationChip, ActiveContextStrip)**

Each ~40-60 lines following the same pattern.

- [ ] **Step 6: Create `src/sidebar/index.css`**

Tailwind setup or minimal CSS for dark theme.

- [ ] **Step 7: Update `package.json`**

Add: `vitest`, `@vitest/browser`, `jsdom`, `happy-dom`, `@testing-library/react`, `happy-dom`.

- [ ] **Step 8: Run tests**

```bash
cd research-kit/extension && npm test -- sidebar/
```

- [ ] **Step 9: Commit**

```bash
cd research-kit/extension
git add src/sidebar/ package.json
git commit -m "feat(extension): React sidebar with ChatThread, ToolCallCard, context strip"
```

---

## Task 16: Extension — SSE client in `shared/api.ts`

**Files:**
- Modify: `research-kit/extension/src/shared/api.ts`

**Goal:** Implement `streamAgentRun(request, pageModels)` that posts to backend `/agent/run` and parses SSE event stream.

```typescript
// research-kit/extension/src/shared/api.ts
import type { PageModel, AgentRunRequest } from '../adapters'

const API_URL = 'http://localhost:8000'

async function* streamAgentRun(
  request: string,
  pageModels: PageModel[],
  mode: 'chat' | 'action' = 'chat'
) {
  const payload: AgentRunRequest = { request, page_models: pageModels, mode }
  const resp = await fetch(`${API_URL}/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!resp.ok) throw new Error(`Agent API error: ${resp.status}`)

  const reader = resp.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value)
    const lines = buffer.split('\n')
    buffer = lines[lines.length - 1]

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i]
      if (line.startsWith('data: ')) {
        const json = JSON.parse(line.slice(6))
        yield json
      }
    }
  }
}

export { streamAgentRun }
```

- [ ] **Step 1: Update `shared/api.ts`**

- [ ] **Step 2: Commit**

```bash
cd research-kit/extension
git add src/shared/api.ts
git commit -m "feat(extension): add SSE client for agent stream"
```

---

## Task 17: Extension — Integration tests + smoke test

**Files:**
- Create: `research-kit/extension/tests/integration/e2e.test.ts`
- Create: `research-kit/extension/tests/fixtures/` (HTML snapshots)

**Goal:** End-to-end tests verifying adapters → background → sidebar → agent backend flow.

Defer detailed implementation to after core UI works. Smoke test: load extension, visit Elicit, extract PageModel, run agent request.

---

## Task 18–22: Extension — Refinement + deployment

**Remaining tasks (high-level):**
- Task 18: Styling refinement (Tailwind CSS setup, dark theme, responsive)
- Task 19: Error handling + user feedback (toast notifications, fallback UI)
- Task 20: Storage + persistence (conversation history via chrome.storage.local)
- Task 21: Multi-tab context management (select/deselect tabs, show active set)
- Task 22: Build + package extension (Vite config, CRX packaging, testing in Chrome)

---
