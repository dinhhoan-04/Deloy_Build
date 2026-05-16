# Recent Features Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply 13 correctness/perf/cleanup fixes to recently-shipped inbox, verify, drafts, and conflict code.

**Architecture:** Three independent groupings — A-data (DB-schema changes), A-cleanup+perf (repo/router refactors), B-extension (TS sidebar + service worker). Each task is TDD-shaped: failing test → minimal fix → green → commit.

**Tech Stack:** Python 3.11 + FastAPI + SQLAlchemy 2.0 async + Alembic + pytest-asyncio (backend); TypeScript + React + Vitest + chrome.* APIs (extension).

**Spec:** [docs/superpowers/specs/2026-05-15-recent-features-polish-design.md](../specs/2026-05-15-recent-features-polish-design.md)

---

## Group A-data (run first — migration)

### Task A1: Revert claim deletion on inbox remove

**Files:**
- Modify: `research-kit/backend/app/repos/inbox.py:74-79`
- Test: `research-kit/backend/tests/test_inbox.py` (new test)

- [ ] **Step 1: Write the failing test**

Append to `research-kit/backend/tests/test_inbox.py`:

```python
@pytest.mark.asyncio
async def test_inbox_remove_keeps_claim(db_engine):
    """DELETE /inbox/{id} must NOT delete the underlying claim."""
    from app.repos.inbox import InboxRepo
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    async with db_engine() as s:
        u = User(google_sub="g_keep", email="g_keep@x"); s.add(u); await s.flush()
        p = Project(user_id=u.id, name="P"); s.add(p); await s.flush()
        c = Claim(user_id=u.id, project_id=p.id, text="t",
                  site="elicit", status=ClaimStatus.PENDING.value)
        s.add(c); await s.commit(); await s.refresh(c)
        claim_id = c.id

        repo = InboxRepo(s)
        item = await repo.add(u.id, project_id=p.id, claim_id=c.id)
        await s.commit()

        await repo.remove(u.id, item.id); await s.commit()

        # Claim must still exist
        survivor = (await s.execute(select(Claim).where(Claim.id == claim_id))).scalar_one_or_none()
        assert survivor is not None
```

- [ ] **Step 2: Run test, confirm it fails**

```
cd research-kit/backend
pytest tests/test_inbox.py::test_inbox_remove_keeps_claim -v
```
Expected: FAIL (claim is deleted because current `remove()` cascades).

- [ ] **Step 3: Apply the fix**

In `research-kit/backend/app/repos/inbox.py`, replace `remove`:

```python
async def remove(self, user_id: UUID, inbox_id: UUID) -> None:
    item = await self._get_item(user_id, inbox_id)
    await self.s.delete(item)
```

- [ ] **Step 4: Run full inbox test file**

```
pytest tests/test_inbox.py -v
```
Expected: all green.

- [ ] **Step 5: Commit**

```
git add research-kit/backend/app/repos/inbox.py research-kit/backend/tests/test_inbox.py
git commit -m "fix(inbox): keep claim when removing inbox item (revert 83837fe)"
```

---

### Task A2: Conflict resolution state columns

**Files:**
- Create: `research-kit/backend/alembic/versions/0006_conflict_resolved.py`
- Modify: `research-kit/shared/rk_shared/models.py` (Conflict class)
- Modify: `research-kit/backend/app/repos/conflicts.py` (`confirm`)
- Test: `research-kit/backend/tests/test_conflict_confirm.py`

- [ ] **Step 1: Write the migration**

Create `research-kit/backend/alembic/versions/0006_conflict_resolved.py`:

```python
"""add resolved_at and accepted_claim_id to conflicts

Revision ID: 0006_conflict_resolved
Revises: 0005_drafts
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006_conflict_resolved"
down_revision = "0005_drafts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("conflicts",
        sa.Column("resolved_at", sa.TIMESTAMP(timezone=True), nullable=True))
    op.add_column("conflicts",
        sa.Column("accepted_claim_id", postgresql.UUID(as_uuid=True), nullable=True))


def downgrade() -> None:
    op.drop_column("conflicts", "accepted_claim_id")
    op.drop_column("conflicts", "resolved_at")
```

- [ ] **Step 2: Update the ORM model**

In `research-kit/shared/rk_shared/models.py`, inside `class Conflict`, after the `resolution` column add:

```python
    resolved_at:        Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    accepted_claim_id:  Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
```

- [ ] **Step 3: Write the failing test**

Append to `research-kit/backend/tests/test_conflict_confirm.py`:

```python
@pytest.mark.asyncio
async def test_confirm_sets_resolved_columns_and_rejects_double_confirm(client_dev_alice):
    # Setup: project + two contradicting claims + conflict
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": "A", "site": "elicit"}, {"text": "B", "site": "elicit"}],
    })
    cid_a = r.json()["created"][0]["id"]
    cid_b = r.json()["created"][1]["id"]

    r = await client_dev_alice.post("/v1/conflicts", json={
        "project_id": pid, "group_key": "g", "doi": None, "paper_title": "P",
        "sides": [
            {"claim_id": cid_a, "label": "A", "quote": "qa"},
            {"claim_id": cid_b, "label": "B", "quote": "qb"},
        ],
    })
    conflict_id = r.json()["id"]

    r = await client_dev_alice.post(f"/v1/conflicts/{conflict_id}/confirm",
                                    json={"accepted_claim_id": cid_a})
    assert r.status_code == 200
    body = r.json()
    assert body["conflict"]["resolved_at"] is not None
    assert body["conflict"]["accepted_claim_id"] == cid_a

    # Second confirm must reject
    r = await client_dev_alice.post(f"/v1/conflicts/{conflict_id}/confirm",
                                    json={"accepted_claim_id": cid_a})
    assert r.status_code == 400
```

Also extend `app/schemas/conflicts.py::ConflictOut` to expose `resolved_at` and `accepted_claim_id`. In `research-kit/backend/app/schemas/conflicts.py` add to `ConflictOut`:

```python
    resolved_at: datetime | None = None
    accepted_claim_id: UUID | None = None
```

And in `app/routers/conflicts.py::_out`:

```python
    return ConflictOut(
        id=c.id, project_id=c.project_id, group_key=c.group_key,
        doi=c.doi, paper_title=c.paper_title, flagged_at=c.flagged_at,
        resolution=c.resolution,
        resolved_at=c.resolved_at,
        accepted_claim_id=c.accepted_claim_id,
        sides=[ConflictSide.model_validate(s) for s in (c.sides or [])],
    )
```

- [ ] **Step 4: Run test, confirm it fails**

```
cd research-kit/backend
alembic upgrade head
pytest tests/test_conflict_confirm.py::test_confirm_sets_resolved_columns_and_rejects_double_confirm -v
```
Expected: FAIL on `assert body["conflict"]["resolved_at"] is not None` or on the double-confirm assertion.

- [ ] **Step 5: Update `confirm()` to use the new columns**

In `research-kit/backend/app/repos/conflicts.py`, replace the existing `confirm` method:

```python
from datetime import datetime, timezone

async def confirm(self, user_id: UUID, conflict_id: UUID,
                  accepted_claim_id: UUID) -> tuple["Conflict", "InboxItem"]:
    """Verify accepted claim, delete rejected claim, add to inbox, mark conflict resolved."""
    conflict = (await self.s.execute(
        select(Conflict).where(Conflict.id == conflict_id, Conflict.user_id == user_id)
    )).scalar_one_or_none()
    if not conflict:
        raise NotFoundError("conflict not found")

    if conflict.resolved_at is not None:
        raise ValidationError_("conflict is already confirmed")

    side_ids = [UUID(s["claim_id"]) for s in (conflict.sides or [])]
    if accepted_claim_id not in side_ids:
        raise ValidationError_("accepted_claim_id not in conflict sides")
    rejected_ids = [sid for sid in side_ids if sid != accepted_claim_id]

    accepted = (await self.s.execute(
        select(Claim).where(Claim.id == accepted_claim_id, Claim.user_id == user_id)
    )).scalar_one_or_none()
    if not accepted:
        raise NotFoundError("accepted claim not found")
    accepted.status = "verified"

    for rid in rejected_ids:
        await self.s.execute(
            delete(Claim).where(Claim.id == rid, Claim.user_id == user_id)
        )

    inbox_item = InboxItem(
        user_id=user_id, project_id=conflict.project_id, claim_id=accepted_claim_id
    )
    self.s.add(inbox_item)
    try:
        async with self.s.begin_nested():
            await self.s.flush()
    except IntegrityError:
        inbox_item = (await self.s.execute(
            select(InboxItem).where(
                InboxItem.claim_id == accepted_claim_id,
                InboxItem.user_id == user_id,
            )
        )).scalar_one()

    conflict.resolved_at = datetime.now(timezone.utc)
    conflict.accepted_claim_id = accepted_claim_id
    conflict.resolution = json.dumps({
        "kind": "confirmed",
        "accepted_claim_id": str(accepted_claim_id),
    })
    await self.s.flush()
    return conflict, inbox_item
```

- [ ] **Step 6: Run tests**

```
pytest tests/test_conflict_confirm.py tests/test_conflicts.py tests/test_migrations.py -v
```
Expected: all green.

- [ ] **Step 7: Commit**

```
git add research-kit/backend/alembic/versions/0006_conflict_resolved.py \
        research-kit/shared/rk_shared/models.py \
        research-kit/backend/app/repos/conflicts.py \
        research-kit/backend/app/routers/conflicts.py \
        research-kit/backend/app/schemas/conflicts.py \
        research-kit/backend/tests/test_conflict_confirm.py
git commit -m "feat(conflicts): track resolved_at and accepted_claim_id columns"
```

---

## Group A-cleanup + A-perf

### Task A3: Remove inline `__import__` in DraftRepo

**Files:**
- Modify: `research-kit/backend/app/repos/drafts.py:1-39`

- [ ] **Step 1: Apply the change**

At the top of `research-kit/backend/app/repos/drafts.py`, change the imports to include `text`:

```python
from sqlalchemy import select, text
```

In the `upsert` method, line 33, replace:

```python
                    "updated_at": __import__("sqlalchemy").text("now()"),
```

with:

```python
                    "updated_at": text("now()"),
```

- [ ] **Step 2: Run draft tests**

```
cd research-kit/backend
pytest tests/test_draft_export.py tests/test_draft_repo.py tests/test_draft_schemas.py -v
```
Expected: green.

- [ ] **Step 3: Commit**

```
git add research-kit/backend/app/repos/drafts.py
git commit -m "refactor(drafts): use top-level sqlalchemy.text import"
```

---

### Task A4: Stable order in `InboxRepo.bulk_patch`

**Files:**
- Modify: `research-kit/backend/app/repos/inbox.py:60-72`
- Test: `research-kit/backend/tests/test_inbox.py`

- [ ] **Step 1: Write the failing test**

Append to `research-kit/backend/tests/test_inbox.py`:

```python
@pytest.mark.asyncio
async def test_inbox_bulk_patch_preserves_input_order(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "Order"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": f"c{i}", "site": "elicit"} for i in range(3)],
    })
    cids = [c["id"] for c in r.json()["created"]]
    iids = []
    for cid in cids:
        r = await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid})
        iids.append(r.json()["id"])

    reversed_ids = list(reversed(iids))
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    r = await client_dev_alice.patch("/v1/inbox/bulk", json={"ids": reversed_ids, "archived_at": now})
    assert r.status_code == 200
    assert [i["id"] for i in r.json()] == reversed_ids
```

- [ ] **Step 2: Run, confirm failure**

```
pytest tests/test_inbox.py::test_inbox_bulk_patch_preserves_input_order -v
```
Expected: FAIL (order is undefined currently).

- [ ] **Step 3: Apply fix**

In `research-kit/backend/app/repos/inbox.py`, replace the body of `bulk_patch` after the `update(...)` statement:

```python
async def bulk_patch(self, user_id: UUID, ids: list[UUID], *, archived_at: datetime | None) -> list[InboxItem]:
    if not ids:
        return []
    await self.s.execute(
        update(InboxItem)
        .where(InboxItem.id.in_(ids), InboxItem.user_id == user_id)
        .values(archived_at=archived_at)
    )
    await self.s.flush()
    result = await self.s.execute(
        select(InboxItem).where(InboxItem.id.in_(ids), InboxItem.user_id == user_id)
    )
    by_id = {i.id: i for i in result.scalars()}
    return [by_id[i] for i in ids if i in by_id]
```

- [ ] **Step 4: Run tests**

```
pytest tests/test_inbox.py -v
```
Expected: green.

- [ ] **Step 5: Commit**

```
git add research-kit/backend/app/repos/inbox.py research-kit/backend/tests/test_inbox.py
git commit -m "fix(inbox): preserve input order in bulk_patch response"
```

---

### Task A5: JSONB containment for `find_by_claim_pair` + `pairs_for_project`

**Files:**
- Modify: `research-kit/backend/app/repos/conflicts.py`
- Test: `research-kit/backend/tests/test_conflicts.py`

- [ ] **Step 1: Write the failing test**

Append to `research-kit/backend/tests/test_conflicts.py`:

```python
@pytest.mark.asyncio
async def test_find_by_claim_pair_only_matches_when_both_present(async_session):
    from rk_shared.models import Project, Conflict
    from app.repos.conflicts import ConflictRepo
    from uuid import uuid4

    user_id = uuid4()
    p = Project(user_id=user_id, name="P"); async_session.add(p); await async_session.flush()

    a, b, c = uuid4(), uuid4(), uuid4()
    overlap_one = Conflict(
        user_id=user_id, project_id=p.id, group_key="g1",
        sides=[{"claim_id": str(a), "label": "A", "quote": "x"},
               {"claim_id": str(c), "label": "C", "quote": "y"}],
    )
    match = Conflict(
        user_id=user_id, project_id=p.id, group_key="g2",
        sides=[{"claim_id": str(a), "label": "A", "quote": "x"},
               {"claim_id": str(b), "label": "B", "quote": "y"}],
    )
    async_session.add_all([overlap_one, match]); await async_session.flush()

    repo = ConflictRepo(async_session)
    found = await repo.find_by_claim_pair(user_id, p.id, a, b)
    assert found is not None and found.id == match.id

    pairs = await repo.pairs_for_project(user_id, p.id)
    assert frozenset({a, b}) in pairs
    assert frozenset({a, c}) in pairs
```

- [ ] **Step 2: Run, confirm one assertion fails**

```
cd research-kit/backend
pytest tests/test_conflicts.py::test_find_by_claim_pair_only_matches_when_both_present -v
```
Expected: FAIL on `pairs_for_project` (method does not exist yet).

- [ ] **Step 3: Replace `find_by_claim_pair` and add `pairs_for_project`**

In `research-kit/backend/app/repos/conflicts.py`, replace `find_by_claim_pair` with:

```python
async def find_by_claim_pair(self, user_id: UUID, project_id: UUID,
                              claim_id_a: UUID, claim_id_b: UUID) -> Conflict | None:
    """Return existing conflict containing both claim IDs in its sides (JSONB containment)."""
    a, b = str(claim_id_a), str(claim_id_b)
    stmt = select(Conflict).where(
        Conflict.user_id == user_id,
        Conflict.project_id == project_id,
        Conflict.sides.op("@>")([{"claim_id": a}]),
        Conflict.sides.op("@>")([{"claim_id": b}]),
    )
    return (await self.s.execute(stmt)).scalar_one_or_none()

async def pairs_for_project(self, user_id: UUID, project_id: UUID) -> set[frozenset[UUID]]:
    """Return the set of {claim_id_a, claim_id_b} pairs already conflicted in this project."""
    rows = await self.list_for(user_id, project_id=project_id)
    out: set[frozenset[UUID]] = set()
    for c in rows:
        ids = [UUID(s["claim_id"]) for s in (c.sides or []) if s.get("claim_id")]
        if len(ids) >= 2:
            out.add(frozenset(ids[:2]))
    return out
```

- [ ] **Step 4: Run tests**

```
pytest tests/test_conflicts.py tests/test_conflict_detect.py -v
```
Expected: green.

- [ ] **Step 5: Commit**

```
git add research-kit/backend/app/repos/conflicts.py research-kit/backend/tests/test_conflicts.py
git commit -m "perf(conflicts): JSONB containment in find_by_claim_pair; add pairs_for_project"
```

---

### Task A6: Rename `ValidationError_` → `ValidationError`

**Files:**
- Modify: `research-kit/backend/app/errors.py`
- Modify: all import sites (search-and-replace)

- [ ] **Step 1: Find all references**

```
cd research-kit/backend
grep -rn "ValidationError_" --include="*.py"
```
Expected: hits in `app/errors.py`, `app/repos/conflicts.py`, plus any router/test using it.

- [ ] **Step 2: Rename the class**

In `research-kit/backend/app/errors.py`:

```python
class ValidationError(APIError):
    code, status = "validation_error", 400
```

(Remove the trailing underscore.) No risk of collision: pydantic's `ValidationError` is not imported into this module's namespace.

- [ ] **Step 3: Update all imports and usages**

For every file from Step 1, replace `ValidationError_` with `ValidationError`. Confirm with:

```
grep -rn "ValidationError_" --include="*.py"
```
Expected: zero matches.

- [ ] **Step 4: Run full backend test suite**

```
pytest -x
```
Expected: green.

- [ ] **Step 5: Commit**

```
git add -u research-kit/backend
git commit -m "refactor(errors): rename ValidationError_ to ValidationError"
```

---

### Task A13: Batch conflict detection (single LLM call)

**Files:**
- Modify: `research-kit/backend/app/routers/claims.py` (`_detect_conflicts` and surrounding constants)
- Test: `research-kit/backend/tests/test_conflict_detect.py`

**Depends on Task A5** (uses `pairs_for_project`).

- [ ] **Step 1: Write the failing tests**

Append to `research-kit/backend/tests/test_conflict_detect.py`:

```python
@pytest.mark.asyncio
async def test_detect_conflicts_makes_single_llm_call_for_multiple_candidates(async_session):
    """Even with N candidates, _detect_conflicts calls provider.extract exactly once."""
    from rk_shared.models import Claim, Project, Conflict
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    project = Project(user_id=user_id, name="Batch")
    async_session.add(project); await async_session.flush()

    doi = "10.1/batch"
    new_claim = Claim(user_id=user_id, project_id=project.id, text="new",
                      doi=doi, paper_title="P", site="pubmed",
                      status=ClaimStatus.PENDING.value, quote="qn")
    candidates = [
        Claim(user_id=user_id, project_id=project.id, text=f"c{i}",
              doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.VERIFIED.value, quote=f"q{i}")
        for i in range(3)
    ]
    async_session.add(new_claim); async_session.add_all(candidates); await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradictions": [
        {"candidate_id": str(candidates[0].id), "contradicts": True},
        {"candidate_id": str(candidates[1].id), "contradicts": False},
        {"candidate_id": str(candidates[2].id), "contradicts": True},
    ]})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, new_claim.id, project.id)

    assert mock_provider.extract.await_count == 1
    conflicts = list((await async_session.execute(
        select(Conflict).where(Conflict.project_id == project.id)
    )).scalars())
    assert len(conflicts) == 2  # candidates[0] and candidates[2]


@pytest.mark.asyncio
async def test_detect_conflicts_caps_candidates_at_max(async_session, caplog):
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    import json

    user_id = uuid4()
    project = Project(user_id=user_id, name="Cap")
    async_session.add(project); await async_session.flush()

    doi = "10.1/cap"
    new_claim = Claim(user_id=user_id, project_id=project.id, text="new",
                      doi=doi, paper_title="P", site="pubmed",
                      status=ClaimStatus.PENDING.value, quote="qn")
    cands = [
        Claim(user_id=user_id, project_id=project.id, text=f"c{i}",
              doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.VERIFIED.value, quote=f"q{i}")
        for i in range(15)
    ]
    async_session.add(new_claim); async_session.add_all(cands); await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradictions": []})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, new_claim.id, project.id)

    user_msg = mock_provider.extract.await_args.args[1]
    payload = json.loads(user_msg)
    assert len(payload["candidates"]) == 10


@pytest.mark.asyncio
async def test_detect_conflicts_ignores_hallucinated_candidate_ids(async_session):
    from rk_shared.models import Claim, Project, Conflict
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    project = Project(user_id=user_id, name="Hallu")
    async_session.add(project); await async_session.flush()

    doi = "10.1/hallu"
    new_claim = Claim(user_id=user_id, project_id=project.id, text="new",
                      doi=doi, paper_title="P", site="pubmed",
                      status=ClaimStatus.PENDING.value, quote="qn")
    cand = Claim(user_id=user_id, project_id=project.id, text="c",
                 doi=doi, paper_title="P", site="pubmed",
                 status=ClaimStatus.VERIFIED.value, quote="q")
    async_session.add_all([new_claim, cand]); await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradictions": [
        {"candidate_id": str(uuid4()), "contradicts": True},  # not in input
    ]})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, new_claim.id, project.id)

    conflicts = list((await async_session.execute(
        select(Conflict).where(Conflict.project_id == project.id)
    )).scalars())
    assert conflicts == []
```

Update existing `test_detect_conflicts_creates_conflict_when_contradiction_found` and `..._no_contradiction` and `..._no_duplicate` to use the new batched mock return shape `{"contradictions": [{"candidate_id": ..., "contradicts": ...}]}`.

- [ ] **Step 2: Run tests, confirm failures**

```
pytest tests/test_conflict_detect.py -v
```
Expected: failures for all new tests + the three updated ones.

- [ ] **Step 3: Rewrite `_detect_conflicts`**

In `research-kit/backend/app/routers/claims.py`, find the existing `_CONFLICT_DETECT_SYSTEM` / `_CONFLICT_DETECT_SCHEMA` constants and replace with batched versions. Also rewrite `_detect_conflicts`:

```python
_CONFLICT_DETECT_MAX_CANDIDATES = 10

_CONFLICT_DETECT_BATCH_SYSTEM = (
    "You are checking whether a new scientific claim contradicts any of several "
    "existing claims from the same paper. For each candidate in the input list, "
    "output `contradicts: true` ONLY when the two claims make incompatible factual "
    "statements about the same quantity, direction, or outcome. Output exactly one "
    "entry per candidate id provided. Do not invent ids."
)

_CONFLICT_DETECT_BATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "contradictions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "candidate_id": {"type": "string"},
                    "contradicts": {"type": "boolean"},
                    "rationale": {"type": "string"},
                },
                "required": ["candidate_id", "contradicts"],
            },
        },
    },
    "required": ["contradictions"],
}


async def _detect_conflicts(s: AsyncSession, user_id: UUID, new_claim_id: UUID,
                             project_id: UUID) -> None:
    """Check new_claim against same-paper claims via a single batched LLM call."""
    new_claim = (await s.execute(
        select(Claim).where(Claim.id == new_claim_id, Claim.user_id == user_id)
    )).scalar_one_or_none()
    if not new_claim:
        return

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
        return
    q = q.order_by(Claim.created_at.desc())

    all_candidates = list((await s.execute(q)).scalars())
    if not all_candidates:
        return
    if len(all_candidates) > _CONFLICT_DETECT_MAX_CANDIDATES:
        logger.info("conflict detect truncated %d candidates to %d",
                    len(all_candidates), _CONFLICT_DETECT_MAX_CANDIDATES)
    candidates = all_candidates[:_CONFLICT_DETECT_MAX_CANDIDATES]

    conflict_repo = ConflictRepo(s)
    existing_pairs = await conflict_repo.pairs_for_project(user_id, project_id)
    candidates = [c for c in candidates
                  if frozenset({new_claim_id, c.id}) not in existing_pairs]
    if not candidates:
        return

    provider = _make_provider()
    if not provider:
        return

    user_msg = json.dumps({
        "claim_new": {"id": str(new_claim_id), "text": new_claim.text},
        "candidates": [{"id": str(c.id), "text": c.text} for c in candidates],
        "paper_title": new_claim.paper_title,
        "doi": new_claim.doi,
    })
    try:
        result = await provider.extract(
            _CONFLICT_DETECT_BATCH_SYSTEM, user_msg, _CONFLICT_DETECT_BATCH_SCHEMA,
        )
    except Exception as exc:
        logger.warning("batch conflict detect failed: %s", exc)
        return

    by_id = {str(c.id): c for c in candidates}
    for entry in result.get("contradictions", []):
        if not entry.get("contradicts"):
            continue
        existing = by_id.get(entry.get("candidate_id"))
        if not existing:
            continue
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

Remove the now-unused `_CONFLICT_DETECT_SYSTEM` and `_CONFLICT_DETECT_SCHEMA` constants.

- [ ] **Step 4: Run tests**

```
pytest tests/test_conflict_detect.py -v
```
Expected: all green (new + updated).

- [ ] **Step 5: Commit**

```
git add research-kit/backend/app/routers/claims.py research-kit/backend/tests/test_conflict_detect.py
git commit -m "perf(conflicts): batch conflict detection into one LLM call, cap candidates at 10"
```

---

## Group B-extension

### Task B7: Route `verifyWithPdf` through `apiFetch`

**Files:**
- Modify: `research-kit/extension/src/shared/api.ts`
- Test: `research-kit/extension/src/shared/api.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `research-kit/extension/src/shared/api.test.ts`:

```typescript
import { verifyWithPdf } from './api'
import * as auth from './auth'

describe('verifyWithPdf', () => {
  it('sends Authorization header and does not set Content-Type', async () => {
    vi.spyOn(auth, 'authHeader').mockReturnValue({ Authorization: 'Bearer testtoken' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        status: 'verified', verbatim_quote: 'q', confidence: 0.9,
        reason: 'ok', paper_title: 'P', doi: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }) as any
    )

    const file = new File(['x'], 'p.pdf', { type: 'application/pdf' })
    await verifyWithPdf({ file, claim: 'c' })

    const [, init] = fetchSpy.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer testtoken')
    expect(headers['Content-Type']).toBeUndefined()
    fetchSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run, confirm fail**

```
cd research-kit/extension
npx vitest run src/shared/api.test.ts
```
Expected: FAIL (current `verifyWithPdf` uses raw fetch with no auth header).

- [ ] **Step 3: Refactor `apiFetch` to handle FormData; reroute `verifyWithPdf`**

In `research-kit/extension/src/shared/api.ts`, replace `apiFetch`:

```ts
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
  const headers: Record<string, string> = {
    ...authHeader(),
    ...(init.headers as Record<string, string> || {}),
  }
  if (!isFormData) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (res.status === 401) { await signOut(); throw new AuthExpiredError() }
  if (!res.ok) throw await ApiError.fromResponse(res)
  return res
}
```

Replace `verifyWithPdf` body:

```ts
export async function verifyWithPdf(opts: VerifyWithPdfOptions): Promise<VerifyUploadResponse> {
  const form = new FormData()
  form.append('pdf', opts.file)
  form.append('claim', opts.claim)
  if (opts.doi) form.append('doi', opts.doi)
  if (opts.paperTitle) form.append('paper_title', opts.paperTitle)
  const res = await apiFetch('/verify/upload', { method: 'POST', body: form })
  return res.json()
}
```

Note: `ApiError.fromResponse` is added in Task B10. For this task, temporarily keep the existing constructor:

```ts
  if (!res.ok) throw new ApiError(res.status, await res.text())
```

This line will be updated in B10.

- [ ] **Step 4: Run tests**

```
npx vitest run src/shared/api.test.ts
```
Expected: green.

- [ ] **Step 5: Commit**

```
git add research-kit/extension/src/shared/api.ts research-kit/extension/src/shared/api.test.ts
git commit -m "fix(verify): route verifyWithPdf through apiFetch for auth"
```

---

### Task B8: Per-tab progress update in service worker

**Files:**
- Modify: `research-kit/extension/src/background_minimal.ts:185-198`

- [ ] **Step 1: Apply the fix**

In `research-kit/extension/src/background_minimal.ts`, replace the trailing `for (const [tabId, prog] of progressByTab)` block inside `verifyOne` with:

```ts
  const prog = progressByTab.get(claim.tabId)
  if (prog) {
    const nextCompleted = prog.completed + 1
    const nextRunning = inFlight.size
    progressByTab.set(claim.tabId, {
      ...prog,
      completed: nextCompleted,
      running: nextRunning,
      step: nextCompleted >= prog.total && nextRunning === 0 ? 'done' : 'verifying',
      stepMessage: nextCompleted >= prog.total && nextRunning === 0
        ? 'Verification complete'
        : `Verifying ${nextRunning} in progress`,
    })
    broadcastProgress(claim.tabId)
  }
```

- [ ] **Step 2: Type-check the extension**

```
cd research-kit/extension
npx tsc -p tsconfig.app.json --noEmit
```
Expected: no errors.

- [ ] **Step 3: Run existing tests**

```
npx vitest run
```
Expected: green (no test currently asserts the bug; behaviour change is covered by manual verification — see Step 4).

- [ ] **Step 4: Commit**

```
git add research-kit/extension/src/background_minimal.ts
git commit -m "fix(verify): scope progress update to claim's own tab"
```

---

### Task B9: Stop reporting "retrying" on terminal failure

**Files:**
- Modify: `research-kit/extension/src/background_minimal.ts:170-178`

- [ ] **Step 1: Apply the fix**

In `verifyOne`'s `catch` block, remove the `broadcastClaimStep(... 'retrying', ...)` call:

```ts
  } catch {
    const errorResult: VerifyResult = {
      claimId: claim.id, status: 'error',
      verbatimQuote: null, confidence: 0, reason: 'Network error',
      paperTitle: claim.paperTitle, doi: claim.doi,
    }
    results.set(claim.id, errorResult)
    updatedClaim = { ...claim, status: 'error', confidence: 0, reason: 'Network error' }
  }
```

The existing `broadcastClaimStep(... 'failed')` further down (currently line 183 in the post-try block) still fires.

- [ ] **Step 2: Type-check**

```
cd research-kit/extension
npx tsc -p tsconfig.app.json --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```
git add research-kit/extension/src/background_minimal.ts
git commit -m "fix(verify): stop reporting 'retrying' on terminal network failure"
```

---

### Task B10: Structured error envelope in `ApiError`

**Files:**
- Modify: `research-kit/extension/src/shared/errors.ts`
- Modify: `research-kit/extension/src/shared/api.ts` (one line — switch to `ApiError.fromResponse`)
- Modify: `research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx`
- Test: `research-kit/extension/src/sidebar/components/tabs/VerifyTab.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `research-kit/extension/src/sidebar/components/tabs/VerifyTab.test.tsx` a case that mocks `verifyWithPdf` to reject with `new ApiError(400, JSON.stringify({error:{code:"pdf_too_large", message:"too big"}}), 'pdf_too_large')` and asserts the toast text `'PDF too large'` appears.

```typescript
it('shows friendly message for structured pdf_too_large error', async () => {
  const { ApiError } = await import('../../../shared/errors')
  vi.spyOn(await import('../../../shared/api'), 'verifyWithPdf')
    .mockRejectedValue(new ApiError(400,
      JSON.stringify({ error: { code: 'pdf_too_large', message: 'too big' } }),
      'pdf_too_large'))
  // ... render VerifyTab with one claim, simulate upload, assert toast text 'PDF too large'
})
```

(Wire the rest of the render/upload flow following the patterns already in this test file.)

- [ ] **Step 2: Run, confirm fail**

```
cd research-kit/extension
npx vitest run src/sidebar/components/tabs/VerifyTab.test.tsx
```
Expected: FAIL (no `e.code` plumbing yet).

- [ ] **Step 3: Add `code` and `fromResponse` to `ApiError`**

Rewrite `research-kit/extension/src/shared/errors.ts`:

```ts
export class ApiError extends Error {
  constructor(public status: number, public body: string, public code?: string) {
    super(`HTTP ${status}: ${body}`)
    this.name = 'ApiError'
  }

  static async fromResponse(res: Response): Promise<ApiError> {
    const text = await res.text()
    let code: string | undefined
    if (res.headers.get('content-type')?.includes('application/json')) {
      try { code = JSON.parse(text)?.error?.code } catch { /* ignore */ }
    }
    return new ApiError(res.status, text, code)
  }
}

export class AuthExpiredError extends Error {
  constructor() { super('Auth expired'); this.name = 'AuthExpiredError' }
}
```

- [ ] **Step 4: Use `fromResponse` in `apiFetch`**

In `research-kit/extension/src/shared/api.ts`, replace the `if (!res.ok) throw new ApiError(...)` line (from Task B7) with:

```ts
  if (!res.ok) throw await ApiError.fromResponse(res)
```

- [ ] **Step 5: Use `e.code` in `VerifyTab.handleUploadPdf`**

In `research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx`, replace the existing `msg = e instanceof ApiError ? ...` block with:

```tsx
      const msg = e instanceof ApiError
        ? (e.code === 'pdf_too_large' ? 'PDF too large'
           : e.code === 'pdf_invalid' ? 'PDF is not readable'
           : e.status === 400 ? 'Validation error — check the PDF'
           : e.status === 503 ? 'Service unavailable — try again later'
           : `Upload failed (${e.status})`)
        : 'Upload failed. Please retry.'
```

(If the backend's `app/errors.py` does not currently use exact codes `pdf_too_large` / `pdf_invalid`, leave the lookup branches in place — they're forward-compatible no-ops. Confirm against `app/errors.py` and `app/routers/verify.py` and adjust the code strings if specific codes are already emitted.)

- [ ] **Step 6: Run tests**

```
npx vitest run
```
Expected: green.

- [ ] **Step 7: Commit**

```
git add research-kit/extension/src/shared/errors.ts \
        research-kit/extension/src/shared/api.ts \
        research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx \
        research-kit/extension/src/sidebar/components/tabs/VerifyTab.test.tsx
git commit -m "feat(errors): parse structured error envelope and surface friendly messages"
```

---

### Task B11: Collapse the two useEffects in `ConflictResolutionPanel`

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/atoms/ConflictResolutionPanel.tsx:19-40`

- [ ] **Step 1: Apply the change**

Replace the `useState` + two `useEffect`s with one effect keyed on `[conflict.id, conflict.resolution]`:

```tsx
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const suggestion = (() => {
    if (!conflict.resolution) return null
    try { return JSON.parse(conflict.resolution) } catch { return null }
  })()

  useEffect(() => {
    let pick: string | null = null
    if (suggestion?.kind === 'suggestion') {
      if (suggestion.recommendation === 'side_a' && conflict.sides[0]) {
        pick = conflict.sides[0].claim_id
      } else if (suggestion.recommendation === 'side_b' && conflict.sides[1]) {
        pick = conflict.sides[1].claim_id
      }
    }
    setSelected(pick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflict.id, conflict.resolution])
```

- [ ] **Step 2: Type-check + tests**

```
cd research-kit/extension
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
```
Expected: green.

- [ ] **Step 3: Commit**

```
git add research-kit/extension/src/sidebar/components/atoms/ConflictResolutionPanel.tsx
git commit -m "refactor(conflict): collapse selection-reset effects into one"
```

---

### Task B12: Tab cleanup in service worker

**Files:**
- Modify: `research-kit/extension/src/background_minimal.ts`

- [ ] **Step 1: Add the listener**

In `research-kit/extension/src/background_minimal.ts`, after the `chrome.tabs.onActivated` listener (around line 25), add:

```ts
chrome.tabs.onRemoved.addListener((tabId) => {
  progressByTab.delete(tabId)
  for (const [id, c] of claimsMap) {
    if (c.tabId === tabId) {
      claimsMap.delete(id)
      results.delete(id)
    }
  }
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].tabId === tabId) queue.splice(i, 1)
  }
})
```

- [ ] **Step 2: Type-check**

```
cd research-kit/extension
npx tsc -p tsconfig.app.json --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```
git add research-kit/extension/src/background_minimal.ts
git commit -m "fix(verify): clean up per-tab state on tab close"
```

---

## Final verification

- [ ] **Run full backend test suite**

```
cd research-kit/backend
pytest -x
```
Expected: green.

- [ ] **Run full extension test suite**

```
cd research-kit/extension
npx vitest run
npx tsc -p tsconfig.app.json --noEmit
```
Expected: green, no type errors.

- [ ] **Apply migration on a fresh DB to confirm**

```
cd research-kit/backend
alembic downgrade base
alembic upgrade head
```
Expected: clean run, ends at `0006_conflict_resolved`.
