# ResearchKit Backend + GoClaw Integration — Implementation Plan (Part 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Part 1 by completing Phases G–N: remaining CRUD, the worker subsystem, run lifecycle with all 8 invariants from spec §4.2 covered as dedicated tests, the GoClaw smoke gate (halt point), the live GoClawRunner, and the extension rewire.

**Architecture:** See Part 1 §Architecture — unchanged. Part 2 is the bulk of the streaming/agent runtime: `EventBus` (persist-before-publish, advisory-lock seq), `execute_run` arq task, SSE replay-then-tail handler, `GoClawRunner` against an OpenAI-compatible HTTP surface, and the extension API + Google OAuth + verify pipeline rewire.

**Tech Stack:** Same as Part 1. Adds: `sse-starlette`, `respx` for unit-mocking the OpenAI-compatible HTTP surface, `pyjwt` already present via `google-auth`, `playwright` (M-only, scaffold), Chrome `chrome.identity` (extension), `@tanstack/react-query` (extension).

**Spec:** [`docs/superpowers/specs/2026-05-08-researchkit-backend-goclaw-design.md`](../specs/2026-05-08-researchkit-backend-goclaw-design.md) — invariants live in §4.2, GoClaw contract in §6.
**Part 1 plan:** [`docs/superpowers/plans/2026-05-08-researchkit-backend-goclaw.md`](./2026-05-08-researchkit-backend-goclaw.md) — read "Conventions used in every task" before starting.

---

## Conventions reminder (carry over from Part 1)

- **TDD per step:** (1) write failing test → (2) run, see it fail → (3) implement → (4) run, see it pass → (5) commit. Steps are 2–5 minutes each.
- **Working directory** for `pytest`: `research-kit/backend/`. Compose: `research-kit/infra/`.
- **No DB mocking.** All DB-touching tests use the testcontainers `db_engine` fixture from Part 1 Phase B.
- **`app.errors`** module (Part 1 Phase C) provides `AuthError`, `NotFoundError`, `ValidationError_`, `ConflictError`, `UpstreamError`, `InternalError`. Reuse — do not redefine.
- **`current_user` / `db` deps** from Part 1 Phase D. Tests use `client_dev_alice` / `client_dev_bob` fixtures.
- **Commit prefixes:** `feat(backend):`, `feat(worker):`, `feat(infra):`, `feat(ext):`, `test(...)`, `chore(...)`, `docs(...)`.
- **Every external boundary** (GoClaw, Google JWKS, EventSource transport) gets an adapter + a fake.
- **Never log claim text, quote text, chat content, draft output.** Lengths and counts only (spec §11.2).

---

## Phase G — Inbox + Conflicts CRUD

**Goal:** Wire the remaining two CRUD resources behind the same pattern as Phase E/F (schema → repo → router → tests). Cascade delete must be exercised.

### Task G1 — Inbox schemas + repo + router + tests

**Files:**
- Create: `research-kit/backend/app/schemas/inbox.py`
- Create: `research-kit/backend/app/repos/inbox.py`
- Create: `research-kit/backend/app/routers/inbox.py`
- Create: `research-kit/backend/tests/test_inbox.py`
- Modify: `research-kit/backend/app/main.py`

- [ ] **Step 1: Schemas**

```python
# app/schemas/inbox.py
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel

class InboxAdd(BaseModel):
    project_id: UUID
    claim_id: UUID

class InboxOut(BaseModel):
    id: UUID
    project_id: UUID
    claim_id: UUID
    saved_at: datetime
```

- [ ] **Step 2: Repo failing test**

```python
# tests/test_inbox.py (partial)
import pytest, uuid
from rk_shared.models import User, Project, Claim
from rk_shared.types import ClaimStatus

@pytest.mark.asyncio
async def test_inbox_add_list_delete(db_engine):
    from app.repos.inbox import InboxRepo
    async with db_engine() as s:
        u = User(google_sub="g1", email="g1@x"); s.add(u); await s.flush()
        p = Project(user_id=u.id, name="P"); s.add(p); await s.flush()
        c = Claim(user_id=u.id, project_id=p.id, text="t",
                  site="elicit", status=ClaimStatus.PENDING.value)
        s.add(c); await s.commit(); await s.refresh(c)

        repo = InboxRepo(s)
        item = await repo.add(u.id, project_id=p.id, claim_id=c.id)
        await s.commit()
        items = await repo.list_for(u.id, project_id=p.id)
        assert [i.id for i in items] == [item.id]

        await repo.remove(u.id, item.id); await s.commit()
        assert await repo.list_for(u.id, project_id=p.id) == []
```

- [ ] **Step 3: Implement repo**

```python
# app/repos/inbox.py
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.errors import NotFoundError, ConflictError
from rk_shared.models import InboxItem, Claim, Project


class InboxRepo:
    def __init__(self, s: AsyncSession): self.s = s

    async def _ensure_owns(self, user_id: UUID, project_id: UUID, claim_id: UUID) -> None:
        proj = (await self.s.execute(
            select(Project.id).where(Project.id == project_id, Project.user_id == user_id)
        )).scalar_one_or_none()
        if not proj:
            raise NotFoundError("project not found")
        clm = (await self.s.execute(
            select(Claim.id).where(Claim.id == claim_id,
                                   Claim.user_id == user_id,
                                   Claim.project_id == project_id)
        )).scalar_one_or_none()
        if not clm:
            raise NotFoundError("claim not found")

    async def add(self, user_id: UUID, *, project_id: UUID, claim_id: UUID) -> InboxItem:
        await self._ensure_owns(user_id, project_id, claim_id)
        item = InboxItem(user_id=user_id, project_id=project_id, claim_id=claim_id)
        self.s.add(item)
        try:
            await self.s.flush()
        except IntegrityError as e:
            await self.s.rollback()
            raise ConflictError("claim already in inbox") from e
        return item

    async def list_for(self, user_id: UUID, *, project_id: UUID) -> list[InboxItem]:
        return list((await self.s.execute(
            select(InboxItem)
            .where(InboxItem.user_id == user_id, InboxItem.project_id == project_id)
            .order_by(InboxItem.saved_at.desc())
        )).scalars())

    async def remove(self, user_id: UUID, inbox_id: UUID) -> None:
        item = (await self.s.execute(
            select(InboxItem).where(InboxItem.id == inbox_id, InboxItem.user_id == user_id)
        )).scalar_one_or_none()
        if not item:
            raise NotFoundError("inbox item not found")
        await self.s.delete(item)
```

- [ ] **Step 4: Implement router**

```python
# app/routers/inbox.py
from uuid import UUID
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, db
from app.repos.inbox import InboxRepo
from app.schemas.inbox import InboxAdd, InboxOut
from rk_shared.models import User

router = APIRouter(prefix="/v1/inbox", tags=["inbox"])


def _out(i) -> InboxOut:
    return InboxOut(id=i.id, project_id=i.project_id, claim_id=i.claim_id, saved_at=i.saved_at)


@router.get("", response_model=list[InboxOut])
async def list_inbox(project_id: UUID = Query(...),
                     u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    return [_out(i) for i in await InboxRepo(s).list_for(u.id, project_id=project_id)]


@router.post("", response_model=InboxOut, status_code=201)
async def add_inbox(body: InboxAdd, u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    i = await InboxRepo(s).add(u.id, project_id=body.project_id, claim_id=body.claim_id)
    await s.commit()
    return _out(i)


@router.delete("/{inbox_id}", status_code=204)
async def delete_inbox(inbox_id: UUID, u: User = Depends(current_user),
                       s: AsyncSession = Depends(db)):
    await InboxRepo(s).remove(u.id, inbox_id)
    await s.commit()
    return Response(status_code=204)
```

- [ ] **Step 5: Endpoint tests + cascade-delete test**

Append to `tests/test_inbox.py`:

```python
@pytest.mark.asyncio
async def test_inbox_endpoint_roundtrip(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid, "claims": [{"text": "c", "site": "elicit"}]})
    cid = r.json()["created"][0]["id"]

    r = await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid})
    assert r.status_code == 201
    iid = r.json()["id"]

    r = await client_dev_alice.get("/v1/inbox", params={"project_id": pid})
    assert [i["id"] for i in r.json()] == [iid]

    r = await client_dev_alice.delete(f"/v1/inbox/{iid}")
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_inbox_cascade_on_project_delete(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid, "claims": [{"text": "c", "site": "elicit"}]})
    cid = r.json()["created"][0]["id"]
    await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid})

    r = await client_dev_alice.delete(f"/v1/projects/{pid}")
    assert r.status_code == 204

    r = await client_dev_alice.get("/v1/inbox", params={"project_id": pid})
    assert r.json() == []
```

- [ ] **Step 6: Wire router in `app/main.py`**

```python
from app.routers import inbox as inbox_router
app.include_router(inbox_router.router)
```

- [ ] **Step 7: Run; expect pass.**

```
pytest tests/test_inbox.py -v
```

- [ ] **Step 8: Commit**

```bash
git add research-kit/backend/app research-kit/backend/tests/test_inbox.py
git commit -m "feat(backend): inbox CRUD with cascade-delete tests"
```

### Task G2 — Conflicts schemas + repo + router + tests

**Files:**
- Create: `research-kit/backend/app/schemas/conflicts.py`
- Create: `research-kit/backend/app/repos/conflicts.py`
- Create: `research-kit/backend/app/routers/conflicts.py`
- Create: `research-kit/backend/tests/test_conflicts.py`
- Modify: `research-kit/backend/app/main.py`

- [ ] **Step 1: Schemas**

```python
# app/schemas/conflicts.py
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field

class ConflictSide(BaseModel):
    claim_id: UUID
    label: str            # 'positive'|'negative'|'neutral'|'mixed'
    quote: str | None = None

class ConflictIn(BaseModel):
    project_id: UUID
    group_key: str = Field(min_length=1, max_length=400)
    doi: str | None = None
    paper_title: str | None = None
    sides: list[ConflictSide] = Field(min_length=2)

class ConflictPatch(BaseModel):
    resolution: str | None = Field(default=None, max_length=2000)

class ConflictOut(BaseModel):
    id: UUID
    project_id: UUID
    group_key: str
    doi: str | None
    paper_title: str | None
    flagged_at: datetime
    resolution: str | None
    sides: list[ConflictSide]
```

- [ ] **Step 2: Failing test**

```python
# tests/test_conflicts.py
import pytest

@pytest.mark.asyncio
async def test_conflicts_crud_and_cascade(client_dev_alice, client_dev_bob):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": "x", "site": "elicit"}, {"text": "y", "site": "scispace"}]})
    c1, c2 = [c["id"] for c in r.json()["created"]]

    body = {
        "project_id": pid, "group_key": "g1", "doi": "10.1/abc",
        "sides": [
            {"claim_id": c1, "label": "positive"},
            {"claim_id": c2, "label": "negative"},
        ],
    }
    r = await client_dev_alice.post("/v1/conflicts", json=body)
    assert r.status_code == 201
    cid = r.json()["id"]

    r = await client_dev_alice.get("/v1/conflicts", params={"project_id": pid})
    assert any(c["id"] == cid for c in r.json())

    r = await client_dev_bob.get("/v1/conflicts", params={"project_id": pid})
    assert all(c["id"] != cid for c in r.json())

    r = await client_dev_alice.patch(f"/v1/conflicts/{cid}", json={"resolution": "kept first"})
    assert r.json()["resolution"] == "kept first"

    # cascade
    await client_dev_alice.delete(f"/v1/projects/{pid}")
    r = await client_dev_alice.get("/v1/conflicts", params={"project_id": pid})
    assert r.json() == []
```

- [ ] **Step 3: Implement repo**

```python
# app/repos/conflicts.py
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import NotFoundError
from rk_shared.models import Conflict, Project


class ConflictRepo:
    def __init__(self, s: AsyncSession): self.s = s

    async def _ensure_project(self, user_id: UUID, project_id: UUID) -> None:
        if not (await self.s.execute(
            select(Project.id).where(Project.id == project_id, Project.user_id == user_id)
        )).scalar_one_or_none():
            raise NotFoundError("project not found")

    async def create(self, user_id: UUID, *, project_id: UUID, group_key: str,
                     doi: str | None, paper_title: str | None,
                     sides: list[dict]) -> Conflict:
        await self._ensure_project(user_id, project_id)
        c = Conflict(user_id=user_id, project_id=project_id, group_key=group_key,
                     doi=doi, paper_title=paper_title, sides=sides, resolution=None)
        self.s.add(c); await self.s.flush()
        return c

    async def list_for(self, user_id: UUID, *, project_id: UUID) -> list[Conflict]:
        return list((await self.s.execute(
            select(Conflict)
            .where(Conflict.user_id == user_id, Conflict.project_id == project_id)
            .order_by(Conflict.flagged_at.desc())
        )).scalars())

    async def patch(self, user_id: UUID, conflict_id: UUID, *,
                    resolution: str | None) -> Conflict:
        c = (await self.s.execute(
            select(Conflict).where(Conflict.id == conflict_id, Conflict.user_id == user_id)
        )).scalar_one_or_none()
        if not c:
            raise NotFoundError("conflict not found")
        if resolution is not None:
            c.resolution = resolution
        await self.s.flush()
        return c
```

- [ ] **Step 4: Implement router**

```python
# app/routers/conflicts.py
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, db
from app.repos.conflicts import ConflictRepo
from app.schemas.conflicts import ConflictIn, ConflictOut, ConflictPatch, ConflictSide
from rk_shared.models import User

router = APIRouter(prefix="/v1/conflicts", tags=["conflicts"])


def _out(c) -> ConflictOut:
    return ConflictOut(
        id=c.id, project_id=c.project_id, group_key=c.group_key,
        doi=c.doi, paper_title=c.paper_title, flagged_at=c.flagged_at,
        resolution=c.resolution,
        sides=[ConflictSide.model_validate(s) for s in (c.sides or [])],
    )


@router.get("", response_model=list[ConflictOut])
async def list_conflicts(project_id: UUID = Query(...),
                          u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    return [_out(c) for c in await ConflictRepo(s).list_for(u.id, project_id=project_id)]


@router.post("", response_model=ConflictOut, status_code=201)
async def create_conflict(body: ConflictIn, u: User = Depends(current_user),
                          s: AsyncSession = Depends(db)):
    c = await ConflictRepo(s).create(
        u.id, project_id=body.project_id, group_key=body.group_key,
        doi=body.doi, paper_title=body.paper_title,
        sides=[s.model_dump(mode="json") for s in body.sides],
    )
    await s.commit()
    return _out(c)


@router.patch("/{conflict_id}", response_model=ConflictOut)
async def patch_conflict(conflict_id: UUID, body: ConflictPatch,
                          u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    c = await ConflictRepo(s).patch(u.id, conflict_id, resolution=body.resolution)
    await s.commit()
    return _out(c)
```

- [ ] **Step 5: Wire router in `app/main.py`**

```python
from app.routers import conflicts as conflicts_router
app.include_router(conflicts_router.router)
```

- [ ] **Step 6: Run; expect pass.**

```
pytest tests/test_conflicts.py -v
```

- [ ] **Step 7: Commit**

```bash
git add research-kit/backend/app research-kit/backend/tests/test_conflicts.py
git commit -m "feat(backend): conflicts CRUD with cascade tests"
```

### Task G3 — Phase G checkpoint

- [ ] **Step 1:** Append to plan file:

```
## Checkpoint G — passed YYYY-MM-DD HH:MM
- Inbox + Conflicts CRUD live with row-level isolation and cascade delete.
- pytest green.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-08-researchkit-backend-goclaw.part2.md
git commit -m "chore(plan): checkpoint G passed"
```

---

## Phase H — Worker scaffold + MockRunner + EventBus

**Goal:** Stand up the arq worker package, a deterministic `MockRunner`, and the `EventBus` that satisfies invariants #1 (persist-before-publish) and #2 (monotonic seq under concurrency). No GoClaw yet.

### Task H1 — Worker package skeleton + arq settings

**Files:**
- Create: `research-kit/worker/pyproject.toml`
- Create: `research-kit/worker/main.py`
- Create: `research-kit/worker/db.py`
- Create: `research-kit/worker/tests/__init__.py` (empty)
- Create: `research-kit/worker/tests/conftest.py`

- [ ] **Step 1: pyproject.toml** (worker reuses backend's pkg + shared)

```toml
[project]
name = "rk-worker"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
  "arq>=0.26",
  "openai>=1.40",
  "structlog>=24.1",
  "redis[hiredis]>=5.0",
]
```

- [ ] **Step 2: `worker/db.py`** (worker has its own engine — workers cannot share FastAPI's connection pool)

```python
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
import os

_engine = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def init_engine(url: str | None = None) -> None:
    global _engine, _sessionmaker
    url = url or os.environ["DATABASE_URL"]
    _engine = create_async_engine(url, pool_size=5, max_overflow=10, pool_pre_ping=True)
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)


def session() -> AsyncSession:
    if _sessionmaker is None:
        init_engine()
    return _sessionmaker()
```

- [ ] **Step 3: `worker/main.py`** (arq settings; placeholder task — real one in Task I6)

```python
import os
import structlog
from arq.connections import RedisSettings

import worker.db as wdb

log = structlog.get_logger()


async def startup(ctx: dict) -> None:
    wdb.init_engine(os.environ["DATABASE_URL"])
    import redis.asyncio as aioredis
    ctx["redis"] = aioredis.from_url(os.environ["REDIS_URL"], decode_responses=True)
    log.info("worker.startup")


async def shutdown(ctx: dict) -> None:
    redis = ctx.get("redis")
    if redis:
        await redis.aclose()
    log.info("worker.shutdown")


# Task registry (filled in I6)
async def execute_run(ctx: dict, run_id: str) -> dict:
    from worker.tasks import _execute_run_impl
    return await _execute_run_impl(ctx, run_id)


class WorkerSettings:
    functions = [execute_run]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(os.environ.get("REDIS_URL", "redis://redis:6379/0"))
    max_jobs = 8
    job_timeout = 240            # max(KIND_TIMEOUTS) + buffer
    max_tries = 2
```

- [ ] **Step 4: Worker test conftest** — reuses backend's testcontainers Postgres/Redis fixtures via shared session-scoped containers.

```python
# worker/tests/conftest.py
import os, sys, pytest, asyncio
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend")))

# Re-export the backend's db_engine + redis_container fixtures so worker tests
# share the same containers (saves ~10s per run).
from tests.conftest import db_engine, redis_container, _db_url_for_alembic    # noqa: F401
```

(If `tests/conftest.py` does not yet expose `redis_container`, add it now — fixture wraps a `RedisContainer` from `testcontainers.redis` and sets `os.environ["REDIS_URL"]`.)

- [ ] **Step 5: Smoke test — worker imports cleanly**

```python
# worker/tests/test_import.py
def test_worker_settings_importable():
    from worker.main import WorkerSettings
    assert "execute_run" in {f.__name__ for f in WorkerSettings.functions}
```

- [ ] **Step 6: Run**

```
cd research-kit/backend
pytest ../worker/tests/test_import.py -v
```

Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add research-kit/worker
git commit -m "feat(worker): arq scaffold + db init + import smoke"
```

### Task H2 — Runner Protocol + CancelToken + RunEvent re-export

**Files:**
- Create: `research-kit/worker/runners/__init__.py` (empty)
- Create: `research-kit/worker/runners/base.py`
- Create: `research-kit/worker/tests/test_cancel_token.py`

- [ ] **Step 1: Write failing test for CancelToken**

```python
import pytest
from unittest.mock import AsyncMock

@pytest.mark.asyncio
async def test_cancel_token_reads_redis_key():
    from worker.runners.base import CancelToken
    redis = AsyncMock()
    redis.get = AsyncMock(side_effect=[None, "1"])
    t = CancelToken(redis, run_id="r1")
    assert await t.is_set() is False
    assert await t.is_set() is True
```

- [ ] **Step 2: Implement `worker/runners/base.py`**

```python
from __future__ import annotations
from typing import Protocol, AsyncIterator, Awaitable, Callable
from uuid import UUID
import redis.asyncio as aioredis

from rk_shared.events import RunEvent
from rk_shared.types import RunKind


class CancelledByUser(Exception):
    pass


class CancelToken:
    def __init__(self, redis: aioredis.Redis, run_id: UUID | str):
        self._r = redis
        self._key = f"cancel:{run_id}"

    async def is_set(self) -> bool:
        return bool(await self._r.get(self._key))


# A push-based event sink, called by runners for every chunk
EventSink = Callable[[RunEvent], Awaitable[int]]    # returns assigned seq


class AgentRunner(Protocol):
    async def run(
        self,
        *,
        kind: RunKind,
        user_id: UUID,
        run_id: UUID,
        messages: list[dict],
        on_event: EventSink,
        cancel: CancelToken,
        request_id: str,
    ) -> dict:                       # the final result dict (kind-specific)
        ...
```

- [ ] **Step 3: Run; expect pass.**

- [ ] **Step 4: Commit**

```bash
git add research-kit/worker/runners research-kit/worker/tests/test_cancel_token.py
git commit -m "feat(worker): AgentRunner Protocol + CancelToken"
```

### Task H3 — MockRunner

**Files:**
- Create: `research-kit/worker/runners/mock.py`
- Create: `research-kit/worker/tests/test_mock_runner.py`

- [ ] **Step 1: Failing test**

```python
import pytest, asyncio
from uuid import uuid4
from unittest.mock import AsyncMock

from rk_shared.types import RunKind


@pytest.mark.asyncio
async def test_mock_runner_emits_scripted_events():
    from worker.runners.mock import MockRunner, ScriptedEvent
    from worker.runners.base import CancelToken

    script = [
        ScriptedEvent({"type": "status", "payload": {"status": "running"}}, delay=0),
        ScriptedEvent({"type": "token",  "payload": {"text": "hi"}},        delay=0.01),
        ScriptedEvent({"type": "final",  "payload": {"ok": True}},          delay=0.01),
    ]
    runner = MockRunner(script=script)

    captured: list[dict] = []
    seq_counter = 0
    async def sink(ev):
        nonlocal seq_counter; seq_counter += 1
        captured.append({**ev, "seq": seq_counter}); return seq_counter

    redis = AsyncMock(); redis.get = AsyncMock(return_value=None)
    cancel = CancelToken(redis, run_id="r")
    result = await runner.run(kind=RunKind.VERIFY, user_id=uuid4(), run_id=uuid4(),
                              messages=[], on_event=sink, cancel=cancel, request_id="req")
    assert [e["type"] for e in captured] == ["status", "token", "final"]
    assert result == {"ok": True}


@pytest.mark.asyncio
async def test_mock_runner_respects_cancel_between_chunks():
    from worker.runners.mock import MockRunner, ScriptedEvent
    from worker.runners.base import CancelToken, CancelledByUser

    script = [ScriptedEvent({"type": "token", "payload": {"text": str(i)}}, delay=0.05)
              for i in range(20)]
    runner = MockRunner(script=script)

    redis = AsyncMock()
    redis.get = AsyncMock(side_effect=[None, None, "1"] + [None]*30)
    cancel = CancelToken(redis, run_id="r")

    async def sink(ev): return 1
    with pytest.raises(CancelledByUser):
        await runner.run(kind=RunKind.VERIFY, user_id="u", run_id="r",
                         messages=[], on_event=sink, cancel=cancel, request_id="req")
```

- [ ] **Step 2: Implement**

```python
# worker/runners/mock.py
from __future__ import annotations
import asyncio
from dataclasses import dataclass
from uuid import UUID

from rk_shared.events import RunEvent
from rk_shared.types import RunKind
from worker.runners.base import AgentRunner, CancelToken, CancelledByUser, EventSink


@dataclass
class ScriptedEvent:
    event: RunEvent
    delay: float = 0.0
    raise_exc: BaseException | None = None


class MockRunner:
    def __init__(self, script: list[ScriptedEvent]):
        self.script = script

    async def run(
        self, *, kind: RunKind, user_id: UUID, run_id: UUID,
        messages: list[dict], on_event: EventSink,
        cancel: CancelToken, request_id: str,
    ) -> dict:
        final_payload: dict = {}
        for step in self.script:
            if step.delay:
                await asyncio.sleep(step.delay)
            if await cancel.is_set():
                raise CancelledByUser()
            if step.raise_exc is not None:
                raise step.raise_exc
            await on_event(step.event)
            if step.event["type"] == "final":
                final_payload = step.event["payload"]
        return final_payload
```

- [ ] **Step 3: Run; pass.**

- [ ] **Step 4: Commit**

```bash
git add research-kit/worker/runners/mock.py research-kit/worker/tests/test_mock_runner.py
git commit -m "feat(worker): MockRunner with scripted events + cancel cooperation"
```

### Task H4 — EventBus: persist-before-publish (Invariant #1)

**Files:**
- Create: `research-kit/worker/event_bus.py`
- Create: `research-kit/worker/tests/test_event_bus_persist_before_publish.py`

- [ ] **Step 1: Failing test — invariant #1**

> "Worker always inserts `run_events` row first, then publishes to Redis. If publish fails, event is still replayable from Postgres." (spec §4.2 #1)

```python
import pytest, uuid
from unittest.mock import AsyncMock, MagicMock
from sqlalchemy import select

from rk_shared.models import User, Run, RunEventRow
from rk_shared.types import RunKind, RunStatus


@pytest.mark.asyncio
async def test_persist_before_publish_succeeds(db_engine):
    """Invariant §4.2 #1: row is in PG before redis.publish is called."""
    from worker.event_bus import EventBus

    async with db_engine() as s:
        u = User(google_sub="g", email="g"); s.add(u); await s.flush()
        run = Run(user_id=u.id, kind=RunKind.VERIFY.value, status=RunStatus.RUNNING.value,
                  input={})
        s.add(run); await s.commit(); await s.refresh(run)
        run_id = run.id

    redis = AsyncMock()
    publish_call_marker: dict = {"row_count_at_publish_time": None}

    # Spy: when publish is called, count rows that already exist in PG.
    async def spy_publish(channel: str, message: str) -> int:
        async with db_engine() as s2:
            count = (await s2.execute(
                select(RunEventRow).where(RunEventRow.run_id == run_id))).scalars().all()
            publish_call_marker["row_count_at_publish_time"] = len(count)
        return 1
    redis.publish = AsyncMock(side_effect=spy_publish)

    bus = EventBus(run_id=run_id, redis=redis, sessionmaker=db_engine)
    seq = await bus.publish({"type": "token", "payload": {"text": "hi"}})

    assert seq == 1
    assert publish_call_marker["row_count_at_publish_time"] == 1


@pytest.mark.asyncio
async def test_persist_survives_redis_publish_failure(db_engine):
    """If redis.publish raises, the event is still in PG (replayable)."""
    from worker.event_bus import EventBus

    async with db_engine() as s:
        u = User(google_sub="g2", email="g2"); s.add(u); await s.flush()
        run = Run(user_id=u.id, kind=RunKind.VERIFY.value, status=RunStatus.RUNNING.value,
                  input={})
        s.add(run); await s.commit(); await s.refresh(run)
        run_id = run.id

    redis = AsyncMock()
    redis.publish = AsyncMock(side_effect=RuntimeError("redis down"))

    bus = EventBus(run_id=run_id, redis=redis, sessionmaker=db_engine)
    with pytest.raises(RuntimeError, match="redis down"):
        await bus.publish({"type": "token", "payload": {"text": "hi"}})

    async with db_engine() as s:
        rows = list((await s.execute(
            select(RunEventRow).where(RunEventRow.run_id == run_id))).scalars())
    assert len(rows) == 1 and rows[0].seq == 1
```

- [ ] **Step 2: Implement EventBus**

```python
# worker/event_bus.py
from __future__ import annotations
import json
from datetime import datetime, timezone
from uuid import UUID

import redis.asyncio as aioredis
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rk_shared.events import RunEvent
from rk_shared.models import RunEventRow


class EventBus:
    """Persist-before-publish event sink for a single run.

    Invariants enforced (spec §4.2):
      #1 PG INSERT commits before redis.publish.
      #2 seq is allocated under an advisory transaction lock, so concurrent
         publishers serialize per run_id.
    """
    def __init__(
        self,
        *,
        run_id: UUID,
        redis: aioredis.Redis,
        sessionmaker: async_sessionmaker[AsyncSession],
    ) -> None:
        self.run_id = run_id
        self.redis = redis
        self._sm = sessionmaker

    async def publish(self, event: RunEvent) -> int:
        seq = await self._persist(event)
        # PG transaction has committed before we hit Redis.
        await self.redis.publish(
            f"run:{self.run_id}",
            json.dumps({
                "seq": seq, "type": event["type"], "payload": event["payload"],
                "ts": datetime.now(tz=timezone.utc).isoformat(),
            }),
        )
        return seq

    async def _persist(self, event: RunEvent) -> int:
        async with self._sm() as s:
            async with s.begin():
                # advisory lock per run_id — Postgres-specific, hash-based key
                await s.execute(
                    text("SELECT pg_advisory_xact_lock(hashtext(:rid))"),
                    {"rid": str(self.run_id)},
                )
                cur_max = (await s.execute(
                    select(func.coalesce(func.max(RunEventRow.seq), 0))
                    .where(RunEventRow.run_id == self.run_id)
                )).scalar_one()
                seq = int(cur_max) + 1
                s.add(RunEventRow(
                    run_id=self.run_id, seq=seq,
                    type=event["type"], payload=event["payload"],
                ))
            # transaction committed here
        return seq
```

- [ ] **Step 3: Run; pass.**

```
pytest ../worker/tests/test_event_bus_persist_before_publish.py -v
```

- [ ] **Step 4: Commit**

```bash
git add research-kit/worker/event_bus.py \
        research-kit/worker/tests/test_event_bus_persist_before_publish.py
git commit -m "feat(worker): EventBus persist-before-publish (invariant #1)"
```

### Task H5 — EventBus monotonic seq under concurrency (Invariant #2)

**Files:**
- Create: `research-kit/worker/tests/test_event_bus_monotonic_seq.py`

- [ ] **Step 1: Failing test — invariant #2**

> "Monotonic seq. Allocated by advisory-lock + COALESCE(MAX(seq),0)+1. Never derived from Redis." (spec §4.2 #2)

```python
import asyncio, pytest
from unittest.mock import AsyncMock
from uuid import uuid4
from sqlalchemy import select

from rk_shared.models import User, Run, RunEventRow
from rk_shared.types import RunKind, RunStatus


@pytest.mark.asyncio
async def test_concurrent_publishes_produce_dense_unique_seq(db_engine):
    """50 concurrent publishes on same run_id => seqs 1..50, no gaps, no dupes."""
    from worker.event_bus import EventBus

    async with db_engine() as s:
        u = User(google_sub="g3", email="g3"); s.add(u); await s.flush()
        run = Run(user_id=u.id, kind=RunKind.VERIFY.value, status=RunStatus.RUNNING.value,
                  input={})
        s.add(run); await s.commit(); await s.refresh(run)
        run_id = run.id

    redis = AsyncMock(); redis.publish = AsyncMock(return_value=1)
    bus = EventBus(run_id=run_id, redis=redis, sessionmaker=db_engine)

    N = 50
    seqs = await asyncio.gather(*[
        bus.publish({"type": "token", "payload": {"i": i}}) for i in range(N)
    ])
    assert sorted(seqs) == list(range(1, N + 1))     # dense, unique

    async with db_engine() as s:
        rows = list((await s.execute(
            select(RunEventRow.seq).where(RunEventRow.run_id == run_id)
            .order_by(RunEventRow.seq)
        )).scalars())
    assert rows == list(range(1, N + 1))


@pytest.mark.asyncio
async def test_publishes_on_different_runs_do_not_block(db_engine):
    """Lock is per-run, not global."""
    from worker.event_bus import EventBus

    async with db_engine() as s:
        u = User(google_sub="g4", email="g4"); s.add(u); await s.flush()
        runs = [Run(user_id=u.id, kind=RunKind.VERIFY.value,
                    status=RunStatus.RUNNING.value, input={}) for _ in range(5)]
        s.add_all(runs); await s.commit()
        for r in runs: await s.refresh(r)
        ids = [r.id for r in runs]

    redis = AsyncMock(); redis.publish = AsyncMock(return_value=1)

    async def pub(rid):
        bus = EventBus(run_id=rid, redis=redis, sessionmaker=db_engine)
        return [await bus.publish({"type": "token", "payload": {}}) for _ in range(3)]

    results = await asyncio.gather(*[pub(rid) for rid in ids])
    for seqs in results:
        assert seqs == [1, 2, 3]
```

- [ ] **Step 2: Run** — should already pass (advisory lock implementation in H4 covers concurrency).

```
pytest ../worker/tests/test_event_bus_monotonic_seq.py -v
```

If it does not pass, the bug is almost certainly that `_persist` releases the advisory lock too early (advisory_xact_lock is held until commit; do not switch to advisory_lock + advisory_unlock).

- [ ] **Step 3: Commit**

```bash
git add research-kit/worker/tests/test_event_bus_monotonic_seq.py
git commit -m "test(worker): EventBus monotonic seq under concurrency (invariant #2)"
```

### Task H6 — Phase H checkpoint

- [ ] **Step 1:** Append checkpoint and commit.

```
## Checkpoint H — passed YYYY-MM-DD HH:MM
- Worker package importable; arq settings declared.
- AgentRunner Protocol + CancelToken + MockRunner.
- EventBus enforces invariants #1 (persist-before-publish) and #2 (monotonic seq).
```

```bash
git add docs/superpowers/plans/2026-05-08-researchkit-backend-goclaw.part2.md
git commit -m "chore(plan): checkpoint H passed"
```

---

## Phase I — Runs API + arq enqueue + cancel + execute_run task

**Goal:** Wire `POST /v1/runs`, `GET /v1/runs/{id}`, `POST /v1/runs/{id}/cancel`, and the worker's `execute_run` task. Cover invariants #4 (idempotency) and #5 (cancel within 2s).

### Task I1 — Run schemas

**Files:**
- Create: `research-kit/backend/app/schemas/runs.py`

- [ ] **Step 1: Write**

```python
from datetime import datetime
from uuid import UUID
from typing import Any, Literal
from pydantic import BaseModel, Field


class RunCreate(BaseModel):
    kind: Literal["verify", "extract", "chat", "draft", "conflict"]
    input: dict[str, Any]
    project_id: UUID | None = None
    idempotency_key: str = Field(min_length=1, max_length=200)


class RunCreateResponse(BaseModel):
    run_id: UUID
    status: str
    stream_url: str


class RunOut(BaseModel):
    id: UUID
    kind: str
    status: str
    project_id: UUID | None
    input: dict
    result: dict | None
    error: dict | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
```

- [ ] **Step 2: Commit**

```bash
git add research-kit/backend/app/schemas/runs.py
git commit -m "feat(backend): run schemas"
```

### Task I2 — Run repo with idempotency

**Files:**
- Create: `research-kit/backend/app/repos/runs.py`
- Create: `research-kit/backend/tests/test_runs_repo.py`

- [ ] **Step 1: Failing test** — invariant #4 at the repo level.

```python
import pytest, hashlib, json
from rk_shared.models import User
from rk_shared.types import RunKind


@pytest.mark.asyncio
async def test_create_or_get_idempotent(db_engine):
    from app.repos.runs import RunRepo

    async with db_engine() as s:
        u = User(google_sub="g", email="g"); s.add(u); await s.commit(); await s.refresh(u)
        repo = RunRepo(s)
        body = {"claim_id": "c1"}
        r1, created1 = await repo.create_or_get(
            user_id=u.id, kind=RunKind.VERIFY, project_id=None,
            input=body, idempotency_key="k1",
        )
        await s.commit()
        r2, created2 = await repo.create_or_get(
            user_id=u.id, kind=RunKind.VERIFY, project_id=None,
            input=body, idempotency_key="k1",
        )
        assert r1.id == r2.id
        assert created1 is True and created2 is False


@pytest.mark.asyncio
async def test_idem_conflict_on_diff_payload(db_engine):
    from app.errors import ConflictError
    from app.repos.runs import RunRepo

    async with db_engine() as s:
        u = User(google_sub="g2", email="g2"); s.add(u); await s.commit(); await s.refresh(u)
        repo = RunRepo(s)
        await repo.create_or_get(user_id=u.id, kind=RunKind.VERIFY, project_id=None,
                                 input={"a": 1}, idempotency_key="k2")
        await s.commit()
        with pytest.raises(ConflictError):
            await repo.create_or_get(user_id=u.id, kind=RunKind.VERIFY, project_id=None,
                                     input={"a": 2}, idempotency_key="k2")
```

- [ ] **Step 2: Implement**

```python
# app/repos/runs.py
from __future__ import annotations
import hashlib, json
from uuid import UUID
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ConflictError, NotFoundError
from rk_shared.models import Run
from rk_shared.types import RunKind, RunStatus


def _hash_input(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


class RunRepo:
    def __init__(self, s: AsyncSession): self.s = s

    async def create_or_get(
        self, *, user_id: UUID, kind: RunKind, project_id: UUID | None,
        input: dict, idempotency_key: str,
    ) -> tuple[Run, bool]:
        existing = (await self.s.execute(
            select(Run).where(Run.user_id == user_id,
                              Run.idempotency_key == idempotency_key)
        )).scalar_one_or_none()
        if existing:
            if _hash_input(existing.input) != _hash_input(input):
                raise ConflictError("idempotency_key reused with different payload")
            return existing, False

        run = Run(
            user_id=user_id, project_id=project_id,
            kind=kind.value, status=RunStatus.QUEUED.value,
            input=input, idempotency_key=idempotency_key,
        )
        self.s.add(run); await self.s.flush()
        return run, True

    async def get(self, user_id: UUID, run_id: UUID) -> Run:
        run = (await self.s.execute(
            select(Run).where(Run.id == run_id, Run.user_id == user_id)
        )).scalar_one_or_none()
        if not run:
            raise NotFoundError("run not found")
        return run

    async def mark_cancelling(self, user_id: UUID, run_id: UUID) -> Run:
        run = await self.get(user_id, run_id)
        if run.status in {RunStatus.SUCCEEDED.value, RunStatus.FAILED.value,
                          RunStatus.CANCELLED.value}:
            return run
        run.status = RunStatus.CANCELLING.value
        await self.s.flush()
        return run

    async def transition(self, run_id: UUID, *, status: RunStatus,
                         result: dict | None = None, error: dict | None = None,
                         started_at: datetime | None = None,
                         finished_at: datetime | None = None) -> None:
        run = (await self.s.execute(
            select(Run).where(Run.id == run_id))).scalar_one()
        run.status = status.value
        if result is not None:    run.result = result
        if error is not None:     run.error = error
        if started_at is not None:  run.started_at = started_at
        if finished_at is not None: run.finished_at = finished_at
```

- [ ] **Step 3: Run; pass.**

- [ ] **Step 4: Commit**

```bash
git add research-kit/backend/app/repos/runs.py research-kit/backend/tests/test_runs_repo.py
git commit -m "feat(backend): run repo with idempotent create_or_get (invariant #4)"
```

### Task I3 — POST /v1/runs router + arq enqueue

**Files:**
- Create: `research-kit/backend/app/queue.py`
- Create: `research-kit/backend/app/routers/runs.py`
- Create: `research-kit/backend/tests/test_runs_post.py`
- Modify: `research-kit/backend/app/main.py`

- [ ] **Step 1: Failing test (uses MockRunner via env override)**

```python
import pytest

@pytest.mark.asyncio
async def test_post_runs_returns_201_and_enqueues(client_dev_alice, monkeypatch):
    """Invariant §4.2 #4: idempotent POST returns same run_id; enqueue called once."""
    from app import queue as q
    calls: list[str] = []
    async def fake_enqueue(redis, run_id):
        calls.append(str(run_id))
    monkeypatch.setattr(q, "enqueue_run", fake_enqueue)

    body = {"kind": "verify", "input": {"claim_id": "c1"}, "idempotency_key": "k1"}
    r1 = await client_dev_alice.post("/v1/runs", json=body)
    assert r1.status_code == 201
    rid = r1.json()["run_id"]
    assert r1.json()["status"] == "queued"
    assert r1.json()["stream_url"] == f"/v1/runs/{rid}/stream"

    r2 = await client_dev_alice.post("/v1/runs", json=body)
    assert r2.status_code == 201
    assert r2.json()["run_id"] == rid

    assert calls == [rid]                             # enqueued exactly once

@pytest.mark.asyncio
async def test_post_runs_idem_conflict(client_dev_alice, monkeypatch):
    from app import queue as q
    monkeypatch.setattr(q, "enqueue_run", (lambda *a, **k: None))
    body1 = {"kind": "verify", "input": {"a": 1}, "idempotency_key": "kk"}
    body2 = {"kind": "verify", "input": {"a": 2}, "idempotency_key": "kk"}
    assert (await client_dev_alice.post("/v1/runs", json=body1)).status_code == 201
    r = await client_dev_alice.post("/v1/runs", json=body2)
    assert r.status_code == 409
```

- [ ] **Step 2: Implement queue helper**

```python
# app/queue.py
from arq import create_pool
from arq.connections import RedisSettings
from app.config import get_settings

_pool = None

async def get_pool():
    global _pool
    if _pool is None:
        _pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    return _pool

async def enqueue_run(redis_pool, run_id) -> None:
    pool = redis_pool or await get_pool()
    await pool.enqueue_job("execute_run", str(run_id))
```

- [ ] **Step 3: Implement router**

```python
# app/routers/runs.py
from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, db
from app.queue import enqueue_run, get_pool
from app.repos.runs import RunRepo
from app.schemas.runs import RunCreate, RunCreateResponse, RunOut
from rk_shared.models import User
from rk_shared.types import RunKind

router = APIRouter(prefix="/v1/runs", tags=["runs"])


def _out(r) -> RunOut:
    return RunOut(
        id=r.id, kind=r.kind, status=r.status, project_id=r.project_id,
        input=r.input, result=r.result, error=r.error,
        created_at=r.created_at, started_at=r.started_at, finished_at=r.finished_at,
    )


@router.post("", response_model=RunCreateResponse, status_code=201)
async def create_run(body: RunCreate,
                     u: User = Depends(current_user),
                     s: AsyncSession = Depends(db)):
    repo = RunRepo(s)
    run, created = await repo.create_or_get(
        user_id=u.id, kind=RunKind(body.kind), project_id=body.project_id,
        input=body.input, idempotency_key=body.idempotency_key,
    )
    await s.commit()
    if created:
        await enqueue_run(await get_pool(), run.id)
    return RunCreateResponse(
        run_id=run.id, status=run.status,
        stream_url=f"/v1/runs/{run.id}/stream",
    )


@router.get("/{run_id}", response_model=RunOut)
async def get_run(run_id: UUID,
                  u: User = Depends(current_user),
                  s: AsyncSession = Depends(db)):
    return _out(await RunRepo(s).get(u.id, run_id))
```

Wire in `main.py`:

```python
from app.routers import runs as runs_router
app.include_router(runs_router.router)
```

- [ ] **Step 4: Run; pass.**

```
pytest tests/test_runs_post.py -v
```

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app research-kit/backend/tests/test_runs_post.py
git commit -m "feat(backend): POST /v1/runs + idempotent dedup (invariant #4)"
```

### Task I4 — POST /v1/runs/{id}/cancel

**Files:**
- Modify: `research-kit/backend/app/routers/runs.py`
- Create: `research-kit/backend/tests/test_runs_cancel.py`

- [ ] **Step 1: Failing test**

```python
import pytest, json

@pytest.mark.asyncio
async def test_cancel_writes_redis_key_and_status(client_dev_alice, monkeypatch, redis_container):
    from app import queue as q
    monkeypatch.setattr(q, "enqueue_run", (lambda *a, **k: None))
    body = {"kind": "verify", "input": {}, "idempotency_key": "kc"}
    r = await client_dev_alice.post("/v1/runs", json=body)
    rid = r.json()["run_id"]

    r2 = await client_dev_alice.post(f"/v1/runs/{rid}/cancel")
    assert r2.status_code == 202

    # status flipped to cancelling
    r3 = await client_dev_alice.get(f"/v1/runs/{rid}")
    assert r3.json()["status"] == "cancelling"

    # redis key written
    import redis.asyncio as aioredis
    rds = aioredis.from_url(redis_container.url, decode_responses=True)
    val = await rds.get(f"cancel:{rid}")
    assert val == "1"
    ttl = await rds.ttl(f"cancel:{rid}")
    assert 0 < ttl <= 300
```

- [ ] **Step 2: Implement**

Append to `app/routers/runs.py`:

```python
from fastapi import Response
from app.redis_pool import get_redis

@router.post("/{run_id}/cancel", status_code=202)
async def cancel_run(run_id: UUID,
                      u: User = Depends(current_user),
                      s: AsyncSession = Depends(db)) -> Response:
    await RunRepo(s).mark_cancelling(u.id, run_id)
    await s.commit()
    rds = await get_redis()
    await rds.set(f"cancel:{run_id}", "1", ex=300)
    return Response(status_code=202)
```

- [ ] **Step 3: Run; pass.**

- [ ] **Step 4: Commit**

```bash
git add research-kit/backend/app/routers/runs.py research-kit/backend/tests/test_runs_cancel.py
git commit -m "feat(backend): POST /v1/runs/{id}/cancel writes redis cancel key"
```

### Task I5 — execute_run task (worker side)

**Files:**
- Create: `research-kit/worker/tasks.py`
- Create: `research-kit/worker/runner_factory.py`
- Create: `research-kit/worker/tests/test_execute_run.py`

- [ ] **Step 1: Failing test — happy path with MockRunner**

```python
import pytest, asyncio
from sqlalchemy import select

from rk_shared.models import User, Run, RunEventRow
from rk_shared.types import RunKind, RunStatus


@pytest.mark.asyncio
async def test_execute_run_happy_path(db_engine, redis_container, monkeypatch):
    """MockRunner emits status/token/final → run reaches succeeded with result."""
    from worker.tasks import _execute_run_impl
    from worker.runners.mock import MockRunner, ScriptedEvent
    from worker import runner_factory

    runner = MockRunner(script=[
        ScriptedEvent({"type": "status", "payload": {"status": "running"}}),
        ScriptedEvent({"type": "token",  "payload": {"text": "hi"}}, delay=0.01),
        ScriptedEvent({"type": "final",  "payload": {"verdict": "verified"}}),
    ])
    monkeypatch.setattr(runner_factory, "build_runner", lambda kind: runner)

    async with db_engine() as s:
        u = User(google_sub="g", email="g"); s.add(u); await s.flush()
        run = Run(user_id=u.id, kind=RunKind.VERIFY.value,
                  status=RunStatus.QUEUED.value, input={"claim_id": "c"})
        s.add(run); await s.commit(); await s.refresh(run); rid = run.id

    import redis.asyncio as aioredis
    rds = aioredis.from_url(redis_container.url, decode_responses=True)
    ctx = {"redis": rds}
    await _execute_run_impl(ctx, str(rid))

    async with db_engine() as s:
        r = (await s.execute(select(Run).where(Run.id == rid))).scalar_one()
        events = list((await s.execute(
            select(RunEventRow).where(RunEventRow.run_id == rid)
            .order_by(RunEventRow.seq))).scalars())
    assert r.status == RunStatus.SUCCEEDED.value
    assert r.result == {"verdict": "verified"}
    assert [e.type for e in events] == ["status", "status", "token", "final"]
    # ^ first 'status' is QUEUED→RUNNING transition published by execute_run
```

- [ ] **Step 2: Runner factory**

```python
# worker/runner_factory.py
import os
from rk_shared.types import RunKind


def build_runner(kind: RunKind):
    """Returns the active runner. Switched to GoClawRunner in Phase L."""
    backend = os.environ.get("RK_RUNNER", "mock").lower()
    if backend == "mock":
        from worker.runners.mock import MockRunner, ScriptedEvent
        # Default mock script: trivial non-empty success.
        return MockRunner(script=[
            ScriptedEvent({"type": "final", "payload": {"ok": True}}),
        ])
    if backend == "goclaw":
        from worker.runners.goclaw import GoClawRunner
        return GoClawRunner()
    raise RuntimeError(f"unknown RK_RUNNER={backend}")
```

- [ ] **Step 3: Implement task**

```python
# worker/tasks.py
from __future__ import annotations
import asyncio, os
from datetime import datetime, timezone
from uuid import UUID

import structlog
from sqlalchemy import select

from rk_shared.events import RunEvent
from rk_shared.models import Run
from rk_shared.types import RunKind, RunStatus, KIND_TIMEOUTS_SEC, TERMINAL_STATUSES
from worker import db as wdb
from worker.event_bus import EventBus
from worker.runner_factory import build_runner
from worker.runners.base import CancelToken, CancelledByUser

log = structlog.get_logger()


def _build_messages(kind: RunKind, run_input: dict) -> list[dict]:
    """Lightweight switch — full prompt builders land in Phase L."""
    from worker.prompts import verify, extract, chat, draft, conflict
    return {
        RunKind.VERIFY:   verify.build_messages,
        RunKind.EXTRACT:  extract.build_messages,
        RunKind.CHAT:     chat.build_messages,
        RunKind.DRAFT:    draft.build_messages,
        RunKind.CONFLICT: conflict.build_messages,
    }[kind](run_input)


async def _execute_run_impl(ctx: dict, run_id_str: str) -> dict:
    run_id = UUID(run_id_str)
    redis = ctx["redis"]

    # 1. Read & terminal-status early-exit (invariant §4.2 #7 retry safety)
    async with wdb.session() as s:
        run = (await s.execute(select(Run).where(Run.id == run_id))).scalar_one_or_none()
        if not run:
            log.warning("execute_run.missing", run_id=run_id_str)
            return {"skipped": True}
        if run.status in {st.value for st in TERMINAL_STATUSES}:
            log.info("execute_run.terminal_exit", run_id=run_id_str, status=run.status)
            return {"skipped": True, "status": run.status}

        kind = RunKind(run.kind); user_id = run.user_id; run_input = run.input
        run.status = RunStatus.RUNNING.value
        run.started_at = datetime.now(tz=timezone.utc)
        await s.commit()

    bus = EventBus(run_id=run_id, redis=redis, sessionmaker=wdb._sessionmaker)
    cancel = CancelToken(redis, run_id)
    runner = build_runner(kind)
    request_id = ctx.get("request_id", run_id_str)

    await bus.publish({"type": "status", "payload": {"status": "running"}})

    timeout_sec = KIND_TIMEOUTS_SEC[kind]

    try:
        messages = _build_messages(kind, run_input)
        async with asyncio.timeout(timeout_sec):
            result = await runner.run(
                kind=kind, user_id=user_id, run_id=run_id,
                messages=messages, on_event=bus.publish,
                cancel=cancel, request_id=request_id,
            )
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
        from app.errors import UpstreamError
        recoverable = isinstance(e, UpstreamError)
        err = {"code": "upstream" if recoverable else "internal",
               "message": str(e)[:500], "recoverable": recoverable}
        await _finalize(run_id, RunStatus.FAILED, error=err, result=None)
        await bus.publish({"type": "error", "payload": err})
        return {"status": "failed", "error": err}

    await _finalize(run_id, RunStatus.SUCCEEDED, result=result, error=None)
    await bus.publish({"type": "final", "payload": result})
    return {"status": "succeeded"}


async def _finalize(run_id: UUID, status: RunStatus, *,
                    result: dict | None, error: dict | None) -> None:
    async with wdb.session() as s:
        run = (await s.execute(select(Run).where(Run.id == run_id))).scalar_one()
        run.status = status.value
        run.finished_at = datetime.now(tz=timezone.utc)
        if result is not None: run.result = result
        if error is not None:  run.error = error
        await s.commit()
```

- [ ] **Step 4: Stub prompt builders** (real ones come in Phase L; unblock import-time only).

Create `research-kit/worker/prompts/__init__.py` (empty), then five files each containing:

```python
# worker/prompts/verify.py  (and extract / chat / draft / conflict)
def build_messages(input: dict) -> list[dict]:
    return [{"role": "user", "content": str(input)}]    # placeholder until Phase L
```

- [ ] **Step 5: Run; pass.**

```
pytest ../worker/tests/test_execute_run.py -v
```

- [ ] **Step 6: Commit**

```bash
git add research-kit/worker/tasks.py research-kit/worker/runner_factory.py \
        research-kit/worker/prompts research-kit/worker/tests/test_execute_run.py
git commit -m "feat(worker): execute_run task with terminal-exit, cancel, timeout"
```

### Task I6 — Cancel completes within 2s (Invariant #5)

**Files:**
- Create: `research-kit/worker/tests/test_cancel_within_2s.py`

- [ ] **Step 1: Failing test — invariant #5**

> "Cancel is cooperative + bounded. POST cancel → status='cancelling' + redis SET. Worker checks cancel_token between every chunk; cancel completes within 2s on a runner emitting chunks every 100ms." (spec §4.2 #5)

```python
import pytest, asyncio, time
import redis.asyncio as aioredis
from sqlalchemy import select

from rk_shared.models import User, Run
from rk_shared.types import RunKind, RunStatus


@pytest.mark.asyncio
async def test_cancel_completes_within_2s(db_engine, redis_container, monkeypatch):
    from worker.tasks import _execute_run_impl
    from worker.runners.mock import MockRunner, ScriptedEvent
    from worker import runner_factory

    # Long script: 100 tokens at 100ms each → ~10s if not cancelled.
    runner = MockRunner(script=[
        ScriptedEvent({"type": "token", "payload": {"text": str(i)}}, delay=0.1)
        for i in range(100)
    ] + [ScriptedEvent({"type": "final", "payload": {"ok": True}})])
    monkeypatch.setattr(runner_factory, "build_runner", lambda kind: runner)

    async with db_engine() as s:
        u = User(google_sub="g", email="g"); s.add(u); await s.flush()
        run = Run(user_id=u.id, kind=RunKind.VERIFY.value,
                  status=RunStatus.QUEUED.value, input={})
        s.add(run); await s.commit(); await s.refresh(run); rid = run.id

    rds = aioredis.from_url(redis_container.url, decode_responses=True)

    async def cancel_after_500ms():
        await asyncio.sleep(0.5)
        await rds.set(f"cancel:{rid}", "1", ex=300)

    t0 = time.monotonic()
    await asyncio.gather(
        _execute_run_impl({"redis": rds}, str(rid)),
        cancel_after_500ms(),
    )
    elapsed = time.monotonic() - t0

    async with db_engine() as s:
        r = (await s.execute(select(Run).where(Run.id == rid))).scalar_one()
    assert r.status == RunStatus.CANCELLED.value
    assert elapsed < 2.0, f"cancel took {elapsed:.2f}s (must be <2s)"
```

- [ ] **Step 2: Run; expect pass.**

```
pytest ../worker/tests/test_cancel_within_2s.py -v
```

If `MockRunner` does not check `cancel.is_set()` between chunks, this test will time out. The fix is in `worker/runners/mock.py` — already implemented in H3.

- [ ] **Step 3: Commit**

```bash
git add research-kit/worker/tests/test_cancel_within_2s.py
git commit -m "test(worker): cancel completes within 2s (invariant #5)"
```

### Task I7 — Phase I checkpoint

- [ ] Append checkpoint, commit:

```
## Checkpoint I — passed YYYY-MM-DD HH:MM
- POST/GET/cancel runs endpoints + execute_run task wired.
- Invariants #4 (idempotency, including ConflictError on diff-payload) and #5 (cancel <2s) verified.
```

```bash
git add docs/superpowers/plans/2026-05-08-researchkit-backend-goclaw.part2.md
git commit -m "chore(plan): checkpoint I passed"
```

---

## Phase J — SSE replay-then-tail + remaining invariants

**Goal:** Implement `GET /v1/runs/{id}/stream` with the replay-then-tail protocol; cover invariants #3 (no-dup overlap), #6 (per-kind timeout), #7 (worker-crash retry idempotent), #8 (GoClaw outage → recoverable).

### Task J1 — SSE handler (replay then tail)

**Files:**
- Create: `research-kit/backend/app/events/__init__.py` (empty)
- Create: `research-kit/backend/app/events/replay.py`
- Modify: `research-kit/backend/app/routers/runs.py`

- [ ] **Step 1: Implement replay generator**

```python
# app/events/replay.py
from __future__ import annotations
import asyncio, json
from uuid import UUID
from typing import AsyncIterator

import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

from rk_shared.models import RunEventRow

TERMINAL_TYPES = {"final", "error"}


async def replay_then_tail(
    *, run_id: UUID, last_seq: int,
    sessionmaker: async_sessionmaker[AsyncSession],
    redis: aioredis.Redis,
    initial_status: str,
) -> AsyncIterator[dict]:
    """Yield events with seq > last_seq from PG, then tail Redis pub/sub.

    Invariant #3: events delivered exactly once across the PG/Redis boundary.
    """
    pubsub = redis.pubsub()
    await pubsub.subscribe(f"run:{run_id}")
    max_seq_sent = last_seq
    try:
        # Phase 1: replay from PG strictly > last_seq, ascending.
        async with sessionmaker() as s:
            rows = list((await s.execute(
                select(RunEventRow)
                .where(RunEventRow.run_id == run_id, RunEventRow.seq > last_seq)
                .order_by(RunEventRow.seq)
            )).scalars())
        for row in rows:
            payload = {"seq": row.seq, "type": row.type,
                       "payload": row.payload, "ts": row.ts.isoformat()}
            yield payload
            max_seq_sent = row.seq
            if row.type in TERMINAL_TYPES:
                return

        # If the run is already in a terminal state and PG has no further events,
        # the final/error event is in the rows above; otherwise we tail Redis.
        if initial_status in {"succeeded", "failed", "cancelled"}:
            # Re-check PG once more to catch races between status update and event insert.
            async with sessionmaker() as s:
                rows = list((await s.execute(
                    select(RunEventRow)
                    .where(RunEventRow.run_id == run_id, RunEventRow.seq > max_seq_sent)
                    .order_by(RunEventRow.seq)
                )).scalars())
            for row in rows:
                payload = {"seq": row.seq, "type": row.type,
                           "payload": row.payload, "ts": row.ts.isoformat()}
                yield payload
                max_seq_sent = row.seq
            return

        # Phase 2: tail Redis. Drop anything <= max_seq_sent (overlap with replay).
        async for msg in pubsub.listen():
            if msg.get("type") != "message":
                continue
            data = json.loads(msg["data"])
            if data["seq"] <= max_seq_sent:
                continue
            yield data
            max_seq_sent = data["seq"]
            if data["type"] in TERMINAL_TYPES:
                return
    finally:
        try: await pubsub.unsubscribe(f"run:{run_id}")
        except Exception: pass
        try: await pubsub.aclose()
        except Exception: pass
```

- [ ] **Step 2: Wire SSE endpoint** — append to `app/routers/runs.py`:

```python
from fastapi import Header, Query
from sse_starlette.sse import EventSourceResponse
import json

from app.events.replay import replay_then_tail
from app.db import sessionmaker as get_sessionmaker

@router.get("/{run_id}/stream")
async def stream_run(
    run_id: UUID,
    last_seq: int = Query(default=0, ge=0),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    u: User = Depends(current_user),
    s: AsyncSession = Depends(db),
) -> EventSourceResponse:
    run = await RunRepo(s).get(u.id, run_id)              # also enforces ownership
    effective = max(last_seq, int(last_event_id) if last_event_id else 0)

    rds = await get_redis()
    sm = get_sessionmaker()

    async def gen():
        async for ev in replay_then_tail(
            run_id=run_id, last_seq=effective,
            sessionmaker=sm, redis=rds, initial_status=run.status,
        ):
            yield {
                "event": "run_event",
                "id": str(ev["seq"]),
                "data": json.dumps(ev, default=str),
            }
    return EventSourceResponse(gen())
```

(`app/db.py` must export a `sessionmaker()` accessor; if missing from Phase B, add: `def sessionmaker() -> async_sessionmaker[AsyncSession]: return _sessionmaker`.)

- [ ] **Step 3: Run** — module-level smoke (no test yet):

```
python -c "from app.routers.runs import router; print('ok')"
```

- [ ] **Step 4: Commit**

```bash
git add research-kit/backend/app/events research-kit/backend/app/routers/runs.py \
        research-kit/backend/app/db.py
git commit -m "feat(backend): SSE replay-then-tail handler"
```

### Task J2 — Invariant #3: replay-then-tail without duplicates

**Files:**
- Create: `research-kit/backend/tests/test_sse_replay_no_dup.py`

- [ ] **Step 1: Failing test — invariant #3**

> "Replay-then-tail without dup. SSE handler completes Postgres replay before subscribing Redis; client filters anything ≤ max_seq_sent in the overlap window. Tested by injecting publishes during replay." (spec §4.2 #3)

```python
import pytest, asyncio, json, httpx, redis.asyncio as aioredis
from sqlalchemy import select

from rk_shared.models import User, Run, RunEventRow
from rk_shared.types import RunKind, RunStatus


async def _seed_run_with_events(db_engine, n_pre: int) -> tuple[str, str]:
    async with db_engine() as s:
        u = User(google_sub="g", email="g"); s.add(u); await s.flush()
        run = Run(user_id=u.id, kind=RunKind.VERIFY.value,
                  status=RunStatus.RUNNING.value, input={})
        s.add(run); await s.commit(); await s.refresh(run)
        for i in range(1, n_pre + 1):
            s.add(RunEventRow(run_id=run.id, seq=i, type="token",
                              payload={"i": i}))
        await s.commit()
        return str(run.id), str(u.id)


@pytest.mark.asyncio
async def test_sse_no_dup_in_overlap_window(client, db_engine, redis_container, monkeypatch):
    """Ensure events seq=10..15 (in PG) are not also delivered when redis publishes them
    again concurrently during the replay phase."""
    monkeypatch.setenv("DEV_AUTH_BYPASS", "true")
    rid, uid = await _seed_run_with_events(db_engine, n_pre=15)
    rds = aioredis.from_url(redis_container.url, decode_responses=True)

    # Ensure the dev-bypass user matches the seeded run owner.
    async with db_engine() as s:
        u = (await s.execute(select(User).where(User.id == uid))).scalar_one()
        u.email = "alice@example.com"
        await s.commit()

    seen: list[int] = []

    async def consume():
        headers = {"X-Dev-User": "alice@example.com", "Accept": "text/event-stream"}
        async with client.stream("GET", f"/v1/runs/{rid}/stream",
                                  headers=headers, params={"last_seq": 5}) as r:
            assert r.status_code == 200
            async for line in r.aiter_lines():
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    seen.append(data["seq"])
                    if data["type"] == "final":
                        return

    async def chaos_publish_overlap():
        # Re-publish seqs 10..15 via redis while replay is in progress, plus a final
        # at seq 16 to terminate the stream.
        await asyncio.sleep(0.05)
        for i in range(10, 16):
            await rds.publish(f"run:{rid}", json.dumps(
                {"seq": i, "type": "token", "payload": {"i": i},
                 "ts": "2026-05-08T00:00:00Z"}))
        # Insert seq=16 in PG then publish so the tail sees it as terminal.
        async with db_engine() as s:
            s.add(RunEventRow(run_id=rid, seq=16, type="final",
                              payload={"verdict": "ok"}))
            await s.commit()
        await rds.publish(f"run:{rid}", json.dumps(
            {"seq": 16, "type": "final", "payload": {"verdict": "ok"},
             "ts": "2026-05-08T00:00:00Z"}))

    await asyncio.gather(consume(), chaos_publish_overlap())

    assert seen == sorted(set(seen)), "duplicates detected"
    assert seen == list(range(6, 17))
```

- [ ] **Step 2: Run; expect pass.**

```
pytest tests/test_sse_replay_no_dup.py -v
```

- [ ] **Step 3: Commit**

```bash
git add research-kit/backend/tests/test_sse_replay_no_dup.py
git commit -m "test(backend): SSE replay-then-tail no-dup overlap (invariant #3)"
```

### Task J3 — Invariant #6: per-kind timeouts

**Files:**
- Create: `research-kit/worker/tests/test_kind_timeouts.py`

- [ ] **Step 1: Failing test — invariant #6**

> "Timeouts per kind. KIND_TIMEOUTS = {verify:30, extract:30, chat:60, draft:180, conflict:60}. Worker enforces via asyncio.timeout; failure becomes error.code='timeout'." (spec §4.2 #6)

```python
import pytest, asyncio
from sqlalchemy import select

from rk_shared.models import User, Run
from rk_shared.types import RunKind, RunStatus


@pytest.mark.asyncio
async def test_verify_timeout_fires_with_timeout_code(db_engine, redis_container, monkeypatch):
    from worker.tasks import _execute_run_impl
    from worker.runners.mock import MockRunner, ScriptedEvent
    from worker import runner_factory

    # Patch the verify timeout to 0.2s for the test.
    import rk_shared.types as t
    monkeypatch.setitem(t.KIND_TIMEOUTS_SEC, RunKind.VERIFY, 0.2)
    import worker.tasks as wt
    # tasks.py imports KIND_TIMEOUTS_SEC at module load; reload it after monkeypatch.
    monkeypatch.setattr(wt, "KIND_TIMEOUTS_SEC", t.KIND_TIMEOUTS_SEC)

    runner = MockRunner(script=[
        ScriptedEvent({"type": "token", "payload": {"i": i}}, delay=0.05)
        for i in range(50)
    ])
    monkeypatch.setattr(runner_factory, "build_runner", lambda kind: runner)

    async with db_engine() as s:
        u = User(google_sub="g", email="g"); s.add(u); await s.flush()
        run = Run(user_id=u.id, kind=RunKind.VERIFY.value,
                  status=RunStatus.QUEUED.value, input={})
        s.add(run); await s.commit(); await s.refresh(run); rid = run.id

    import redis.asyncio as aioredis
    rds = aioredis.from_url(redis_container.url, decode_responses=True)
    await _execute_run_impl({"redis": rds}, str(rid))

    async with db_engine() as s:
        r = (await s.execute(select(Run).where(Run.id == rid))).scalar_one()
    assert r.status == RunStatus.FAILED.value
    assert r.error["code"] == "timeout"
```

- [ ] **Step 2: Run; expect pass.**

- [ ] **Step 3: Commit**

```bash
git add research-kit/worker/tests/test_kind_timeouts.py
git commit -m "test(worker): per-kind timeouts produce error.code=timeout (invariant #6)"
```

### Task J4 — Invariant #7: worker crash + retry idempotent

**Files:**
- Create: `research-kit/worker/tests/test_crash_retry.py`

- [ ] **Step 1: Failing test — invariant #7**

> "arq max_tries=2. Task entry checks status in TERMINAL → no-op. If status='running' on retry: continues, seq sequence continues." (spec §4.2 #7)

```python
import pytest, asyncio
from sqlalchemy import select

from rk_shared.models import User, Run, RunEventRow
from rk_shared.types import RunKind, RunStatus


@pytest.mark.asyncio
async def test_terminal_retry_is_noop(db_engine, redis_container):
    from worker.tasks import _execute_run_impl

    async with db_engine() as s:
        u = User(google_sub="g", email="g"); s.add(u); await s.flush()
        run = Run(user_id=u.id, kind=RunKind.VERIFY.value,
                  status=RunStatus.SUCCEEDED.value,
                  input={}, result={"verdict": "verified"})
        s.add(run); await s.commit(); await s.refresh(run); rid = run.id
        # Pre-existing event so we can detect any new writes.
        s.add(RunEventRow(run_id=rid, seq=1, type="final",
                          payload={"verdict": "verified"}))
        await s.commit()

    import redis.asyncio as aioredis
    rds = aioredis.from_url(redis_container.url, decode_responses=True)

    out = await _execute_run_impl({"redis": rds}, str(rid))
    assert out.get("skipped") is True

    async with db_engine() as s:
        n = len(list((await s.execute(
            select(RunEventRow).where(RunEventRow.run_id == rid))).scalars()))
    assert n == 1, "no new events should be written on retry of a terminal run"


@pytest.mark.asyncio
async def test_running_retry_continues_seq(db_engine, redis_container, monkeypatch):
    """Worker dies mid-run; arq retries; new events continue the same seq sequence."""
    from worker.tasks import _execute_run_impl
    from worker.runners.mock import MockRunner, ScriptedEvent
    from worker import runner_factory

    runner = MockRunner(script=[
        ScriptedEvent({"type": "token", "payload": {"i": 99}}),
        ScriptedEvent({"type": "final", "payload": {"ok": True}}),
    ])
    monkeypatch.setattr(runner_factory, "build_runner", lambda kind: runner)

    async with db_engine() as s:
        u = User(google_sub="g2", email="g2"); s.add(u); await s.flush()
        run = Run(user_id=u.id, kind=RunKind.VERIFY.value,
                  status=RunStatus.RUNNING.value, input={})
        s.add(run); await s.commit(); await s.refresh(run); rid = run.id
        for i in (1, 2, 3):
            s.add(RunEventRow(run_id=rid, seq=i, type="token",
                              payload={"i": i}))
        await s.commit()

    import redis.asyncio as aioredis
    rds = aioredis.from_url(redis_container.url, decode_responses=True)
    await _execute_run_impl({"redis": rds}, str(rid))

    async with db_engine() as s:
        seqs = list((await s.execute(
            select(RunEventRow.seq).where(RunEventRow.run_id == rid)
            .order_by(RunEventRow.seq))).scalars())
    assert seqs == [1, 2, 3, 4, 5, 6]    # 4=status running, 5=token, 6=final
```

- [ ] **Step 2: Run; expect pass.**

- [ ] **Step 3: Commit**

```bash
git add research-kit/worker/tests/test_crash_retry.py
git commit -m "test(worker): retry-after-crash is idempotent + seq continues (invariant #7)"
```

### Task J5 — Invariant #8: GoClaw outage → recoverable=true

**Files:**
- Create: `research-kit/worker/tests/test_goclaw_outage_recoverable.py`

- [ ] **Step 1: Failing test — invariant #8**

> "GoClaw outage during run. UpstreamError → error.recoverable=true published; client may POST a new run with the same input (new idempotency key)." (spec §4.2 #8)

```python
import pytest
from sqlalchemy import select

from rk_shared.models import User, Run, RunEventRow
from rk_shared.types import RunKind, RunStatus


@pytest.mark.asyncio
async def test_upstream_error_marks_recoverable(db_engine, redis_container, monkeypatch):
    from app.errors import UpstreamError
    from worker.tasks import _execute_run_impl
    from worker.runners.mock import MockRunner, ScriptedEvent
    from worker import runner_factory

    runner = MockRunner(script=[
        ScriptedEvent({"type": "token", "payload": {"i": 1}}),
        ScriptedEvent({"type": "token", "payload": {"i": 2}},
                       raise_exc=UpstreamError("goclaw 502")),
    ])
    monkeypatch.setattr(runner_factory, "build_runner", lambda kind: runner)

    async with db_engine() as s:
        u = User(google_sub="g", email="g"); s.add(u); await s.flush()
        run = Run(user_id=u.id, kind=RunKind.VERIFY.value,
                  status=RunStatus.QUEUED.value, input={})
        s.add(run); await s.commit(); await s.refresh(run); rid = run.id

    import redis.asyncio as aioredis
    rds = aioredis.from_url(redis_container.url, decode_responses=True)
    await _execute_run_impl({"redis": rds}, str(rid))

    async with db_engine() as s:
        r = (await s.execute(select(Run).where(Run.id == rid))).scalar_one()
        events = list((await s.execute(
            select(RunEventRow).where(RunEventRow.run_id == rid)
            .order_by(RunEventRow.seq))).scalars())
    assert r.status == RunStatus.FAILED.value
    assert r.error["recoverable"] is True
    assert r.error["code"] == "upstream"
    err_events = [e for e in events if e.type == "error"]
    assert err_events and err_events[-1].payload["recoverable"] is True
```

(Note: `MockRunner.run` must surface `step.raise_exc` if present — already implemented in H3.)

- [ ] **Step 2: Run; expect pass.**

- [ ] **Step 3: Commit**

```bash
git add research-kit/worker/tests/test_goclaw_outage_recoverable.py
git commit -m "test(worker): UpstreamError → recoverable=true published (invariant #8)"
```

### Task J6 — Phase J checkpoint

- [ ] Append checkpoint, commit:

```
## Checkpoint J — passed YYYY-MM-DD HH:MM
- SSE replay-then-tail (invariant #3) ✓
- Per-kind timeout (invariant #6) ✓
- Retry idempotency + seq continuity (invariant #7) ✓
- UpstreamError → recoverable (invariant #8) ✓
- All 8 invariants from spec §4.2 are now covered by named tests:
  #1 H4 test_persist_before_publish_succeeds
  #2 H5 test_concurrent_publishes_produce_dense_unique_seq
  #3 J2 test_sse_no_dup_in_overlap_window
  #4 I2/I3 test_create_or_get_idempotent + test_post_runs_idem_conflict
  #5 I6 test_cancel_completes_within_2s
  #6 J3 test_verify_timeout_fires_with_timeout_code
  #7 J4 test_terminal_retry_is_noop + test_running_retry_continues_seq
  #8 J5 test_upstream_error_marks_recoverable
```

```bash
git add docs/superpowers/plans/2026-05-08-researchkit-backend-goclaw.part2.md
git commit -m "chore(plan): checkpoint J passed (all 8 invariants covered)"
```

---

## Phase K — GoClaw container + bootstrap + smoke gate (HALT POINT)

> **STOP-THE-LINE:** If smoke (Task K4) fails, **halt the plan**, return to design. Do not start Phase L.

### Task K1 — Add GoClaw services to compose

**Files:**
- Modify: `research-kit/infra/docker-compose.yml`
- Modify: `research-kit/infra/.env.example`

- [ ] **Step 1: Add services**

```yaml
# append to research-kit/infra/docker-compose.yml -> services:
  goclaw_postgres:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_DB: goclaw
      POSTGRES_USER: goclaw
      POSTGRES_PASSWORD: goclaw
    volumes: [goclaw_pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U goclaw -d goclaw"]
      interval: 5s
      timeout: 3s
      retries: 10

  goclaw:
    image: ghcr.io/nextlevelbuilder/goclaw:0.7.0    # pinned tag — adjust if newer LTS exists at smoke time
    environment:
      DATABASE_URL: ${GOCLAW_DATABASE_URL}
      AUTH_TOKEN: ${GOCLAW_TOKEN}
    depends_on:
      goclaw_postgres: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:8080/health"]
      interval: 5s
      timeout: 3s
      retries: 20
    expose: ["8080"]

  goclaw_bootstrap:
    image: ghcr.io/nextlevelbuilder/goclaw-cli:0.7.0
    depends_on:
      goclaw: { condition: service_healthy }
    environment:
      GOCLAW_URL: http://goclaw:8080
      GOCLAW_TOKEN: ${GOCLAW_TOKEN}
    volumes:
      - ./goclaw/agents:/agents:ro
      - ./goclaw/bootstrap.sh:/bootstrap.sh:ro
    entrypoint: ["/bin/sh", "/bootstrap.sh"]
    restart: "no"

  worker:
    build:
      context: ..
      dockerfile: infra/Dockerfile.worker
    env_file: .env
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
      goclaw:   { condition: service_healthy }

# append to volumes:
volumes:
  goclaw_pgdata:
```

- [ ] **Step 2: Add backend dep on goclaw_bootstrap completion** (optional — bootstrap is one-shot):

```yaml
  backend:
    depends_on:
      postgres:          { condition: service_healthy }
      redis:             { condition: service_healthy }
      goclaw_bootstrap:  { condition: service_completed_successfully }
```

- [ ] **Step 3: Commit**

```bash
git add research-kit/infra/docker-compose.yml research-kit/infra/.env.example
git commit -m "feat(infra): add goclaw + goclaw_postgres + goclaw_bootstrap services"
```

### Task K2 — Agent YAML files

**Files:**
- Create: `research-kit/infra/goclaw/agents/verify.yaml`
- Create: `research-kit/infra/goclaw/agents/extract.yaml`
- Create: `research-kit/infra/goclaw/agents/chat.yaml`
- Create: `research-kit/infra/goclaw/agents/draft.yaml`
- Create: `research-kit/infra/goclaw/agents/conflict.yaml`

- [ ] **Step 1: Author all five YAMLs**

```yaml
# verify.yaml
name: rk-verify
id: rk-verify
model: anthropic/claude-3-5-sonnet
system_prompt: |
  You are a citation verification agent for the ResearchKit extension.
  Given a claim, paper metadata, and a paper URL, decide if the cited paper
  supports the claim. Return JSON: {verdict, confidence, quote, reason}.
  verdict ∈ {"verified","partial","not_found","error"}; confidence ∈ [0,1].
tools: []
```

```yaml
# extract.yaml
name: rk-extract
id: rk-extract
model: anthropic/claude-3-5-haiku
system_prompt: |
  Extract atomic factual claims from research-summary site pages. Return JSON
  array of {text, paper_title, doi, paper_url, page}.
tools: []
```

```yaml
# chat.yaml
name: rk-chat
id: rk-chat
model: anthropic/claude-3-5-sonnet
system_prompt: |
  You are a research assistant grounded in the user's saved inbox items.
  Cite inbox claim ids (e.g. [c-7]) when answering. Refuse if no relevant inbox.
tools:
  - name: search_inbox
    description: Search the user's inbox for relevant claims.
    parameters:
      type: object
      properties:
        query: { type: string }
      required: [query]
```

```yaml
# draft.yaml
name: rk-draft
id: rk-draft
model: anthropic/claude-3-5-sonnet
system_prompt: |
  Draft a literature-review paragraph using ONLY the supplied inbox items.
  Every sentence must end with a citation marker [c-id].
tools:
  - name: get_inbox_items
    description: Fetch full text of selected inbox items by id.
    parameters:
      type: object
      properties:
        ids: { type: array, items: { type: string } }
      required: [ids]
```

```yaml
# conflict.yaml
name: rk-conflict
id: rk-conflict
model: anthropic/claude-3-5-sonnet
system_prompt: |
  Given a set of claims about the same paper, identify whether they conflict.
  Return JSON: {is_conflict: bool, group_key, sides: [{claim_id, label, quote}]}.
tools: []
```

- [ ] **Step 2: Commit**

```bash
git add research-kit/infra/goclaw/agents
git commit -m "feat(infra): goclaw agent YAML for 5 kinds"
```

### Task K3 — Bootstrap script

**Files:**
- Create: `research-kit/infra/goclaw/bootstrap.sh`

- [ ] **Step 1: Write script (idempotent upsert)**

```bash
#!/bin/sh
set -eu
echo "[bootstrap] waiting for goclaw at $GOCLAW_URL"
i=0
until wget -q -O- "$GOCLAW_URL/health" >/dev/null 2>&1; do
  i=$((i+1))
  if [ $i -gt 30 ]; then
    echo "[bootstrap] goclaw never became healthy" >&2
    exit 1
  fi
  sleep 1
done

for f in /agents/*.yaml; do
  echo "[bootstrap] upserting $f"
  goclaw-cli agent upsert \
    --url "$GOCLAW_URL" \
    --token "$GOCLAW_TOKEN" \
    --file "$f"
done
echo "[bootstrap] done"
```

- [ ] **Step 2: Commit**

```bash
git add research-kit/infra/goclaw/bootstrap.sh
git commit -m "feat(infra): goclaw bootstrap script (idempotent upsert)"
```

### Task K4 — Smoke gate (HALT POINT)

**Files:**
- Create: `research-kit/backend/tests/contract/__init__.py` (empty)
- Create: `research-kit/backend/tests/contract/test_goclaw_smoke.py`
- Modify: `research-kit/backend/pyproject.toml` (add `[tool.pytest.ini_options].markers`)

- [ ] **Step 1: Add `contract` marker to pyproject**

```toml
# under [tool.pytest.ini_options]
markers = [
  "contract: requires live GoClaw at GOCLAW_URL",
]
```

- [ ] **Step 2: Smoke test**

```python
# tests/contract/test_goclaw_smoke.py
import os, pytest

pytestmark = pytest.mark.contract

requires_goclaw = pytest.mark.skipif(
    not os.environ.get("GOCLAW_URL"),
    reason="GOCLAW_URL not set; smoke test skipped",
)


@requires_goclaw
@pytest.mark.asyncio
async def test_goclaw_streams_chat_completion():
    """HALT POINT: if this fails, do not proceed past Phase K."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        base_url=f"{os.environ['GOCLAW_URL']}/v1",
        api_key=os.environ["GOCLAW_TOKEN"],
        default_headers={
            "X-GoClaw-User-Id": "smoke",
            "X-GoClaw-Agent-Id": "rk-verify",
        },
    )
    chunks: list[str] = []
    async with client.chat.completions.stream(
        model="goclaw:rk-verify",
        messages=[{"role": "user", "content":
                    "Reply with the single word OK."}],
    ) as stream:
        async for event in stream:
            if event.type == "content.delta":
                chunks.append(event.delta)
        final = await stream.get_final_completion()

    full = "".join(chunks).strip().lower()
    assert "ok" in full or "ok" in (final.choices[0].message.content or "").lower()
```

- [ ] **Step 3: Boot stack and run smoke**

```bash
cd research-kit/infra
cp .env.example .env
# Edit .env: set GOCLAW_TOKEN to a real value, plus the upstream LLM keys
# the agent YAMLs reference (per GoClaw docs: ANTHROPIC_API_KEY etc.).
docker compose up -d goclaw_postgres goclaw goclaw_bootstrap
sleep 15
docker compose logs goclaw_bootstrap | grep '\[bootstrap\] done'

cd ../backend
GOCLAW_URL=http://localhost:8080 \
GOCLAW_TOKEN=$(grep GOCLAW_TOKEN ../infra/.env | cut -d= -f2) \
  pytest -m contract tests/contract/test_goclaw_smoke.py -v
```

Expected: 1 passed, ~3–10 seconds.

- [ ] **Step 4 — HALT GATE.**

If smoke fails:
- Read `docker compose logs goclaw goclaw_bootstrap`.
- Common failure modes: (a) GoClaw image tag drift (update K1 tag); (b) upstream model API key missing; (c) agent id mismatch between YAML and `X-GoClaw-Agent-Id`.
- **Stop here.** Open a follow-up issue with the failure logs and revisit the spec. Do not begin Phase L.

If smoke passes:

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/tests/contract research-kit/backend/pyproject.toml
git commit -m "feat(backend): goclaw contract smoke test (Phase K halt point)"
```

### Task K5 — Phase K checkpoint

```
## Checkpoint K — passed YYYY-MM-DD HH:MM
- 5 agents bootstrapped via goclaw_bootstrap one-shot.
- Smoke contract test streams "OK" from rk-verify via /v1/chat/completions.
- Halt gate cleared; Phase L unblocked.
```

```bash
git add docs/superpowers/plans/2026-05-08-researchkit-backend-goclaw.part2.md
git commit -m "chore(plan): checkpoint K passed — smoke gate cleared"
```

---

## Phase L — GoClawRunner + prompt builders

**Goal:** Replace `MockRunner` with a real `GoClawRunner` for production use. Cover with respx-mocked unit tests AND a live contract test gated by `GOCLAW_URL`.

### Task L1 — Real prompt builders (replace stubs)

**Files:**
- Modify: `research-kit/worker/prompts/verify.py`
- Modify: `research-kit/worker/prompts/extract.py`
- Modify: `research-kit/worker/prompts/chat.py`
- Modify: `research-kit/worker/prompts/draft.py`
- Modify: `research-kit/worker/prompts/conflict.py`
- Create: `research-kit/worker/tests/test_prompts.py`

- [ ] **Step 1: Failing test**

```python
import pytest


def test_verify_messages_includes_claim_and_paper():
    from worker.prompts.verify import build_messages
    msgs = build_messages({
        "claim_text": "X causes Y.",
        "paper": {"title": "T", "doi": "10.1/x", "url": "https://e.com/p"},
        "site": "elicit",
    })
    assert msgs[0]["role"] == "user"
    body = msgs[0]["content"]
    assert "X causes Y." in body and "10.1/x" in body and "https://e.com/p" in body


def test_extract_messages_passes_html_excerpt():
    from worker.prompts.extract import build_messages
    msgs = build_messages({"site": "elicit", "page_text": "abc def"})
    assert any("abc def" in m["content"] for m in msgs)


def test_chat_messages_threads_history():
    from worker.prompts.chat import build_messages
    msgs = build_messages({"history": [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ], "question": "what is X?"})
    assert msgs[-1]["content"] == "what is X?"
    assert any(m["role"] == "assistant" and m["content"] == "hello" for m in msgs)


def test_draft_messages_lists_inbox_ids():
    from worker.prompts.draft import build_messages
    msgs = build_messages({"inbox_ids": ["a", "b"], "topic": "T"})
    assert "a" in msgs[0]["content"] and "b" in msgs[0]["content"]


def test_conflict_messages_has_all_sides():
    from worker.prompts.conflict import build_messages
    msgs = build_messages({"sides": [
        {"claim_id": "c1", "text": "supports X"},
        {"claim_id": "c2", "text": "rejects X"},
    ]})
    assert "supports X" in msgs[0]["content"] and "rejects X" in msgs[0]["content"]
```

- [ ] **Step 2: Implement each builder**

```python
# worker/prompts/verify.py
def build_messages(input: dict) -> list[dict]:
    paper = input.get("paper", {})
    body = (
        f"Claim: {input.get('claim_text','').strip()}\n"
        f"Paper title: {paper.get('title','')}\n"
        f"DOI: {paper.get('doi','')}\n"
        f"Paper URL: {paper.get('url','')}\n"
        f"Source site: {input.get('site','')}\n\n"
        "Decide if the paper supports the claim. Reply with JSON."
    )
    return [{"role": "user", "content": body}]
```

```python
# worker/prompts/extract.py
def build_messages(input: dict) -> list[dict]:
    page_text = input.get("page_text", "")[:80_000]    # cap; site pages are ≤ 80k chars
    return [{
        "role": "user",
        "content": (
            f"Site: {input.get('site','')}\n"
            f"Extract atomic claims as JSON array.\n\n"
            f"PAGE:\n{page_text}"
        ),
    }]
```

```python
# worker/prompts/chat.py
def build_messages(input: dict) -> list[dict]:
    history = input.get("history") or []
    question = input.get("question", "")
    return [*history, {"role": "user", "content": question}]
```

```python
# worker/prompts/draft.py
def build_messages(input: dict) -> list[dict]:
    ids = ", ".join(input.get("inbox_ids") or [])
    topic = input.get("topic", "")
    return [{"role": "user", "content":
             f"Topic: {topic}\nUse only these inbox ids: [{ids}]."}]
```

```python
# worker/prompts/conflict.py
def build_messages(input: dict) -> list[dict]:
    lines = "\n".join(
        f"- {s.get('claim_id')}: {s.get('text','')}" for s in input.get("sides", [])
    )
    return [{"role": "user", "content":
             f"Decide whether these claims conflict:\n{lines}\nReturn JSON."}]
```

- [ ] **Step 3: Run; pass.**

- [ ] **Step 4: Commit**

```bash
git add research-kit/worker/prompts research-kit/worker/tests/test_prompts.py
git commit -m "feat(worker): prompt builders for 5 kinds"
```

### Task L2 — GoClawRunner

**Files:**
- Create: `research-kit/worker/runners/goclaw.py`

- [ ] **Step 1: Implement** (test in L3)

```python
# worker/runners/goclaw.py
from __future__ import annotations
import os
from uuid import UUID

from openai import AsyncOpenAI
from openai import APIStatusError, APIConnectionError

from app.errors import UpstreamError
from rk_shared.events import RunEvent
from rk_shared.types import RunKind
from worker.runners.base import (
    AgentRunner, CancelToken, CancelledByUser, EventSink,
)


AGENT_IDS: dict[RunKind, str] = {
    RunKind.VERIFY:   "rk-verify",
    RunKind.EXTRACT:  "rk-extract",
    RunKind.CHAT:     "rk-chat",
    RunKind.DRAFT:    "rk-draft",
    RunKind.CONFLICT: "rk-conflict",
}


def _parse_final(kind: RunKind, content: str) -> dict:
    """Best-effort JSON parse of agent final content. Falls back to {raw}."""
    import json
    s = (content or "").strip()
    # strip markdown fence if present
    if s.startswith("```"):
        s = s.strip("`")
        s = s.split("\n", 1)[1] if "\n" in s else s
        s = s.rsplit("```", 1)[0] if s.endswith("```") else s
    try:
        return json.loads(s)
    except Exception:
        return {"raw": content}


class GoClawRunner:
    def __init__(self, *, base_url: str | None = None, token: str | None = None) -> None:
        self.base_url = base_url or os.environ["GOCLAW_URL"]
        self.token = token or os.environ["GOCLAW_TOKEN"]

    async def run(
        self, *, kind: RunKind, user_id: UUID, run_id: UUID,
        messages: list[dict], on_event: EventSink,
        cancel: CancelToken, request_id: str,
    ) -> dict:
        agent_id = AGENT_IDS[kind]
        client = AsyncOpenAI(
            base_url=f"{self.base_url}/v1",
            api_key=self.token,
            default_headers={
                "X-GoClaw-User-Id": str(user_id),
                "X-GoClaw-Agent-Id": agent_id,
                "X-Request-Id": request_id,
            },
        )

        full_text: list[str] = []
        try:
            async with client.chat.completions.stream(
                model=f"goclaw:{agent_id}",
                messages=messages,
            ) as stream:
                async for event in stream:
                    if await cancel.is_set():
                        raise CancelledByUser()
                    et = event.type
                    if et == "content.delta":
                        delta = getattr(event, "delta", "") or ""
                        full_text.append(delta)
                        await on_event({"type": "token", "payload": {"text": delta}})
                    elif et == "tool_call.created":
                        await on_event({"type": "tool_call",
                                        "payload": {"name": getattr(event, "name", ""),
                                                    "args": getattr(event, "arguments", {})}})
                    elif et == "tool_call.completed":
                        await on_event({"type": "tool_result",
                                        "payload": {"output": getattr(event, "output", "")}})
                    elif et == "error":
                        msg = str(getattr(event, "error", "unknown"))
                        raise UpstreamError(msg)
                final = await stream.get_final_completion()
        except (APIConnectionError, APIStatusError) as e:
            raise UpstreamError(str(e)[:500]) from e

        content = (final.choices[0].message.content
                   if final and final.choices else "".join(full_text))
        return _parse_final(kind, content or "")
```

- [ ] **Step 2: Commit**

```bash
git add research-kit/worker/runners/goclaw.py
git commit -m "feat(worker): GoClawRunner against /v1/chat/completions"
```

### Task L3 — Unit tests with respx (mocked OpenAI surface)

**Files:**
- Create: `research-kit/worker/tests/test_goclaw_runner_mocked.py`

- [ ] **Step 1: Failing test (mocked SSE response)**

```python
import pytest, respx, httpx
from uuid import uuid4
from unittest.mock import AsyncMock

from rk_shared.types import RunKind


SSE_BODY = (
    'data: {"id":"x","object":"chat.completion.chunk","choices":'
    '[{"delta":{"content":"ver"},"index":0}]}\n\n'
    'data: {"id":"x","object":"chat.completion.chunk","choices":'
    '[{"delta":{"content":"ified"},"index":0}]}\n\n'
    'data: {"id":"x","object":"chat.completion.chunk","choices":'
    '[{"delta":{"content":"{\\"verdict\\":\\"verified\\"}"},"index":0}]}\n\n'
    'data: [DONE]\n\n'
)


@pytest.mark.asyncio
@respx.mock
async def test_goclaw_runner_streams_tokens_and_parses_final(monkeypatch):
    monkeypatch.setenv("GOCLAW_URL", "http://goclaw.test")
    monkeypatch.setenv("GOCLAW_TOKEN", "t")

    respx.post("http://goclaw.test/v1/chat/completions").mock(
        return_value=httpx.Response(200, content=SSE_BODY,
                                    headers={"content-type": "text/event-stream"})
    )

    from worker.runners.goclaw import GoClawRunner
    from worker.runners.base import CancelToken

    runner = GoClawRunner()
    captured: list[dict] = []
    async def sink(ev): captured.append(ev); return len(captured)

    redis = AsyncMock(); redis.get = AsyncMock(return_value=None)
    cancel = CancelToken(redis, run_id="r")

    result = await runner.run(
        kind=RunKind.VERIFY, user_id=uuid4(), run_id=uuid4(),
        messages=[{"role": "user", "content": "claim"}],
        on_event=sink, cancel=cancel, request_id="rid",
    )
    assert any(e["type"] == "token" for e in captured)
    assert result.get("verdict") == "verified"


@pytest.mark.asyncio
@respx.mock
async def test_goclaw_runner_5xx_raises_upstream_error(monkeypatch):
    from app.errors import UpstreamError
    monkeypatch.setenv("GOCLAW_URL", "http://goclaw.test")
    monkeypatch.setenv("GOCLAW_TOKEN", "t")

    respx.post("http://goclaw.test/v1/chat/completions").mock(
        return_value=httpx.Response(502, json={"error": "bad gateway"})
    )

    from worker.runners.goclaw import GoClawRunner
    from worker.runners.base import CancelToken
    runner = GoClawRunner()
    redis = AsyncMock(); redis.get = AsyncMock(return_value=None)
    async def sink(ev): return 1

    with pytest.raises(UpstreamError):
        await runner.run(kind=RunKind.VERIFY, user_id=uuid4(), run_id=uuid4(),
                         messages=[{"role": "user", "content": "x"}],
                         on_event=sink, cancel=CancelToken(redis, "r"),
                         request_id="rid")
```

- [ ] **Step 2: Run; pass.**

```
pytest ../worker/tests/test_goclaw_runner_mocked.py -v
```

- [ ] **Step 3: Commit**

```bash
git add research-kit/worker/tests/test_goclaw_runner_mocked.py
git commit -m "test(worker): GoClawRunner unit tests with respx (streaming + 5xx)"
```

### Task L4 — Live contract test (gated by GOCLAW_URL)

**Files:**
- Create: `research-kit/backend/tests/contract/test_goclaw_runner_live.py`

- [ ] **Step 1: Test**

```python
import os, pytest
from uuid import uuid4
from unittest.mock import AsyncMock

from rk_shared.types import RunKind

pytestmark = pytest.mark.contract


@pytest.mark.skipif(not os.environ.get("GOCLAW_URL"), reason="GOCLAW_URL not set")
@pytest.mark.asyncio
async def test_goclaw_runner_against_live_verify_agent():
    from worker.runners.goclaw import GoClawRunner
    from worker.runners.base import CancelToken

    runner = GoClawRunner()
    captured: list[dict] = []
    async def sink(ev): captured.append(ev); return len(captured)
    redis = AsyncMock(); redis.get = AsyncMock(return_value=None)

    result = await runner.run(
        kind=RunKind.VERIFY, user_id=uuid4(), run_id=uuid4(),
        messages=[{"role": "user", "content":
                    "Claim: water boils at 100C at sea level. Reply JSON."}],
        on_event=sink, cancel=CancelToken(redis, "r"),
        request_id="contract",
    )
    # Live agent should produce at least one token + a parseable result.
    assert any(e["type"] == "token" for e in captured)
    assert isinstance(result, dict)
```

- [ ] **Step 2: Run** (with stack up):

```bash
GOCLAW_URL=http://localhost:8080 \
GOCLAW_TOKEN=$(grep GOCLAW_TOKEN ../infra/.env | cut -d= -f2) \
  pytest -m contract tests/contract/test_goclaw_runner_live.py -v
```

- [ ] **Step 3: Commit**

```bash
git add research-kit/backend/tests/contract/test_goclaw_runner_live.py
git commit -m "test(worker): live GoClaw runner contract test (gated by env)"
```

### Task L5 — Switch runner_factory to GoClaw

**Files:**
- Modify: `research-kit/infra/.env.example` (add `RK_RUNNER=goclaw`)
- Modify: `research-kit/worker/runner_factory.py` (default `RK_RUNNER=goclaw` in non-test envs)

- [ ] **Step 1: Edit `.env.example`**

```
RK_RUNNER=goclaw      # set to 'mock' for offline tests
```

- [ ] **Step 2: No code change needed in `runner_factory.py`** — it already routes by `RK_RUNNER`. Verify: tests do not set `RK_RUNNER`, so they default to `mock`; integration tests use `monkeypatch.setattr(runner_factory, "build_runner", ...)`.

- [ ] **Step 3: Commit**

```bash
git add research-kit/infra/.env.example
git commit -m "chore(infra): default RK_RUNNER=goclaw"
```

### Task L6 — Phase L checkpoint

```
## Checkpoint L — passed YYYY-MM-DD HH:MM
- GoClawRunner unit-tested with respx; live contract test green.
- Worker uses GoClaw by default; mock retained for offline tests.
```

```bash
git add docs/superpowers/plans/2026-05-08-researchkit-backend-goclaw.part2.md
git commit -m "chore(plan): checkpoint L passed"
```

---

## Phase M — Extension API client + Google sign-in + schema-v3 wipe

**Goal:** Add `src/api/*` and `src/state/*` modules so the extension can authenticate against the backend and load server-of-record data.

### Task M1 — Manifest oauth2 + host permissions

**Files:**
- Modify: `research-kit/extension/manifest.json` (or `manifest.config.ts` if dynamic)

- [ ] **Step 1: Edit manifest**

```json
{
  "permissions": ["identity", "storage", "activeTab", "sidePanel"],
  "oauth2": {
    "client_id": "${GOOGLE_CLIENT_ID}",
    "scopes": ["openid", "email", "profile"]
  },
  "host_permissions": [
    "https://api.researchkit.local/*",
    "http://localhost:8000/*"
  ]
}
```

If the build uses `manifest.config.ts`, populate `client_id` from `import.meta.env.VITE_GOOGLE_CLIENT_ID`.

- [ ] **Step 2: Commit**

```bash
git add research-kit/extension/manifest.json
git commit -m "feat(ext): manifest oauth2 + host_permissions for backend"
```

### Task M2 — fetchWithAuth client + error mapping

**Files:**
- Create: `research-kit/extension/src/api/client.ts`
- Create: `research-kit/extension/src/api/types.ts`
- Create: `research-kit/extension/src/api/__tests__/client.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/api/__tests__/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiFetch, ApiError } from '../client'

beforeEach(() => {
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({ session_token: 'tok-123' })),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    },
  } as any
})

describe('apiFetch', () => {
  it('attaches Bearer token from chrome.storage', async () => {
    const f = vi.fn(async () => new Response('{"x":1}', { status: 200 }))
    globalThis.fetch = f
    await apiFetch('/v1/projects')
    const init = f.mock.calls[0][1] as RequestInit
    expect((init.headers as any).Authorization).toBe('Bearer tok-123')
  })

  it('maps 401 to ApiError with code=auth', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'auth', message: 'bad' } }),
        { status: 401, headers: { 'content-type': 'application/json' } }))
    await expect(apiFetch('/v1/projects')).rejects.toMatchObject({
      status: 401, code: 'auth',
    })
  })
})
```

- [ ] **Step 2: Implement**

```typescript
// src/api/types.ts
export interface ErrorBody { code: string; message: string; details?: unknown }
export type Project   = { id: string; name: string; created_at: string }
export type Claim     = {
  id: string; project_id: string; text: string; site: string; status: string
  paper_title: string | null; doi: string | null; paper_url: string | null
  page: string | null; quote: string | null; reason: string | null
  confidence: number | null; page_url: string | null
  extracted_at: string | null; created_at: string; updated_at: string
}
export type InboxItem = { id: string; project_id: string; claim_id: string; saved_at: string }
export type ConflictSide = { claim_id: string; label: string; quote: string | null }
export type ConflictItem = {
  id: string; project_id: string; group_key: string
  doi: string | null; paper_title: string | null
  flagged_at: string; resolution: string | null; sides: ConflictSide[]
}
export type RunOut = {
  id: string; kind: string; status: string; project_id: string | null
  input: any; result: any; error: any
  created_at: string; started_at: string | null; finished_at: string | null
}
```

```typescript
// src/api/client.ts
const BASE = (import.meta as any).env?.VITE_BACKEND_URL ?? 'http://localhost:8000'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string,
              public details?: unknown) {
    super(message)
  }
}

async function getToken(): Promise<string | null> {
  const v = await chrome.storage.local.get('session_token')
  return (v as any)?.session_token ?? null
}

export async function apiFetch<T = unknown>(
  path: string, init: RequestInit = {},
): Promise<T> {
  const token = await getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as any) ?? {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, { ...init, headers })
  if (r.status === 204) return undefined as unknown as T
  const ct = r.headers.get('content-type') ?? ''
  const body = ct.includes('application/json') ? await r.json() : await r.text()
  if (!r.ok) {
    const err = (body && (body as any).error) || { code: 'http', message: String(body) }
    throw new ApiError(r.status, err.code ?? 'http', err.message ?? 'error', err.details)
  }
  return body as T
}
```

- [ ] **Step 3: Run vitest** (extension's existing test runner):

```
cd research-kit/extension
npm run test -- src/api/__tests__/client.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add research-kit/extension/src/api
git commit -m "feat(ext): apiFetch with Bearer + error mapping"
```

### Task M3 — auth client + Google sign-in

**Files:**
- Create: `research-kit/extension/src/api/auth.ts`
- Create: `research-kit/extension/src/api/__tests__/auth.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loginWithGoogle, logout } from '../auth'

beforeEach(() => {
  globalThis.chrome = {
    identity: {
      getAuthToken: vi.fn((_o, cb) => cb('google-id-token')),
      removeCachedAuthToken: vi.fn((_o, cb) => cb()),
    },
    storage: { local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    }},
  } as any
})

describe('loginWithGoogle', () => {
  it('sends id_token to /v1/auth/login and stores session_token', async () => {
    const fakeResp = {
      session_token: 'sess-1',
      user: { id: 'u', email: 'e@x', name: 'E' },
      expires_at: '2026-05-09T00:00:00Z',
    }
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(fakeResp),
                   { status: 200, headers: { 'content-type': 'application/json' } }))
    const out = await loginWithGoogle()
    expect(out.session_token).toBe('sess-1')
    expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      session_token: 'sess-1',
    }))
  })
})
```

- [ ] **Step 2: Implement**

```typescript
// src/api/auth.ts
import { apiFetch } from './client'

export interface User { id: string; email: string; name: string | null }
export interface LoginResponse {
  session_token: string; user: User; expires_at: string
}

function chromeGetAuthToken(interactive: boolean): Promise<string> {
  return new Promise((res, rej) =>
    chrome.identity.getAuthToken({ interactive }, (tok) =>
      tok ? res(tok) : rej(new Error('no google token'))))
}

export async function loginWithGoogle(): Promise<LoginResponse> {
  const idToken = await chromeGetAuthToken(true)
  const resp = await apiFetch<LoginResponse>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ google_id_token: idToken }),
  })
  await chrome.storage.local.set({
    session_token: resp.session_token,
    user_summary: resp.user,
  })
  return resp
}

export async function logout(): Promise<void> {
  try { await apiFetch('/v1/auth/logout', { method: 'POST' }) } catch {}
  const v = await chrome.storage.local.get('session_token')
  await chrome.storage.local.remove(['session_token', 'user_summary'])
  await new Promise<void>((res) => chrome.identity.removeCachedAuthToken(
    { token: (v as any).session_token ?? '' }, () => res()))
}

export async function me(): Promise<{ user: User }> {
  return apiFetch<{ user: User }>('/v1/auth/me')
}
```

- [ ] **Step 3: Run; pass.**

- [ ] **Step 4: Commit**

```bash
git add research-kit/extension/src/api/auth.ts \
        research-kit/extension/src/api/__tests__/auth.test.ts
git commit -m "feat(ext): Google sign-in via chrome.identity + /v1/auth/login"
```

### Task M4 — Resource clients (projects/claims/inbox/conflicts)

**Files:**
- Create: `research-kit/extension/src/api/projects.ts`
- Create: `research-kit/extension/src/api/claims.ts`
- Create: `research-kit/extension/src/api/inbox.ts`
- Create: `research-kit/extension/src/api/conflicts.ts`

- [ ] **Step 1: Implement (no separate tests — exercised via integration in N)**

```typescript
// src/api/projects.ts
import { apiFetch } from './client'
import type { Project } from './types'
export const listProjects   = ()                     => apiFetch<Project[]>('/v1/projects')
export const createProject  = (name: string)         => apiFetch<Project>('/v1/projects',
  { method: 'POST', body: JSON.stringify({ name }) })
export const renameProject  = (id: string, name: string) =>
  apiFetch<Project>(`/v1/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
export const deleteProject  = (id: string)           =>
  apiFetch<void>(`/v1/projects/${id}`, { method: 'DELETE' })
```

```typescript
// src/api/claims.ts
import { apiFetch } from './client'
import type { Claim } from './types'

export interface ClaimInput {
  text: string; site: string
  paper_title?: string; doi?: string; paper_url?: string
  page?: string; page_url?: string; extracted_at?: string
}

export const listClaims = (projectId: string, status?: string) =>
  apiFetch<Claim[]>(
    `/v1/claims?project_id=${projectId}${status ? `&status=${status}` : ''}`,
  )

export const batchClaims = (projectId: string, claims: ClaimInput[],
                            idempotencyKey: string) =>
  apiFetch<{ created: Claim[] }>('/v1/claims/batch', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, claims, idempotency_key: idempotencyKey }),
  })

export const patchClaim = (id: string, patch: Partial<Claim>) =>
  apiFetch<Claim>(`/v1/claims/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
```

```typescript
// src/api/inbox.ts
import { apiFetch } from './client'
import type { InboxItem } from './types'
export const listInbox  = (projectId: string)                  =>
  apiFetch<InboxItem[]>(`/v1/inbox?project_id=${projectId}`)
export const addInbox   = (projectId: string, claimId: string) =>
  apiFetch<InboxItem>('/v1/inbox',
    { method: 'POST', body: JSON.stringify({ project_id: projectId, claim_id: claimId }) })
export const removeInbox = (id: string) =>
  apiFetch<void>(`/v1/inbox/${id}`, { method: 'DELETE' })
```

```typescript
// src/api/conflicts.ts
import { apiFetch } from './client'
import type { ConflictItem } from './types'
export const listConflicts = (projectId: string) =>
  apiFetch<ConflictItem[]>(`/v1/conflicts?project_id=${projectId}`)
export const patchConflict = (id: string, resolution: string) =>
  apiFetch<ConflictItem>(`/v1/conflicts/${id}`,
    { method: 'PATCH', body: JSON.stringify({ resolution }) })
```

- [ ] **Step 2: Commit**

```bash
git add research-kit/extension/src/api/projects.ts \
        research-kit/extension/src/api/claims.ts \
        research-kit/extension/src/api/inbox.ts \
        research-kit/extension/src/api/conflicts.ts
git commit -m "feat(ext): API clients for projects/claims/inbox/conflicts"
```

### Task M5 — runs.ts with EventSource (Last-Event-ID)

**Files:**
- Create: `research-kit/extension/src/api/runs.ts`
- Create: `research-kit/extension/src/api/__tests__/runs.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createRun } from '../runs'

describe('createRun', () => {
  it('POSTs to /v1/runs and returns run id', async () => {
    globalThis.chrome = { storage: { local: {
      get: async () => ({ session_token: 't' }),
      set: async () => {}, remove: async () => {},
    }}} as any
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ run_id: 'r1', status: 'queued',
                       stream_url: '/v1/runs/r1/stream' }),
      { status: 201, headers: { 'content-type': 'application/json' } }))
    const out = await createRun({ kind: 'verify', input: { x: 1 },
                                  idempotency_key: 'k' })
    expect(out.run_id).toBe('r1')
    expect(out.stream_url).toBe('/v1/runs/r1/stream')
  })
})
```

- [ ] **Step 2: Implement**

```typescript
// src/api/runs.ts
import { apiFetch } from './client'
import type { RunOut } from './types'

export interface CreateRunInput {
  kind: 'verify' | 'extract' | 'chat' | 'draft' | 'conflict'
  input: any
  project_id?: string
  idempotency_key: string
}
export interface CreateRunResponse {
  run_id: string; status: string; stream_url: string
}

export const createRun = (body: CreateRunInput) =>
  apiFetch<CreateRunResponse>('/v1/runs', { method: 'POST', body: JSON.stringify(body) })

export const getRun = (id: string) => apiFetch<RunOut>(`/v1/runs/${id}`)

export const cancelRun = (id: string) =>
  apiFetch<void>(`/v1/runs/${id}/cancel`, { method: 'POST' })

/** Open an SSE stream on a run; supports reconnect via Last-Event-ID. */
export interface RunStreamHandlers {
  onEvent(ev: { seq: number; type: string; payload: any; ts: string }): void
  onError(e: Event): void
  onClose(): void
}

export function openRunStream(
  runId: string, handlers: RunStreamHandlers, lastSeq: number = 0,
): () => void {
  // EventSource cannot set Authorization headers; we pass session_token as query
  // param ONLY in dev (backend allows when ENV=development). In prod, switch to
  // a fetch-based ReadableStream parser. For now, dev path:
  const tokenP = chrome.storage.local.get('session_token')
  let es: EventSource | null = null
  let cancelled = false
  void tokenP.then((v: any) => {
    if (cancelled) return
    const base = (import.meta as any).env?.VITE_BACKEND_URL ?? 'http://localhost:8000'
    const url = `${base}/v1/runs/${runId}/stream?last_seq=${lastSeq}` +
                `&_=${encodeURIComponent(v.session_token ?? '')}`
    es = new EventSource(url)
    es.addEventListener('run_event', (e: MessageEvent) => {
      try { handlers.onEvent(JSON.parse(e.data)) } catch (err) { handlers.onError(err as any) }
    })
    es.onerror = (e) => handlers.onError(e)
  })
  return () => { cancelled = true; es?.close(); handlers.onClose() }
}
```

> **Note:** EventSource lacks header support. The dev path above uses a query
> param; production hardening (cookie-based session OR fetch-stream parser) is
> tracked as a follow-up — not in scope this phase. Document in `src/api/runs.ts`
> top-comment if needed.

- [ ] **Step 3: Run; pass.**

- [ ] **Step 4: Commit**

```bash
git add research-kit/extension/src/api/runs.ts \
        research-kit/extension/src/api/__tests__/runs.test.ts
git commit -m "feat(ext): runs client + SSE stream opener"
```

### Task M6 — schema-v3 wipe migration

**Files:**
- Create: `research-kit/extension/src/state/migration.ts`
- Create: `research-kit/extension/src/state/__tests__/migration.test.ts`
- Modify: `research-kit/extension/src/sidebar/App.tsx` (call `migrate()` on mount)

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrate } from '../migration'

let store: Record<string, any> = {}
beforeEach(() => {
  store = {}
  globalThis.chrome = { storage: { local: {
    get: vi.fn(async (k?: string) =>
      typeof k === 'string' ? { [k]: store[k] } : { ...store }),
    set: vi.fn(async (o: any) => { Object.assign(store, o) }),
    clear: vi.fn(async () => { for (const k of Object.keys(store)) delete store[k] }),
    remove: vi.fn(async () => {}),
  }}} as any
})

describe('migrate', () => {
  it('wipes when schemaVersion < 3 and sets v3', async () => {
    store = { schemaVersion: 1, projects: [{ id: 'p' }], inboxItems: [] }
    await migrate()
    expect(store.schemaVersion).toBe(3)
    expect(store.projects).toBeUndefined()
    expect(store.inboxItems).toBeUndefined()
  })
  it('is no-op at v3', async () => {
    store = { schemaVersion: 3, verifyEnabled: true }
    await migrate()
    expect(store.verifyEnabled).toBe(true)
    expect(store.schemaVersion).toBe(3)
  })
})
```

- [ ] **Step 2: Implement**

```typescript
// src/state/migration.ts
const TARGET = 3

export async function migrate(): Promise<void> {
  const { schemaVersion } = (await chrome.storage.local.get('schemaVersion')) as
    { schemaVersion?: number }
  const v = schemaVersion ?? 1
  if (v >= TARGET) return
  await chrome.storage.local.clear()
  await chrome.storage.local.set({ schemaVersion: TARGET })
}
```

- [ ] **Step 3: Wire in `Sidebar/App.tsx`** (call before any state hydration). Show a one-time toast: "Local data reset for new server-backed version. Please sign in." (use existing `showToast` from `useStore`).

- [ ] **Step 4: Run; pass.**

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/state \
        research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(ext): schema-v3 wipe migration on extension load"
```

### Task M7 — React Query setup + auth slice

**Files:**
- Modify: `research-kit/extension/package.json` (add `@tanstack/react-query`)
- Create: `research-kit/extension/src/state/queryClient.ts`
- Create: `research-kit/extension/src/state/authSlice.ts`
- Modify: `research-kit/extension/src/sidebar/App.tsx`

- [ ] **Step 1: Install**

```
cd research-kit/extension
npm i @tanstack/react-query
```

- [ ] **Step 2: queryClient**

```typescript
// src/state/queryClient.ts
import { QueryClient } from '@tanstack/react-query'
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})
```

- [ ] **Step 3: authSlice (zustand-compatible with existing store)**

```typescript
// src/state/authSlice.ts
import { create } from 'zustand'
import type { User } from '../api/auth'

interface AuthState {
  user: User | null
  status: 'unknown' | 'signed-in' | 'signed-out'
  setUser(u: User | null): void
  setStatus(s: AuthState['status']): void
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'unknown',
  setUser: (u) => set({ user: u, status: u ? 'signed-in' : 'signed-out' }),
  setStatus: (s) => set({ status: s }),
}))
```

- [ ] **Step 4: Wrap `<App>` in `<QueryClientProvider client={queryClient}>`** in `Sidebar/App.tsx`. On mount, call `me()` once; on 401, set status `signed-out`.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/package.json research-kit/extension/package-lock.json \
        research-kit/extension/src/state/queryClient.ts \
        research-kit/extension/src/state/authSlice.ts \
        research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(ext): React Query + auth slice"
```

### Task M8 — Phase M checkpoint

```
## Checkpoint M — passed YYYY-MM-DD HH:MM
- Manifest oauth2 set; chrome.identity wired; loginWithGoogle works against backend.
- API clients for all resources; React Query bootstrapped.
- schema-v3 wipe migration runs on load.
```

```bash
git add docs/superpowers/plans/2026-05-08-researchkit-backend-goclaw.part2.md
git commit -m "chore(plan): checkpoint M passed"
```

---

## Phase N — Verify pipeline rewire + finalize

**Goal:** Replace `BACKEND_URL = http://localhost:9000` direct-LLM calls in `background_minimal.ts` with the new server pipeline; remove legacy `/verify` and `/extract` endpoints; add CORS for `chrome-extension://*`; add an E2E happy-path stub.

### Task N1 — CORS for chrome-extension

**Files:**
- Modify: `research-kit/backend/app/main.py`
- Create: `research-kit/backend/tests/test_cors.py`

- [ ] **Step 1: Failing test**

```python
import pytest

@pytest.mark.asyncio
async def test_cors_allows_chrome_extension_preflight(client):
    r = await client.options(
        "/v1/projects",
        headers={
            "Origin": "chrome-extension://abcdefghijklmnop",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == \
        "chrome-extension://abcdefghijklmnop"
```

- [ ] **Step 2: Implement**

```python
# app/main.py — inside create_app()
from fastapi.middleware.cors import CORSMiddleware
import re

_ALLOWED_ORIGIN_RE = re.compile(r"^chrome-extension://[a-z0-9]+$|^http://localhost:\d+$")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=_ALLOWED_ORIGIN_RE.pattern,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- [ ] **Step 3: Run; pass.**

- [ ] **Step 4: Commit**

```bash
git add research-kit/backend/app/main.py research-kit/backend/tests/test_cors.py
git commit -m "feat(backend): CORS for chrome-extension origin"
```

### Task N2 — Rewire `background_minimal.ts` to backend runs

**Files:**
- Modify: `research-kit/extension/src/background_minimal.ts`

- [ ] **Step 1: Replace direct verify call with batch + run + SSE consume**

Replace the existing direct-fetch verify logic with:

```typescript
// research-kit/extension/src/background_minimal.ts (rewrite verify path)
import { batchClaims } from './api/claims'
import { createRun, openRunStream } from './api/runs'
import {
  MSG_CLAIMS_EXTRACTED, MSG_VERIFY_PROGRESS, MSG_VERIFY_RESULT,
  MSG_VERIFY_TOGGLE, MSG_VERIFY_PAUSE,
  type MessageClaimsExtracted, type MessageVerifyToggle, type MessageVerifyPause,
} from './shared/messages'
import type { ClaimItem, VerifyResult, VerifyProgress } from './shared/verify-types'

const MAX_CONCURRENT = 3
let verifyEnabled = true
let paused = false
const queue: { tabId: number; claim: ClaimItem; projectId: string }[] = []
const inFlight = new Set<string>()
const results = new Map<string, VerifyResult>()
const progressByTab = new Map<number, VerifyProgress>()

async function startVerify(projectId: string, claim: ClaimItem, tabId: number) {
  // 1. Persist the claim batch (one claim per item; the server batch path handles
  //    larger batches when content scripts coalesce).
  const idem = `claim:${claim.id}`
  const { created } = await batchClaims(projectId, [{
    text: claim.text, site: claim.site as any,
    paper_title: claim.paper_title, doi: claim.doi,
    paper_url: claim.paper_url, page: claim.page,
    page_url: claim.page_url, extracted_at: claim.extracted_at,
  }], idem)
  const serverClaimId = created[0]?.id
  if (!serverClaimId) return

  // 2. Create the verify run.
  const runIdem = `verify:${serverClaimId}`
  const run = await createRun({
    kind: 'verify',
    input: { claim_id: serverClaimId },
    project_id: projectId,
    idempotency_key: runIdem,
  })

  // 3. Stream events; on final/error, broadcast to sidebar.
  inFlight.add(claim.id)
  const close = openRunStream(run.run_id, {
    onEvent: (ev) => {
      if (ev.type === 'final') {
        const result: VerifyResult = {
          claimId: claim.id, status: ev.payload.verdict,
          confidence: ev.payload.confidence ?? null,
          quote: ev.payload.quote ?? null, reason: ev.payload.reason ?? null,
        }
        results.set(claim.id, result)
        chrome.runtime.sendMessage({ type: MSG_VERIFY_RESULT, tabId, result })
        cleanup()
      } else if (ev.type === 'error') {
        const result: VerifyResult = {
          claimId: claim.id, status: 'error',
          confidence: null, quote: null,
          reason: ev.payload.message ?? 'error',
        }
        results.set(claim.id, result)
        chrome.runtime.sendMessage({ type: MSG_VERIFY_RESULT, tabId, result })
        cleanup()
      }
    },
    onError: () => { /* let it retry on next claim */ cleanup() },
    onClose: () => { /* no-op */ },
  })

  function cleanup() {
    close()
    inFlight.delete(claim.id)
    pump()
  }
}

async function pump() {
  while (!paused && verifyEnabled && inFlight.size < MAX_CONCURRENT && queue.length) {
    const next = queue.shift()!
    void startVerify(next.projectId, next.claim, next.tabId)
  }
}

async function getCurrentProjectId(): Promise<string | null> {
  const v = await chrome.storage.local.get('currentProjectId')
  return (v as any).currentProjectId ?? null
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MSG_CLAIMS_EXTRACTED) {
    if (!verifyEnabled) return
    void (async () => {
      const projectId = await getCurrentProjectId()
      if (!projectId) return
      const { tabId, claims } = msg as MessageClaimsExtracted
      for (const claim of claims) queue.push({ projectId, claim, tabId })
      pump()
    })()
    sendResponse({ ok: true })
    return
  }
  if (msg.type === MSG_VERIFY_TOGGLE) {
    verifyEnabled = (msg as MessageVerifyToggle).enabled
    chrome.storage.local.set({ verifyEnabled })
    if (!verifyEnabled) { queue.length = 0 }
    return
  }
  if (msg.type === MSG_VERIFY_PAUSE) {
    paused = (msg as MessageVerifyPause).paused
    if (!paused) pump()
    return
  }
  if (msg.type === 'verify:get_results') {
    sendResponse({ results: Object.fromEntries(results) })
    return true
  }
})

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('verifyEnabled', (r: any) => {
    if (r && r.verifyEnabled !== undefined) verifyEnabled = r.verifyEnabled
  })
})
```

- [ ] **Step 2: Build extension**

```
cd research-kit/extension
npm run build
```

Expected: clean build with no `BACKEND_URL` references.

- [ ] **Step 3: Commit**

```bash
git add research-kit/extension/src/background_minimal.ts
git commit -m "feat(ext): rewire verify pipeline to /v1/claims/batch + /v1/runs SSE"
```

### Task N3 — Remove legacy `/verify` and `/extract` FastAPI endpoints

**Files:**
- Delete: `research-kit/backend/main_openai.py` (legacy prototype, if still present in tree)
- Modify: `research-kit/backend/app/main.py` (ensure no `/verify` or `/extract` routes wired)

- [ ] **Step 1: Search for any remaining references**

```
cd research-kit
grep -rn "main_openai\|@app.post.*verify\|@app.post.*extract" backend extension || true
```

If `main_openai.py` still exists at the repo root or under `research-kit/backend/`, delete it.

- [ ] **Step 2: Add a guard test**

```python
# tests/test_no_legacy_routes.py
import pytest

@pytest.mark.asyncio
async def test_legacy_verify_route_404(client):
    r = await client.post("/verify", json={})
    assert r.status_code == 404

@pytest.mark.asyncio
async def test_legacy_extract_route_404(client):
    r = await client.post("/extract", json={})
    assert r.status_code == 404
```

- [ ] **Step 3: Run; pass.**

- [ ] **Step 4: Commit**

```bash
git rm -f research-kit/backend/main_openai.py 2>/dev/null || true
git add research-kit/backend/tests/test_no_legacy_routes.py research-kit/backend/app/main.py
git commit -m "chore(backend): remove legacy /verify and /extract endpoints"
```

### Task N4 — E2E happy-path Playwright stub

**Files:**
- Create: `research-kit/extension/e2e/playwright.config.ts`
- Create: `research-kit/extension/e2e/happy_path.spec.ts`

- [ ] **Step 1: Add Playwright dev dep and config**

```
cd research-kit/extension
npm i -D @playwright/test
```

```typescript
// e2e/playwright.config.ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  use: {
    baseURL: process.env.BACKEND_URL ?? 'http://localhost:8000',
    headless: true,
  },
})
```

- [ ] **Step 2: Stub spec (uses dev-bypass header — no real Google flow)**

```typescript
// e2e/happy_path.spec.ts
import { test, expect, request } from '@playwright/test'

test.describe('happy path: project → batch claims → verify run → final', () => {
  test.skip(!process.env.BACKEND_URL || !process.env.RK_DEV_USER,
            'set BACKEND_URL and RK_DEV_USER to run E2E')

  test('end-to-end', async () => {
    const ctx = await request.newContext({
      baseURL: process.env.BACKEND_URL,
      extraHTTPHeaders: { 'X-Dev-User': process.env.RK_DEV_USER! },
    })
    const proj = await ctx.post('/v1/projects', { data: { name: 'E2E' } })
    expect(proj.ok()).toBeTruthy()
    const projectId = (await proj.json()).id

    const batch = await ctx.post('/v1/claims/batch', {
      data: { project_id: projectId,
              claims: [{ text: 'water boils at 100C', site: 'elicit' }],
              idempotency_key: 'e2e-batch-1' },
    })
    expect(batch.ok()).toBeTruthy()
    const claimId = (await batch.json()).created[0].id

    const run = await ctx.post('/v1/runs', {
      data: { kind: 'verify', input: { claim_id: claimId },
              project_id: projectId, idempotency_key: 'e2e-run-1' },
    })
    expect(run.status()).toBe(201)
    const { run_id } = await run.json()

    // poll terminal status (skip live SSE in this stub)
    for (let i = 0; i < 60; i++) {
      const r = await ctx.get(`/v1/runs/${run_id}`)
      const j = await r.json()
      if (['succeeded', 'failed', 'cancelled'].includes(j.status)) {
        expect(j.status).toBe('succeeded')
        return
      }
      await new Promise((res) => setTimeout(res, 500))
    }
    throw new Error('run did not reach terminal status within 30s')
  })
})
```

- [ ] **Step 3: Run** (with backend, worker, GoClaw all up):

```
BACKEND_URL=http://localhost:8000 RK_DEV_USER=alice@example.com \
  npx playwright test e2e/happy_path.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add research-kit/extension/e2e research-kit/extension/package.json \
        research-kit/extension/package-lock.json
git commit -m "test(ext): playwright e2e happy-path stub"
```

### Task N5 — Final cleanup pass

- [ ] **Step 1:** `grep -rn "MockRunner" research-kit/worker/runner_factory.py` — confirm prod default is `goclaw`.
- [ ] **Step 2:** `grep -rn "BACKEND_URL = 'http://localhost:9000'" research-kit/extension/src` — confirm no matches.
- [ ] **Step 3:** Run full backend test suite: `cd research-kit/backend && pytest -v` — all green except `-m contract` tests when `GOCLAW_URL` unset.
- [ ] **Step 4:** Run extension tests: `cd research-kit/extension && npm run test` — all green.
- [ ] **Step 5:** Bring full stack up and exercise login + verify on a single Elicit page. Confirm:
  - Sidebar shows the user's email.
  - A claim appears with status `pending` then `verified`/`partial` after ~5s.
  - Cancel button on a long-running run flips status within 2s.

- [ ] **Step 6: Commit any tweaks**

```bash
git add -A
git commit -m "chore: final cleanup after Phase N"
```

### Task N6 — Phase N checkpoint

```
## Checkpoint N — passed YYYY-MM-DD HH:MM
- Verify pipeline driven by /v1/runs SSE.
- Legacy /verify and /extract removed and 404-guarded.
- CORS allows chrome-extension://* and localhost.
- E2E happy-path stub passes against full local stack.
```

```bash
git add docs/superpowers/plans/2026-05-08-researchkit-backend-goclaw.part2.md
git commit -m "chore(plan): checkpoint N passed — implementation complete"
```

---

## Self-review checklist (run after Phase N)

### 1. Spec coverage

- [x] §1 Goal & Scope — Phases A–N collectively replace direct-LLM, route via GoClaw, persist runs, OAuth.
- [x] §2 Architecture — every layer instantiated: backend (C/D/E/F/G/I/J), worker (H/I/L), Postgres (B), Redis (A/I), GoClaw (K), goclaw_postgres (K).
- [x] §3 Data model — Phase B migrates the full schema; tests in B4 verify all 9 tables exist.
- [x] §4.1 Run lifecycle — POST→queued (I3), running (I5), final/error/cancel (I5/I6/J5), SSE replay (J1/J2).
- [x] §4.2 Invariants — every one has a named test:
      #1 H4 · #2 H5 · #3 J2 · #4 I2+I3 · #5 I6 · #6 J3 · #7 J4 · #8 J5.
- [x] §4.3 SSE wire format — `event: run_event`, `id: <seq>`, JSON data — emitted in J1 and consumed in M5.
- [x] §5 Auth — Phase D (Part 1) + M2/M3 (extension).
- [x] §6 GoClaw — K (smoke gate) + L (runner + prompts).
- [x] §7 Endpoints — all paths present: auth (D), projects (E), claims (F), inbox (G1), conflicts (G2), runs (I3/I4), stream (J1).
- [x] §8 Worker — H1 settings, H2/H3/H4 components, I5 task.
- [x] §9 Extension — M1–M7, N2.
- [x] §10 Repo layout & compose — A (Part 1) + K (goclaw services).
- [x] §11 Errors / observability / security — error envelope (Part 1 Phase C), structlog (Part 1 Phase C), CORS (N1), input caps (Part 1 Phase F schemas).
- [x] §12 Testing — unit (every phase), integration (testcontainers, every DB phase), contract (K4, L4).

### 2. Placeholder scan

Searched for: `TBD`, `TODO`, `implement later`, `fill in details`, "appropriate error handling", "similar to Task". No bare placeholders remain. Two intentional notes are explicit and bounded:
- Phase L's `_parse_final` falls back to `{raw}` when JSON parsing fails — documented.
- Phase M5 uses an EventSource query-param token in dev; flagged as a known follow-up for prod hardening (cookie or fetch-stream parser). This is intentional, not a placeholder.

### 3. Type consistency

- `RunKind`, `RunStatus`, `ClaimStatus`, `Site`, `RunEvent`, `KIND_TIMEOUTS_SEC`, `TERMINAL_STATUSES` are defined exactly once in `rk_shared/types.py` and `rk_shared/events.py` (Part 1 Phase B), and only imported elsewhere.
- `AGENT_IDS` lives once in `worker/runners/goclaw.py` (Phase L2). The matching agent ids in `infra/goclaw/agents/*.yaml` (K2) are `rk-verify`, `rk-extract`, `rk-chat`, `rk-draft`, `rk-conflict` — identical strings. Cross-referenced.
- `EventBus.publish` returns `int seq`; `EventSink = Callable[[RunEvent], Awaitable[int]]` (H2) — matches.
- `CancelToken.is_set()` is `async`; every call site (`MockRunner`, `GoClawRunner`, `tasks._execute_run_impl`) uses `await`.
- Error class names: `AuthError`, `NotFoundError`, `ValidationError_`, `ConflictError`, `UpstreamError`, `InternalError`. Used consistently.
- Extension types in `src/api/types.ts` (M2) mirror Pydantic schemas in `app/schemas/*` field-for-field.

### 4. Halt / gate points

- **Phase K Task K4** is the only halt point. If smoke fails, the plan stops and the team revisits the spec.

### 5. Invariant-to-test cross-reference (final)

| Invariant (spec §4.2) | Test file | Test name |
|---|---|---|
| #1 Persist-before-publish | `worker/tests/test_event_bus_persist_before_publish.py` | `test_persist_before_publish_succeeds`, `test_persist_survives_redis_publish_failure` |
| #2 Monotonic seq | `worker/tests/test_event_bus_monotonic_seq.py` | `test_concurrent_publishes_produce_dense_unique_seq`, `test_publishes_on_different_runs_do_not_block` |
| #3 Replay-then-tail no dup | `backend/tests/test_sse_replay_no_dup.py` | `test_sse_no_dup_in_overlap_window` |
| #4 Idempotency | `backend/tests/test_runs_repo.py` + `tests/test_runs_post.py` | `test_create_or_get_idempotent`, `test_idem_conflict_on_diff_payload`, `test_post_runs_returns_201_and_enqueues`, `test_post_runs_idem_conflict` |
| #5 Cancel <2s | `worker/tests/test_cancel_within_2s.py` | `test_cancel_completes_within_2s` |
| #6 Per-kind timeout | `worker/tests/test_kind_timeouts.py` | `test_verify_timeout_fires_with_timeout_code` |
| #7 Crash retry idempotent | `worker/tests/test_crash_retry.py` | `test_terminal_retry_is_noop`, `test_running_retry_continues_seq` |
| #8 GoClaw outage recoverable | `worker/tests/test_goclaw_outage_recoverable.py` | `test_upstream_error_marks_recoverable` |

End of Part 2.

## Checkpoint G — passed 2026-05-08 session-2
- Inbox + Conflicts CRUD live with row-level isolation and cascade delete.
- pytest green.

## Checkpoint H — passed 2026-05-08 session-2
- Worker package importable; arq settings declared.
- AgentRunner Protocol + CancelToken + MockRunner.
- EventBus enforces invariants #1 (persist-before-publish) and #2 (monotonic seq).

## Checkpoint I — passed 2026-05-08 session-2
- POST/GET/cancel runs endpoints + execute_run task wired.
- Invariants #4 (idempotency, including ConflictError on diff-payload) and #5 (cancel <2s) verified.

## Checkpoint J — passed 2026-05-08 session-2
- SSE replay-then-tail (invariant #3) ✓
- Per-kind timeout (invariant #6) ✓
- Retry idempotency + seq continuity (invariant #7) ✓
- UpstreamError → recoverable (invariant #8) ✓
- All 8 invariants from spec §4.2 are now covered by named tests:
  #1 H4 test_persist_before_publish_succeeds
  #2 H5 test_concurrent_publishes_produce_dense_unique_seq
  #3 J2 test_sse_no_dup_in_overlap_window
  #4 I2/I3 test_create_or_get_idempotent + test_post_runs_idem_conflict
  #5 I6 test_cancel_completes_within_2s
  #6 J3 test_verify_timeout_fires_with_timeout_code
  #7 J4 test_terminal_retry_is_noop + test_running_retry_continues_seq
  #8 J5 test_upstream_error_marks_recoverable
