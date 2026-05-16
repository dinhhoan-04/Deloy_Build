# Conflict Detection Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make background conflict detection visible to the user via a `ConflictsTab` header that shows "Checking N claims…" while detection is in flight and "Last checked X ago" once complete, backed by a per-claim `conflicts_checked_at` timestamp.

**Architecture:** Backend adds a nullable `conflicts_checked_at` column on `claims`, set by `_detect_conflicts` at each successful exit branch; a new `GET /v1/conflicts/check-status` endpoint reports `{last_checked_at, pending_count}` for the project. Frontend adds a `ConflictsCheckHeader` plus a polling hook that fetches the endpoint every 3s while the tab is active and `pending_count > 0`, with an optimistic bump when the user PATCHes a claim to verified/partial.

**Tech Stack:** Python/FastAPI/SQLAlchemy async (backend), Alembic (migration), TypeScript/React/Zustand (extension), pytest + vitest + React Testing Library

**Spec:** `docs/superpowers/specs/2026-05-16-conflict-detection-visibility-design.md`

---

## File Map

| File | Change |
|---|---|
| `research-kit/shared/rk_shared/models.py` | Add `conflicts_checked_at` field to `Claim` |
| `research-kit/backend/alembic/versions/0007_claim_conflicts_checked_at.py` | New migration: add nullable column |
| `research-kit/backend/app/routers/claims.py` | `_detect_conflicts` sets timestamp at success branches |
| `research-kit/backend/app/repos/conflicts.py` | Add `ConflictRepo.check_status()` method |
| `research-kit/backend/app/schemas/conflicts.py` | Add `ConflictCheckStatusOut` schema |
| `research-kit/backend/app/routers/conflicts.py` | Add `GET /v1/conflicts/check-status` route |
| `research-kit/backend/tests/test_conflict_detect.py` | Tests for timestamp set/leave-null behavior |
| `research-kit/backend/tests/test_conflicts.py` | Tests for check-status endpoint & repo |
| `research-kit/extension/src/shared/types.ts` | Add `ConflictCheckStatus` type |
| `research-kit/extension/src/shared/api.ts` | Add `getConflictCheckStatus()` |
| `research-kit/extension/src/sidebar/state/slices/conflicts.ts` | Add `conflictCheckStatus` slice + actions |
| `research-kit/extension/src/sidebar/hooks/useConflictCheckPolling.ts` | New polling hook |
| `research-kit/extension/src/sidebar/components/atoms/ConflictsCheckHeader.tsx` | New header component |
| `research-kit/extension/src/sidebar/components/tabs/ConflictsTab.tsx` | Integrate header + hook |
| `research-kit/extension/src/sidebar/components/tabs/ConflictsTab.test.tsx` | Header render tests |
| `research-kit/extension/src/sidebar/App.tsx` | Optimistic bump after PATCH verified/partial |

---

## Task 1: Add `conflicts_checked_at` column

**Files:**
- Modify: `research-kit/shared/rk_shared/models.py`
- Create: `research-kit/backend/alembic/versions/0007_claim_conflicts_checked_at.py`

- [ ] **Step 1: Add field to `Claim` model**

In `research-kit/shared/rk_shared/models.py`, inside the `Claim` class, add the field next to `updated_at`:

```python
    conflicts_checked_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=False), nullable=True)
```

(Use `TIMESTAMP(timezone=False)` to match the existing naive-datetime convention used elsewhere in the model — `_detect_conflicts` writes `datetime.now(timezone.utc).replace(tzinfo=None)`.)

- [ ] **Step 2: Create the migration**

Create `research-kit/backend/alembic/versions/0007_claim_conflicts_checked_at.py`:

```python
"""add conflicts_checked_at to claims

Revision ID: 0007_claim_conflicts_checked_at
Revises: 0006_conflict_resolved
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0007_claim_conflicts_checked_at"
down_revision = "0006_conflict_resolved"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "claims",
        sa.Column("conflicts_checked_at", sa.TIMESTAMP(timezone=False), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("claims", "conflicts_checked_at")
```

- [ ] **Step 3: Run the migration test suite**

Run: `cd research-kit/backend && pytest tests/test_migrations.py -v`
Expected: PASS (migrations 0001 → 0007 run cleanly up and down)

- [ ] **Step 4: Commit**

```bash
git add research-kit/shared/rk_shared/models.py research-kit/backend/alembic/versions/0007_claim_conflicts_checked_at.py
git commit -m "feat(claims): add conflicts_checked_at column"
```

---

## Task 2: `_detect_conflicts` sets timestamp on success branches

**Files:**
- Modify: `research-kit/backend/app/routers/claims.py`
- Modify: `research-kit/backend/tests/test_conflict_detect.py`

- [ ] **Step 1: Write the failing test — happy path sets timestamp**

Append to `research-kit/backend/tests/test_conflict_detect.py`:

```python
@pytest.mark.asyncio
async def test_detect_conflicts_sets_checked_at_on_llm_success(async_session):
    """After a successful LLM call, the new claim's conflicts_checked_at is set."""
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id))
    await async_session.flush()

    project = Project(user_id=user_id, name="TS-Happy")
    async_session.add(project); await async_session.flush()

    doi = "10.42/happy"
    claim_a = Claim(user_id=user_id, project_id=project.id,
                    text="A", doi=doi, paper_title="P", site="pubmed",
                    status=ClaimStatus.VERIFIED.value, quote="qa")
    claim_b = Claim(user_id=user_id, project_id=project.id,
                    text="B", doi=doi, paper_title="P", site="pubmed",
                    status=ClaimStatus.PENDING.value, quote="qb")
    async_session.add_all([claim_a, claim_b]); await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradictions": []})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, claim_b.id, project.id)

    refreshed = (await async_session.execute(
        select(Claim).where(Claim.id == claim_b.id)
    )).scalar_one()
    assert refreshed.conflicts_checked_at is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd research-kit/backend && pytest tests/test_conflict_detect.py::test_detect_conflicts_sets_checked_at_on_llm_success -v`
Expected: FAIL — `conflicts_checked_at` is None.

- [ ] **Step 3: Add the `_mark_checked` helper and call it in `_detect_conflicts`**

In `research-kit/backend/app/routers/claims.py`:

1. Add `update` to the sqlalchemy import (top of file):

```python
from sqlalchemy import select, update
```

2. Add `datetime`/`timezone` to the imports if not already there:

```python
from datetime import datetime, timezone
```

3. Inside `_detect_conflicts`, add this nested helper right after the `if not new_claim: return` check (around current line 70):

```python
    async def _mark_checked() -> None:
        await s.execute(
            update(Claim)
            .where(Claim.id == new_claim_id, Claim.user_id == user_id)
            .values(conflicts_checked_at=datetime.now(timezone.utc).replace(tzinfo=None))
        )
        await s.commit()
```

4. Call `await _mark_checked()` at each success-exit point. The current function (claims.py:62-137) has these branches — replace each return/end with the marked + return pattern:

   - **No DOI and no paper_title** (currently around line 81-82): replace `return` with `await _mark_checked(); return`.
   - **No candidates** (after `if not all_candidates: return`): replace with `await _mark_checked(); return`.
   - **All pairs already conflicted** (after the `candidates = [...]; if not candidates: return`): replace with `await _mark_checked(); return`.
   - **End of function** (after the final `await s.commit()`): add `await _mark_checked()` before the implicit return.

   **Do NOT** call `_mark_checked` in the `if not provider: return` branch or in the `except Exception` block — these must leave `conflicts_checked_at` NULL per spec.

- [ ] **Step 4: Run the happy-path test**

Run: `cd research-kit/backend && pytest tests/test_conflict_detect.py::test_detect_conflicts_sets_checked_at_on_llm_success -v`
Expected: PASS

- [ ] **Step 5: Add tests for early-return branches**

Append to `research-kit/backend/tests/test_conflict_detect.py`:

```python
@pytest.mark.asyncio
async def test_detect_conflicts_sets_checked_at_when_no_doi_no_title(async_session):
    """No DOI and no paper_title -> still mark as checked (nothing to group on)."""
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id)); await async_session.flush()
    project = Project(user_id=user_id, name="NoMeta")
    async_session.add(project); await async_session.flush()

    c = Claim(user_id=user_id, project_id=project.id,
              text="orphan", doi=None, paper_title=None, site="pubmed",
              status=ClaimStatus.PENDING.value, quote="q")
    async_session.add(c); await async_session.flush()

    with patch("app.routers.claims._make_provider", return_value=AsyncMock()):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, c.id, project.id)

    refreshed = (await async_session.execute(select(Claim).where(Claim.id == c.id))).scalar_one()
    assert refreshed.conflicts_checked_at is not None


@pytest.mark.asyncio
async def test_detect_conflicts_sets_checked_at_when_no_candidates(async_session):
    """When no same-paper candidates exist, mark as checked anyway."""
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id)); await async_session.flush()
    project = Project(user_id=user_id, name="Lonely")
    async_session.add(project); await async_session.flush()

    c = Claim(user_id=user_id, project_id=project.id,
              text="alone", doi="10.1/alone", paper_title="P", site="pubmed",
              status=ClaimStatus.PENDING.value, quote="q")
    async_session.add(c); await async_session.flush()

    with patch("app.routers.claims._make_provider", return_value=AsyncMock()):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, c.id, project.id)

    refreshed = (await async_session.execute(select(Claim).where(Claim.id == c.id))).scalar_one()
    assert refreshed.conflicts_checked_at is not None


@pytest.mark.asyncio
async def test_detect_conflicts_sets_checked_at_when_all_pairs_already_exist(async_session):
    """When every candidate is already conflict-paired with the new claim, still mark checked."""
    from rk_shared.models import Claim, Project, Conflict
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id)); await async_session.flush()
    project = Project(user_id=user_id, name="AllPaired")
    async_session.add(project); await async_session.flush()

    doi = "10.1/paired"
    new_claim = Claim(user_id=user_id, project_id=project.id,
                      text="new", doi=doi, paper_title="P", site="pubmed",
                      status=ClaimStatus.PENDING.value, quote="qn")
    cand = Claim(user_id=user_id, project_id=project.id,
                 text="cand", doi=doi, paper_title="P", site="pubmed",
                 status=ClaimStatus.VERIFIED.value, quote="qc")
    async_session.add_all([new_claim, cand]); await async_session.flush()

    existing = Conflict(
        user_id=user_id, project_id=project.id, group_key=doi,
        doi=doi, paper_title="P",
        sides=[{"claim_id": str(new_claim.id), "label": "A", "quote": "qn"},
               {"claim_id": str(cand.id), "label": "B", "quote": "qc"}],
    )
    async_session.add(existing); await async_session.flush()

    with patch("app.routers.claims._make_provider", return_value=AsyncMock()):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, new_claim.id, project.id)

    refreshed = (await async_session.execute(
        select(Claim).where(Claim.id == new_claim.id))).scalar_one()
    assert refreshed.conflicts_checked_at is not None


@pytest.mark.asyncio
async def test_detect_conflicts_leaves_null_when_no_provider(async_session):
    """No provider configured -> leave conflicts_checked_at NULL."""
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id)); await async_session.flush()
    project = Project(user_id=user_id, name="NoProv")
    async_session.add(project); await async_session.flush()

    doi = "10.1/noprov"
    a = Claim(user_id=user_id, project_id=project.id,
              text="A", doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.VERIFIED.value, quote="qa")
    b = Claim(user_id=user_id, project_id=project.id,
              text="B", doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.PENDING.value, quote="qb")
    async_session.add_all([a, b]); await async_session.flush()

    with patch("app.routers.claims._make_provider", return_value=None):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, b.id, project.id)

    refreshed = (await async_session.execute(select(Claim).where(Claim.id == b.id))).scalar_one()
    assert refreshed.conflicts_checked_at is None


@pytest.mark.asyncio
async def test_detect_conflicts_leaves_null_when_llm_raises(async_session):
    """LLM exception -> leave conflicts_checked_at NULL."""
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id)); await async_session.flush()
    project = Project(user_id=user_id, name="Raise")
    async_session.add(project); await async_session.flush()

    doi = "10.1/raise"
    a = Claim(user_id=user_id, project_id=project.id,
              text="A", doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.VERIFIED.value, quote="qa")
    b = Claim(user_id=user_id, project_id=project.id,
              text="B", doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.PENDING.value, quote="qb")
    async_session.add_all([a, b]); await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(side_effect=RuntimeError("boom"))

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, b.id, project.id)

    refreshed = (await async_session.execute(select(Claim).where(Claim.id == b.id))).scalar_one()
    assert refreshed.conflicts_checked_at is None
```

- [ ] **Step 6: Run the full test file**

Run: `cd research-kit/backend && pytest tests/test_conflict_detect.py -v`
Expected: PASS (all old tests still pass, all five new tests pass).

- [ ] **Step 7: Commit**

```bash
git add research-kit/backend/app/routers/claims.py research-kit/backend/tests/test_conflict_detect.py
git commit -m "feat(conflicts): set conflicts_checked_at on detection success branches"
```

---

## Task 3: `ConflictRepo.check_status` method

**Files:**
- Modify: `research-kit/backend/app/repos/conflicts.py`
- Modify: `research-kit/backend/tests/test_conflicts.py`

- [ ] **Step 1: Write the failing test**

Append to `research-kit/backend/tests/test_conflicts.py`:

```python
@pytest.mark.asyncio
async def test_check_status_returns_max_timestamp_and_pending_count(async_session):
    from rk_shared.models import Project, Claim, User
    from app.repos.conflicts import ConflictRepo
    from datetime import datetime, timedelta, timezone
    from uuid import uuid4

    uid = uuid4()
    async_session.add(User(id=uid, google_sub=str(uid), email="t@e.com"))
    await async_session.flush()
    p = Project(user_id=uid, name="P"); async_session.add(p); await async_session.flush()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    older = now - timedelta(minutes=5)

    # 1 verified, checked recently
    async_session.add(Claim(user_id=uid, project_id=p.id, text="x1", site="pubmed",
                            status="verified", conflicts_checked_at=now))
    # 1 verified, checked earlier
    async_session.add(Claim(user_id=uid, project_id=p.id, text="x2", site="pubmed",
                            status="verified", conflicts_checked_at=older))
    # 1 verified, NOT yet checked -> pending
    async_session.add(Claim(user_id=uid, project_id=p.id, text="x3", site="pubmed",
                            status="verified", conflicts_checked_at=None))
    # 1 partial, NOT yet checked -> pending
    async_session.add(Claim(user_id=uid, project_id=p.id, text="x4", site="pubmed",
                            status="partial", conflicts_checked_at=None))
    # 1 pending status (NOT eligible for pending check) -> ignored
    async_session.add(Claim(user_id=uid, project_id=p.id, text="x5", site="pubmed",
                            status="pending", conflicts_checked_at=None))
    await async_session.flush()

    last_at, pending = await ConflictRepo(async_session).check_status(uid, p.id)
    assert last_at == now
    assert pending == 2


@pytest.mark.asyncio
async def test_check_status_empty_project(async_session):
    from rk_shared.models import Project, User
    from app.repos.conflicts import ConflictRepo
    from uuid import uuid4

    uid = uuid4()
    async_session.add(User(id=uid, google_sub=str(uid), email="t@e.com"))
    await async_session.flush()
    p = Project(user_id=uid, name="Empty"); async_session.add(p); await async_session.flush()

    last_at, pending = await ConflictRepo(async_session).check_status(uid, p.id)
    assert last_at is None
    assert pending == 0


@pytest.mark.asyncio
async def test_check_status_isolates_users_and_projects(async_session):
    from rk_shared.models import Project, Claim, User
    from app.repos.conflicts import ConflictRepo
    from datetime import datetime, timezone
    from uuid import uuid4

    u1, u2 = uuid4(), uuid4()
    async_session.add_all([
        User(id=u1, google_sub=str(u1), email="a@e.com"),
        User(id=u2, google_sub=str(u2), email="b@e.com"),
    ])
    await async_session.flush()
    p1a = Project(user_id=u1, name="P1A"); p1b = Project(user_id=u1, name="P1B")
    p2 = Project(user_id=u2, name="P2")
    async_session.add_all([p1a, p1b, p2]); await async_session.flush()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    async_session.add(Claim(user_id=u1, project_id=p1b.id, text="other-proj",
                            site="pubmed", status="verified", conflicts_checked_at=now))
    async_session.add(Claim(user_id=u2, project_id=p2.id, text="other-user",
                            site="pubmed", status="verified", conflicts_checked_at=now))
    await async_session.flush()

    last_at, pending = await ConflictRepo(async_session).check_status(u1, p1a.id)
    assert last_at is None
    assert pending == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd research-kit/backend && pytest tests/test_conflicts.py::test_check_status_returns_max_timestamp_and_pending_count -v`
Expected: FAIL — `ConflictRepo` has no `check_status` method.

- [ ] **Step 3: Implement the repo method**

In `research-kit/backend/app/repos/conflicts.py`:

1. Add imports at the top (alongside existing):

```python
from sqlalchemy import select, delete, func, case
```

2. Add `Claim` to the existing model import:

```python
from rk_shared.models import Claim, Conflict, InboxItem, Project
```

(`Claim` is already imported — verify and skip if so.)

3. Add this method to the `ConflictRepo` class:

```python
    async def check_status(self, user_id: UUID, project_id: UUID) -> tuple["datetime | None", int]:
        """Return (last_checked_at, pending_count) for the project's claims.

        last_checked_at = MAX(conflicts_checked_at) across all claims of this user
                          in this project (None if no claim has ever been checked).
        pending_count   = number of claims with status in (verified, partial) and
                          conflicts_checked_at IS NULL.
        """
        row = (await self.s.execute(
            select(
                func.max(Claim.conflicts_checked_at),
                func.count(
                    case(
                        (
                            (Claim.status.in_(["verified", "partial"]))
                            & (Claim.conflicts_checked_at.is_(None)),
                            1,
                        ),
                    )
                ),
            ).where(Claim.user_id == user_id, Claim.project_id == project_id)
        )).one()
        return row[0], int(row[1] or 0)
```

4. Add `from datetime import datetime` at the top if not already imported:

```python
from datetime import datetime, timezone
```

- [ ] **Step 4: Run repo tests**

Run: `cd research-kit/backend && pytest tests/test_conflicts.py -k check_status -v`
Expected: PASS (all three tests)

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app/repos/conflicts.py research-kit/backend/tests/test_conflicts.py
git commit -m "feat(conflicts): add ConflictRepo.check_status"
```

---

## Task 4: `GET /v1/conflicts/check-status` endpoint

**Files:**
- Modify: `research-kit/backend/app/schemas/conflicts.py`
- Modify: `research-kit/backend/app/routers/conflicts.py`
- Modify: `research-kit/backend/tests/test_conflicts.py`

- [ ] **Step 1: Write the failing endpoint test**

Append to `research-kit/backend/tests/test_conflicts.py`:

```python
@pytest.mark.asyncio
async def test_check_status_endpoint_reports_pending_and_last(client_dev_alice):
    """End-to-end: PATCH a claim to verified, then GET /check-status reports a recent
    last_checked_at OR pending_count >= 1 (race with background task is acceptable)."""
    r = await client_dev_alice.post("/v1/projects", json={"name": "CSE"})
    pid = r.json()["id"]

    # Empty project -> zeros
    r = await client_dev_alice.get("/v1/conflicts/check-status", params={"project_id": pid})
    assert r.status_code == 200
    body = r.json()
    assert body == {"last_checked_at": None, "pending_count": 0}

    # Add a verified claim directly (skip background); pending should be 1
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": "x", "site": "elicit", "doi": "10.1/x", "paper_title": "P"}]})
    cid = r.json()["created"][0]["id"]
    # PATCH bumps to verified but background task is fire-and-forget; we can't await it
    # in tests. So we just check the endpoint reports pending_count >= 1 OR last_checked_at set.
    await client_dev_alice.patch(f"/v1/claims/{cid}", json={"status": "verified"})

    r = await client_dev_alice.get("/v1/conflicts/check-status", params={"project_id": pid})
    assert r.status_code == 200
    body = r.json()
    # Either background ran (last_checked_at set, pending 0) or it didn't (pending 1).
    assert body["pending_count"] + (1 if body["last_checked_at"] else 0) >= 1


@pytest.mark.asyncio
async def test_check_status_endpoint_returns_zeros_for_other_users_project(
    client_dev_alice, client_dev_bob,
):
    """Bob asks about Alice's project -> safe zeros, no leak, no 404."""
    r = await client_dev_alice.post("/v1/projects", json={"name": "Private"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": "x", "site": "elicit"}]})

    r = await client_dev_bob.get("/v1/conflicts/check-status", params={"project_id": pid})
    assert r.status_code == 200
    assert r.json() == {"last_checked_at": None, "pending_count": 0}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd research-kit/backend && pytest tests/test_conflicts.py::test_check_status_endpoint_reports_pending_and_last -v`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Add the response schema**

In `research-kit/backend/app/schemas/conflicts.py`, add at the bottom:

```python
class ConflictCheckStatusOut(BaseModel):
    last_checked_at: datetime | None = None
    pending_count: int = 0
```

- [ ] **Step 4: Add the route**

In `research-kit/backend/app/routers/conflicts.py`:

1. Add import:

```python
from app.schemas.conflicts import (
    ConflictCheckStatusOut, ConflictConfirmIn, ConflictConfirmOut,
    ConflictIn, ConflictOut, ConflictPatch, ConflictSide,
)
```

(merge with existing schema import line)

2. Add this route **before** the `/{conflict_id}` routes (path ordering matters in FastAPI — static segments must come before dynamic ones):

```python
@router.get("/check-status", response_model=ConflictCheckStatusOut)
async def check_status(project_id: UUID = Query(...),
                       u: User = Depends(current_user),
                       s: AsyncSession = Depends(db)):
    last_at, pending = await ConflictRepo(s).check_status(u.id, project_id)
    return ConflictCheckStatusOut(last_checked_at=last_at, pending_count=pending)
```

- [ ] **Step 5: Run endpoint tests**

Run: `cd research-kit/backend && pytest tests/test_conflicts.py -k check_status -v`
Expected: PASS (both repo and endpoint tests).

- [ ] **Step 6: Commit**

```bash
git add research-kit/backend/app/schemas/conflicts.py research-kit/backend/app/routers/conflicts.py research-kit/backend/tests/test_conflicts.py
git commit -m "feat(conflicts): add GET /v1/conflicts/check-status endpoint"
```

---

## Task 5: Frontend types + API client

**Files:**
- Modify: `research-kit/extension/src/shared/types.ts`
- Modify: `research-kit/extension/src/shared/api.ts`
- Modify: `research-kit/extension/src/shared/api.test.ts`

- [ ] **Step 1: Add the type**

In `research-kit/extension/src/shared/types.ts`, append:

```typescript
export interface ConflictCheckStatus {
  last_checked_at: string | null
  pending_count: number
}
```

- [ ] **Step 2: Write the failing api test**

Append to `research-kit/extension/src/shared/api.test.ts`:

```typescript
import { getConflictCheckStatus } from './api'

describe('getConflictCheckStatus', () => {
  it('GETs /v1/conflicts/check-status with project_id and returns parsed body', async () => {
    const fakeBody = { last_checked_at: '2026-05-16T10:00:00Z', pending_count: 2 }
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => fakeBody,
    } as Response)

    const out = await getConflictCheckStatus('proj-1')
    expect(out).toEqual(fakeBody)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/conflicts/check-status?project_id=proj-1'),
      expect.any(Object),
    )
  })
})
```

(If `api.test.ts` already imports `vi`, `describe`, etc. at the top, do not duplicate.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd research-kit/extension && pnpm vitest run src/shared/api.test.ts -t getConflictCheckStatus`
Expected: FAIL — `getConflictCheckStatus` is not exported.

- [ ] **Step 4: Add the api function**

In `research-kit/extension/src/shared/api.ts`:

1. Add to the type imports:

```typescript
import type {
  Project, Claim, ClaimInput, ClaimPatch, InboxItem, Conflict,
  ConflictCheckStatus,
  ResolutionPayload, RunCreate, RunCreateResponse, Run, RunEvent, Draft,
} from './types'
```

2. Add the function in the `// Conflicts` section (after `listConflicts`):

```typescript
export async function getConflictCheckStatus(projectId: string): Promise<ConflictCheckStatus> {
  return (await apiFetch(`/conflicts/check-status?project_id=${projectId}`)).json()
}
```

- [ ] **Step 5: Run api test**

Run: `cd research-kit/extension && pnpm vitest run src/shared/api.test.ts -t getConflictCheckStatus`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/shared/types.ts research-kit/extension/src/shared/api.ts research-kit/extension/src/shared/api.test.ts
git commit -m "feat(extension): add getConflictCheckStatus API client"
```

---

## Task 6: Conflicts slice — `conflictCheckStatus` state + actions

**Files:**
- Modify: `research-kit/extension/src/sidebar/state/slices/conflicts.ts`
- Modify: `research-kit/extension/src/sidebar/state/useStore.test.ts`

- [ ] **Step 1: Write the failing slice test**

Append to `research-kit/extension/src/sidebar/state/useStore.test.ts`:

```typescript
describe('conflictCheckStatus', () => {
  it('loadConflictCheckStatus fetches and stores status', async () => {
    const spy = vi.spyOn(api, 'getConflictCheckStatus').mockResolvedValue({
      last_checked_at: '2026-05-16T10:00:00Z',
      pending_count: 3,
    })
    await useStore.getState().loadConflictCheckStatus('proj-1')
    const slice = useStore.getState().conflictCheckStatus
    expect(slice.data).toEqual({ last_checked_at: '2026-05-16T10:00:00Z', pending_count: 3 })
    expect(slice.status).toBe('ready')
    spy.mockRestore()
  })

  it('bumpPendingCheck increments pending_count', () => {
    useStore.setState({
      conflictCheckStatus: {
        data: { last_checked_at: null, pending_count: 0 },
        status: 'ready', lastFetched: Date.now(),
      },
    } as any)
    useStore.getState().bumpPendingCheck()
    expect(useStore.getState().conflictCheckStatus.data?.pending_count).toBe(1)
  })

  it('bumpPendingCheck is a no-op when no data loaded yet', () => {
    useStore.setState({
      conflictCheckStatus: { data: null, status: 'idle' },
    } as any)
    useStore.getState().bumpPendingCheck()
    expect(useStore.getState().conflictCheckStatus.data).toBe(null)
  })
})
```

(Imports at top of file: ensure `import * as api from '../../shared/api'` exists; add it if not, matching the existing slice test pattern.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd research-kit/extension && pnpm vitest run src/sidebar/state/useStore.test.ts -t conflictCheckStatus`
Expected: FAIL — `loadConflictCheckStatus` / `bumpPendingCheck` undefined.

- [ ] **Step 3: Extend the conflicts slice**

Replace the contents of `research-kit/extension/src/sidebar/state/slices/conflicts.ts`:

```typescript
import * as api from '../../../shared/api'
import type { Conflict, ConflictCheckStatus, ResolutionPayload } from '../../../shared/types'
import { idle } from './_slice'
import type { Slice } from './_slice'

export interface ConflictsSlice {
  conflicts: Slice<Conflict[]>
  conflictCheckStatus: Slice<ConflictCheckStatus | null>
  loadConflicts(projectId: string): Promise<void>
  loadConflictCheckStatus(projectId: string): Promise<void>
  bumpPendingCheck(): void
  patchConflict(id: string, resolution: ResolutionPayload): Promise<void>
  confirmConflict(conflictId: string, acceptedClaimId: string): Promise<void>
}

export function createConflictsSlice(set: any, get: any): ConflictsSlice {
  return {
    conflicts: idle<Conflict[]>([]),
    conflictCheckStatus: idle<ConflictCheckStatus | null>(null),
    async loadConflicts(projectId) {
      set((s: any) => ({ conflicts: { ...s.conflicts, status: 'loading' } }))
      try {
        const data = await api.listConflicts(projectId)
        set({ conflicts: { data, status: 'ready', lastFetched: Date.now() } })
      } catch (e: any) {
        set((s: any) => ({ conflicts: { ...s.conflicts, status: 'error', error: e.message } }))
      }
    },
    async loadConflictCheckStatus(projectId) {
      try {
        const data = await api.getConflictCheckStatus(projectId)
        set({ conflictCheckStatus: { data, status: 'ready', lastFetched: Date.now() } })
      } catch (e: any) {
        // Polling errors are silent per spec — keep last known state.
        set((s: any) => ({ conflictCheckStatus: { ...s.conflictCheckStatus, status: 'error', error: e.message } }))
      }
    },
    bumpPendingCheck() {
      const s = get().conflictCheckStatus
      if (!s.data) return
      set({
        conflictCheckStatus: {
          ...s,
          data: { ...s.data, pending_count: s.data.pending_count + 1 },
        },
      })
    },
    async patchConflict(id, resolution) {
      await api.patchConflict(id, resolution)
      const pid = get().currentProjectId
      if (pid) await get().loadConflicts(pid)
    },
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
  }
}
```

- [ ] **Step 4: Run slice tests**

Run: `cd research-kit/extension && pnpm vitest run src/sidebar/state/useStore.test.ts -t conflictCheckStatus`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/state/slices/conflicts.ts research-kit/extension/src/sidebar/state/useStore.test.ts
git commit -m "feat(extension): add conflictCheckStatus slice with bump action"
```

---

## Task 7: `useConflictCheckPolling` hook

**Files:**
- Create: `research-kit/extension/src/sidebar/hooks/useConflictCheckPolling.ts`
- Create: `research-kit/extension/src/sidebar/hooks/useConflictCheckPolling.test.tsx`

- [ ] **Step 1: Write the failing hook test**

Create `research-kit/extension/src/sidebar/hooks/useConflictCheckPolling.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useConflictCheckPolling } from './useConflictCheckPolling'
import { useStore } from '../state/useStore'
import * as api from '../../shared/api'

describe('useConflictCheckPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStore.setState({
      conflictCheckStatus: { data: null, status: 'idle' } as any,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fetches immediately on mount when active', async () => {
    const spy = vi.spyOn(api, 'getConflictCheckStatus').mockResolvedValue({
      last_checked_at: null, pending_count: 0,
    })
    renderHook(() => useConflictCheckPolling('proj-1', true))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  })

  it('does not fetch when inactive', () => {
    const spy = vi.spyOn(api, 'getConflictCheckStatus').mockResolvedValue({
      last_checked_at: null, pending_count: 0,
    })
    renderHook(() => useConflictCheckPolling('proj-1', false))
    expect(spy).not.toHaveBeenCalled()
  })

  it('polls every 3s while pending_count > 0', async () => {
    const spy = vi.spyOn(api, 'getConflictCheckStatus').mockResolvedValue({
      last_checked_at: null, pending_count: 2,
    })
    renderHook(() => useConflictCheckPolling('proj-1', true))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    await act(async () => { vi.advanceTimersByTime(3000) })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    await act(async () => { vi.advanceTimersByTime(3000) })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3))
  })

  it('stops polling and calls loadConflicts when pending transitions to 0', async () => {
    let pending = 1
    vi.spyOn(api, 'getConflictCheckStatus').mockImplementation(async () => ({
      last_checked_at: '2026-05-16T10:00:00Z', pending_count: pending,
    }))
    const loadSpy = vi.spyOn(useStore.getState(), 'loadConflicts').mockResolvedValue()

    renderHook(() => useConflictCheckPolling('proj-1', true))
    await waitFor(() => expect(useStore.getState().conflictCheckStatus.data?.pending_count).toBe(1))

    pending = 0
    await act(async () => { vi.advanceTimersByTime(3000) })
    await waitFor(() => expect(useStore.getState().conflictCheckStatus.data?.pending_count).toBe(0))
    await waitFor(() => expect(loadSpy).toHaveBeenCalledWith('proj-1'))

    // Next tick — no further fetches
    const callsBefore = (api.getConflictCheckStatus as any).mock.calls.length
    await act(async () => { vi.advanceTimersByTime(6000) })
    expect((api.getConflictCheckStatus as any).mock.calls.length).toBe(callsBefore)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd research-kit/extension && pnpm vitest run src/sidebar/hooks/useConflictCheckPolling.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `research-kit/extension/src/sidebar/hooks/useConflictCheckPolling.ts`:

```typescript
import { useEffect, useRef } from 'react'
import { useStore } from '../state/useStore'

const POLL_INTERVAL_MS = 3000

/**
 * Polls GET /v1/conflicts/check-status while `isActive` is true. Stops polling
 * the moment `pending_count` reaches 0, and triggers one `loadConflicts` refresh
 * at the > 0 → 0 transition so newly-created conflicts surface in the list.
 */
export function useConflictCheckPolling(projectId: string | null, isActive: boolean) {
  const loadStatus = useStore(s => s.loadConflictCheckStatus)
  const loadConflicts = useStore(s => s.loadConflicts)
  const prevPendingRef = useRef<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!projectId || !isActive) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      prevPendingRef.current = null
      return
    }

    let cancelled = false

    const tick = async () => {
      await loadStatus(projectId)
      if (cancelled) return
      const next = useStore.getState().conflictCheckStatus.data?.pending_count ?? 0
      const prev = prevPendingRef.current
      if (prev !== null && prev > 0 && next === 0) {
        await loadConflicts(projectId)
      }
      prevPendingRef.current = next
      if (next > 0 && intervalRef.current === null) {
        intervalRef.current = setInterval(tick, POLL_INTERVAL_MS)
      } else if (next === 0 && intervalRef.current !== null) {
        clearInterval(intervalRef.current); intervalRef.current = null
      }
    }

    tick()

    return () => {
      cancelled = true
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    }
  }, [projectId, isActive, loadStatus, loadConflicts])
}
```

- [ ] **Step 4: Run hook tests**

Run: `cd research-kit/extension && pnpm vitest run src/sidebar/hooks/useConflictCheckPolling.test.tsx`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/hooks/useConflictCheckPolling.ts research-kit/extension/src/sidebar/hooks/useConflictCheckPolling.test.tsx
git commit -m "feat(extension): add useConflictCheckPolling hook"
```

---

## Task 8: `ConflictsCheckHeader` component

**Files:**
- Create: `research-kit/extension/src/sidebar/components/atoms/ConflictsCheckHeader.tsx`
- Create: `research-kit/extension/src/sidebar/components/atoms/ConflictsCheckHeader.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `research-kit/extension/src/sidebar/components/atoms/ConflictsCheckHeader.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConflictsCheckHeader } from './ConflictsCheckHeader'

describe('ConflictsCheckHeader', () => {
  it('renders nothing when pending=0 and last_checked_at=null', () => {
    const { container } = render(
      <ConflictsCheckHeader status={{ last_checked_at: null, pending_count: 0 }} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders pending message when pending_count > 0', () => {
    render(
      <ConflictsCheckHeader status={{ last_checked_at: null, pending_count: 2 }} />,
    )
    expect(screen.getByText(/checking 2 claims/i)).toBeInTheDocument()
  })

  it('uses singular form when pending_count === 1', () => {
    render(
      <ConflictsCheckHeader status={{ last_checked_at: null, pending_count: 1 }} />,
    )
    expect(screen.getByText(/checking 1 claim\b/i)).toBeInTheDocument()
  })

  it('renders last-checked relative time when pending=0 and timestamp present', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    render(
      <ConflictsCheckHeader status={{ last_checked_at: fiveMinAgo, pending_count: 0 }} />,
    )
    expect(screen.getByText(/last checked.*ago/i)).toBeInTheDocument()
  })

  it('renders nothing when status is null', () => {
    const { container } = render(<ConflictsCheckHeader status={null} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd research-kit/extension && pnpm vitest run src/sidebar/components/atoms/ConflictsCheckHeader.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `research-kit/extension/src/sidebar/components/atoms/ConflictsCheckHeader.tsx`:

```typescript
import type { ConflictCheckStatus } from '../../../shared/types'

interface Props {
  status: ConflictCheckStatus | null
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${Math.max(sec, 1)}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} h ago`
  const day = Math.floor(hr / 24)
  return `${day} d ago`
}

export function ConflictsCheckHeader({ status }: Props) {
  if (!status) return null
  const { last_checked_at, pending_count } = status
  if (pending_count === 0 && !last_checked_at) return null

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 12px',
    borderBottom: '1px solid var(--rk-border-1, rgba(0,0,0,0.08))',
    fontSize: 12, color: 'var(--rk-text-3, #6b7280)',
  }

  if (pending_count > 0) {
    return (
      <div style={rowStyle} role="status" aria-live="polite">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
             style={{ animation: 'rk-spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span>Checking {pending_count} claim{pending_count === 1 ? '' : 's'}…</span>
        <style>{`@keyframes rk-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div style={rowStyle}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span>Last checked {relativeTime(last_checked_at!)}</span>
    </div>
  )
}
```

- [ ] **Step 4: Run component tests**

Run: `cd research-kit/extension && pnpm vitest run src/sidebar/components/atoms/ConflictsCheckHeader.test.tsx`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/ConflictsCheckHeader.tsx research-kit/extension/src/sidebar/components/atoms/ConflictsCheckHeader.test.tsx
git commit -m "feat(extension): add ConflictsCheckHeader component"
```

---

## Task 9: Integrate header + polling in `ConflictsTab`

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/ConflictsTab.tsx`
- Modify: `research-kit/extension/src/sidebar/components/tabs/ConflictsTab.test.tsx`

- [ ] **Step 1: Update the existing tests to render with provider**

The existing `ConflictsTab.test.tsx` renders `ConflictsTab` standalone. Since the integrated component now reads from `useStore`, update test imports and add a new test:

Replace the contents of `research-kit/extension/src/sidebar/components/tabs/ConflictsTab.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConflictsTab } from './ConflictsTab'
import { useStore } from '../../state/useStore'
import type { Conflict } from '../../../shared/types'

const fakeConflict = (id: string, paper_title: string = 'Paper A', doi: string | null = '10.1/a'): Conflict => ({
  id, doi, group_key: doi || paper_title, paper_title,
  flagged_at: new Date().toISOString(), project_id: 'p_default',
  resolution: null,
  sides: [
    { claim_id: `${id}_elicit`, label: 'elicit', quote: `Claim ${id} from Elicit` },
    { claim_id: `${id}_scispace`, label: 'scispace', quote: `Claim ${id} from SciSpace` },
  ],
})

describe('ConflictsTab', () => {
  beforeEach(() => {
    useStore.setState({
      conflictCheckStatus: { data: null, status: 'idle' } as any,
    })
  })

  it('renders empty state when no conflicts', () => {
    render(<ConflictsTab conflicts={[]} onConfirm={vi.fn()} onSuggest={vi.fn()} />)
    expect(screen.getByText(/no conflicts/i)).toBeInTheDocument()
  })

  it('renders conflict items', () => {
    render(<ConflictsTab conflicts={[fakeConflict('conf1')]} onConfirm={vi.fn()} onSuggest={vi.fn()} />)
    expect(screen.getByText(/paper a/i)).toBeInTheDocument()
  })

  it('shows both sides of conflict', () => {
    render(<ConflictsTab conflicts={[fakeConflict('conf1')]} onConfirm={vi.fn()} onSuggest={vi.fn()} />)
    expect(screen.getAllByText(/elicit|scispace/i).length).toBeGreaterThanOrEqual(2)
  })

  it('calls onConfirm when Confirm clicked after selecting a side', () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    render(<ConflictsTab conflicts={[fakeConflict('conf1')]} onConfirm={fn} onSuggest={vi.fn()} />)
    fireEvent.click(screen.getByText('Claim conf1 from Elicit'))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(fn).toHaveBeenCalledWith('conf1', 'conf1_elicit')
  })

  it('renders ConflictsCheckHeader pending state when pending_count > 0', () => {
    useStore.setState({
      conflictCheckStatus: {
        data: { last_checked_at: null, pending_count: 2 },
        status: 'ready', lastFetched: Date.now(),
      } as any,
    })
    render(<ConflictsTab conflicts={[]} onConfirm={vi.fn()} onSuggest={vi.fn()} />)
    expect(screen.getByText(/checking 2 claims/i)).toBeInTheDocument()
  })

  it('renders ConflictsCheckHeader last-checked when pending=0 and timestamp set', () => {
    useStore.setState({
      conflictCheckStatus: {
        data: { last_checked_at: new Date(Date.now() - 60_000).toISOString(), pending_count: 0 },
        status: 'ready', lastFetched: Date.now(),
      } as any,
    })
    render(<ConflictsTab conflicts={[]} onConfirm={vi.fn()} onSuggest={vi.fn()} />)
    expect(screen.getByText(/last checked.*ago/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify the new cases fail**

Run: `cd research-kit/extension && pnpm vitest run src/sidebar/components/tabs/ConflictsTab.test.tsx`
Expected: the two new tests FAIL (no header rendered yet).

- [ ] **Step 3: Integrate header + polling**

Replace `research-kit/extension/src/sidebar/components/tabs/ConflictsTab.tsx`:

```typescript
import { ConflictResolutionPanel } from '../atoms/ConflictResolutionPanel'
import { ConflictsCheckHeader } from '../atoms/ConflictsCheckHeader'
import { useConflictCheckPolling } from '../../hooks/useConflictCheckPolling'
import { useStore } from '../../state/useStore'
import type { Conflict } from '../../../shared/types'

interface Props {
  conflicts: Conflict[]
  onConfirm: (conflictId: string, acceptedClaimId: string) => Promise<void>
  onSuggest: (c: Conflict) => Promise<void>
}

export function ConflictsTab({ conflicts, onConfirm, onSuggest }: Props) {
  const projectId = useStore(s => s.currentProjectId)
  const activeTab = useStore(s => s.tab)
  const status = useStore(s => s.conflictCheckStatus.data)
  useConflictCheckPolling(projectId, activeTab === 'conflicts')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ConflictsCheckHeader status={status} />
      <div className="flex flex-col gap-2 p-2 overflow-y-auto flex-1">
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
    </div>
  )
}
```

- [ ] **Step 4: Run ConflictsTab tests**

Run: `cd research-kit/extension && pnpm vitest run src/sidebar/components/tabs/ConflictsTab.test.tsx`
Expected: PASS (all six tests).

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/ConflictsTab.tsx research-kit/extension/src/sidebar/components/tabs/ConflictsTab.test.tsx
git commit -m "feat(extension): integrate ConflictsCheckHeader + polling in ConflictsTab"
```

---

## Task 10: Optimistic pending bump on save

**Files:**
- Modify: `research-kit/extension/src/sidebar/App.tsx`
- Modify: `research-kit/extension/src/sidebar/App.test.tsx`

- [ ] **Step 1: Write the failing integration test**

In `research-kit/extension/src/sidebar/App.test.tsx`, add a new test in the existing describe block (consult the file for the test setup pattern — mocks for `patchClaim`, `batchCreateClaims`, `addToInbox` already exist):

```typescript
it('bumpPendingCheck is called after PATCH with status=verified', async () => {
  const bumpSpy = vi.spyOn(useStore.getState(), 'bumpPendingCheck')
  // ... arrange a local claim with status='verified', trigger handleAcceptClaim,
  //     await the save chain (batchCreate -> patch -> addToInbox)
  // (use the existing test for handleAcceptClaim as the template)
  expect(bumpSpy).toHaveBeenCalledTimes(1)
})
```

Read [research-kit/extension/src/sidebar/App.test.tsx](research-kit/extension/src/sidebar/App.test.tsx) and find the existing test that exercises the Save / handleAcceptClaim flow; copy its setup verbatim and add the `bumpSpy` assertion at the end. Do not invent setup — reuse what's there.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd research-kit/extension && pnpm vitest run src/sidebar/App.test.tsx -t bumpPendingCheck`
Expected: FAIL — `bumpPendingCheck` not called.

- [ ] **Step 3: Wire the optimistic bump in App.tsx**

In `research-kit/extension/src/sidebar/App.tsx`:

1. Add `bumpPendingCheck` to the destructured store actions (look for the existing `patchClaim,` line ~53 inside a `useStore(state => ({ ... }))` selector or hook usage):

```typescript
    bumpPendingCheck,
```

2. After the existing `await patchClaim(backendId, { ... })` call (around line 200-205), add:

```typescript
      if (localClaim.status === 'verified' || localClaim.status === 'partial') {
        bumpPendingCheck()
      }
```

   Place it **after** `patchClaim` succeeds and **before** `addToInbox`. The PATCH must succeed for detection to actually fire on the backend; bumping after the await guarantees we don't show "Checking…" for a failed save.

- [ ] **Step 4: Run integration test**

Run: `cd research-kit/extension && pnpm vitest run src/sidebar/App.test.tsx -t bumpPendingCheck`
Expected: PASS

- [ ] **Step 5: Run the full extension test suite**

Run: `cd research-kit/extension && pnpm test`
Expected: PASS (no regressions in App, ConflictsTab, slices, hooks).

- [ ] **Step 6: Run the full backend test suite**

Run: `cd research-kit/backend && pytest -q`
Expected: PASS (all tests).

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/sidebar/App.tsx research-kit/extension/src/sidebar/App.test.tsx
git commit -m "feat(extension): optimistic bumpPendingCheck after verify save"
```

---

## Task 11: Manual smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Start backend + extension dev**

```bash
# Terminal 1
cd research-kit/backend && uvicorn app.main:app --reload

# Terminal 2
cd research-kit/extension && pnpm dev
```

- [ ] **Step 2: Apply migration**

```bash
cd research-kit/backend && alembic upgrade head
```

Expected: migration `0007_claim_conflicts_checked_at` runs without errors.

- [ ] **Step 3: Smoke test in the browser**

1. Load the unpacked extension in Chrome, open sidebar.
2. Open Verify tab on a source site (e.g. PubMed) and verify a claim, then "Save to inbox" with status verified.
3. Switch to Conflicts tab immediately.
4. Verify the header shows "Checking 1 claim…" with a spinner (optimistic bump).
5. Within ~3-6s, verify the header transitions to "Last checked Xs ago" (poll observes pending=0).
6. Verify any new conflicts appear in the list at the same moment (loadConflicts triggered on transition).

If LLM is unavailable (no API key), the header should stay on "Checking 1 claim…" indefinitely — this is the expected pending state and confirms the failure leaves NULL.

---

## Self-Review

- **Spec coverage:** Every spec section (`Data model & migration`, `Backend timestamp logic`, `Endpoint contract`, `ConflictsCheckHeader`, `Polling hook`, `Optimistic bump`, all backend + frontend test categories) maps to Tasks 1–10. Manual smoke is Task 11.
- **Placeholder scan:** No TBD/TODO/"add appropriate error handling". Task 10 Step 1 asks the worker to copy the existing App.test setup pattern verbatim rather than inventing — this is intentional because the App test file is large and its mocks are well-established; following the existing template is safer than fabricating one here.
- **Type consistency:** `ConflictCheckStatus`, `conflictCheckStatus`, `bumpPendingCheck`, `loadConflictCheckStatus`, `getConflictCheckStatus`, `useConflictCheckPolling`, `ConflictsCheckHeader`, `check_status`, `ConflictCheckStatusOut`, `conflicts_checked_at` — names are consistent across backend (snake_case) and frontend (camelCase) per existing convention.
