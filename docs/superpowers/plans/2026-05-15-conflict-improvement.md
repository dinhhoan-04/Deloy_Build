# Conflict Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect conflicts after verify, improve AI suggestion quality, and add a confirm flow that verifies the accepted claim, deletes the rejected one, and adds it to inbox.

**Architecture:** Four independent changes — (1) fire-and-forget detection in `claims.py` after PATCH, (2) rewrite CONFLICT LLM block in `runs.py` with new prompt + auto-save to `conflict.resolution`, (3) new `POST /v1/conflicts/:id/confirm` endpoint, (4) extension UI replaces Accept buttons with radio-select + Confirm.

**Tech Stack:** Python/FastAPI (backend), TypeScript/React (extension), Zustand (state), SQLAlchemy async

---

## File Map

| File | Change |
|---|---|
| `research-kit/backend/app/routers/claims.py` | Add `_detect_conflicts()` background task; fire from `patch_claim` |
| `research-kit/backend/app/routers/runs.py` | Rewrite CONFLICT block: new prompt, new schema, auto-save `conflict.resolution` |
| `research-kit/backend/app/repos/conflicts.py` | Add `find_by_claim_pair()` and `confirm()` methods |
| `research-kit/backend/app/schemas/conflicts.py` | Add `ConflictConfirmIn`, `ConflictConfirmOut` |
| `research-kit/backend/app/routers/conflicts.py` | Add `POST /v1/conflicts/{conflict_id}/confirm` endpoint |
| `research-kit/extension/src/shared/api.ts` | Add `confirmConflict()` |
| `research-kit/extension/src/sidebar/state/slices/conflicts.ts` | Add `confirmConflict()` action |
| `research-kit/extension/src/sidebar/components/atoms/ConflictResolutionPanel.tsx` | Radio-select sides + Confirm button + suggestion highlight |

---

## Task 1: Auto-detect conflicts after PATCH claim

**Files:**
- Modify: `research-kit/backend/app/routers/claims.py`
- Modify: `research-kit/backend/app/repos/conflicts.py`
- Test: `research-kit/backend/tests/test_conflict_detect.py`

- [ ] **Step 1: Write the failing test**

Create `research-kit/backend/tests/test_conflict_detect.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch
from uuid import uuid4


@pytest.mark.asyncio
async def test_detect_conflicts_creates_conflict_when_contradiction_found(async_session):
    """_detect_conflicts creates a conflict when LLM says contradicts=True."""
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus

    user_id = uuid4()
    project = Project(user_id=user_id, name="Test")
    async_session.add(project)
    await async_session.flush()

    doi = "10.1234/test"
    claim_a = Claim(
        user_id=user_id, project_id=project.id,
        text="Exercise increases depression", doi=doi, paper_title="P1",
        site="pubmed", status=ClaimStatus.VERIFIED.value, quote="quote A",
    )
    claim_b = Claim(
        user_id=user_id, project_id=project.id,
        text="Exercise reduces depression", doi=doi, paper_title="P1",
        site="pubmed", status=ClaimStatus.PENDING.value, quote="quote B",
    )
    async_session.add_all([claim_a, claim_b])
    await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradicts": True, "reason": "opposite"})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, claim_b.id, project.id)

    from sqlalchemy import select
    from rk_shared.models import Conflict
    conflicts = list((await async_session.execute(
        select(Conflict).where(Conflict.project_id == project.id)
    )).scalars())
    assert len(conflicts) == 1
    side_ids = {s["claim_id"] for s in conflicts[0].sides}
    assert str(claim_a.id) in side_ids
    assert str(claim_b.id) in side_ids


@pytest.mark.asyncio
async def test_detect_conflicts_no_conflict_when_no_contradiction(async_session):
    from rk_shared.models import Claim, Project, Conflict
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    project = Project(user_id=user_id, name="Test2")
    async_session.add(project)
    await async_session.flush()

    doi = "10.9999/nodiff"
    claim_a = Claim(
        user_id=user_id, project_id=project.id,
        text="A", doi=doi, paper_title="P", site="pubmed",
        status=ClaimStatus.VERIFIED.value, quote="q",
    )
    claim_b = Claim(
        user_id=user_id, project_id=project.id,
        text="B", doi=doi, paper_title="P", site="pubmed",
        status=ClaimStatus.PENDING.value, quote="q2",
    )
    async_session.add_all([claim_a, claim_b])
    await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradicts": False, "reason": "consistent"})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, claim_b.id, project.id)

    conflicts = list((await async_session.execute(
        select(Conflict).where(Conflict.project_id == project.id)
    )).scalars())
    assert len(conflicts) == 0


@pytest.mark.asyncio
async def test_detect_conflicts_no_duplicate(async_session):
    """_detect_conflicts does not create a second conflict for the same pair."""
    from rk_shared.models import Claim, Project, Conflict
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    project = Project(user_id=user_id, name="Test3")
    async_session.add(project)
    await async_session.flush()

    doi = "10.0001/dup"
    claim_a = Claim(
        user_id=user_id, project_id=project.id,
        text="A", doi=doi, paper_title="P", site="pubmed",
        status=ClaimStatus.VERIFIED.value, quote="q",
    )
    claim_b = Claim(
        user_id=user_id, project_id=project.id,
        text="B", doi=doi, paper_title="P", site="pubmed",
        status=ClaimStatus.PENDING.value, quote="q2",
    )
    async_session.add_all([claim_a, claim_b])
    await async_session.flush()

    # Pre-existing conflict for the same pair
    existing = Conflict(
        user_id=user_id, project_id=project.id, group_key=doi,
        doi=doi, paper_title="P",
        sides=[{"claim_id": str(claim_a.id), "label": "A", "quote": "q"},
               {"claim_id": str(claim_b.id), "label": "B", "quote": "q2"}],
    )
    async_session.add(existing)
    await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradicts": True, "reason": "opp"})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, claim_b.id, project.id)

    conflicts = list((await async_session.execute(
        select(Conflict).where(Conflict.project_id == project.id)
    )).scalars())
    assert len(conflicts) == 1  # still just the original
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd research-kit/backend
pytest tests/test_conflict_detect.py -v
```

Expected: ImportError or AttributeError — `_detect_conflicts` and `_make_provider` don't exist yet.

- [ ] **Step 3: Add `find_by_claim_pair` to `ConflictRepo`**

In `research-kit/backend/app/repos/conflicts.py`, add after the `patch` method:

```python
    async def find_by_claim_pair(self, user_id: UUID, project_id: UUID,
                                  claim_id_a: UUID, claim_id_b: UUID) -> Conflict | None:
        """Return existing conflict that contains both claim IDs in its sides."""
        rows = await self.list_for(user_id, project_id=project_id)
        a, b = str(claim_id_a), str(claim_id_b)
        for c in rows:
            ids = {s.get("claim_id") for s in (c.sides or [])}
            if a in ids and b in ids:
                return c
        return None
```

- [ ] **Step 4: Add `_make_provider` and `_detect_conflicts` to `claims.py`**

Add these imports at the top of `research-kit/backend/app/routers/claims.py` (after existing imports):

```python
import asyncio
import json
from app.config import get_settings
from app.llm.providers import GeminiProvider, GroqProvider, OpenAIProvider, ProviderError, RateLimitError
from app.repos.conflicts import ConflictRepo
from rk_shared.models import Claim
from sqlalchemy import select
```

Then add the helper functions before the `router = APIRouter(...)` line:

```python
_CONFLICT_DETECT_SYSTEM = (
    "You detect contradictions between two scientific claims from the same paper. "
    "Return JSON: {\"contradicts\": bool, \"reason\": string}. "
    "contradicts=true only if the claims make incompatible assertions."
)

_CONFLICT_DETECT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "contradicts": {"type": "boolean"},
        "reason": {"type": "string"},
    },
    "required": ["contradicts", "reason"],
}


def _make_provider():
    s = get_settings()
    if s.llm_primary_provider == "gemini" and s.gemini_api_key:
        return GeminiProvider(api_key=s.gemini_api_key, model=s.llm_gemini_model)
    if s.llm_primary_provider == "groq" and s.groq_api_key:
        return GroqProvider(api_key=s.groq_api_key, model=s.llm_groq_model)
    if s.openai_api_key:
        return OpenAIProvider(api_key=s.openai_api_key, model=s.llm_openai_model)
    return None


async def _detect_conflicts(s: AsyncSession, user_id: UUID, new_claim_id: UUID,
                             project_id: UUID) -> None:
    """Check new_claim against same-paper claims in project; create conflict if contradiction found."""
    new_claim = (await s.execute(
        select(Claim).where(Claim.id == new_claim_id, Claim.user_id == user_id)
    )).scalar_one_or_none()
    if not new_claim:
        return

    # Find candidate claims: same project, same DOI (or paper_title fallback), verified/partial
    q = select(Claim).where(
        Claim.user_id == user_id,
        Claim.project_id == project_id,
        Claim.id != new_claim_id,
        Claim.status.in_(["verified", "partial"]),
    )
    if new_claim.doi:
        q = q.where(Claim.doi == new_claim.doi)
    elif new_claim.paper_title:
        q = q.where(Claim.paper_title == new_claim.paper_title)
    else:
        return  # no paper key — skip

    candidates = list((await s.execute(q)).scalars())
    if not candidates:
        return

    provider = _make_provider()
    if not provider:
        return

    conflict_repo = ConflictRepo(s)
    for existing in candidates:
        # Duplicate guard
        if await conflict_repo.find_by_claim_pair(user_id, project_id, new_claim_id, existing.id):
            continue

        user_msg = json.dumps({
            "claim_a": new_claim.text,
            "claim_b": existing.text,
            "paper_title": new_claim.paper_title,
            "doi": new_claim.doi,
        })
        try:
            result = await provider.extract(_CONFLICT_DETECT_SYSTEM, user_msg, _CONFLICT_DETECT_SCHEMA)
        except (ProviderError, RateLimitError, Exception):
            continue

        if result.get("contradicts"):
            group_key = new_claim.doi or new_claim.paper_title or str(project_id)
            await conflict_repo.create(
                user_id,
                project_id=project_id,
                group_key=group_key,
                doi=new_claim.doi,
                paper_title=new_claim.paper_title,
                sides=[
                    {"claim_id": str(new_claim_id), "label": "Claim A", "quote": new_claim.quote},
                    {"claim_id": str(existing.id), "label": "Claim B", "quote": existing.quote},
                ],
            )
    await s.commit()
```

- [ ] **Step 5: Fire `_detect_conflicts` from `patch_claim`**

Replace the existing `patch_claim` function in `research-kit/backend/app/routers/claims.py`:

```python
@router.patch("/{claim_id}", response_model=ClaimOut)
async def patch_claim(
    claim_id: UUID,
    body: ClaimPatch,
    u: User = Depends(current_user),
    s: AsyncSession = Depends(db),
):
    c = await ClaimRepo(s).patch(
        u.id,
        claim_id,
        status=body.status,
        quote=body.quote,
        confidence=body.confidence,
        reason=body.reason,
        page=body.page,
    )
    await s.commit()

    if body.status in ("verified", "partial"):
        from app.db import sessionmaker as get_sessionmaker
        sm = get_sessionmaker()
        async def _bg():
            async with sm() as bg_s:
                await _detect_conflicts(bg_s, u.id, claim_id, c.project_id)
        asyncio.create_task(_bg())

    return _out(c)
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd research-kit/backend
pytest tests/test_conflict_detect.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add research-kit/backend/app/routers/claims.py research-kit/backend/app/repos/conflicts.py research-kit/backend/tests/test_conflict_detect.py
git commit -m "feat(conflict): auto-detect conflicts after claim patch"
```

---

## Task 2: Rewrite CONFLICT LLM block

**Files:**
- Modify: `research-kit/backend/app/routers/runs.py:220-241`

- [ ] **Step 1: Replace the CONFLICT block in `_execute_inline_run`**

In `research-kit/backend/app/routers/runs.py`, find and replace the entire `if kind == RunKind.CONFLICT:` block (lines 220–241):

```python
    if kind == RunKind.CONFLICT:
        _CONFLICT_SYSTEM = """\
You are RK-Conflict, an academic research assistant that analyzes contradictions \
between two claims from the same paper.

You receive two conflicting claims with their verbatim quotes. Analyze each side \
and recommend which claim better represents the paper's findings.

RULES:
1. EVIDENCE: Base your analysis only on the verbatim quotes provided.
2. SIDES: For each side, assess how strongly the quote supports the claim (0.0-1.0).
3. SYNTHESIS: If both sides are partially valid, suggest a reconciliation sentence.
4. RECOMMENDATION: Pick "side_a", "side_b", or "neither" with a rationale.
5. OUTPUT: Return valid JSON matching the schema."""

        user = json.dumps({
            "group_key": run_input.get("group_key"),
            "sides": run_input.get("sides", []),
        })
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "recommendation": {"type": "string", "enum": ["side_a", "side_b", "neither"]},
                "rationale": {"type": "string"},
                "synthesis": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                "sides_analysis": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "side_id": {"type": "string"},
                            "weight": {"type": "number"},
                            "note": {"type": "string"},
                        },
                        "required": ["side_id", "weight", "note"],
                    },
                },
            },
            "required": ["recommendation", "rationale", "synthesis", "sides_analysis"],
        }
        try:
            out = await provider.extract(_CONFLICT_SYSTEM, user, schema)
        except (ProviderError, RateLimitError) as e:
            raise RuntimeError(str(e)) from e

        # Auto-save suggestion back to conflict.resolution
        conflict_id = run_input.get("conflict_id")
        if conflict_id:
            from app.repos.conflicts import ConflictRepo
            resolution = json.dumps({"kind": "suggestion", **out})
            async with sm() as bg_s:
                repo = ConflictRepo(bg_s)
                try:
                    await repo.patch(
                        run_input.get("meta", {}).get("user_id") or uuid4(),
                        UUID(conflict_id),
                        resolution=resolution,
                    )
                    await bg_s.commit()
                except Exception:
                    pass  # best-effort: don't fail the run if save fails

        return out, json.dumps(out)
```

Wait — `repo.patch` needs `user_id`. The run's `user_id` is on the `Run` model. Replace the auto-save block above with this corrected version that reads `user_id` from the run already loaded in scope:

Find the full `_execute_inline_run` function signature:

```python
async def _execute_inline_run(sm, run_id: UUID):
    async with sm() as s:
        run = (await s.execute(select(Run).where(Run.id == run_id))).scalar_one()
        kind = RunKind(run.kind)
        run_input = run.input
        provider_name = (run_input.get("meta") or {}).get("provider")
        model_name = (run_input.get("meta") or {}).get("model")
    provider = _provider_chain(provider_name, model_name)
```

The `run.user_id` is available. Adjust the CONFLICT block to capture `run.user_id` before exiting the `async with sm()` block. Replace the entire `_execute_inline_run` function's opening to also read `user_id`:

In `research-kit/backend/app/routers/runs.py` at the `_execute_inline_run` function (around line 180), change the initial block from:

```python
async def _execute_inline_run(sm, run_id: UUID):
    async with sm() as s:
        run = (await s.execute(select(Run).where(Run.id == run_id))).scalar_one()
        kind = RunKind(run.kind)
        run_input = run.input
        provider_name = (run_input.get("meta") or {}).get("provider")
        model_name = (run_input.get("meta") or {}).get("model")
    provider = _provider_chain(provider_name, model_name)
```

to:

```python
async def _execute_inline_run(sm, run_id: UUID):
    async with sm() as s:
        run = (await s.execute(select(Run).where(Run.id == run_id))).scalar_one()
        kind = RunKind(run.kind)
        run_input = run.input
        run_user_id = run.user_id
        provider_name = (run_input.get("meta") or {}).get("provider")
        model_name = (run_input.get("meta") or {}).get("model")
    provider = _provider_chain(provider_name, model_name)
```

Then use `run_user_id` in the CONFLICT auto-save block:

```python
        # Auto-save suggestion back to conflict.resolution
        conflict_id = run_input.get("conflict_id")
        if conflict_id:
            from app.repos.conflicts import ConflictRepo
            resolution = json.dumps({"kind": "suggestion", **out})
            async with sm() as bg_s:
                repo = ConflictRepo(bg_s)
                try:
                    await repo.patch(run_user_id, UUID(conflict_id), resolution=resolution)
                    await bg_s.commit()
                except Exception:
                    pass  # best-effort
```

- [ ] **Step 2: Verify the server starts without errors**

```bash
cd research-kit/backend
uvicorn app.main:app --reload
```

Expected: server starts, no import errors.

- [ ] **Step 3: Commit**

```bash
git add research-kit/backend/app/routers/runs.py
git commit -m "feat(conflict): rewrite CONFLICT LLM prompt with recommendation and auto-save"
```

---

## Task 3: Add `POST /v1/conflicts/:id/confirm` endpoint

**Files:**
- Modify: `research-kit/backend/app/repos/conflicts.py`
- Modify: `research-kit/backend/app/schemas/conflicts.py`
- Modify: `research-kit/backend/app/routers/conflicts.py`
- Test: `research-kit/backend/tests/test_conflict_confirm.py`

- [ ] **Step 1: Write the failing test**

Create `research-kit/backend/tests/test_conflict_confirm.py`:

```python
import pytest
from uuid import uuid4
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_confirm_conflict_accepts_side_and_cleans_up(client: AsyncClient, auth_headers):
    """POST /v1/conflicts/:id/confirm verifies accepted claim, deletes rejected, adds to inbox."""
    from rk_shared.models import Claim, Project, Conflict, InboxItem
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select
    from app.db import sessionmaker as get_sessionmaker

    sm = get_sessionmaker()
    async with sm() as s:
        # Get user_id from auth headers (assumes fixture sets up user)
        from rk_shared.models import User
        user = (await s.execute(select(User).limit(1))).scalar_one()
        user_id = user.id

        project = Project(user_id=user_id, name="ConfirmTest")
        s.add(project)
        await s.flush()

        claim_a = Claim(
            user_id=user_id, project_id=project.id,
            text="Claim A", doi="10.test/confirm", paper_title="P",
            site="pubmed", status=ClaimStatus.PARTIAL.value, quote="qa",
        )
        claim_b = Claim(
            user_id=user_id, project_id=project.id,
            text="Claim B", doi="10.test/confirm", paper_title="P",
            site="pubmed", status=ClaimStatus.PARTIAL.value, quote="qb",
        )
        s.add_all([claim_a, claim_b])
        await s.flush()

        conflict = Conflict(
            user_id=user_id, project_id=project.id,
            group_key="10.test/confirm", doi="10.test/confirm", paper_title="P",
            sides=[
                {"claim_id": str(claim_a.id), "label": "Claim A", "quote": "qa"},
                {"claim_id": str(claim_b.id), "label": "Claim B", "quote": "qb"},
            ],
        )
        s.add(conflict)
        await s.commit()

        conflict_id = conflict.id
        claim_a_id = claim_a.id
        claim_b_id = claim_b.id

    resp = await client.post(
        f"/v1/conflicts/{conflict_id}/confirm",
        json={"accepted_claim_id": str(claim_a_id)},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["conflict"]["id"] == str(conflict_id)
    assert body["inbox_item"]["claim_id"] == str(claim_a_id)

    async with sm() as s:
        # accepted claim is verified
        accepted = (await s.execute(select(Claim).where(Claim.id == claim_a_id))).scalar_one()
        assert accepted.status == ClaimStatus.VERIFIED.value

        # rejected claim is deleted
        rejected = (await s.execute(select(Claim).where(Claim.id == claim_b_id))).scalar_one_or_none()
        assert rejected is None

        # inbox item exists
        inbox = (await s.execute(
            select(InboxItem).where(InboxItem.claim_id == claim_a_id)
        )).scalar_one_or_none()
        assert inbox is not None

        # conflict resolution updated
        conf = (await s.execute(select(Conflict).where(Conflict.id == conflict_id))).scalar_one()
        import json
        res = json.loads(conf.resolution)
        assert res["kind"] == "confirmed"
        assert res["accepted_claim_id"] == str(claim_a_id)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd research-kit/backend
pytest tests/test_conflict_confirm.py -v
```

Expected: 404 — endpoint does not exist yet.

- [ ] **Step 3: Add `confirm()` to `ConflictRepo`**

In `research-kit/backend/app/repos/conflicts.py`, add these imports at the top:

```python
import json
from rk_shared.models import Claim, InboxItem
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
```

Then add the `confirm` method after `find_by_claim_pair`:

```python
    async def confirm(self, user_id: UUID, conflict_id: UUID,
                      accepted_claim_id: UUID) -> tuple["Conflict", "InboxItem"]:
        """Verify accepted claim, delete rejected claim, add to inbox, mark conflict resolved."""
        conflict = (await self.s.execute(
            select(Conflict).where(Conflict.id == conflict_id, Conflict.user_id == user_id)
        )).scalar_one_or_none()
        if not conflict:
            raise NotFoundError("conflict not found")

        side_ids = [UUID(s["claim_id"]) for s in (conflict.sides or [])]
        if accepted_claim_id not in side_ids:
            from app.errors import ValidationError_
            raise ValidationError_("accepted_claim_id not in conflict sides")
        rejected_ids = [sid for sid in side_ids if sid != accepted_claim_id]

        # 1. Set accepted claim to verified
        accepted = (await self.s.execute(
            select(Claim).where(Claim.id == accepted_claim_id, Claim.user_id == user_id)
        )).scalar_one_or_none()
        if not accepted:
            raise NotFoundError("accepted claim not found")
        accepted.status = "verified"

        # 2. Delete rejected claims
        for rid in rejected_ids:
            await self.s.execute(
                delete(Claim).where(Claim.id == rid, Claim.user_id == user_id)
            )

        # 3. Add accepted claim to inbox (skip if already there)
        inbox_item = InboxItem(
            user_id=user_id, project_id=conflict.project_id, claim_id=accepted_claim_id
        )
        self.s.add(inbox_item)
        try:
            await self.s.flush()
        except IntegrityError:
            await self.s.rollback()
            inbox_item = (await self.s.execute(
                select(InboxItem).where(
                    InboxItem.claim_id == accepted_claim_id,
                    InboxItem.user_id == user_id,
                )
            )).scalar_one()

        # 4. Mark conflict resolved
        conflict.resolution = json.dumps({
            "kind": "confirmed",
            "accepted_claim_id": str(accepted_claim_id),
        })
        await self.s.flush()
        return conflict, inbox_item
```

- [ ] **Step 4: Add schemas to `schemas/conflicts.py`**

Append to `research-kit/backend/app/schemas/conflicts.py`:

```python
from app.schemas.inbox import InboxOut


class ConflictConfirmIn(BaseModel):
    accepted_claim_id: UUID


class ConflictConfirmOut(BaseModel):
    conflict: ConflictOut
    inbox_item: InboxOut
```

- [ ] **Step 5: Add endpoint to `routers/conflicts.py`**

Add this import at the top of `research-kit/backend/app/routers/conflicts.py`:

```python
from app.schemas.conflicts import ConflictConfirmIn, ConflictConfirmOut
from app.schemas.inbox import InboxOut
```

Add the endpoint after `patch_conflict`:

```python
@router.post("/{conflict_id}/confirm", response_model=ConflictConfirmOut)
async def confirm_conflict(conflict_id: UUID, body: ConflictConfirmIn,
                            u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    conflict, inbox_item = await ConflictRepo(s).confirm(u.id, conflict_id, body.accepted_claim_id)
    await s.commit()
    return ConflictConfirmOut(
        conflict=_out(conflict),
        inbox_item=InboxOut.model_validate(inbox_item, from_attributes=True),
    )
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd research-kit/backend
pytest tests/test_conflict_confirm.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add research-kit/backend/app/repos/conflicts.py research-kit/backend/app/schemas/conflicts.py research-kit/backend/app/routers/conflicts.py research-kit/backend/tests/test_conflict_confirm.py
git commit -m "feat(conflict): add confirm endpoint — verify accepted, delete rejected, add to inbox"
```

---

## Task 4: Update extension UI

**Files:**
- Modify: `research-kit/extension/src/shared/api.ts`
- Modify: `research-kit/extension/src/sidebar/state/slices/conflicts.ts`
- Modify: `research-kit/extension/src/sidebar/components/atoms/ConflictResolutionPanel.tsx`

- [ ] **Step 1: Add `confirmConflict` to `api.ts`**

In `research-kit/extension/src/shared/api.ts`, after `patchConflict`:

```ts
export async function confirmConflict(
  conflictId: string,
  acceptedClaimId: string,
): Promise<{ conflict: Conflict; inbox_item: InboxItem }> {
  return (await apiFetch(`/conflicts/${conflictId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ accepted_claim_id: acceptedClaimId }),
  })).json()
}
```

Make sure `InboxItem` is imported at the top of `api.ts`:

```ts
import type { Claim, ClaimPatch, Conflict, InboxItem, ResolutionPayload, ... } from './types'
```

(Add `InboxItem` to the existing import if not already there.)

- [ ] **Step 2: Add `confirmConflict` action to `conflicts.ts` slice**

In `research-kit/extension/src/sidebar/state/slices/conflicts.ts`, add `confirmConflict` to the interface:

```ts
export interface ConflictsSlice {
  conflicts: Slice<Conflict[]>
  loadConflicts(projectId: string): Promise<void>
  patchConflict(id: string, resolution: ResolutionPayload): Promise<void>
  confirmConflict(conflictId: string, acceptedClaimId: string): Promise<void>
}
```

Add the implementation in `createConflictsSlice`:

```ts
    async confirmConflict(conflictId, acceptedClaimId) {
      const { conflict, inbox_item } = await api.confirmConflict(conflictId, acceptedClaimId)
      set((s: any) => ({
        conflicts: {
          ...s.conflicts,
          data: s.conflicts.data.filter((c: any) => c.id !== conflict.id),
        },
        inbox: {
          ...s.inbox,
          data: [inbox_item, ...s.inbox.data],
        },
      }))
    },
```

- [ ] **Step 3: Rewrite `ConflictResolutionPanel.tsx`**

Replace the entire file `research-kit/extension/src/sidebar/components/atoms/ConflictResolutionPanel.tsx`:

```tsx
import { useState, useEffect } from 'react'
import type { Conflict } from '../../../shared/types'

interface Props {
  conflict: Conflict
  onConfirm(acceptedClaimId: string): Promise<void>
  onSuggest(): Promise<void>
}

function LightningIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

export function ConflictResolutionPanel({ conflict, onConfirm, onSuggest }: Props) {
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const suggestion = (() => {
    if (!conflict.resolution) return null
    try { return JSON.parse(conflict.resolution) } catch { return null }
  })()

  // Pre-select recommended side when suggestion arrives
  useEffect(() => {
    if (!suggestion || suggestion.kind !== 'suggestion') return
    if (suggestion.recommendation === 'side_a' && conflict.sides[0]) {
      setSelected(conflict.sides[0].claim_id)
    } else if (suggestion.recommendation === 'side_b' && conflict.sides[1]) {
      setSelected(conflict.sides[1].claim_id)
    }
  }, [conflict.resolution])

  return (
    <div
      className="overflow-hidden"
      style={{ border: '1px solid var(--rk-border-warm)', borderRadius: 12, boxShadow: 'var(--rk-shadow-sm)' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(37,99,235,0.06))', borderBottom: '1px solid var(--rk-border-warm)' }}
      >
        <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, background: 'var(--rk-brand-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LightningIcon />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--rk-text-brand)' }}>
          Conflict · {conflict.paper_title ?? conflict.group_key}
        </span>
      </div>

      {/* Radio-select sides */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        {conflict.sides.map((s, i) => {
          const isSelected = selected === s.claim_id
          return (
            <div
              key={s.claim_id}
              onClick={() => setSelected(s.claim_id)}
              style={{
                padding: '10px 12px',
                borderRight: i === 0 ? '1px solid var(--rk-border-warm)' : undefined,
                cursor: 'pointer',
                border: isSelected ? '2px solid var(--rk-brand)' : undefined,
                borderRadius: isSelected ? 4 : undefined,
                background: isSelected ? 'rgba(124,58,237,0.04)' : undefined,
                transition: 'background 0.15s',
              }}
            >
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--rk-brand)', marginBottom: 4 }}>
                {s.label}
              </div>
              <p style={{ fontSize: 11, color: 'var(--rk-text)', lineHeight: 1.5, marginBottom: 4 }}>
                {s.quote}
              </p>
              <div style={{
                width: 14, height: 14, borderRadius: '50%',
                border: isSelected ? '4px solid var(--rk-brand)' : '2px solid var(--rk-border-warm)',
                background: isSelected ? 'white' : 'transparent',
                transition: 'border 0.15s',
              }} />
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--rk-border-warm)', background: 'var(--rk-surface-warm)' }}>
        {suggestion?.kind === 'suggestion' && (
          <div className="mb-2">
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rk-text-brand)' }}>AI: </span>
            <span style={{ fontSize: 11, color: 'var(--rk-text-2)' }}>{suggestion.rationale}</span>
            {suggestion.synthesis && (
              <p style={{ fontSize: 11, color: 'var(--rk-text-3)', marginTop: 2 }}>{suggestion.synthesis}</p>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          {!suggestion && (
            <button
              disabled={busy}
              onClick={async () => { setBusy(true); try { await onSuggest() } finally { setBusy(false) } }}
              style={{ fontSize: 10, padding: '4px 12px', background: 'white', color: 'var(--rk-brand)', border: '1px solid var(--rk-border-warm)', borderRadius: 99, fontWeight: 600, opacity: busy ? 0.5 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}
            >
              ✦ Get AI Suggestion
            </button>
          )}
          <div className="flex-1" />
          <button
            disabled={!selected || busy}
            onClick={async () => {
              if (!selected) return
              setBusy(true)
              try { await onConfirm(selected) } finally { setBusy(false) }
            }}
            style={{
              fontSize: 10, padding: '4px 14px', borderRadius: 99, border: 'none', fontWeight: 600,
              background: selected && !busy ? 'var(--rk-brand-gradient)' : 'var(--rk-border-warm)',
              color: selected && !busy ? 'white' : 'var(--rk-text-3)',
              cursor: selected && !busy ? 'pointer' : 'not-allowed',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Confirming…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update `ConflictsTab.tsx` to use new props**

In `research-kit/extension/src/sidebar/components/tabs/ConflictsTab.tsx`, update the `Props` interface and component:

```tsx
import { ConflictResolutionPanel } from '../atoms/ConflictResolutionPanel'
import type { Conflict } from '../../../shared/types'

interface Props {
  conflicts: Conflict[]
  onConfirm: (conflictId: string, acceptedClaimId: string) => Promise<void>
  onSuggest: (c: Conflict) => Promise<void>
}

export function ConflictsTab({ conflicts, onConfirm, onSuggest }: Props) {
  return (
    <div className="flex flex-col gap-2 p-2 overflow-y-auto h-full">
      {conflicts.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(37,99,235,0.12))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rk-brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rk-text-brand)' }}>No conflicts</p>
          <p style={{ fontSize: 12, color: 'var(--rk-text-3)', lineHeight: 1.5 }}>
            Conflicting claims from different sources will appear here.
          </p>
        </div>
      )}
      {conflicts.map(c => (
        <ConflictResolutionPanel
          key={c.id}
          conflict={c}
          onConfirm={acceptedClaimId => onConfirm(c.id, acceptedClaimId)}
          onSuggest={() => onSuggest(c)}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Update `App.tsx` to wire new props**

In `research-kit/extension/src/sidebar/App.tsx`, replace `handleResolveConflict`:

```ts
  const handleConfirmConflict = async (conflictId: string, acceptedClaimId: string) => {
    await confirmConflict(conflictId, acceptedClaimId)
    showToast('Claim added to inbox', 'success')
  }
```

Add `confirmConflict` to the store destructure:

```ts
    conflicts,
    confirmConflict,
```

Update the `<ConflictsTab>` usage:

```tsx
{tab === 'conflicts' && (
  <ConflictsTab
    conflicts={conflicts.data}
    onConfirm={handleConfirmConflict}
    onSuggest={handleSuggestConflict}
  />
)}
```

- [ ] **Step 6: Build extension to verify no TypeScript errors**

```bash
cd research-kit/extension
npm run build
```

Expected: build succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/shared/api.ts research-kit/extension/src/sidebar/state/slices/conflicts.ts research-kit/extension/src/sidebar/components/atoms/ConflictResolutionPanel.tsx research-kit/extension/src/sidebar/components/tabs/ConflictsTab.tsx research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(conflict): radio-select sides + confirm flow + suggestion highlight"
```

---

## Self-Review

**Spec coverage:**
- ✅ Auto-detect conflicts after PATCH claim (verified/partial) — Task 1
- ✅ Same-paper detection via DOI with paper_title fallback — Task 1 Step 4
- ✅ Duplicate guard (no duplicate conflicts for same pair) — Task 1 Step 4 + test
- ✅ Fire-and-forget (PATCH responds immediately) — Task 1 Step 5
- ✅ Rewrite CONFLICT LLM prompt with `recommendation`, `rationale`, `synthesis`, `sides_analysis` — Task 2
- ✅ Auto-save suggestion back to `conflict.resolution` — Task 2 Step 1
- ✅ `POST /v1/conflicts/:id/confirm` endpoint — Task 3
- ✅ Confirm: verify accepted claim, delete rejected, add to inbox, mark resolved — Task 3 Step 3
- ✅ Radio-select sides in UI — Task 4 Step 3
- ✅ Pre-select recommended side from AI suggestion — Task 4 Step 3 (`useEffect`)
- ✅ Confirm button disabled until one side selected — Task 4 Step 3
- ✅ Show `rationale` + `synthesis` from suggestion — Task 4 Step 3
- ✅ Remove conflict from store + add inbox_item after confirm — Task 4 Step 2
- ✅ Toast "Claim added to inbox" — Task 4 Step 5

**Placeholder scan:** No TBD/TODO/vague steps. All code blocks complete. ✅

**Type consistency:**
- `onConfirm(acceptedClaimId: string)` in `ConflictResolutionPanel` → `onConfirm(conflictId, acceptedClaimId)` in `ConflictsTab` → `handleConfirmConflict(conflictId, acceptedClaimId)` in `App.tsx` → `confirmConflict(conflictId, acceptedClaimId)` in slice ✅
- `ConflictConfirmOut.conflict: ConflictOut`, `ConflictConfirmOut.inbox_item: InboxOut` — matches `{ conflict: Conflict; inbox_item: InboxItem }` in TS ✅
- `suggestion.recommendation: "side_a" | "side_b" | "neither"` — matches schema enum + `useEffect` logic ✅
