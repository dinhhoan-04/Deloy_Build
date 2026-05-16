# Research Kit App Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire RK from current "GoClaw merged + extension scaffolded" state into an end-to-end usable app: real worker prompts with JSON output, Google auth, real backend client, SSE streaming, ChatTab/DraftTab, and all UI handlers.

**Architecture:** Worker emits structured JSON (one schema per RunKind), parser+writeback in `worker/_execute_run_impl`; extension uses `chrome.identity.launchWebAuthFlow` for Google sign-in, persists session token, and goes through a single `apiFetch` chokepoint for all REST + SSE traffic. Backend = source of truth; mutations are write-through with refetch.

**Tech Stack:** Python 3.12 (FastAPI, RQ, Pydantic v2, websockets, pytest); TypeScript/React 18 (Vite, Zustand, Vitest, @testing-library/react, react-markdown); GoClaw gateway (WS, port 18790).

**Spec:** `docs/superpowers/specs/2026-05-09-rk-app-completion-design.md`

---

## File Structure

### Worker (Python) — Phase 1

| Path | Status | Responsibility |
|---|---|---|
| `research-kit/worker/prompts/verify.py` | Modify | `VerifyOutput` schema + `build_messages`. |
| `research-kit/worker/prompts/extract.py` | Modify | `ExtractOutput` schema + `build_messages`. |
| `research-kit/worker/prompts/conflict.py` | Modify | `ConflictOutput` schema + `build_messages`. |
| `research-kit/worker/prompts/draft.py` | Modify | `DraftOutput` schema + `build_messages`. |
| `research-kit/worker/prompts/chat.py` | Modify | `ChatOutput` schema + `build_messages`. |
| `research-kit/worker/result_parser.py` | Create | `parse_output(kind, content) → BaseModel`, `OutputParseError`, `_strip_code_fences`. |
| `research-kit/worker/writeback.py` | Create | `apply_writeback(kind, run, parsed)` — DB writes for verify/extract/conflict. |
| `research-kit/worker/tasks.py` | Modify | Call parser + writeback; single retry on `OutputParseError`. |
| `research-kit/worker/tests/unit/test_prompts.py` | Create | Per-prompt `build_messages` shape tests. |
| `research-kit/worker/tests/unit/test_result_parser.py` | Create | Round-trip + malformed + code-fence tests. |
| `research-kit/worker/tests/integration/test_run_writeback.py` | Create | Mock GoClaw → assert DB rows after `_finalize`. |
| `research-kit/worker/tests/integration/test_parse_retry.py` | Create | First call prose, second JSON → run succeeds. |

### Extension (TypeScript) — Phases 2–4

| Path | Status | Responsibility |
|---|---|---|
| `research-kit/extension/src/shared/auth.ts` | Create | OAuth flow, token persistence, `onAuthChange`, `authHeader`. |
| `research-kit/extension/src/shared/sse.ts` | Create | `parseSSE(stream)` async iterable. |
| `research-kit/extension/src/shared/api.ts` | Rewrite | `apiFetch` + typed REST functions + `streamRun`. |
| `research-kit/extension/src/shared/types.ts` | Modify | Add `Project`, `Claim`, `InboxItem`, `Conflict`, `Run*`, `RunEvent`, `ResolutionPayload`. Remove `VerifyResponse`, `CollectResponse`, `Capture`, `Session`. |
| `research-kit/extension/src/shared/errors.ts` | Create | `ApiError`, `AuthExpiredError`. |
| `research-kit/extension/src/sidebar/hooks/useAuth.ts` | Create | Subscribe to `onAuthChange`, return `{user, loading, signIn, signOut}`. |
| `research-kit/extension/src/sidebar/hooks/useRunStream.ts` | Create | Async-iterable consumer, exposes `{tokens, status, toolCalls, error}`. |
| `research-kit/extension/src/sidebar/hooks/useToast.ts` | Create | Thin wrapper over existing `Toast` atom. |
| `research-kit/extension/src/sidebar/state/slices/projects.ts` | Create | `loadProjects`, `createProject`. |
| `research-kit/extension/src/sidebar/state/slices/claims.ts` | Create | `loadClaims`, `patchClaim`. |
| `research-kit/extension/src/sidebar/state/slices/inbox.ts` | Create | `loadInbox`, `addToInbox`, `removeFromInbox`, `archiveMany`. |
| `research-kit/extension/src/sidebar/state/slices/conflicts.ts` | Create | `loadConflicts`, `patchConflict`. |
| `research-kit/extension/src/sidebar/state/slices/runs.ts` | Create | `trackRun(run_id, kind)` and per-run subscription register. |
| `research-kit/extension/src/sidebar/state/useStore.ts` | Refactor | Compose slices; drop persisted domain data; keep persisted UI state under `rk_schema_version=2`. |
| `research-kit/extension/src/sidebar/components/atoms/MessageBubble.tsx` | Create | Chat message renderer. |
| `research-kit/extension/src/sidebar/components/atoms/MarkdownView.tsx` | Create | Wrap `react-markdown` with safe defaults. |
| `research-kit/extension/src/sidebar/components/atoms/ProjectCreateModal.tsx` | Create | Name input + Create / Cancel. |
| `research-kit/extension/src/sidebar/components/atoms/ConflictResolutionPanel.tsx` | Create | Sides + accept/reject controls. |
| `research-kit/extension/src/sidebar/components/atoms/LoginGate.tsx` | Create | "Sign in with Google" centered card. |
| `research-kit/extension/src/sidebar/components/tabs/ChatTab.tsx` | Rewrite | Thread + send + streaming. |
| `research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx` | Rewrite | Source picker + generate + streaming markdown. |
| `research-kit/extension/src/sidebar/App.tsx` | Modify | Replace 7 TODO handlers; wrap in auth gate. |
| `research-kit/extension/manifest.json` | Modify | Add `"identity"` permission, set `key` for stable ID. |
| `research-kit/extension/.env.example` | Create | `VITE_GOOGLE_CLIENT_ID`, `VITE_API_URL`. |

### Tests (extension) — colocated

For each new TS file above, an adjacent `*.test.ts(x)` exists. Files explicitly enumerated as tasks below.

---

## Phase 1 — Worker Prompts, Parser, Writeback

End state: `RK_RUNNER=goclaw` + new prompts produces validated output for all 5 kinds; verify/extract/conflict write to DB inside `_finalize`. **Rollback gate**: a `curl POST /v1/runs` then `GET /v1/runs/{id}/stream` for `kind=verify` must complete with valid `VerifyOutput` written to claims table before Phase 2 begins.

### Task 1: `VerifyOutput` schema + `build_messages`

**Files:**
- Modify: `research-kit/worker/prompts/verify.py`
- Test: `research-kit/worker/tests/unit/test_prompts.py`

- [ ] **Step 1: Write the failing test**

```python
# research-kit/worker/tests/unit/test_prompts.py
import json
from worker.prompts import verify

def test_verify_build_messages_shape():
    msgs = verify.build_messages({
        "claim_id": "00000000-0000-0000-0000-000000000001",
        "claim": {
            "text": "GPT-4 outperforms humans on MMLU.",
            "citations": [{"ref_id": "1", "url": "https://arxiv.org/abs/2303.08774"}],
        },
    })
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert "JSON" in msgs[0]["content"]
    assert "VerifyOutput" in msgs[0]["content"] or "verdict" in msgs[0]["content"]
    user = json.loads(msgs[1]["content"])
    assert user["claim_text"] == "GPT-4 outperforms humans on MMLU."
    assert user["paper_urls"] == ["https://arxiv.org/abs/2303.08774"]

def test_verify_output_schema_validates():
    out = verify.VerifyOutput(
        verdict="supported", confidence=0.9, quote="...", page=3, reason="ok"
    )
    assert out.verdict == "supported"

def test_verify_output_rejects_bad_verdict():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        verify.VerifyOutput(verdict="maybe", confidence=0.5, reason="x")
```

- [ ] **Step 2: Run test, expect ImportError / AttributeError**

```bash
cd research-kit/worker && pytest tests/unit/test_prompts.py -v
```

Expected: FAIL — `verify.VerifyOutput` does not exist yet.

- [ ] **Step 3: Implement `verify.py`**

```python
# research-kit/worker/prompts/verify.py
from __future__ import annotations
import json
from typing import Literal
from pydantic import BaseModel, Field


class VerifyOutput(BaseModel):
    verdict: Literal["supported", "partially_supported", "unsupported", "uncertain"]
    confidence: float = Field(ge=0.0, le=1.0)
    quote: str | None = None
    page: int | None = None
    reason: str = Field(min_length=1, max_length=2000)


_SYSTEM = """You are RK-Verify. Given a claim and one or more cited papers,
determine whether the papers support the claim.

Output ONLY a JSON object matching this schema (no prose, no markdown fences):
{schema}

Rules:
- "verdict" is one of: supported, partially_supported, unsupported, uncertain.
- "confidence" reflects evidence strength on a 0..1 scale.
- "quote" must be verbatim from one of the cited papers when verdict is supported or partially_supported.
- "page" is the page number where the quote appears, if known.
- "reason" briefly explains the verdict (1-3 sentences).

EXAMPLE:
Input claim: "Aspirin reduces the risk of heart attack by 30%."
Output:
{{"verdict":"partially_supported","confidence":0.7,"quote":"low-dose aspirin reduced incidence by 22%","page":4,"reason":"Cited trial shows ~22% reduction, not 30%."}}
"""


def build_messages(input: dict) -> list[dict]:
    claim = input["claim"]
    schema = json.dumps(VerifyOutput.model_json_schema(), indent=2)
    return [
        {"role": "system", "content": _SYSTEM.format(schema=schema)},
        {"role": "user", "content": json.dumps({
            "claim_text": claim["text"],
            "paper_urls": [c["url"] for c in claim.get("citations", [])],
        })},
    ]
```

- [ ] **Step 4: Run test, expect PASS**

```bash
cd research-kit/worker && pytest tests/unit/test_prompts.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add research-kit/worker/prompts/verify.py research-kit/worker/tests/unit/test_prompts.py
git commit -m "feat(worker): real verify prompt with JSON schema"
```

### Task 2: `ExtractOutput` schema + `build_messages`

**Files:**
- Modify: `research-kit/worker/prompts/extract.py`
- Modify: `research-kit/worker/tests/unit/test_prompts.py`

- [ ] **Step 1: Append failing test**

```python
# in test_prompts.py, append:
from worker.prompts import extract

def test_extract_build_messages():
    msgs = extract.build_messages({"paper_url": "https://example.com/p.pdf", "sections": ["abstract"]})
    assert len(msgs) == 2
    assert "claims" in msgs[0]["content"].lower()

def test_extract_output_schema():
    out = extract.ExtractOutput(claims=[
        extract.ExtractedClaim(text="X is Y.", page=1, section="abstract"),
    ])
    assert len(out.claims) == 1
```

- [ ] **Step 2: Run, expect ImportError**

```bash
cd research-kit/worker && pytest tests/unit/test_prompts.py -v
```

Expected: 2 new tests fail.

- [ ] **Step 3: Implement `extract.py`**

```python
# research-kit/worker/prompts/extract.py
from __future__ import annotations
import json
from pydantic import BaseModel, Field


class ExtractedClaim(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    page: int | None = None
    section: str | None = None


class ExtractOutput(BaseModel):
    claims: list[ExtractedClaim] = Field(max_length=100)


_SYSTEM = """You are RK-Extract. Read the paper at the given URL and extract
factual, citation-worthy claims (statements of empirical fact, results, or
strong assertions).

Output ONLY a JSON object matching this schema:
{schema}

Rules:
- Each claim is a self-contained sentence.
- Include the page number and section name if identifiable.
- Skip background, motivation, or rhetorical statements.
- Limit to the most important 20 claims.

EXAMPLE:
{{"claims":[{{"text":"Model X achieves 87.3% accuracy on MMLU.","page":4,"section":"results"}}]}}
"""


def build_messages(input: dict) -> list[dict]:
    schema = json.dumps(ExtractOutput.model_json_schema(), indent=2)
    return [
        {"role": "system", "content": _SYSTEM.format(schema=schema)},
        {"role": "user", "content": json.dumps({
            "paper_url": input["paper_url"],
            "sections": input.get("sections"),
        })},
    ]
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd research-kit/worker && pytest tests/unit/test_prompts.py -v
```

- [ ] **Step 5: Commit**

```bash
git add research-kit/worker/prompts/extract.py research-kit/worker/tests/unit/test_prompts.py
git commit -m "feat(worker): real extract prompt with JSON schema"
```

### Task 3: `ConflictOutput` schema + `build_messages`

**Files:**
- Modify: `research-kit/worker/prompts/conflict.py`
- Modify: `research-kit/worker/tests/unit/test_prompts.py`

- [ ] **Step 1: Append failing test**

```python
from worker.prompts import conflict

def test_conflict_build_messages():
    msgs = conflict.build_messages({
        "conflict_id": "00000000-0000-0000-0000-000000000002",
        "group_key": "doi:10.x/abc",
        "sides": [
            {"side_id": "s1", "label": "A", "verdict": "supported", "quote": "x"},
            {"side_id": "s2", "label": "B", "verdict": "unsupported", "quote": "y"},
        ],
    })
    assert "sides" in msgs[1]["content"]

def test_conflict_output_schema():
    out = conflict.ConflictOutput(
        suggested_resolution="A is more reliable because larger sample.",
        rationale="Sample size and methodology differ.",
        sides_analysis=[
            conflict.SideAnalysis(side_id="s1", weight=0.7, note="larger n"),
            conflict.SideAnalysis(side_id="s2", weight=0.3, note="smaller n"),
        ],
    )
    assert sum(s.weight for s in out.sides_analysis) == pytest.approx(1.0)  # noqa
```

(Add `import pytest` at top if not present.)

- [ ] **Step 2: Run, expect ImportError**

```bash
cd research-kit/worker && pytest tests/unit/test_prompts.py -v
```

- [ ] **Step 3: Implement `conflict.py`**

```python
# research-kit/worker/prompts/conflict.py
from __future__ import annotations
import json
from pydantic import BaseModel, Field


class SideAnalysis(BaseModel):
    side_id: str
    weight: float = Field(ge=0.0, le=1.0)
    note: str = Field(min_length=1, max_length=500)


class ConflictOutput(BaseModel):
    suggested_resolution: str = Field(min_length=1, max_length=2000)
    rationale: str = Field(min_length=1, max_length=2000)
    sides_analysis: list[SideAnalysis] = Field(min_length=2)


_SYSTEM = """You are RK-Conflict. You are given two or more sides of a research
disagreement (each with a verdict and quote). Suggest which side is more reliable
and why.

Output ONLY a JSON object matching this schema:
{schema}

Rules:
- "suggested_resolution" is your recommended outcome (the user has final say).
- "rationale" cites methodology, sample size, recency, etc.
- "sides_analysis" has one entry per input side; weights need not sum to 1 but
  should reflect relative reliability.
"""


def build_messages(input: dict) -> list[dict]:
    schema = json.dumps(ConflictOutput.model_json_schema(), indent=2)
    return [
        {"role": "system", "content": _SYSTEM.format(schema=schema)},
        {"role": "user", "content": json.dumps({
            "group_key": input["group_key"],
            "sides": input["sides"],
        })},
    ]
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

```bash
git add research-kit/worker/prompts/conflict.py research-kit/worker/tests/unit/test_prompts.py
git commit -m "feat(worker): real conflict prompt with JSON schema"
```

### Task 4: `DraftOutput` schema + `build_messages`

**Files:**
- Modify: `research-kit/worker/prompts/draft.py`
- Modify: `research-kit/worker/tests/unit/test_prompts.py`

- [ ] **Step 1: Append failing test**

```python
from worker.prompts import draft

def test_draft_build_messages():
    msgs = draft.build_messages({
        "claims": [{"id": "c1", "text": "X is Y.", "verdict": "supported", "quote": "x"}],
        "style": "short",
    })
    assert "markdown" in msgs[0]["content"].lower()

def test_draft_output_schema():
    out = draft.DraftOutput(
        markdown="# Title\n\nBody.",
        sections=[draft.DraftSection(title="Intro", claim_refs=["c1"])],
    )
    assert out.markdown.startswith("#")
```

- [ ] **Step 2: Run, expect ImportError**
- [ ] **Step 3: Implement `draft.py`**

```python
# research-kit/worker/prompts/draft.py
from __future__ import annotations
import json
from pydantic import BaseModel, Field


class DraftSection(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    claim_refs: list[str] = Field(default_factory=list)


class DraftOutput(BaseModel):
    markdown: str = Field(min_length=1)
    sections: list[DraftSection] = Field(default_factory=list)


_SYSTEM = """You are RK-Draft. You are given a set of verified claims with
their supporting quotes. Synthesize them into a coherent, well-cited markdown
document.

Output ONLY a JSON object matching this schema:
{schema}

Rules:
- "markdown" is the synthesized document. Use markdown headings and inline
  citation markers like [c1] referring to claim ids.
- "sections" lists section titles and which claim ids appear in each.
- Style "short" → ~300 words; "long" → ~1000 words; default → ~500.
"""


def build_messages(input: dict) -> list[dict]:
    schema = json.dumps(DraftOutput.model_json_schema(), indent=2)
    return [
        {"role": "system", "content": _SYSTEM.format(schema=schema)},
        {"role": "user", "content": json.dumps({
            "claims": input["claims"],
            "style": input.get("style", "default"),
        })},
    ]
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

```bash
git add research-kit/worker/prompts/draft.py research-kit/worker/tests/unit/test_prompts.py
git commit -m "feat(worker): real draft prompt with JSON schema"
```

### Task 5: `ChatOutput` schema + `build_messages`

**Files:**
- Modify: `research-kit/worker/prompts/chat.py`
- Modify: `research-kit/worker/tests/unit/test_prompts.py`

- [ ] **Step 1: Append failing test**

```python
from worker.prompts import chat

def test_chat_build_messages_passes_history():
    msgs = chat.build_messages({"messages": [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
        {"role": "user", "content": "what is RK?"},
    ]})
    # System message + 3 history messages = 4
    assert len(msgs) == 4
    assert msgs[0]["role"] == "system"
    assert msgs[-1]["content"] == "what is RK?"

def test_chat_output_schema():
    out = chat.ChatOutput(text="hello world")
    assert out.text == "hello world"
```

- [ ] **Step 2: Run, expect ImportError**
- [ ] **Step 3: Implement `chat.py`**

```python
# research-kit/worker/prompts/chat.py
from __future__ import annotations
import json
from pydantic import BaseModel, Field


class ChatOutput(BaseModel):
    text: str = Field(min_length=1)


_SYSTEM = """You are RK-Chat, a research assistant. Answer the user's question
based on prior conversation context. You may use available MCP tools
(search_inbox, get_inbox_items, fetch_paper) to retrieve information.

Output ONLY a JSON object: {{"text": "<your answer>"}}
"""


def build_messages(input: dict) -> list[dict]:
    history = input.get("messages", [])
    return [{"role": "system", "content": _SYSTEM}, *history]
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

```bash
git add research-kit/worker/prompts/chat.py research-kit/worker/tests/unit/test_prompts.py
git commit -m "feat(worker): real chat prompt with JSON schema"
```

### Task 6: `result_parser.py`

**Files:**
- Create: `research-kit/worker/result_parser.py`
- Create: `research-kit/worker/tests/unit/test_result_parser.py`

- [ ] **Step 1: Write failing tests**

```python
# research-kit/worker/tests/unit/test_result_parser.py
import json
import pytest
from rk_shared.types import RunKind
from worker.result_parser import parse_output, OutputParseError, _strip_code_fences

def test_strip_code_fences_json_block():
    raw = "```json\n{\"a\": 1}\n```"
    assert _strip_code_fences(raw) == '{"a": 1}'

def test_strip_code_fences_plain():
    assert _strip_code_fences("{\"a\": 1}") == '{"a": 1}'

def test_parse_verify_valid():
    raw = json.dumps({
        "verdict": "supported", "confidence": 0.9,
        "quote": "x", "page": 1, "reason": "ok",
    })
    out = parse_output(RunKind.VERIFY, raw)
    assert out.verdict == "supported"

def test_parse_verify_with_fences():
    raw = "```json\n" + json.dumps({
        "verdict": "supported", "confidence": 0.9, "reason": "ok"
    }) + "\n```"
    out = parse_output(RunKind.VERIFY, raw)
    assert out.confidence == 0.9

def test_parse_invalid_json_raises():
    with pytest.raises(OutputParseError):
        parse_output(RunKind.VERIFY, "not json at all")

def test_parse_invalid_schema_raises():
    raw = json.dumps({"verdict": "weird", "confidence": 0.5, "reason": "x"})
    with pytest.raises(OutputParseError):
        parse_output(RunKind.VERIFY, raw)

def test_parse_chat_valid():
    out = parse_output(RunKind.CHAT, json.dumps({"text": "hi"}))
    assert out.text == "hi"
```

- [ ] **Step 2: Run, expect ImportError**

```bash
cd research-kit/worker && pytest tests/unit/test_result_parser.py -v
```

- [ ] **Step 3: Implement `result_parser.py`**

```python
# research-kit/worker/result_parser.py
from __future__ import annotations
import json
import re
from pydantic import BaseModel, ValidationError

from rk_shared.types import RunKind
from worker.prompts.verify import VerifyOutput
from worker.prompts.extract import ExtractOutput
from worker.prompts.conflict import ConflictOutput
from worker.prompts.draft import DraftOutput
from worker.prompts.chat import ChatOutput


PARSERS: dict[RunKind, type[BaseModel]] = {
    RunKind.VERIFY:   VerifyOutput,
    RunKind.EXTRACT:  ExtractOutput,
    RunKind.CONFLICT: ConflictOutput,
    RunKind.DRAFT:    DraftOutput,
    RunKind.CHAT:     ChatOutput,
}


class OutputParseError(Exception):
    pass


_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*\n(.*?)\n?\s*```\s*$", re.DOTALL)


def _strip_code_fences(text: str) -> str:
    m = _FENCE_RE.match(text)
    return m.group(1) if m else text.strip()


def parse_output(kind: RunKind, content: str) -> BaseModel:
    cleaned = _strip_code_fences(content)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise OutputParseError(f"invalid JSON: {e}") from e
    model_cls = PARSERS[kind]
    try:
        return model_cls.model_validate(data)
    except ValidationError as e:
        raise OutputParseError(f"schema validation failed: {e}") from e
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

```bash
git add research-kit/worker/result_parser.py research-kit/worker/tests/unit/test_result_parser.py
git commit -m "feat(worker): result_parser with per-kind schemas + fence stripping"
```

### Task 7: `writeback.py`

**Files:**
- Create: `research-kit/worker/writeback.py`

Note: The repos used here (`ClaimRepo`, `ConflictRepo`) live in the **backend** package (`research-kit/backend/app/repos/`). Worker imports them via the shared workspace; if cross-package imports aren't already wired, this task is to wrap their underlying SQL via direct ORM operations on `rk_shared.models` instead. Inspect first; choose the simpler path.

- [ ] **Step 1: Inspect import availability**

```bash
cd research-kit && python -c "from rk_shared.models import Claim, Conflict, Run; print('ok')"
```

If `ok`, use ORM directly in writeback. If not, raise to user.

- [ ] **Step 2: Implement `writeback.py`**

```python
# research-kit/worker/writeback.py
from __future__ import annotations
import json
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from pydantic import BaseModel

from rk_shared.models import Claim, Conflict
from rk_shared.types import RunKind
from worker import db as wdb
from worker.prompts.verify import VerifyOutput
from worker.prompts.extract import ExtractOutput
from worker.prompts.conflict import ConflictOutput


async def apply_writeback(kind: RunKind, run_input: dict, project_id: UUID | None,
                           parsed: BaseModel) -> None:
    """Apply DB writes specific to a RunKind. Idempotent (set-state operations)."""
    if kind == RunKind.VERIFY and isinstance(parsed, VerifyOutput):
        await _writeback_verify(UUID(run_input["claim_id"]), parsed)
    elif kind == RunKind.EXTRACT and isinstance(parsed, ExtractOutput):
        if project_id is None:
            return
        await _writeback_extract(project_id, run_input, parsed)
    elif kind == RunKind.CONFLICT and isinstance(parsed, ConflictOutput):
        await _writeback_conflict(UUID(run_input["conflict_id"]), parsed)
    # DRAFT, CHAT: nothing extra; result lives in run.result.


async def _writeback_verify(claim_id: UUID, parsed: VerifyOutput) -> None:
    async with wdb.session() as s:
        c = (await s.execute(select(Claim).where(Claim.id == claim_id))).scalar_one_or_none()
        if c is None:
            return
        c.status = parsed.verdict
        c.confidence = parsed.confidence
        c.quote = parsed.quote
        c.reason = parsed.reason
        if parsed.page is not None:
            c.page = str(parsed.page)
        c.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await s.commit()


async def _writeback_extract(project_id: UUID, run_input: dict, parsed: ExtractOutput) -> None:
    paper_url = run_input.get("paper_url")
    async with wdb.session() as s:
        for ec in parsed.claims:
            s.add(Claim(
                project_id=project_id,
                text=ec.text,
                paper_url=paper_url,
                page=str(ec.page) if ec.page is not None else None,
                site="extract",
                status="pending",
            ))
        await s.commit()


async def _writeback_conflict(conflict_id: UUID, parsed: ConflictOutput) -> None:
    async with wdb.session() as s:
        c = (await s.execute(select(Conflict).where(Conflict.id == conflict_id))).scalar_one_or_none()
        if c is None:
            return
        # Backend ConflictPatch.resolution is a string column; serialize structured
        # suggestion as JSON so the UI can deserialize back.
        c.resolution = json.dumps({
            "kind": "suggestion",
            "text": parsed.suggested_resolution,
            "rationale": parsed.rationale,
            "sides_analysis": [s.model_dump() for s in parsed.sides_analysis],
        })
        await s.commit()
```

- [ ] **Step 3: No unit test for this task (covered by integration test in Task 9). Commit.**

```bash
git add research-kit/worker/writeback.py
git commit -m "feat(worker): writeback module for verify/extract/conflict"
```

### Task 8: Wire parser + retry + writeback into `tasks.py`

**Files:**
- Modify: `research-kit/worker/tasks.py`

- [ ] **Step 1: Read `tasks.py:_execute_run_impl` (already done in design phase). Identify insertion points.**

- [ ] **Step 2: Modify `_execute_run_impl`**

Replace the current `try` block (lines 57–82) with:

```python
    try:
        messages = _build_messages(kind, run_input)
        async with asyncio.timeout(timeout_sec):
            result = await runner.run(
                kind=kind, user_id=user_id, run_id=run_id,
                messages=messages, on_event=bus.publish,
                cancel=cancel, request_id=request_id,
            )
        # Parse + writeback (Phase 1).
        from worker.result_parser import parse_output, OutputParseError
        from worker.writeback import apply_writeback

        try:
            parsed = parse_output(kind, result.get("content", ""))
        except OutputParseError:
            # Single retry with stricter reminder.
            retry_msgs = messages + [
                {"role": "assistant", "content": result.get("content", "")},
                {"role": "user", "content": "Output was not valid JSON. Return ONLY the JSON object matching the schema."},
            ]
            async with asyncio.timeout(timeout_sec):
                result = await runner.run(
                    kind=kind, user_id=user_id, run_id=run_id,
                    messages=retry_msgs, on_event=bus.publish,
                    cancel=cancel, request_id=request_id,
                )
            parsed = parse_output(kind, result.get("content", ""))

        # Look up project_id for writeback that needs it.
        async with wdb.session() as s:
            run = (await s.execute(select(Run).where(Run.id == run_id))).scalar_one()
            project_id = run.project_id

        await apply_writeback(kind, run_input, project_id, parsed)
        result_payload = parsed.model_dump()
    except CancelledByUser:
        await _finalize(run_id, RunStatus.CANCELLED, error=None, result=None)
        await bus.publish({"type": "status", "payload": {"status": "cancelled"}})
        return {"status": "cancelled"}
    except asyncio.TimeoutError:
        err = {"code": "timeout", "message": f"run exceeded {timeout_sec}s",
               "recoverable": False}
        await _finalize(run_id, RunStatus.FAILED, error=err, result=None)
        await bus.publish({"type": "error", "payload": err})
        return {"status": "failed", "error": err}
    except Exception as e:
        from worker.runners.goclaw import UpstreamError
        from worker.result_parser import OutputParseError as _OPE
        if isinstance(e, _OPE):
            err = {"code": "parse", "message": str(e)[:500], "recoverable": True}
        else:
            recoverable = isinstance(e, UpstreamError)
            err = {"code": "upstream" if recoverable else "internal",
                   "message": str(e)[:500], "recoverable": recoverable}
        await _finalize(run_id, RunStatus.FAILED, error=err, result=None)
        await bus.publish({"type": "error", "payload": err})
        return {"status": "failed", "error": err}

    await _finalize(run_id, RunStatus.SUCCEEDED, result=result_payload, error=None)
    return {"status": "succeeded"}
```

- [ ] **Step 3: Run existing worker tests; ensure none regress**

```bash
cd research-kit/worker && pytest -v
```

Expected: existing `test_execute_run`, `test_mock_runner`, etc. still pass. (Mock runner returns plain content; with the new parser this will fail unless mock is updated — see next task.)

- [ ] **Step 4: Update `MockRunner` to return valid JSON content per kind**

Inspect `research-kit/worker/runners/mock.py` (path may differ — check `runner_factory.py`). Modify mock's hardcoded response so each `RunKind` returns a content string that parses against its schema.

```python
# Example for verify; do similarly for the other 4 kinds.
_MOCK_OUTPUTS: dict[RunKind, str] = {
    RunKind.VERIFY: '{"verdict":"supported","confidence":0.8,"quote":"mock quote","page":1,"reason":"mock reason"}',
    RunKind.EXTRACT: '{"claims":[{"text":"mock claim","page":1,"section":"abstract"}]}',
    RunKind.CONFLICT: '{"suggested_resolution":"mock","rationale":"mock","sides_analysis":[{"side_id":"s1","weight":0.5,"note":"x"},{"side_id":"s2","weight":0.5,"note":"y"}]}',
    RunKind.DRAFT: '{"markdown":"# mock\\n\\nbody","sections":[]}',
    RunKind.CHAT: '{"text":"mock chat reply"}',
}
```

- [ ] **Step 5: Run tests, expect PASS**

```bash
cd research-kit/worker && pytest -v
```

- [ ] **Step 6: Commit**

```bash
git add research-kit/worker/tasks.py research-kit/worker/runners/mock.py
git commit -m "feat(worker): parse output + retry + writeback in _execute_run_impl"
```

### Task 9: Integration test — writeback on success

**Files:**
- Create: `research-kit/worker/tests/integration/test_run_writeback.py`

- [ ] **Step 1: Write the failing test**

```python
# research-kit/worker/tests/integration/test_run_writeback.py
import json
import pytest
from uuid import uuid4
from sqlalchemy import select

from rk_shared.models import Claim, Project, User
from rk_shared.types import RunKind, RunStatus
from worker import db as wdb
from worker.tasks import _execute_run_impl


@pytest.mark.asyncio
async def test_verify_writeback_updates_claim(redis_client, mock_runner_returns):
    # Arrange: create user, project, claim
    async with wdb.session() as s:
        u = User(google_sub="t-sub", email="t@e.x", name="t")
        s.add(u); await s.flush()
        p = Project(user_id=u.id, name="p"); s.add(p); await s.flush()
        c = Claim(project_id=p.id, text="X is Y.", site="elicit", status="pending")
        s.add(c); await s.flush()
        await s.commit()
        claim_id = c.id; user_id = u.id; project_id = p.id

    # Configure mock to return verify-shaped JSON
    mock_runner_returns(RunKind.VERIFY, json.dumps({
        "verdict": "supported", "confidence": 0.9,
        "quote": "from paper", "page": 2, "reason": "matches"
    }))

    # Create run row
    from rk_shared.models import Run
    async with wdb.session() as s:
        run = Run(user_id=user_id, kind=RunKind.VERIFY.value,
                  project_id=project_id, status=RunStatus.QUEUED.value,
                  input={"claim_id": str(claim_id), "claim": {"text": "X is Y.", "citations": []}})
        s.add(run); await s.flush(); await s.commit()
        run_id = run.id

    # Act
    ctx = {"redis": redis_client, "request_id": str(run_id)}
    out = await _execute_run_impl(ctx, str(run_id))

    # Assert: run status + claim updated
    assert out["status"] == "succeeded"
    async with wdb.session() as s:
        c2 = (await s.execute(select(Claim).where(Claim.id == claim_id))).scalar_one()
        assert c2.status == "supported"
        assert c2.confidence == pytest.approx(0.9)
        assert c2.quote == "from paper"
```

(`mock_runner_returns` is a fixture in `conftest.py` — Step 2.)

- [ ] **Step 2: Add fixture in `tests/conftest.py`**

```python
# Add to research-kit/worker/tests/conftest.py
import pytest
from rk_shared.types import RunKind

@pytest.fixture
def mock_runner_returns(monkeypatch):
    """Override MockRunner output for a given RunKind."""
    overrides: dict[RunKind, str] = {}
    def _set(kind: RunKind, content: str): overrides[kind] = content
    
    from worker.runners import mock as mock_module
    original = mock_module._MOCK_OUTPUTS.copy()
    monkeypatch.setattr(mock_module, "_MOCK_OUTPUTS", {**original, **overrides})
    
    return _set
```

(Adjust if mock module path differs.)

- [ ] **Step 3: Run, expect PASS (with `RK_RUNNER=mock` env)**

```bash
cd research-kit/worker && RK_RUNNER=mock pytest tests/integration/test_run_writeback.py -v
```

- [ ] **Step 4: Commit**

```bash
git add research-kit/worker/tests/integration/test_run_writeback.py research-kit/worker/tests/conftest.py
git commit -m "test(worker): integration test for verify writeback"
```

### Task 10: Integration test — parse retry

**Files:**
- Create: `research-kit/worker/tests/integration/test_parse_retry.py`

- [ ] **Step 1: Write failing test**

```python
# research-kit/worker/tests/integration/test_parse_retry.py
import pytest, json
from rk_shared.types import RunKind
from worker.tasks import _execute_run_impl

@pytest.mark.asyncio
async def test_parse_retry_on_first_invalid(redis_client, mock_runner_sequence, basic_run):
    """First runner call returns prose; retry returns valid JSON. Run succeeds."""
    mock_runner_sequence(RunKind.CHAT, [
        "Here you go: not JSON",
        json.dumps({"text": "ok"}),
    ])
    out = await _execute_run_impl({"redis": redis_client}, str(basic_run.id))
    assert out["status"] == "succeeded"
```

- [ ] **Step 2: Add `mock_runner_sequence` and `basic_run` fixtures (similar shape to step above)**

```python
# in conftest.py
@pytest.fixture
def mock_runner_sequence(monkeypatch):
    sequences: dict[RunKind, list[str]] = {}
    def _set(kind: RunKind, outputs: list[str]): sequences[kind] = list(outputs)
    
    from worker.runners import mock as mock_module
    async def fake_run(self, *, kind, **_):
        seq = sequences.get(kind)
        if not seq:
            return {"content": mock_module._MOCK_OUTPUTS[kind], "usage": {}}
        return {"content": seq.pop(0), "usage": {}}
    monkeypatch.setattr(mock_module.MockRunner, "run", fake_run)
    return _set

@pytest.fixture
async def basic_run(): ...  # creates a User, Project, Run row of kind CHAT, returns the Run
```

- [ ] **Step 3: Run, expect PASS**

```bash
cd research-kit/worker && RK_RUNNER=mock pytest tests/integration/test_parse_retry.py -v
```

- [ ] **Step 4: Commit**

```bash
git add research-kit/worker/tests/integration/test_parse_retry.py research-kit/worker/tests/conftest.py
git commit -m "test(worker): integration test for parse retry"
```

### Task 11: Phase 1 rollback gate (manual)

- [ ] **Step 1: Bring up the stack with real GoClaw**

```bash
cd research-kit/infra && docker-compose up -d
```

- [ ] **Step 2: Issue a real verify run via curl**

```bash
# Get a session token by hitting /v1/auth/login with a Google ID token,
# OR temporarily issue one via a dev helper. Document method and store token in $TOK.
curl -X POST http://localhost:8000/v1/runs \
  -H "Authorization: Bearer $TOK" \
  -H "Content-Type: application/json" \
  -d '{"kind":"verify","project_id":"<UUID>","input":{"claim_id":"<UUID>","claim":{"text":"...","citations":[{"ref_id":"1","url":"https://arxiv.org/abs/2303.08774"}]}},"idempotency_key":"phase1-gate-1"}'
```

- [ ] **Step 3: Stream the run**

```bash
curl -N -H "Authorization: Bearer $TOK" http://localhost:8000/v1/runs/<run_id>/stream
```

Expected: stream ends with `status: succeeded`, claim row updated in DB. Inspect via `psql` if needed.

- [ ] **Step 4: If fails, fix prompts/parser; do NOT proceed to Phase 2.**

- [ ] **Step 5: Commit any fixes; tag.**

```bash
git tag phase1-gate-passed
```

---

## Phase 2 — Extension Auth + `api.ts` Rewrite

End state: extension renders login gate; after Google sign-in, token is persisted; sidebar can list projects/claims/inbox/conflicts. **No mutations, no run streams yet.**

### Task 12: Add `errors.ts` and types

**Files:**
- Create: `research-kit/extension/src/shared/errors.ts`
- Modify: `research-kit/extension/src/shared/types.ts`

- [ ] **Step 1: Create `errors.ts`**

```typescript
// research-kit/extension/src/shared/errors.ts
export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body}`)
    this.name = 'ApiError'
  }
}

export class AuthExpiredError extends Error {
  constructor() { super('Auth expired'); this.name = 'AuthExpiredError' }
}
```

- [ ] **Step 2: Replace `types.ts` content**

Delete `VerifyResponse`, `CollectResponse`, `Capture`, `Session`, `ScrapeRequest`, `ScrapeResponse`, `Block`, `ToolCapture`. Keep `Citation`. Add the following:

```typescript
// research-kit/extension/src/shared/types.ts
export interface Citation { ref_id: string; url: string }

export interface UserOut { id: string; email: string; name: string | null }

export interface Project { id: string; name: string }

export interface Claim {
  id: string
  project_id: string
  text: string
  paper_title: string | null
  doi: string | null
  paper_url: string | null
  page: string | null
  site: string
  status: string
  confidence: number | null
  quote: string | null
  reason: string | null
  page_url: string | null
  extracted_at: string | null
  created_at: string
  updated_at: string
}

export interface ClaimInput {
  text: string
  paper_title?: string | null
  doi?: string | null
  paper_url?: string | null
  page?: string | null
  site: string
  page_url?: string | null
  extracted_at?: string | null
}

export interface ClaimPatch {
  status?: string
  quote?: string
  confidence?: number
  reason?: string
  page?: string
}

export interface InboxItem {
  id: string
  project_id: string
  claim_id: string
  saved_at: string
}

export interface ConflictSide { claim_id: string; label: string; quote: string | null }
export interface Conflict {
  id: string
  project_id: string
  group_key: string
  doi: string | null
  paper_title: string | null
  flagged_at: string
  resolution: string | null  // server stores JSON-encoded ResolutionPayload (or null)
  sides: ConflictSide[]
}

export type ResolutionPayload =
  | { kind: 'accept_side'; side_id: string; note?: string }
  | { kind: 'reject_all'; note: string }
  | { kind: 'suggestion'; text: string; rationale: string; sides_analysis?: Array<{ side_id: string; weight: number; note: string }> }

export type RunKind = 'verify' | 'extract' | 'chat' | 'draft' | 'conflict'
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'cancelling'

export interface RunCreate {
  kind: RunKind
  input: Record<string, unknown>
  project_id?: string
  idempotency_key: string
}
export interface RunCreateResponse { run_id: string; status: string; stream_url: string }
export interface Run {
  id: string; kind: RunKind; status: RunStatus
  project_id: string | null
  input: Record<string, unknown>
  result: Record<string, unknown> | null
  error: { code: string; message: string; recoverable?: boolean } | null
  created_at: string; started_at: string | null; finished_at: string | null
}

export type RunEvent =
  | { type: 'status'; payload: { status: RunStatus } }
  | { type: 'token'; payload: { text: string } }
  | { type: 'tool_call'; payload: { name: string; args: unknown; id?: string } }
  | { type: 'tool_result'; payload: { name: string; result: unknown; id?: string } }
  | { type: 'error'; payload: { code: string; message: string; recoverable?: boolean } }
  | { type: 'final'; payload: { content: string; usage: Record<string, unknown> } }
```

- [ ] **Step 3: Build to catch type errors elsewhere**

```bash
cd research-kit/extension && npm run build
```

Expected: many type errors in components that referenced removed types — fix forward as we touch each file. For now, note them; tasks below address them.

- [ ] **Step 4: Commit (compile errors expected, will be fixed in subsequent tasks)**

```bash
git add research-kit/extension/src/shared/errors.ts research-kit/extension/src/shared/types.ts
git commit -m "feat(ext): canonical types for backend domain + ResolutionPayload"
```

### Task 13: `auth.ts` — Google sign-in module

**Files:**
- Create: `research-kit/extension/src/shared/auth.ts`
- Create: `research-kit/extension/src/shared/auth.test.ts`
- Modify: `research-kit/extension/.env.example`

- [ ] **Step 1: Write failing test**

```typescript
// research-kit/extension/src/shared/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  // @ts-expect-error chrome global
  globalThis.chrome = {
    identity: {
      launchWebAuthFlow: vi.fn(),
      getRedirectURL: () => 'https://abc.chromiumapp.org/',
    },
    storage: { local: {
      get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    } },
  }
  // @ts-expect-error
  globalThis.crypto.randomUUID = () => '11111111-1111-1111-1111-111111111111'
  globalThis.fetch = vi.fn()
})

describe('googleSignIn', () => {
  it('exchanges id_token for session_token and persists', async () => {
    // @ts-expect-error
    chrome.identity.launchWebAuthFlow.mockResolvedValue('https://abc.chromiumapp.org/#id_token=GTOKEN&state=x')
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        session_token: 'STOK',
        user: { id: 'u1', email: 'a@b.c', name: 'A' },
        expires_at: '2099-01-01T00:00:00Z',
      }),
    })
    const auth = await import('./auth')
    const result = await auth.googleSignIn()
    expect(result?.token).toBe('STOK')
    expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      rk_auth: expect.objectContaining({ token: 'STOK' }),
    }))
  })

  it('signOut clears state and storage', async () => {
    const auth = await import('./auth')
    await auth.signOut()
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('rk_auth')
  })

  it('loadStoredAuth returns null when expired', async () => {
    // @ts-expect-error
    chrome.storage.local.get.mockResolvedValue({
      rk_auth: { token: 'old', user: {}, expiresAt: 0 },
    })
    const auth = await import('./auth')
    const r = await auth.loadStoredAuth()
    expect(r).toBeNull()
  })
})
```

- [ ] **Step 2: Run, expect FAIL (file not found)**

```bash
cd research-kit/extension && npm test -- src/shared/auth.test.ts
```

- [ ] **Step 3: Implement `auth.ts`**

```typescript
// research-kit/extension/src/shared/auth.ts
import type { UserOut } from './types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/v1'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

export type AuthState = { token: string; user: UserOut; expiresAt: number } | null

let _state: AuthState = null
const _listeners = new Set<(s: AuthState) => void>()

export async function googleSignIn(): Promise<AuthState> {
  if (!GOOGLE_CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID not set')
  const nonce = crypto.randomUUID()
  const redirectUri = chrome.identity.getRedirectURL()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  url.searchParams.set('response_type', 'id_token')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('nonce', nonce)

  const redirected = await chrome.identity.launchWebAuthFlow({
    url: url.toString(), interactive: true,
  })
  if (!redirected) throw new Error('OAuth flow returned no URL')
  const fragment = redirected.split('#')[1] || ''
  const params = new URLSearchParams(fragment)
  const idToken = params.get('id_token')
  if (!idToken) throw new Error('No id_token in redirect')

  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ google_id_token: idToken }),
  })
  if (!res.ok) throw new Error(`Login failed: ${res.status}`)
  const { session_token, user, expires_at } = await res.json()
  const next: AuthState = { token: session_token, user, expiresAt: Date.parse(expires_at) }
  await chrome.storage.local.set({ rk_auth: next })
  _setState(next)
  return next
}

export async function loadStoredAuth(): Promise<AuthState> {
  const { rk_auth } = await chrome.storage.local.get('rk_auth')
  if (!rk_auth || (rk_auth as AuthState)!.expiresAt < Date.now()) {
    await chrome.storage.local.remove('rk_auth')
    _setState(null)
    return null
  }
  _setState(rk_auth as AuthState)
  return rk_auth as AuthState
}

export async function signOut(): Promise<void> {
  if (_state) {
    fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: authHeader() }).catch(() => {})
  }
  await chrome.storage.local.remove('rk_auth')
  _setState(null)
}

export function getToken(): string | null { return _state?.token ?? null }
export function getUser(): UserOut | null { return _state?.user ?? null }
export function getAuthState(): AuthState { return _state }
export function authHeader(): Record<string, string> {
  return _state ? { Authorization: `Bearer ${_state.token}` } : {}
}
export function onAuthChange(fn: (s: AuthState) => void) {
  _listeners.add(fn); return () => { _listeners.delete(fn) }
}
function _setState(s: AuthState) { _state = s; _listeners.forEach(l => l(s)) }
```

- [ ] **Step 4: Add env example**

```bash
cat > research-kit/extension/.env.example <<'EOF'
VITE_API_URL=http://localhost:8000/v1
VITE_GOOGLE_CLIENT_ID=
EOF
```

- [ ] **Step 5: Run tests, expect PASS**

```bash
cd research-kit/extension && npm test -- src/shared/auth.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/shared/auth.ts research-kit/extension/src/shared/auth.test.ts research-kit/extension/.env.example
git commit -m "feat(ext): auth module with chrome.identity Google flow"
```

### Task 14: `manifest.json` — add identity permission

**Files:**
- Modify: `research-kit/extension/manifest.json`

- [ ] **Step 1: Read current manifest.json**

- [ ] **Step 2: Add `"identity"` to permissions array; add `"key": "<your-key>"` placeholder if not pinning yet (document that user must generate one for stable extension ID).**

If extension already has stable `key`, skip key step.

- [ ] **Step 3: Build to verify manifest valid**

```bash
cd research-kit/extension && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add research-kit/extension/manifest.json
git commit -m "feat(ext): identity permission for OAuth"
```

### Task 15: `sse.ts` — SSE parser

**Files:**
- Create: `research-kit/extension/src/shared/sse.ts`
- Create: `research-kit/extension/src/shared/sse.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// research-kit/extension/src/shared/sse.test.ts
import { describe, it, expect } from 'vitest'
import { parseSSE } from './sse'

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]))
      else controller.close()
    },
  })
}

describe('parseSSE', () => {
  it('parses single complete frame', async () => {
    const s = makeStream(['event: run_event\nid: 7\ndata: {"a":1}\n\n'])
    const out: any[] = []
    for await (const f of parseSSE(s)) out.push(f)
    expect(out).toEqual([{ event: 'run_event', id: '7', data: '{"a":1}' }])
  })

  it('handles split frames across chunks', async () => {
    const s = makeStream(['event: x\nid: 1\nda', 'ta: hello\n\nevent: y\nid: 2\ndata: world\n\n'])
    const out: any[] = []
    for await (const f of parseSSE(s)) out.push(f)
    expect(out.map(f => f.data)).toEqual(['hello', 'world'])
  })

  it('handles multi-line data', async () => {
    const s = makeStream(['data: line1\ndata: line2\n\n'])
    const out: any[] = []
    for await (const f of parseSSE(s)) out.push(f)
    expect(out[0].data).toBe('line1\nline2')
  })

  it('skips comments', async () => {
    const s = makeStream([': keepalive\nid: 5\ndata: ok\n\n'])
    const out: any[] = []
    for await (const f of parseSSE(s)) out.push(f)
    expect(out[0]).toEqual({ event: undefined, id: '5', data: 'ok' })
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd research-kit/extension && npm test -- src/shared/sse.test.ts
```

- [ ] **Step 3: Implement `sse.ts`**

```typescript
// research-kit/extension/src/shared/sse.ts
export interface SSEFrame {
  event?: string
  id?: string
  data: string
}

export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncIterable<SSEFrame> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let event: string | undefined
  let id: string | undefined
  let dataLines: string[] = []

  function flush(): SSEFrame | null {
    if (dataLines.length === 0) {
      event = undefined; id = undefined
      return null
    }
    const frame: SSEFrame = { event, id, data: dataLines.join('\n') }
    event = undefined; id = undefined; dataLines = []
    return frame
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (line === '') {
          const f = flush()
          if (f) yield f
          continue
        }
        if (line.startsWith(':')) continue  // comment
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const valueRaw = colon < 0 ? '' : line.slice(colon + 1)
        const v = valueRaw.startsWith(' ') ? valueRaw.slice(1) : valueRaw
        if (field === 'event') event = v
        else if (field === 'id') id = v
        else if (field === 'data') dataLines.push(v)
      }
      if (done) {
        const f = flush()
        if (f) yield f
        return
      }
    }
  } finally {
    reader.releaseLock()
  }
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd research-kit/extension && npm test -- src/shared/sse.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/shared/sse.ts research-kit/extension/src/shared/sse.test.ts
git commit -m "feat(ext): standalone SSE parser"
```

### Task 16: Rewrite `api.ts` — REST endpoints + apiFetch

**Files:**
- Modify (full rewrite): `research-kit/extension/src/shared/api.ts`
- Create: `research-kit/extension/src/shared/api.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// research-kit/extension/src/shared/api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, AuthExpiredError } from './errors'

beforeEach(() => {
  vi.resetModules()
  globalThis.fetch = vi.fn()
  // @ts-expect-error
  globalThis.chrome = {
    storage: { local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(), remove: vi.fn().mockResolvedValue(undefined),
    } },
  }
})

describe('apiFetch behavior', () => {
  it('listProjects sends auth header', async () => {
    const auth = await import('./auth')
    // @ts-expect-error
    auth.__test_setState?.({ token: 'STOK', user: {}, expiresAt: Date.now() + 1e9 })
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true, status: 200,
      json: async () => [{ id: 'p1', name: 'A' }],
    })
    const api = await import('./api')
    const projects = await api.listProjects()
    expect(projects).toEqual([{ id: 'p1', name: 'A' }])
    const call = (globalThis.fetch as any).mock.calls[0]
    expect(call[1].headers.Authorization).toBe('Bearer STOK')
  })

  it('401 triggers signOut and AuthExpiredError', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({ ok: false, status: 401, text: async () => '' })
    const api = await import('./api')
    await expect(api.listProjects()).rejects.toBeInstanceOf(AuthExpiredError)
  })

  it('5xx throws ApiError', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({ ok: false, status: 500, text: async () => 'oops' })
    const api = await import('./api')
    await expect(api.listProjects()).rejects.toBeInstanceOf(ApiError)
  })
})
```

(For test purposes, you may need to expose `__test_setState` on auth.ts under `if (import.meta.env.MODE === 'test')`. Or simpler: mock `./auth` module via `vi.mock`. Pick whichever the codebase already uses; if neither, use `vi.mock`.)

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Replace `api.ts` content**

```typescript
// research-kit/extension/src/shared/api.ts
import { authHeader, signOut } from './auth'
import { ApiError, AuthExpiredError } from './errors'
import { parseSSE } from './sse'
import type {
  Project, Claim, ClaimInput, ClaimPatch, InboxItem, Conflict,
  ResolutionPayload, RunCreate, RunCreateResponse, Run, RunEvent,
} from './types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/v1'

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
      ...(init.headers || {}),
    },
  })
  if (res.status === 401) { await signOut(); throw new AuthExpiredError() }
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res
}

// Projects
export async function listProjects(): Promise<Project[]> {
  return (await apiFetch('/projects')).json()
}
export async function createProject(name: string): Promise<Project> {
  return (await apiFetch('/projects', { method: 'POST', body: JSON.stringify({ name }) })).json()
}

// Claims
export async function listClaims(projectId: string, status?: string, limit = 50): Promise<Claim[]> {
  const qs = new URLSearchParams({ project_id: projectId, limit: String(limit) })
  if (status) qs.set('status', status)
  return (await apiFetch(`/claims?${qs}`)).json()
}
export async function batchCreateClaims(
  projectId: string, claims: ClaimInput[], idempotencyKey?: string,
): Promise<{ created: Claim[] }> {
  return (await apiFetch('/claims/batch', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, claims, idempotency_key: idempotencyKey }),
  })).json()
}
export async function patchClaim(claimId: string, patch: ClaimPatch): Promise<Claim> {
  return (await apiFetch(`/claims/${claimId}`, { method: 'PATCH', body: JSON.stringify(patch) })).json()
}

// Inbox
export async function listInbox(projectId: string): Promise<InboxItem[]> {
  return (await apiFetch(`/inbox?project_id=${projectId}`)).json()
}
export async function addToInbox(projectId: string, claimId: string): Promise<InboxItem> {
  return (await apiFetch('/inbox', {
    method: 'POST', body: JSON.stringify({ project_id: projectId, claim_id: claimId }),
  })).json()
}
export async function removeFromInbox(inboxId: string): Promise<void> {
  await apiFetch(`/inbox/${inboxId}`, { method: 'DELETE' })
}

// Conflicts
export async function listConflicts(projectId: string): Promise<Conflict[]> {
  return (await apiFetch(`/conflicts?project_id=${projectId}`)).json()
}
export async function patchConflict(
  conflictId: string, resolution: ResolutionPayload,
): Promise<Conflict> {
  // Backend stores resolution as a string; encode as JSON.
  return (await apiFetch(`/conflicts/${conflictId}`, {
    method: 'PATCH',
    body: JSON.stringify({ resolution: JSON.stringify(resolution) }),
  })).json()
}

// Runs
export async function createRun(body: RunCreate): Promise<RunCreateResponse> {
  return (await apiFetch('/runs', { method: 'POST', body: JSON.stringify(body) })).json()
}
export async function getRun(runId: string): Promise<Run> {
  return (await apiFetch(`/runs/${runId}`)).json()
}
export async function cancelRun(runId: string): Promise<void> {
  await apiFetch(`/runs/${runId}/cancel`, { method: 'POST' })
}

// SSE stream with reconnect
export async function* streamRun(
  runId: string,
  { lastSeq = 0, signal }: { lastSeq?: number; signal?: AbortSignal } = {},
): AsyncIterable<RunEvent> {
  let seq = lastSeq
  let backoff = 500
  while (!signal?.aborted) {
    try {
      const res = await fetch(`${API_URL}/runs/${runId}/stream`, {
        headers: { ...authHeader(), 'Last-Event-ID': String(seq) },
        signal,
      })
      if (res.status === 401) { await signOut(); throw new AuthExpiredError() }
      if (!res.ok) throw new ApiError(res.status, await res.text())
      backoff = 500
      for await (const f of parseSSE(res.body!)) {
        if (f.id) seq = parseInt(f.id, 10)
        const evt = JSON.parse(f.data) as RunEvent
        yield evt
        if (evt.type === 'status' &&
            ['succeeded', 'failed', 'cancelled'].includes(evt.payload.status)) return
      }
    } catch (e) {
      if (signal?.aborted || e instanceof AuthExpiredError) throw e
      await new Promise(r => setTimeout(r, backoff))
      backoff = Math.min(backoff * 2, 10000)
    }
  }
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
cd research-kit/extension && npm test -- src/shared/api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/shared/api.ts research-kit/extension/src/shared/api.test.ts
git commit -m "feat(ext): rewrite api.ts to real backend + apiFetch chokepoint"
```

### Task 17: Login gate + `useAuth` hook + App.tsx wrap

**Files:**
- Create: `research-kit/extension/src/sidebar/components/atoms/LoginGate.tsx`
- Create: `research-kit/extension/src/sidebar/hooks/useAuth.ts`
- Modify: `research-kit/extension/src/sidebar/App.tsx`
- Modify: `research-kit/extension/src/sidebar/main.tsx`

- [ ] **Step 1: Implement `useAuth.ts`**

```typescript
// research-kit/extension/src/sidebar/hooks/useAuth.ts
import { useEffect, useState } from 'react'
import { onAuthChange, getAuthState, googleSignIn, signOut, loadStoredAuth, AuthState }
  from '../../shared/auth'

export function useAuth() {
  const [state, setState] = useState<AuthState>(getAuthState())
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    loadStoredAuth().finally(() => setLoading(false))
    return onAuthChange(setState)
  }, [])
  return { state, user: state?.user ?? null, loading, signIn: googleSignIn, signOut }
}
```

- [ ] **Step 2: Implement `LoginGate.tsx`**

```tsx
// research-kit/extension/src/sidebar/components/atoms/LoginGate.tsx
import { useState } from 'react'

interface Props { onSignIn: () => Promise<unknown> }
export function LoginGate({ onSignIn }: Props) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 p-6">
      <h1 className="text-xl font-semibold">Research Kit</h1>
      <button
        className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true); setErr(null)
          try { await onSignIn() } catch (e: any) { setErr(e.message) }
          finally { setBusy(false) }
        }}
      >{busy ? 'Signing in…' : 'Sign in with Google'}</button>
      {err && <p className="text-red-600 text-sm">{err}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Modify `App.tsx` to wrap in auth gate**

At the top of `App()`:

```tsx
import { useAuth } from './hooks/useAuth'
import { LoginGate } from './components/atoms/LoginGate'

export function App() {
  const { user, loading, signIn } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading…</div>
  if (!user) return <LoginGate onSignIn={signIn} />
  // … existing return …
}
```

- [ ] **Step 4: Build, fix any type errors from Task 12 fallout**

```bash
cd research-kit/extension && npm run build
```

Fix errors in any file referencing removed types (`VerifyResponse`, `Capture`, etc.) by deleting/rewriting those references. Likely files: `usePageModels.ts`, `ChatThread.tsx`, `ToolCallCard.tsx`. If a file is too entangled with old types, replace contents with a minimal stub and TODO-tracked in a later task.

- [ ] **Step 5: Manual smoke (E2E partial)**

Load unpacked, sign in. Verify token written to `chrome.storage.local`. Tabs render but data fetching is not wired yet (next phase).

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/sidebar/hooks/useAuth.ts \
        research-kit/extension/src/sidebar/components/atoms/LoginGate.tsx \
        research-kit/extension/src/sidebar/App.tsx \
        research-kit/extension/src/sidebar/main.tsx
git commit -m "feat(ext): login gate + useAuth wrapping App"
```

### Task 18: Slice modules — projects, claims, inbox, conflicts

**Files:**
- Create: `research-kit/extension/src/sidebar/state/slices/projects.ts`
- Create: `research-kit/extension/src/sidebar/state/slices/claims.ts`
- Create: `research-kit/extension/src/sidebar/state/slices/inbox.ts`
- Create: `research-kit/extension/src/sidebar/state/slices/conflicts.ts`
- Create: `research-kit/extension/src/sidebar/state/slices/runs.ts`
- Modify: `research-kit/extension/src/sidebar/state/useStore.ts`

This is the largest single change; follow steps carefully.

- [ ] **Step 1: Define `Slice<T>` helper**

Create `research-kit/extension/src/sidebar/state/slices/_slice.ts`:

```typescript
export interface Slice<T> {
  data: T
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  lastFetched?: number
}
export const idle = <T>(data: T): Slice<T> => ({ data, status: 'idle' })
```

- [ ] **Step 2: Implement `projects.ts`**

```typescript
// research-kit/extension/src/sidebar/state/slices/projects.ts
import * as api from '../../../shared/api'
import type { Project } from '../../../shared/types'
import { idle, Slice } from './_slice'

export interface ProjectsSlice {
  projects: Slice<Project[]>
  loadProjects(): Promise<void>
  createProject(name: string): Promise<Project>
}

export function createProjectsSlice(set: any, get: any): ProjectsSlice {
  return {
    projects: idle<Project[]>([]),
    async loadProjects() {
      set((s: any) => ({ projects: { ...s.projects, status: 'loading' } }))
      try {
        const data = await api.listProjects()
        set({ projects: { data, status: 'ready', lastFetched: Date.now() } })
      } catch (e: any) {
        set((s: any) => ({ projects: { ...s.projects, status: 'error', error: e.message } }))
      }
    },
    async createProject(name) {
      const p = await api.createProject(name)
      await get().loadProjects()
      return p
    },
  }
}
```

- [ ] **Step 3: Implement `claims.ts`, `inbox.ts`, `conflicts.ts`** (same pattern)

```typescript
// claims.ts
import * as api from '../../../shared/api'
import type { Claim, ClaimPatch } from '../../../shared/types'
import { idle, Slice } from './_slice'

export interface ClaimsSlice {
  claims: Slice<Claim[]>
  loadClaims(projectId: string): Promise<void>
  patchClaim(id: string, patch: ClaimPatch): Promise<void>
}

export function createClaimsSlice(set: any, get: any): ClaimsSlice {
  return {
    claims: idle<Claim[]>([]),
    async loadClaims(projectId) {
      set((s: any) => ({ claims: { ...s.claims, status: 'loading' } }))
      try {
        const data = await api.listClaims(projectId)
        set({ claims: { data, status: 'ready', lastFetched: Date.now() } })
      } catch (e: any) {
        set((s: any) => ({ claims: { ...s.claims, status: 'error', error: e.message } }))
      }
    },
    async patchClaim(id, patch) {
      await api.patchClaim(id, patch)
      const pid = get().currentProjectId
      if (pid) await get().loadClaims(pid)
    },
  }
}
```

```typescript
// inbox.ts
import * as api from '../../../shared/api'
import type { InboxItem } from '../../../shared/types'
import { idle, Slice } from './_slice'

export interface InboxSlice {
  inbox: Slice<InboxItem[]>
  loadInbox(projectId: string): Promise<void>
  addToInbox(projectId: string, claimId: string): Promise<void>
  removeFromInbox(inboxId: string): Promise<void>
  archiveMany(inboxIds: string[]): Promise<void>
}

export function createInboxSlice(set: any, get: any): InboxSlice {
  return {
    inbox: idle<InboxItem[]>([]),
    async loadInbox(projectId) {
      set((s: any) => ({ inbox: { ...s.inbox, status: 'loading' } }))
      try {
        const data = await api.listInbox(projectId)
        set({ inbox: { data, status: 'ready', lastFetched: Date.now() } })
      } catch (e: any) {
        set((s: any) => ({ inbox: { ...s.inbox, status: 'error', error: e.message } }))
      }
    },
    async addToInbox(projectId, claimId) {
      await api.addToInbox(projectId, claimId)
      await get().loadInbox(projectId)
    },
    async removeFromInbox(inboxId) {
      await api.removeFromInbox(inboxId)
      const pid = get().currentProjectId
      if (pid) await get().loadInbox(pid)
    },
    async archiveMany(ids) {
      await Promise.allSettled(ids.map(id => api.removeFromInbox(id)))
      const pid = get().currentProjectId
      if (pid) await get().loadInbox(pid)
    },
  }
}
```

```typescript
// conflicts.ts
import * as api from '../../../shared/api'
import type { Conflict, ResolutionPayload } from '../../../shared/types'
import { idle, Slice } from './_slice'

export interface ConflictsSlice {
  conflicts: Slice<Conflict[]>
  loadConflicts(projectId: string): Promise<void>
  patchConflict(id: string, resolution: ResolutionPayload): Promise<void>
}

export function createConflictsSlice(set: any, get: any): ConflictsSlice {
  return {
    conflicts: idle<Conflict[]>([]),
    async loadConflicts(projectId) {
      set((s: any) => ({ conflicts: { ...s.conflicts, status: 'loading' } }))
      try {
        const data = await api.listConflicts(projectId)
        set({ conflicts: { data, status: 'ready', lastFetched: Date.now() } })
      } catch (e: any) {
        set((s: any) => ({ conflicts: { ...s.conflicts, status: 'error', error: e.message } }))
      }
    },
    async patchConflict(id, resolution) {
      await api.patchConflict(id, resolution)
      const pid = get().currentProjectId
      if (pid) await get().loadConflicts(pid)
    },
  }
}
```

- [ ] **Step 4: Implement `runs.ts` (skeleton; expanded in Phase 3)**

```typescript
// runs.ts
import type { RunKind } from '../../../shared/types'

export interface TrackedRun {
  runId: string
  kind: RunKind
  claimId?: string
  conflictId?: string
}

export interface RunsSlice {
  runs: Map<string, TrackedRun>
  trackRun(t: TrackedRun): void
  untrackRun(runId: string): void
}

export function createRunsSlice(set: any, get: any): RunsSlice {
  return {
    runs: new Map(),
    trackRun(t) { set((s: any) => { const m = new Map(s.runs); m.set(t.runId, t); return { runs: m } }) },
    untrackRun(id) { set((s: any) => { const m = new Map(s.runs); m.delete(id); return { runs: m } }) },
  }
}
```

- [ ] **Step 5: Refactor `useStore.ts` to compose slices**

The existing store is large. Strategy: keep its UI methods (toast, expand, tab, settings) intact; replace persisted-domain fields (`projects`, `inboxItems`, `conflicts`) with the new slices' data; remove obsolete `saveToInbox`/`removeFromInbox` methods (now in slices); remove `clearAllData` calls to old keys (replaced by `rk_schema_version` wipe).

```typescript
// useStore.ts (refactored skeleton)
import { create } from 'zustand'
import { createProjectsSlice, ProjectsSlice } from './slices/projects'
import { createClaimsSlice, ClaimsSlice } from './slices/claims'
import { createInboxSlice, InboxSlice } from './slices/inbox'
import { createConflictsSlice, ConflictsSlice } from './slices/conflicts'
import { createRunsSlice, RunsSlice } from './slices/runs'
// keep imports for UI types (TabId, Tone, ToastState, etc.)

interface UIState {
  tab: TabId
  settingsOpen: boolean
  toast: ToastState | null
  expandedClaimIds: Set<string>
  inboxSelectedIds: Set<string>
  inboxExpandedGroups: Set<string>
  draftSelection: string[]
  currentProjectId: string | null
  // …
  setTab(t: TabId): void
  /* etc — keep existing UI actions */
}

type Store = UIState & ProjectsSlice & ClaimsSlice & InboxSlice & ConflictsSlice & RunsSlice

export const useStore = create<Store>((set, get) => ({
  // UI state with sensible defaults
  tab: 'verify',
  settingsOpen: false,
  toast: null,
  expandedClaimIds: new Set(),
  inboxSelectedIds: new Set(),
  inboxExpandedGroups: new Set(),
  draftSelection: [],
  currentProjectId: null,
  // … existing UI actions verbatim …

  // Slices
  ...createProjectsSlice(set, get),
  ...createClaimsSlice(set, get),
  ...createInboxSlice(set, get),
  ...createConflictsSlice(set, get),
  ...createRunsSlice(set, get),
}))
```

Persistence (`chrome.storage`) shrinks to UI-only keys: `tab`, `currentProjectId`, `activeSites`, `pausedSites`, `globalPaused`, `provider`, `autoVerify`, `verifyDelay`, `onboardingDone`, `verifyEnabled`, `inboxSelectedIds`. Update `storage.ts`/`storage-schema.ts` accordingly. Bump `rk_schema_version` to `2`; on mismatch, wipe.

- [ ] **Step 6: Update `useChromeStorage.ts` to remove obsolete domain reads**

Drop reads of `projects`, `inboxItems`, `conflicts`. Add a one-time migration check:

```typescript
const { rk_schema_version } = await chrome.storage.local.get('rk_schema_version')
if (rk_schema_version !== 2) {
  await chrome.storage.local.clear()
  await chrome.storage.local.set({ rk_schema_version: 2 })
}
```

- [ ] **Step 7: Wire fetch triggers in App**

In `App.tsx` after auth gate:

```tsx
useEffect(() => {
  loadProjects()
}, [user?.id])

useEffect(() => {
  if (!currentProjectId) return
  loadClaims(currentProjectId)
  loadInbox(currentProjectId)
  loadConflicts(currentProjectId)
}, [currentProjectId])

useEffect(() => {
  if (!currentProjectId && projects.data.length > 0) {
    switchProject(projects.data[0].id)
  }
}, [projects.data, currentProjectId])
```

- [ ] **Step 8: Build + run extension tests**

```bash
cd research-kit/extension && npm run build && npm test
```

Fix all type errors. Tests for old useStore behavior may need updating; rewrite or delete tests that assert behavior the new slices replace.

- [ ] **Step 9: Manual smoke**

Sign in → see projects fetched → switch projects → claims/inbox/conflicts load. Check Network tab.

- [ ] **Step 10: Commit**

```bash
git add research-kit/extension/src/sidebar/state research-kit/extension/src/sidebar/App.tsx \
        research-kit/extension/src/sidebar/hooks/useChromeStorage.ts
git commit -m "refactor(ext): split useStore into slices; backend as source of truth"
```

---

## Phase 3 — SSE Streaming + Verify/Chat/Draft Tabs

End state: Verify tab triggers verify runs and shows live progress; ChatTab functional; DraftTab functional. Conflicts and remaining mutations come in Phase 4.

### Task 19: `useRunStream` hook

**Files:**
- Create: `research-kit/extension/src/sidebar/hooks/useRunStream.ts`
- Create: `research-kit/extension/src/sidebar/hooks/useRunStream.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// useRunStream.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useRunStream } from './useRunStream'

vi.mock('../../shared/api', () => ({
  streamRun: async function* () {
    yield { type: 'status', payload: { status: 'running' } }
    yield { type: 'token', payload: { text: 'hel' } }
    yield { type: 'token', payload: { text: 'lo' } }
    yield { type: 'status', payload: { status: 'succeeded' } }
  },
}))

describe('useRunStream', () => {
  it('accumulates tokens and tracks status', async () => {
    const { result } = renderHook(() => useRunStream('run-1'))
    await waitFor(() => expect(result.current.status).toBe('succeeded'))
    expect(result.current.tokens).toBe('hello')
  })
})
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**

```tsx
// useRunStream.ts
import { useEffect, useState } from 'react'
import { streamRun } from '../../shared/api'
import type { RunEvent, RunStatus } from '../../shared/types'

interface ToolCall { id?: string; name: string; args?: unknown; result?: unknown }
interface RunError { code: string; message: string; recoverable?: boolean }

export function useRunStream(runId: string | null) {
  const [tokens, setTokens] = useState('')
  const [status, setStatus] = useState<RunStatus>('queued')
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [error, setError] = useState<RunError | null>(null)
  const [finalContent, setFinalContent] = useState<string | null>(null)

  useEffect(() => {
    if (!runId) return
    const ctrl = new AbortController()
    setTokens(''); setStatus('queued'); setToolCalls([]); setError(null); setFinalContent(null)
    ;(async () => {
      try {
        for await (const evt of streamRun(runId, { signal: ctrl.signal })) {
          dispatch(evt)
        }
      } catch (e: any) {
        if (!ctrl.signal.aborted) setError({ code: e.name || 'error', message: e.message })
      }
    })()
    function dispatch(evt: RunEvent) {
      switch (evt.type) {
        case 'status': setStatus(evt.payload.status); break
        case 'token': setTokens(t => t + evt.payload.text); break
        case 'tool_call': setToolCalls(c => [...c, { id: evt.payload.id, name: evt.payload.name, args: evt.payload.args }]); break
        case 'tool_result': setToolCalls(c => c.map(x => x.id === evt.payload.id
          ? { ...x, result: evt.payload.result } : x)); break
        case 'error': setError(evt.payload); break
        case 'final': setFinalContent(evt.payload.content); break
      }
    }
    return () => ctrl.abort()
  }, [runId])

  return { tokens, status, toolCalls, error, finalContent }
}
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/hooks/useRunStream.ts \
        research-kit/extension/src/sidebar/hooks/useRunStream.test.tsx
git commit -m "feat(ext): useRunStream hook"
```

### Task 20: VerifyTab wiring (start verify run, live progress)

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx`
- Modify: `research-kit/extension/src/sidebar/App.tsx`

- [ ] **Step 1: Add `startVerify` to App-level (composes runs slice + createRun)**

```tsx
// in App.tsx
import { createRun } from '../shared/api'

async function startVerify(claim: Claim) {
  const idem = `verify:${claim.id}:${Date.now()}`
  const { run_id } = await createRun({
    kind: 'verify',
    project_id: currentProjectId!,
    idempotency_key: idem,
    input: {
      claim_id: claim.id,
      claim: { text: claim.text, citations: [] /* TODO: surface citations from claim */ },
    },
  })
  trackRun({ runId: run_id, kind: 'verify', claimId: claim.id })
}
```

- [ ] **Step 2: VerifyTab subscribes to current claim's run via `useRunStream`**

In VerifyTab, render each row with a per-row hook. (Hooks-in-loop is fine if rows are stable React components keyed by claim.id.)

```tsx
function ClaimRow({ claim, runId }: { claim: Claim; runId?: string }) {
  const { status, tokens } = useRunStream(runId ?? null)
  // render confidence bar, status badge, etc.
}
```

VerifyTab maps current project's `claims.data` → `<ClaimRow claim runId={runIdForClaim(claim.id)} />`. `runIdForClaim` looks up runs slice for matching `claimId`.

- [ ] **Step 3: When run reaches `succeeded`, refresh claims slice**

In a `useEffect` in `ClaimRow`:

```tsx
useEffect(() => {
  if (status === 'succeeded') {
    loadClaims(currentProjectId!)
    untrackRun(runId!)
  }
}, [status])
```

- [ ] **Step 4: Build + manual smoke**

Sign in → click Verify on a claim → progress indicator → claim row updates with verdict.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx \
        research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(ext): VerifyTab triggers verify runs and shows live progress"
```

### Task 21: ChatTab — thread + streaming

**Files:**
- Rewrite: `research-kit/extension/src/sidebar/components/tabs/ChatTab.tsx`
- Create: `research-kit/extension/src/sidebar/components/atoms/MessageBubble.tsx`
- Create: `research-kit/extension/src/sidebar/components/atoms/MarkdownView.tsx`
- Modify: `package.json` to add `react-markdown`

- [ ] **Step 1: Add dependency**

```bash
cd research-kit/extension && npm install react-markdown
```

- [ ] **Step 2: Implement `MarkdownView.tsx`**

```tsx
import ReactMarkdown from 'react-markdown'
export function MarkdownView({ source }: { source: string }) {
  return <ReactMarkdown>{source}</ReactMarkdown>
}
```

- [ ] **Step 3: Implement `MessageBubble.tsx`**

```tsx
import { MarkdownView } from './MarkdownView'
interface Props { role: 'user' | 'assistant'; content: string }
export function MessageBubble({ role, content }: Props) {
  return (
    <div className={`p-2 my-1 rounded ${role === 'user' ? 'bg-blue-100 self-end' : 'bg-gray-100'}`}>
      <MarkdownView source={content} />
    </div>
  )
}
```

- [ ] **Step 4: Implement `ChatTab.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../state/useStore'
import { createRun, getRun, cancelRun } from '../../../shared/api'
import { useRunStream } from '../../hooks/useRunStream'
import { MessageBubble } from '../atoms/MessageBubble'

interface Message { role: 'user' | 'assistant'; content: string; runId?: string }

export function ChatTab() {
  const projectId = useStore(s => s.currentProjectId)
  const [thread, setThread] = useState<Message[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const stream = useRunStream(activeRunId)

  // Load persisted thread when projectId changes
  useEffect(() => {
    if (!projectId) return
    chrome.storage.local.get(`chat:${projectId}`).then(({ [`chat:${projectId}`]: t }) => {
      setThread(t ?? [])
    })
  }, [projectId])

  // Persist thread on change
  useEffect(() => {
    if (!projectId) return
    chrome.storage.local.set({ [`chat:${projectId}`]: thread })
  }, [thread, projectId])

  // Finalize message when run completes
  useEffect(() => {
    if (!activeRunId) return
    if (stream.status === 'succeeded' || stream.status === 'failed' || stream.status === 'cancelled') {
      ;(async () => {
        let final = stream.finalContent ?? stream.tokens
        if (stream.status === 'succeeded' && !stream.finalContent) {
          try {
            const r = await getRun(activeRunId)
            final = (r.result as any)?.text ?? final
          } catch {}
        }
        setThread(t => {
          const last = t[t.length - 1]
          if (last?.runId === activeRunId) {
            const next = [...t]
            next[next.length - 1] = { ...last, content: final ?? '(no response)' }
            return next
          }
          return t
        })
        setActiveRunId(null)
      })()
    }
  }, [stream.status])

  async function send() {
    if (!input.trim() || !projectId) return
    const userMsg: Message = { role: 'user', content: input.trim() }
    const newThread = [...thread, userMsg]
    setThread(newThread)
    setInput('')
    const idem = `chat:${projectId}:${Date.now()}`
    const { run_id } = await createRun({
      kind: 'chat', project_id: projectId, idempotency_key: idem,
      input: { messages: newThread.map(m => ({ role: m.role, content: m.content })) },
    })
    setThread(t => [...t, { role: 'assistant', content: '', runId: run_id }])
    setActiveRunId(run_id)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-2 flex flex-col">
        {thread.map((m, i) => (
          <MessageBubble key={i} role={m.role}
            content={m.runId === activeRunId ? stream.tokens : m.content} />
        ))}
        {stream.error && <div className="text-red-600 text-sm">{stream.error.message}</div>}
      </div>
      <div className="flex gap-2 p-2 border-t">
        <textarea className="flex-1 border rounded p-1" value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          disabled={!!activeRunId} />
        {activeRunId
          ? <button className="px-3 py-1 bg-red-600 text-white rounded"
              onClick={() => cancelRun(activeRunId)}>Cancel</button>
          : <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={send}>Send</button>}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Build + manual smoke**

Send "hi" in chat → tokens stream in → message finalizes.

- [ ] **Step 6: Add basic test**

```tsx
// ChatTab.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChatTab } from './ChatTab'

vi.mock('../../../shared/api', () => ({
  createRun: vi.fn().mockResolvedValue({ run_id: 'r1', status: 'queued', stream_url: '' }),
  getRun: vi.fn().mockResolvedValue({ result: { text: 'pong' } }),
  cancelRun: vi.fn(),
}))
vi.mock('../../hooks/useRunStream', () => ({
  useRunStream: (id: string | null) => id
    ? { status: 'succeeded', tokens: 'pong', toolCalls: [], error: null, finalContent: 'pong' }
    : { status: 'queued', tokens: '', toolCalls: [], error: null, finalContent: null },
}))
vi.mock('../../state/useStore', () => ({ useStore: (sel: any) => sel({ currentProjectId: 'p1' }) }))

describe('ChatTab', () => {
  it('sends message, finalizes assistant reply', async () => {
    // @ts-expect-error
    globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } }
    render(<ChatTab />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ping' } })
    fireEvent.click(screen.getByText('Send'))
    await waitFor(() => expect(screen.getByText('pong')).toBeInTheDocument())
  })
})
```

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/ChatTab.tsx \
        research-kit/extension/src/sidebar/components/atoms/MessageBubble.tsx \
        research-kit/extension/src/sidebar/components/atoms/MarkdownView.tsx \
        research-kit/extension/package.json research-kit/extension/package-lock.json \
        research-kit/extension/src/sidebar/components/tabs/ChatTab.test.tsx
git commit -m "feat(ext): ChatTab with streaming + history persistence"
```

### Task 22: DraftTab — source picker + streaming markdown

**Files:**
- Rewrite: `research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx`

- [ ] **Step 1: Implement DraftTab**

```tsx
import { useState } from 'react'
import { useStore } from '../../state/useStore'
import { createRun } from '../../../shared/api'
import { useRunStream } from '../../hooks/useRunStream'
import { MarkdownView } from '../atoms/MarkdownView'

export function DraftTab() {
  const projectId = useStore(s => s.currentProjectId)
  const inboxItems = useStore(s => s.inbox.data)
  const claims = useStore(s => s.claims.data)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [style, setStyle] = useState<'short' | 'default' | 'long'>('default')
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const stream = useRunStream(activeRunId)

  function toggle(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function generate() {
    if (!projectId || selected.size === 0) return
    const claimsForDraft = inboxItems
      .filter(i => selected.has(i.id))
      .map(i => {
        const c = claims.find(x => x.id === i.claim_id)
        return c ? {
          id: c.id, text: c.text, verdict: c.status, quote: c.quote,
          paper_title: c.paper_title, doi: c.doi,
        } : null
      })
      .filter(Boolean)
    const idem = `draft:${projectId}:${Date.now()}`
    const { run_id } = await createRun({
      kind: 'draft', project_id: projectId, idempotency_key: idem,
      input: { claims: claimsForDraft, style },
    })
    setActiveRunId(run_id)
  }

  async function save() {
    if (!projectId || !stream.finalContent) return
    const draft = JSON.parse(stream.finalContent)
    const drafts = (await chrome.storage.local.get(`drafts:${projectId}`))[`drafts:${projectId}`] ?? []
    await chrome.storage.local.set({
      [`drafts:${projectId}`]: [...drafts, { savedAt: Date.now(), ...draft }],
    })
  }

  const markdown = stream.finalContent
    ? (() => { try { return JSON.parse(stream.finalContent).markdown } catch { return stream.tokens } })()
    : stream.tokens

  return (
    <div className="flex flex-col h-full p-2 gap-2">
      <div className="border rounded p-2 max-h-40 overflow-y-auto">
        {inboxItems.map(i => {
          const c = claims.find(x => x.id === i.claim_id)
          return (
            <label key={i.id} className="flex gap-2 items-start py-1">
              <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
              <span className="text-sm">{c?.text ?? '(missing claim)'}</span>
            </label>
          )
        })}
      </div>
      <div className="flex gap-2 items-center">
        <select value={style} onChange={e => setStyle(e.target.value as any)}>
          <option value="short">Short</option>
          <option value="default">Default</option>
          <option value="long">Long</option>
        </select>
        <button onClick={generate} disabled={selected.size === 0 || !!activeRunId}
          className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50">Generate</button>
        <button onClick={save} disabled={!stream.finalContent}
          className="px-3 py-1 bg-green-600 text-white rounded disabled:opacity-50">Save</button>
      </div>
      <div className="flex-1 overflow-y-auto border rounded p-2">
        <MarkdownView source={markdown} />
        {stream.error && <div className="text-red-600">{stream.error.message}</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build + manual smoke**

- [ ] **Step 3: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx
git commit -m "feat(ext): DraftTab with claim picker + streaming markdown"
```

---

## Phase 4 — Mutations + Conflict Resolution + App.tsx Wiring

End state: all 7 App.tsx TODOs resolved; ConflictsTab functional; full E2E checklist passes.

### Task 23: ProjectCreateModal + onCreateProject wiring

**Files:**
- Create: `research-kit/extension/src/sidebar/components/atoms/ProjectCreateModal.tsx`
- Modify: `App.tsx`

- [ ] **Step 1: Implement modal**

```tsx
// ProjectCreateModal.tsx
import { useState } from 'react'
interface Props { onCreate(name: string): Promise<unknown>; onClose(): void }
export function ProjectCreateModal({ onCreate, onClose }: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-white p-4 rounded w-72 flex flex-col gap-2">
        <h2 className="font-semibold">New project</h2>
        <input className="border rounded p-1" autoFocus value={name}
          onChange={e => setName(e.target.value)} placeholder="Project name" />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose}>Cancel</button>
          <button disabled={!name.trim() || busy}
            className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
            onClick={async () => {
              setBusy(true); try { await onCreate(name.trim()); onClose() } finally { setBusy(false) }
            }}>Create</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire in App.tsx**

```tsx
const [showCreateProject, setShowCreateProject] = useState(false)
// …
onCreateProject={() => setShowCreateProject(true)}
// …
{showCreateProject && (
  <ProjectCreateModal
    onCreate={async (name) => { await createProject(name) }}
    onClose={() => setShowCreateProject(false)}
  />
)}
```

- [ ] **Step 3: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/ProjectCreateModal.tsx \
        research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(ext): project creation modal"
```

### Task 24: App.tsx — archive, addToProject, save, toggleSelect, expand

**Files:**
- Modify: `App.tsx`

- [ ] **Step 1: Implement handlers**

```tsx
// At top of App() after slice destructure:
const { archiveMany, addToInbox } = useStore()
const { patchClaim } = useStore()
const { expandedClaimIds, toggleClaimExpand, toggleInboxSelect } = useStore()

const handleArchive = async (ids: string[]) => {
  await archiveMany(ids)
  clearInboxSelection()
}

const [showProjectPicker, setShowProjectPicker] = useState<string[] | null>(null)
const handleAddToProject = (ids: string[]) => setShowProjectPicker(ids)

const onSave = async (claimId: string) => {
  await patchClaim(claimId, { status: 'saved' })
  await addToInbox(currentProjectId!, claimId)
}

const onToggleSelect = (id: string) => toggleInboxSelect(id)
const onToggleExpand = (id: string) => toggleClaimExpand(id)
```

- [ ] **Step 2: Wire `<ProjectPicker>` modal for handleAddToProject**

Reuse `ProjectSelector` atom inside a modal. On pick:

```tsx
async (targetProjectId) => {
  const inbox = useStore.getState().inbox.data
  const claims = useStore.getState().claims.data
  const claimIds = (showProjectPicker ?? [])
    .map(invId => inbox.find(i => i.id === invId)?.claim_id)
    .filter(Boolean) as string[]
  await Promise.all(claimIds.map(id => addToInbox(targetProjectId, id)))
  setShowProjectPicker(null)
}
```

- [ ] **Step 3: Replace `expandedIds = new Set<string>()` with `expandedClaimIds` from store**

- [ ] **Step 4: Build + smoke**

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(ext): wire archive/add-to-project/save/expand/toggle"
```

### Task 25: ConflictsTab + ConflictResolutionPanel

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/ConflictsTab.tsx`
- Create: `research-kit/extension/src/sidebar/components/atoms/ConflictResolutionPanel.tsx`
- Modify: `App.tsx`

- [ ] **Step 1: Implement panel**

```tsx
// ConflictResolutionPanel.tsx
import { useState } from 'react'
import type { Conflict, ResolutionPayload } from '../../../shared/types'

interface Props {
  conflict: Conflict
  onResolve(p: ResolutionPayload): Promise<void>
  onSuggest(): Promise<void>
}

export function ConflictResolutionPanel({ conflict, onResolve, onSuggest }: Props) {
  const [busy, setBusy] = useState(false)
  const suggestion = (() => {
    if (!conflict.resolution) return null
    try { return JSON.parse(conflict.resolution) } catch { return null }
  })()
  return (
    <div className="border rounded p-2">
      <div className="font-semibold">{conflict.paper_title ?? conflict.group_key}</div>
      <div className="grid grid-cols-2 gap-2 my-2">
        {conflict.sides.map(s => (
          <div key={s.claim_id} className="border p-1 rounded">
            <div className="text-xs uppercase">{s.label}</div>
            <div className="text-sm">{s.quote}</div>
            <button className="mt-1 text-xs px-2 py-0.5 bg-blue-600 text-white rounded"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try { await onResolve({ kind: 'accept_side', side_id: s.claim_id }) }
                finally { setBusy(false) }
              }}>Accept</button>
          </div>
        ))}
      </div>
      {suggestion?.kind === 'suggestion' && (
        <div className="text-sm bg-yellow-50 p-2 rounded">
          <div className="font-medium">Suggestion:</div> {suggestion.text}
        </div>
      )}
      {!suggestion && (
        <button className="px-3 py-1 bg-gray-200 rounded"
          disabled={busy} onClick={async () => { setBusy(true); try { await onSuggest() } finally { setBusy(false) } }}>
          Get suggestion
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update ConflictsTab to use the panel**

```tsx
import { ConflictResolutionPanel } from '../atoms/ConflictResolutionPanel'

export function ConflictsTab(props: { conflicts: Conflict[]; onResolve: (id: string, p: ResolutionPayload) => Promise<void>; onSuggest: (c: Conflict) => Promise<void> }) {
  return (
    <div className="flex flex-col gap-2 p-2 overflow-y-auto h-full">
      {props.conflicts.length === 0 && <div className="text-sm text-gray-500">No conflicts.</div>}
      {props.conflicts.map(c => (
        <ConflictResolutionPanel key={c.id} conflict={c}
          onResolve={p => props.onResolve(c.id, p)}
          onSuggest={() => props.onSuggest(c)} />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Wire App-level handlers**

```tsx
const handleResolveConflict = async (id: string, p: ResolutionPayload) => {
  await patchConflict(id, p)
}
const handleSuggestConflict = async (c: Conflict) => {
  const idem = `conflict:${c.id}:${Date.now()}`
  await createRun({
    kind: 'conflict', project_id: c.project_id, idempotency_key: idem,
    input: {
      conflict_id: c.id, group_key: c.group_key,
      sides: c.sides.map(s => ({ side_id: s.claim_id, label: s.label, quote: s.quote })),
    },
  })
  // Could trackRun + on success auto-refetch; keep simple: user clicks refresh.
}
```

Pass these as props to `<ConflictsTab>`.

- [ ] **Step 4: Build + smoke**
- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/ConflictsTab.tsx \
        research-kit/extension/src/sidebar/components/atoms/ConflictResolutionPanel.tsx \
        research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(ext): ConflictsTab resolution panel + suggestion run"
```

### Task 26: InboxTab — handleRemoveItem wiring

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/InboxTab.tsx`

- [ ] **Step 1: Add `onRemove` prop usage**

InboxTab currently has a Remove button without handler. Add:

```tsx
// Pass `removeFromInbox` from useStore via App into InboxTab as `onRemove(id)`.
// Wire onClick in row markup:
<button onClick={() => props.onRemove(item.id)}>Remove</button>
```

- [ ] **Step 2: In App.tsx**

```tsx
<InboxTab
  items={inboxItems || []}
  selectedIds={inboxSelectedIds}
  onToggleSelect={onToggleSelect}
  onArchive={handleArchive}
  onAddToProject={handleAddToProject}
  onClearSelection={clearInboxSelection}
  onRemove={(id: string) => removeFromInbox(id)}
/>
```

- [ ] **Step 3: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/InboxTab.tsx \
        research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(ext): InboxTab single-item remove"
```

### Task 27: SettingsPanel — sign out

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/overlays/SettingsPanel.tsx`

- [ ] **Step 1: Add Sign Out button**

```tsx
import { signOut } from '../../../shared/auth'
// inside SettingsPanel JSX:
<button className="px-3 py-1 bg-red-600 text-white rounded" onClick={signOut}>Sign out</button>
```

- [ ] **Step 2: Commit**

```bash
git add research-kit/extension/src/sidebar/components/overlays/SettingsPanel.tsx
git commit -m "feat(ext): sign-out button in settings"
```

### Task 28: Final E2E manual checklist

- [ ] **Step 1: Bring up full stack**

```bash
cd research-kit/infra && docker-compose up -d
```

- [ ] **Step 2: Load extension unpacked, run all 10 E2E checklist items from spec §8.**

For each that fails, file a follow-up task. Do not mark plan complete until all 10 pass or are explicitly waived.

- [ ] **Step 3: Tag**

```bash
git tag rk-app-completion-v1
```

---

## Self-Review Notes

- Spec §3 conflict input uses `verify_run_id` historically; Tasks 3 and 25 use `side_id` (= claim_id, since `ConflictSide` schema has `claim_id`). This is consistent within the plan.
- Spec §7 says "ChatThread under `chat:{projectId}`" and Task 21 implements exactly that key shape.
- Spec §6 says "no optimistic updates v1"; Tasks 18–26 use only `await api.*; await load*()` write-through.
- Spec §1 out-of-scope: "no MCP write tools" — Task 7 writeback uses ORM directly, not MCP.
- Worker `idempotency_key` is required (`min_length=1`); every `createRun` call in Tasks 20–25 supplies one.
- Backend `ConflictPatch.resolution` is `str` not structured; Task 16 `patchConflict` JSON-encodes the payload. Task 25 panel decodes it back. Task 7 writeback also JSON-encodes.
- Manual E2E gate at Task 11 is a hard rollback boundary before any extension work.
