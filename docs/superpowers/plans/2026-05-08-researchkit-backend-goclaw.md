# ResearchKit Backend + GoClaw Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the direct-LLM FastAPI prototype with a server-of-record FastAPI gateway + arq worker that routes all LLM work through a self-hosted vanilla GoClaw, persists run events for SSE replay, and authenticates users via Google OAuth.

**Architecture:** Stateless FastAPI → Postgres + Redis (queue + pub/sub) → arq worker → GoClaw HTTP (OpenAI-compatible streaming). Every streamed token is persisted in `run_events` before being published to Redis, so a reconnecting SSE client can replay then tail without loss or duplication.

**Tech Stack:** Python 3.12 · FastAPI · SQLAlchemy 2 (async) · asyncpg · Alembic · arq · Redis 7 · Postgres 16 · OpenAI Python SDK (pointed at GoClaw) · structlog · pytest · testcontainers · GoClaw (vanilla, pinned image) · React + Zustand + React Query (extension).

**Spec:** [`docs/superpowers/specs/2026-05-08-researchkit-backend-goclaw-design.md`](../specs/2026-05-08-researchkit-backend-goclaw-design.md)
**Brainstorm notes:** [`docs/superpowers/specs/2026-05-08-researchkit-backend-goclaw-brainstorm-notes.md`](../specs/2026-05-08-researchkit-backend-goclaw-brainstorm-notes.md)

---

## Phase Map (review checkpoints)

| Phase | Title | Output |
|---|---|---|
| A | Repo scaffolding & compose skeleton | Compose up: PG, Redis, empty backend container starts. |
| B | Shared package + ORM + Alembic | Migration applies; models import cleanly in tests. |
| C | FastAPI app skeleton + config + logging | `/health` returns 200; structlog JSON output. |
| D | Auth (Google OAuth + sessions) | `/v1/auth/login` works against fake JWKS; integration test passes. |
| E | Projects CRUD | Full CRUD with row-level isolation tests. |
| F | Claims CRUD + batch | Batch upsert + idempotency test. |
| G | Inbox + Conflicts CRUD | Both endpoints + cascade delete tests. |
| H | Worker scaffold + MockRunner + EventBus | EventBus persist-before-publish + monotonic seq tests pass. |
| I | Runs API (POST/GET/cancel) + arq enqueue | Run created → MockRunner executes → terminal state in DB. |
| J | SSE streaming with replay-then-tail | All run-lifecycle invariant tests (§4.2) pass. |
| K | GoClaw container + bootstrap + smoke gate | `goclaw_bootstrap` provisions 5 agents; smoke test streams a chat completion. |
| L | GoClawRunner + prompts | Contract test (live GoClaw) passes; runner swappable via env. |
| M | Extension API client + Google sign-in + schema-v3 wipe | Login flow works against backend; data loads from server. |
| N | Extension verify pipeline rewire + finalize | Verify badges driven by server runs; legacy `/verify` removed. |

Each phase ends with a commit and a checkpoint comment in this file. Implementation does NOT proceed past Phase K's smoke gate if smoke fails.

---

## Conventions used in every task

- **TDD:** every code-bearing task is (1) write failing test → (2) run, see it fail → (3) implement minimum → (4) run, see it pass → (5) commit.
- **Working directory:** `d:/vin_product/A20-App-012` (Windows host); container paths are POSIX.
- **Backend lives at:** `research-kit/backend/`. Worker at `research-kit/worker/`. Shared lib at `research-kit/shared/rk_shared/`. Infra at `research-kit/infra/`.
- **Run pytest from:** `research-kit/backend/` (it includes worker tests via path config).
- **Compose commands run from:** `research-kit/infra/`.
- **Commit prefix:** `feat(backend):`, `feat(worker):`, `feat(infra):`, `feat(ext):`, `test(...)`, `chore(...)`, `docs(...)`.
- **No mocking the database in tests.** Use testcontainers (decision recorded from prior feedback in repo guidelines about mock/prod divergence; aligns with spec §12.1).
- **Every external boundary** (GoClaw, Google JWKS) gets an adapter + a fake; tests use the fake.

---

## Phase A — Repo scaffolding & compose skeleton

**Goal:** A docker-compose stack that brings up Postgres, Redis, and an empty FastAPI container that serves `/health`. No auth, no DB models yet.

### Task A1 — Create directory layout

**Files:**
- Create: `research-kit/backend/pyproject.toml`
- Create: `research-kit/backend/app/__init__.py` (empty)
- Create: `research-kit/backend/app/main.py`
- Create: `research-kit/backend/tests/__init__.py` (empty)
- Create: `research-kit/backend/tests/conftest.py`
- Create: `research-kit/worker/__init__.py` (empty)
- Create: `research-kit/shared/rk_shared/__init__.py` (empty)
- Create: `research-kit/infra/.env.example`
- Create: `research-kit/infra/docker-compose.yml`
- Create: `research-kit/infra/docker-compose.dev.yml`
- Create: `research-kit/infra/Dockerfile.backend`
- Create: `research-kit/infra/Dockerfile.worker`

- [ ] **Step 1: Create `research-kit/backend/pyproject.toml`**

```toml
[project]
name = "rk-backend"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.7",
  "pydantic-settings>=2.3",
  "sqlalchemy[asyncio]>=2.0.30",
  "asyncpg>=0.29",
  "alembic>=1.13",
  "redis[hiredis]>=5.0",
  "arq>=0.26",
  "httpx>=0.27",
  "openai>=1.40",
  "google-auth>=2.30",
  "structlog>=24.1",
  "python-multipart>=0.0.9",
  "sse-starlette>=2.1",
]

[project.optional-dependencies]
dev = [
  "pytest>=8",
  "pytest-asyncio>=0.23",
  "pytest-mock>=3.14",
  "testcontainers[postgres,redis]>=4.7",
  "factory-boy>=3.3",
  "respx>=0.21",
  "ruff>=0.5",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
pythonpath = ["."]
testpaths = ["tests", "../worker/tests"]

[tool.ruff]
line-length = 100
target-version = "py312"
```

- [ ] **Step 2: Create `research-kit/backend/app/main.py`**

```python
from fastapi import FastAPI

def create_app() -> FastAPI:
    app = FastAPI(title="ResearchKit Backend", version="0.1.0")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app

app = create_app()
```

- [ ] **Step 3: Create `research-kit/backend/tests/conftest.py`**

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


@pytest.fixture
async def client() -> AsyncClient:
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
```

- [ ] **Step 4: Commit scaffolding**

```bash
git add research-kit/backend research-kit/worker research-kit/shared
git commit -m "feat(backend): scaffold backend/worker/shared package layout"
```

### Task A2 — `/health` smoke test (TDD entry)

**Files:**
- Create: `research-kit/backend/tests/test_health.py`

- [ ] **Step 1: Write failing test**

```python
import pytest

@pytest.mark.asyncio
async def test_health_returns_ok(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 2: Run test (expect PASS — `app/main.py` already implements it)**

```
cd research-kit/backend
pip install -e .[dev]
pytest tests/test_health.py -v
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add research-kit/backend/tests/test_health.py research-kit/backend/pyproject.toml
git commit -m "test(backend): /health endpoint sanity"
```

### Task A3 — `.env.example` and infra files

- [ ] **Step 1: Create `research-kit/infra/.env.example`**

```
ENV=development
APP_NAME=rk-backend
LOG_LEVEL=INFO

DATABASE_URL=postgresql+asyncpg://rk:rk@postgres:5432/rk
REDIS_URL=redis://redis:6379/0

GOCLAW_URL=http://goclaw:8080
GOCLAW_TOKEN=changeme-gateway-token
GOCLAW_DATABASE_URL=postgresql://goclaw:goclaw@goclaw_postgres:5432/goclaw

GOOGLE_CLIENT_ID=
SESSION_SECRET=changeme-32-bytes-random

DEV_AUTH_BYPASS=false
```

- [ ] **Step 2: Create `research-kit/infra/Dockerfile.backend`**

```dockerfile
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY shared /app/shared
RUN pip install -e /app/shared && pip install -e /app/backend

COPY backend /app/backend
COPY worker /app/worker

WORKDIR /app/backend
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: Create `research-kit/infra/Dockerfile.worker`**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY shared /app/shared
RUN pip install -e /app/shared && pip install -e /app/backend

COPY backend /app/backend
COPY worker /app/worker

WORKDIR /app/worker
CMD ["arq", "main.WorkerSettings"]
```

- [ ] **Step 4: Create `research-kit/infra/docker-compose.yml`**

```yaml
name: researchkit
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: rk
      POSTGRES_USER: rk
      POSTGRES_PASSWORD: rk
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rk -d rk"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes: [redisdata:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  backend:
    build:
      context: ..
      dockerfile: infra/Dockerfile.backend
    env_file: .env
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    ports: ["8000:8000"]

volumes:
  pgdata:
  redisdata:
```

- [ ] **Step 5: Create `research-kit/infra/docker-compose.dev.yml`**

```yaml
services:
  backend:
    command: ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--reload"]
    volumes:
      - ../backend:/app/backend
      - ../worker:/app/worker
      - ../shared:/app/shared
    environment:
      ENV: development
      LOG_LEVEL: DEBUG
  postgres:
    ports: ["5433:5432"]
  redis:
    ports: ["6380:6379"]
```

- [ ] **Step 6: Bring stack up and curl health**

```bash
cd research-kit/infra
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
sleep 10
curl -fsS http://localhost:8000/health
docker compose down
```

Expected: `{"status":"ok"}`. If fails, fix before proceeding.

- [ ] **Step 7: Commit**

```bash
git add research-kit/infra
git commit -m "feat(infra): docker-compose skeleton (postgres, redis, backend)"
```

### Task A4 — Phase A checkpoint

- [ ] **Step 1: Append checkpoint to plan**

Add at end of this file:
```
## Checkpoint A — passed YYYY-MM-DD HH:MM
- /health responds via compose
- pytest green (1 test)
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-08-researchkit-backend-goclaw.md
git commit -m "chore(plan): checkpoint A passed"
```

---

## Phase B — Shared package, ORM models, Alembic

**Goal:** Single source of truth for ORM models in `rk_shared`, Alembic migration that creates the full schema, an integration test using a testcontainers Postgres that confirms tables exist.

### Task B1 — Shared types and enums

**Files:**
- Create: `research-kit/shared/pyproject.toml`
- Create: `research-kit/shared/rk_shared/types.py`
- Create: `research-kit/shared/rk_shared/events.py`

- [ ] **Step 1: Create `research-kit/shared/pyproject.toml`**

```toml
[project]
name = "rk-shared"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = ["sqlalchemy[asyncio]>=2.0.30", "pydantic>=2.7"]
```

- [ ] **Step 2: Create `research-kit/shared/rk_shared/types.py`**

```python
from enum import StrEnum

class RunKind(StrEnum):
    VERIFY   = "verify"
    EXTRACT  = "extract"
    CHAT     = "chat"
    DRAFT    = "draft"
    CONFLICT = "conflict"

class RunStatus(StrEnum):
    QUEUED     = "queued"
    RUNNING    = "running"
    CANCELLING = "cancelling"
    SUCCEEDED  = "succeeded"
    FAILED     = "failed"
    CANCELLED  = "cancelled"

TERMINAL_STATUSES = frozenset({RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED})

class ClaimStatus(StrEnum):
    PENDING    = "pending"
    VERIFIED   = "verified"
    PARTIAL    = "partial"
    NOT_FOUND  = "not_found"
    ERROR      = "error"

class Site(StrEnum):
    ELICIT    = "elicit"
    SCISPACE  = "scispace"
    CONSENSUS = "consensus"

KIND_TIMEOUTS_SEC: dict[RunKind, int] = {
    RunKind.VERIFY:   30,
    RunKind.EXTRACT:  30,
    RunKind.CHAT:     60,
    RunKind.DRAFT:    180,
    RunKind.CONFLICT: 60,
}
```

- [ ] **Step 3: Create `research-kit/shared/rk_shared/events.py`**

```python
from typing import Literal, TypedDict

RunEventType = Literal["token","tool_call","tool_result","status","error","final","log"]

class RunEvent(TypedDict):
    type: RunEventType
    payload: dict
```

- [ ] **Step 4: Commit**

```bash
git add research-kit/shared
git commit -m "feat(shared): types, enums, RunEvent TypedDict"
```

### Task B2 — ORM models (single source)

**Files:**
- Create: `research-kit/shared/rk_shared/models.py`

- [ ] **Step 1: Write `models.py`**

```python
from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import (
    BigInteger, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid_pk():
    return mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class User(Base):
    __tablename__ = "users"
    id:          Mapped[uuid.UUID] = _uuid_pk()
    google_sub:  Mapped[str]       = mapped_column(Text, unique=True, nullable=False)
    email:       Mapped[str]       = mapped_column(Text, nullable=False)
    name:        Mapped[str | None] = mapped_column(Text)
    created_at:  Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)


class Session(Base):
    __tablename__ = "sessions"
    token_hash:    Mapped[str]       = mapped_column(Text, primary_key=True)
    user_id:       Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                     ForeignKey("users.id", ondelete="CASCADE"),
                                                     nullable=False, index=True)
    created_at:    Mapped[datetime]  = mapped_column(nullable=False)
    expires_at:    Mapped[datetime]  = mapped_column(nullable=False, index=True)
    last_used_at:  Mapped[datetime]  = mapped_column(nullable=False)


class Project(Base):
    __tablename__ = "projects"
    id:         Mapped[uuid.UUID] = _uuid_pk()
    user_id:    Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                  ForeignKey("users.id", ondelete="CASCADE"),
                                                  nullable=False, index=True)
    name:       Mapped[str]       = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)


class Claim(Base):
    __tablename__ = "claims"
    id:           Mapped[uuid.UUID] = _uuid_pk()
    user_id:      Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                    ForeignKey("users.id", ondelete="CASCADE"),
                                                    nullable=False)
    project_id:   Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                    ForeignKey("projects.id", ondelete="CASCADE"),
                                                    nullable=False)
    text:         Mapped[str]       = mapped_column(Text, nullable=False)
    paper_title:  Mapped[str | None] = mapped_column(Text)
    doi:          Mapped[str | None] = mapped_column(Text, index=True)
    paper_url:    Mapped[str | None] = mapped_column(Text)
    page:         Mapped[str | None] = mapped_column(Text)
    site:         Mapped[str]       = mapped_column(Text, nullable=False)
    status:       Mapped[str]       = mapped_column(Text, nullable=False)
    confidence:   Mapped[float | None] = mapped_column(Float)
    quote:        Mapped[str | None] = mapped_column(Text)
    reason:       Mapped[str | None] = mapped_column(Text)
    page_url:     Mapped[str | None] = mapped_column(Text)
    extracted_at: Mapped[datetime | None]
    created_at:   Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)
    updated_at:   Mapped[datetime]  = mapped_column(server_default=func.now(),
                                                    onupdate=func.now(), nullable=False)
    __table_args__ = (Index("ix_claims_project_status", "project_id", "status"),)


class InboxItem(Base):
    __tablename__ = "inbox_items"
    id:         Mapped[uuid.UUID] = _uuid_pk()
    user_id:    Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                  ForeignKey("users.id", ondelete="CASCADE"),
                                                  nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                  ForeignKey("projects.id", ondelete="CASCADE"),
                                                  nullable=False)
    claim_id:   Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                  ForeignKey("claims.id", ondelete="CASCADE"),
                                                  nullable=False)
    saved_at:   Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)
    __table_args__ = (UniqueConstraint("project_id", "claim_id", name="uq_inbox_project_claim"),)


class Conflict(Base):
    __tablename__ = "conflicts"
    id:           Mapped[uuid.UUID] = _uuid_pk()
    user_id:      Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                    ForeignKey("users.id", ondelete="CASCADE"),
                                                    nullable=False)
    project_id:   Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                    ForeignKey("projects.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    doi:          Mapped[str | None] = mapped_column(Text)
    group_key:    Mapped[str]       = mapped_column(Text, nullable=False)
    paper_title:  Mapped[str | None] = mapped_column(Text)
    flagged_at:   Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)
    resolution:   Mapped[str | None] = mapped_column(Text)
    sides:        Mapped[dict]      = mapped_column(JSONB, nullable=False)


class Run(Base):
    __tablename__ = "runs"
    id:               Mapped[uuid.UUID] = _uuid_pk()
    user_id:          Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                        ForeignKey("users.id", ondelete="CASCADE"),
                                                        nullable=False)
    project_id:       Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True),
                                                               ForeignKey("projects.id", ondelete="SET NULL"))
    kind:             Mapped[str] = mapped_column(Text, nullable=False)
    status:           Mapped[str] = mapped_column(Text, nullable=False)
    input:            Mapped[dict]      = mapped_column(JSONB, nullable=False)
    result:           Mapped[dict | None] = mapped_column(JSONB)
    error:            Mapped[dict | None] = mapped_column(JSONB)
    goclaw_run_id:    Mapped[str | None] = mapped_column(Text)
    idempotency_key:  Mapped[str | None] = mapped_column(Text)
    created_at:       Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)
    started_at:       Mapped[datetime | None]
    finished_at:      Mapped[datetime | None]
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_runs_user_idem"),
        Index("ix_runs_user_created", "user_id", "created_at"),
        Index("ix_runs_active", "status",
              postgresql_where="status in ('queued','running','cancelling')"),
    )


class RunEventRow(Base):
    __tablename__ = "run_events"
    id:      Mapped[int]       = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id:  Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                               ForeignKey("runs.id", ondelete="CASCADE"),
                                               nullable=False)
    seq:     Mapped[int]       = mapped_column(Integer, nullable=False)
    ts:      Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)
    type:    Mapped[str]       = mapped_column(Text, nullable=False)
    payload: Mapped[dict]      = mapped_column(JSONB, nullable=False)
    __table_args__ = (
        UniqueConstraint("run_id", "seq", name="uq_run_event_seq"),
        Index("ix_run_events_run_seq", "run_id", "seq"),
    )


class VerifyCache(Base):
    __tablename__ = "verify_cache"
    doi:        Mapped[str] = mapped_column(Text, primary_key=True)
    claim_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    result:     Mapped[dict] = mapped_column(JSONB, nullable=False)
    cached_at:  Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
```

- [ ] **Step 2: Reinstall shared so backend picks it up**

```
cd research-kit/backend
pip install -e ../shared
```

- [ ] **Step 3: Commit**

```bash
git add research-kit/shared/rk_shared/models.py
git commit -m "feat(shared): SQLAlchemy ORM for full schema"
```

### Task B3 — Alembic init + first migration

**Files:**
- Create: `research-kit/backend/alembic.ini`
- Create: `research-kit/backend/alembic/env.py`
- Create: `research-kit/backend/alembic/script.py.mako`
- Create: `research-kit/backend/alembic/versions/0001_initial.py`

- [ ] **Step 1: Create `alembic.ini`** (minimal)

```ini
[alembic]
script_location = alembic
sqlalchemy.url = ${DATABASE_URL_SYNC}

[loggers]
keys = root
[handlers]
keys = console
[formatters]
keys = generic
[logger_root]
level = WARN
handlers = console
qualname =
[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic
[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
```

- [ ] **Step 2: Create `alembic/env.py`**

```python
import os
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
from rk_shared.models import Base

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

# Allow override from env (sync URL for alembic)
db_url = os.environ.get("DATABASE_URL_SYNC") or os.environ.get("DATABASE_URL", "").replace(
    "+asyncpg", ""
)
if db_url:
    config.set_main_option("sqlalchemy.url", db_url)

target_metadata = Base.metadata


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
```

- [ ] **Step 3: Create `alembic/script.py.mako`**

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}

def upgrade() -> None:
    ${upgrades if upgrades else "pass"}

def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 4: Add `psycopg2-binary` to backend dev dependencies for alembic sync driver**

Edit `research-kit/backend/pyproject.toml`, add to `[project.optional-dependencies].dev`: `"psycopg2-binary>=2.9"`. Reinstall:

```
pip install -e .[dev]
```

- [ ] **Step 5: Generate the initial migration via autogenerate against an ephemeral PG**

Boot a one-off PG, point Alembic at it, autogenerate, then save the migration:

```bash
cd research-kit/backend
docker run --rm -d --name rk_alembic_pg -e POSTGRES_DB=rk -e POSTGRES_USER=rk -e POSTGRES_PASSWORD=rk -p 55432:5432 postgres:16-alpine
sleep 5
DATABASE_URL_SYNC=postgresql+psycopg2://rk:rk@localhost:55432/rk \
  alembic revision --autogenerate -m "initial schema"
DATABASE_URL_SYNC=postgresql+psycopg2://rk:rk@localhost:55432/rk \
  alembic upgrade head
docker stop rk_alembic_pg
```

Rename the generated revision file to `0001_initial.py` and set `revision = "0001_initial"`, `down_revision = None`.

- [ ] **Step 6: Commit**

```bash
git add research-kit/backend/alembic.ini research-kit/backend/alembic
git commit -m "feat(backend): alembic init + 0001_initial schema migration"
```

### Task B4 — Migration test (testcontainers)

**Files:**
- Create: `research-kit/backend/tests/test_migrations.py`

- [ ] **Step 1: Write failing test**

```python
import os
import pytest
from sqlalchemy import create_engine, inspect
from testcontainers.postgres import PostgresContainer
from alembic import command
from alembic.config import Config

@pytest.fixture(scope="module")
def pg():
    with PostgresContainer("postgres:16-alpine") as c:
        yield c

def test_migration_creates_all_tables(pg):
    sync_url = pg.get_connection_url()       # postgresql+psycopg2://...
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", sync_url)
    os.environ["DATABASE_URL_SYNC"] = sync_url
    command.upgrade(cfg, "head")

    eng = create_engine(sync_url)
    insp = inspect(eng)
    tables = set(insp.get_table_names())
    expected = {"users","sessions","projects","claims","inbox_items",
                "conflicts","runs","run_events","verify_cache","alembic_version"}
    assert expected.issubset(tables)
```

- [ ] **Step 2: Run**

```
pytest tests/test_migrations.py -v
```

Expected: pass after pulling postgres:16-alpine the first time.

- [ ] **Step 3: Commit**

```bash
git add research-kit/backend/tests/test_migrations.py
git commit -m "test(backend): migration creates all tables"
```

### Task B5 — Async DB session module + fixture

**Files:**
- Create: `research-kit/backend/app/db.py`
- Modify: `research-kit/backend/tests/conftest.py`

- [ ] **Step 1: Write `app/db.py`**

```python
from collections.abc import AsyncIterator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings   # to be created in Phase C; placeholder import allowed

_engine = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def init_engine(url: str) -> None:
    global _engine, _sessionmaker
    _engine = create_async_engine(url, pool_size=10, max_overflow=20, pool_pre_ping=True)
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    assert _sessionmaker is not None, "Call init_engine first"
    async with _sessionmaker() as s:
        yield s
```

(Placeholder import for `settings` will resolve in Phase C; this task does not import it at module load — only `init_engine` is called from app startup.)

- [ ] **Step 2: Update `conftest.py`**

```python
import pytest
from httpx import ASGITransport, AsyncClient
from testcontainers.postgres import PostgresContainer
from alembic import command
from alembic.config import Config
import os

@pytest.fixture(scope="session")
def pg_url():
    with PostgresContainer("postgres:16-alpine") as c:
        sync_url = c.get_connection_url()
        async_url = sync_url.replace("+psycopg2", "+asyncpg")
        cfg = Config("alembic.ini")
        cfg.set_main_option("sqlalchemy.url", sync_url)
        os.environ["DATABASE_URL_SYNC"] = sync_url
        command.upgrade(cfg, "head")
        yield async_url

@pytest.fixture
async def db_engine(pg_url):
    from app.db import init_engine, _sessionmaker
    init_engine(pg_url)
    yield _sessionmaker

@pytest.fixture
async def client(pg_url):
    os.environ["DATABASE_URL"] = pg_url
    from app.main import create_app
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
```

- [ ] **Step 3: Run existing tests, expect green**

```
pytest -v
```

- [ ] **Step 4: Commit**

```bash
git add research-kit/backend/app/db.py research-kit/backend/tests/conftest.py
git commit -m "feat(backend): async engine + testcontainers session fixture"
```

### Task B6 — Phase B checkpoint

- [ ] Append `## Checkpoint B — passed ...` to plan and commit (`chore(plan): checkpoint B passed`).

---

## Phase C — FastAPI app skeleton (config + logging + errors)

**Goal:** Settings via pydantic, structlog JSON logging with `request_id`, error handler, all wired so `/health` keeps working under the new structure.

### Task C1 — `app/config.py` Settings

**Files:**
- Create: `research-kit/backend/app/config.py`
- Create: `research-kit/backend/tests/test_config.py`

- [ ] **Step 1: Write failing test**

```python
def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x")
    monkeypatch.setenv("REDIS_URL", "redis://r")
    monkeypatch.setenv("SESSION_SECRET", "s"*32)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("GOCLAW_URL", "http://g")
    monkeypatch.setenv("GOCLAW_TOKEN", "t")
    from app.config import Settings
    s = Settings()
    assert s.env == "development"
    assert s.session_secret == "s"*32
    assert s.dev_auth_bypass is False
```

- [ ] **Step 2: Run, see fail (ImportError).**

- [ ] **Step 3: Implement `app/config.py`**

```python
from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, case_sensitive=False, extra="ignore")

    env: str = "development"
    log_level: str = "INFO"

    database_url: str
    redis_url: str

    google_client_id: str
    session_secret: str = Field(min_length=32)

    goclaw_url: str
    goclaw_token: str

    dev_auth_bypass: bool = False


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings  # callable; FastAPI deps use Depends(settings)
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app/config.py research-kit/backend/tests/test_config.py
git commit -m "feat(backend): settings module"
```

### Task C2 — Structlog setup + request_id middleware

**Files:**
- Create: `research-kit/backend/app/logging.py`
- Create: `research-kit/backend/app/middleware.py`
- Modify: `research-kit/backend/app/main.py`
- Create: `research-kit/backend/tests/test_logging.py`

- [ ] **Step 1: Write failing test (request_id propagates to logs)**

```python
import json
import logging
import pytest
from io import StringIO

@pytest.mark.asyncio
async def test_request_id_in_log(client, caplog):
    caplog.set_level(logging.INFO)
    r = await client.get("/health", headers={"X-Request-Id": "test-rid-1"})
    assert r.status_code == 200
    # X-Request-Id should be echoed back
    assert r.headers.get("X-Request-Id") == "test-rid-1"
```

- [ ] **Step 2: Implement `app/logging.py`**

```python
import logging
import structlog
from contextvars import ContextVar

request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)
user_id_ctx:    ContextVar[str | None] = ContextVar("user_id",    default=None)


def _add_ctx(_, __, event_dict):
    rid = request_id_ctx.get()
    uid = user_id_ctx.get()
    if rid: event_dict["request_id"] = rid
    if uid: event_dict["user_id"]    = uid
    return event_dict


def configure(level: str = "INFO") -> None:
    logging.basicConfig(level=level, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.add_log_level,
            _add_ctx,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level)),
        logger_factory=structlog.PrintLoggerFactory(),
    )


def get_logger(name: str = "app") -> structlog.BoundLogger:
    return structlog.get_logger(name)
```

- [ ] **Step 3: Implement `app/middleware.py`**

```python
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.logging import request_id_ctx


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("X-Request-Id") or uuid.uuid4().hex
        token = request_id_ctx.set(rid)
        try:
            response = await call_next(request)
        finally:
            request_id_ctx.reset(token)
        response.headers["X-Request-Id"] = rid
        return response
```

- [ ] **Step 4: Update `app/main.py`**

```python
from fastapi import FastAPI

from app.config import get_settings
from app.logging import configure as configure_logging
from app.middleware import RequestIdMiddleware


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="ResearchKit Backend", version="0.1.0")
    app.add_middleware(RequestIdMiddleware)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
```

- [ ] **Step 5: Run all tests; ensure green**

```
pytest -v
```

- [ ] **Step 6: Commit**

```bash
git add research-kit/backend/app/logging.py research-kit/backend/app/middleware.py research-kit/backend/app/main.py research-kit/backend/tests/test_logging.py
git commit -m "feat(backend): structlog + request-id middleware"
```

### Task C3 — Error model and global handler

**Files:**
- Create: `research-kit/backend/app/errors.py`
- Modify: `research-kit/backend/app/main.py`
- Create: `research-kit/backend/tests/test_errors.py`

- [ ] **Step 1: Write failing test**

```python
@pytest.mark.asyncio
async def test_error_envelope(client):
    # Hit a route that does not exist
    r = await client.get("/v1/__nope__")
    assert r.status_code == 404
    assert r.json() == {"error": {"code": "not_found", "message": "Not Found"}}
```

- [ ] **Step 2: Implement `app/errors.py`**

```python
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException


class APIError(Exception):
    code: str = "internal_error"
    status: int = 500

    def __init__(self, message: str, *, details: dict | None = None):
        self.message = message
        self.details = details


class AuthError(APIError):       code, status = "auth_error", 401
class PermissionError_(APIError): code, status = "permission_denied", 403
class NotFoundError(APIError):   code, status = "not_found", 404
class ValidationError_(APIError):code, status = "validation_error", 400
class ConflictError(APIError):   code, status = "conflict", 409
class RateLimitError(APIError):  code, status = "rate_limited", 429
class UpstreamError(APIError):   code, status = "upstream_error", 502


def _envelope(code: str, message: str, details: dict | None = None) -> dict:
    body: dict = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    return body


async def api_error_handler(_: Request, exc: APIError) -> JSONResponse:
    return JSONResponse(_envelope(exc.code, exc.message, exc.details), status_code=exc.status)


async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = {400:"validation_error",401:"auth_error",403:"permission_denied",
            404:"not_found",405:"method_not_allowed",409:"conflict",
            429:"rate_limited"}.get(exc.status_code, "internal_error")
    return JSONResponse(_envelope(code, exc.detail or code), status_code=exc.status_code)


async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(_envelope("validation_error", "invalid request",
                                  {"errors": exc.errors()}), status_code=400)


def install(app):
    app.add_exception_handler(APIError, api_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
```

- [ ] **Step 3: Wire in `main.py`** — call `errors.install(app)` after middleware.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app/errors.py research-kit/backend/app/main.py research-kit/backend/tests/test_errors.py
git commit -m "feat(backend): error envelope + global handlers"
```

### Task C4 — Phase C checkpoint

- [ ] Append checkpoint, commit.

---

## Phase D — Auth (Google OAuth + sessions)

**Goal:** `POST /v1/auth/login` accepts a Google ID token, verifies it, upserts user, issues session token. `current_user` dependency works on subsequent requests. Dev bypass works when env-gated.

### Task D1 — Google ID token verifier with fake JWKS

**Files:**
- Create: `research-kit/backend/app/auth/__init__.py` (empty)
- Create: `research-kit/backend/app/auth/google.py`
- Create: `research-kit/backend/tests/test_google_verify.py`
- Create: `research-kit/backend/tests/auth_fakes.py`

- [ ] **Step 1: Write the fake-JWKS helper** (`tests/auth_fakes.py`)

```python
import time, json, uuid
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
import jwt   # comes via google-auth's deps; if not present, add `pyjwt` to dev deps

def make_keypair():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem_priv = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return key, pem_priv

def issue_id_token(*, sub: str, email: str, aud: str, kid: str, key) -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss":"https://accounts.google.com","sub":sub,"email":email,
         "aud":aud,"iat":now,"exp":now+3600,"email_verified":True,"name":"Test"},
        key, algorithm="RS256", headers={"kid": kid},
    )
```

(Add `pyjwt[crypto]>=2.9` to backend dev deps if not already, plus `cryptography>=42` already present per requirements.)

- [ ] **Step 2: Failing test for verifier**

```python
import pytest
from tests.auth_fakes import make_keypair, issue_id_token

@pytest.mark.asyncio
async def test_verify_accepts_valid_token(monkeypatch):
    key, pem = make_keypair()
    kid = "kid-1"
    token = issue_id_token(sub="g-123", email="a@b.com", aud="cid-1", kid=kid, key=key)

    from app.auth.google import GoogleVerifier, JWKSCache
    cache = JWKSCache(client_id="cid-1")
    # Inject our keypair as JWKS
    pub_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    cache._set_for_test({kid: pub_pem})

    verifier = GoogleVerifier(cache, client_id="cid-1")
    claims = await verifier.verify(token)
    assert claims["sub"] == "g-123"
    assert claims["email"] == "a@b.com"

@pytest.mark.asyncio
async def test_verify_rejects_wrong_aud(monkeypatch):
    from app.auth.google import GoogleVerifier, JWKSCache
    from app.errors import AuthError
    key, _ = make_keypair()
    token = issue_id_token(sub="x", email="x@x", aud="OTHER", kid="k", key=key)
    cache = JWKSCache(client_id="cid-1")
    cache._set_for_test({"k": key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()})
    with pytest.raises(AuthError):
        await GoogleVerifier(cache, client_id="cid-1").verify(token)
```

- [ ] **Step 3: Implement `app/auth/google.py`**

```python
import time
from typing import Any
import httpx
import jwt
from jwt import PyJWKClient, InvalidTokenError

from app.errors import AuthError

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"


class JWKSCache:
    """Caches Google's JWKS for ~1h. Test path overrides via _set_for_test."""

    def __init__(self, client_id: str, ttl_sec: int = 3600):
        self.client_id = client_id
        self._ttl = ttl_sec
        self._keys: dict[str, str] = {}     # kid → PEM public
        self._fetched_at: float = 0.0

    def _set_for_test(self, keys: dict[str, str]) -> None:
        self._keys = dict(keys)
        self._fetched_at = time.time()

    async def get(self, kid: str) -> str:
        if not self._keys or (time.time() - self._fetched_at) > self._ttl:
            await self._refresh()
        if kid not in self._keys:
            await self._refresh()
        if kid not in self._keys:
            raise AuthError(f"unknown kid: {kid}")
        return self._keys[kid]

    async def _refresh(self) -> None:
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(GOOGLE_JWKS_URL)
            r.raise_for_status()
            jwks = r.json()
        new: dict[str, str] = {}
        for k in jwks.get("keys", []):
            kid = k["kid"]
            new[kid] = jwt.algorithms.RSAAlgorithm.from_jwk(k).public_bytes(
                encoding=__import__("cryptography").hazmat.primitives.serialization.Encoding.PEM,
                format=__import__("cryptography").hazmat.primitives.serialization.PublicFormat.SubjectPublicKeyInfo,
            ).decode()
        self._keys = new
        self._fetched_at = time.time()


class GoogleVerifier:
    def __init__(self, jwks: JWKSCache, *, client_id: str):
        self.jwks = jwks
        self.client_id = client_id

    async def verify(self, token: str) -> dict[str, Any]:
        try:
            unverified = jwt.get_unverified_header(token)
            kid = unverified.get("kid")
            if not kid:
                raise AuthError("missing kid")
            pub_pem = await self.jwks.get(kid)
            claims = jwt.decode(
                token, pub_pem, algorithms=["RS256"],
                audience=self.client_id,
                issuer=["https://accounts.google.com", "accounts.google.com"],
                options={"require": ["sub", "email", "exp", "iat"]},
            )
            return claims
        except InvalidTokenError as e:
            raise AuthError(f"invalid id token: {e}")
```

- [ ] **Step 4: Run tests; pass.**

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app/auth research-kit/backend/tests/test_google_verify.py research-kit/backend/tests/auth_fakes.py
git commit -m "feat(backend): Google ID token verifier with JWKS cache"
```

### Task D2 — Session token issue / verify

**Files:**
- Create: `research-kit/backend/app/auth/session.py`
- Create: `research-kit/backend/tests/test_sessions.py`

- [ ] **Step 1: Failing test**

```python
import pytest
from datetime import timedelta
from sqlalchemy import select

from rk_shared.models import User, Session as SessionRow

@pytest.mark.asyncio
async def test_issue_and_validate_session(db_engine):
    from app.auth.session import SessionService
    svc = SessionService(secret="x"*32, ttl=timedelta(hours=1))
    async with db_engine() as s:
        u = User(google_sub="g1", email="a@b")
        s.add(u); await s.commit(); await s.refresh(u)
    async with db_engine() as s:
        token = await svc.issue(s, user_id=u.id)
        await s.commit()
    async with db_engine() as s:
        uid = await svc.validate(s, token)
        assert uid == u.id

@pytest.mark.asyncio
async def test_invalid_token_rejected(db_engine):
    from app.auth.session import SessionService
    from app.errors import AuthError
    svc = SessionService(secret="x"*32, ttl=__import__("datetime").timedelta(hours=1))
    async with db_engine() as s:
        with pytest.raises(AuthError):
            await svc.validate(s, "bogus")
```

- [ ] **Step 2: Implement `app/auth/session.py`**

```python
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AuthError
from rk_shared.models import Session as SessionRow

def _hash(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


class SessionService:
    def __init__(self, *, secret: str, ttl: timedelta):
        # secret used as additional HMAC pepper if you ever switch to stateless tokens; for now, opaque random tokens
        self.secret = secret
        self.ttl = ttl

    async def issue(self, s: AsyncSession, *, user_id: UUID) -> str:
        token = secrets.token_urlsafe(32)
        now = datetime.now(tz=timezone.utc)
        s.add(SessionRow(
            token_hash=_hash(token),
            user_id=user_id,
            created_at=now,
            expires_at=now + self.ttl,
            last_used_at=now,
        ))
        return token

    async def validate(self, s: AsyncSession, token: str) -> UUID:
        if not token:
            raise AuthError("missing token")
        row = (await s.execute(
            select(SessionRow).where(SessionRow.token_hash == _hash(token))
        )).scalar_one_or_none()
        now = datetime.now(tz=timezone.utc)
        if not row or row.expires_at < now:
            raise AuthError("invalid or expired session")
        # sliding renewal
        await s.execute(
            update(SessionRow)
            .where(SessionRow.token_hash == row.token_hash)
            .values(last_used_at=now, expires_at=now + self.ttl)
        )
        return row.user_id

    async def revoke(self, s: AsyncSession, token: str) -> None:
        await s.execute(delete(SessionRow).where(SessionRow.token_hash == _hash(token)))
```

- [ ] **Step 3: Run; pass.**

- [ ] **Step 4: Commit**

```bash
git add research-kit/backend/app/auth/session.py research-kit/backend/tests/test_sessions.py
git commit -m "feat(backend): session token service"
```

### Task D3 — `current_user` dependency + DEV bypass

**Files:**
- Create: `research-kit/backend/app/deps.py`
- Create: `research-kit/backend/tests/test_deps_user.py`

- [ ] **Step 1: Failing test for bypass and bearer paths** (use a tiny throwaway router fixture)

```python
import os
import pytest
from fastapi import FastAPI, Depends
from httpx import ASGITransport, AsyncClient

@pytest.mark.asyncio
async def test_dev_bypass_creates_user(pg_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", pg_url)
    monkeypatch.setenv("ENV", "development")
    monkeypatch.setenv("DEV_AUTH_BYPASS", "true")
    monkeypatch.setenv("SESSION_SECRET", "x"*32)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("REDIS_URL", "redis://x")
    monkeypatch.setenv("GOCLAW_URL", "http://x")
    monkeypatch.setenv("GOCLAW_TOKEN", "t")
    from app.config import get_settings
    get_settings.cache_clear()
    from app.main import create_app
    from app.deps import current_user
    app = create_app()

    @app.get("/whoami")
    async def whoami(u = Depends(current_user)):
        return {"id": str(u.id), "email": u.email}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/whoami", headers={"X-Dev-User": "alice@example.com"})
    assert r.status_code == 200
    assert r.json()["email"] == "alice@example.com"

@pytest.mark.asyncio
async def test_no_token_rejects(client):
    # client fixture has dev_auth_bypass=False default
    r = await client.get("/v1/auth/me")
    assert r.status_code == 401
```

- [ ] **Step 2: Implement `app/deps.py`**

```python
from collections.abc import AsyncIterator
from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.errors import AuthError
from app.auth.google import GoogleVerifier, JWKSCache
from app.auth.session import SessionService
from app.db import get_session
from app.logging import user_id_ctx
from rk_shared.models import User


_session_service: SessionService | None = None
_google_verifier: GoogleVerifier | None = None


def session_service() -> SessionService:
    global _session_service
    if _session_service is None:
        from datetime import timedelta
        s = get_settings()
        _session_service = SessionService(secret=s.session_secret, ttl=timedelta(hours=24))
    return _session_service


def google_verifier() -> GoogleVerifier:
    global _google_verifier
    if _google_verifier is None:
        s = get_settings()
        _google_verifier = GoogleVerifier(JWKSCache(client_id=s.google_client_id), client_id=s.google_client_id)
    return _google_verifier


async def db() -> AsyncIterator[AsyncSession]:
    async for s in get_session():
        yield s


async def current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None, alias="X-Dev-User"),
    s: AsyncSession = Depends(db),
) -> User:
    settings = get_settings()
    if settings.env == "development" and settings.dev_auth_bypass and x_dev_user:
        # upsert by email
        u = (await s.execute(select(User).where(User.email == x_dev_user))).scalar_one_or_none()
        if not u:
            u = User(google_sub=f"dev|{x_dev_user}", email=x_dev_user, name=x_dev_user)
            s.add(u); await s.commit(); await s.refresh(u)
        user_id_ctx.set(str(u.id))
        return u

    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError("missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    user_id = await session_service().validate(s, token)
    await s.commit()  # commit the sliding-renewal update
    u = (await s.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u:
        raise AuthError("user not found")
    user_id_ctx.set(str(u.id))
    return u
```

- [ ] **Step 3: Wire `app.db.init_engine(settings.database_url)` into `create_app`** (modify main.py before adding routes; create startup hook):

```python
@app.on_event("startup")
async def _startup():
    from app.db import init_engine
    init_engine(get_settings().database_url)
```

- [ ] **Step 4: Run, expect pass (the second test will fail until D4 adds /v1/auth/me; mark it `pytest.mark.xfail(strict=False)` for now or move it into D4).**

- [ ] **Step 5: Commit**

```bash
git add research-kit/backend/app/deps.py research-kit/backend/tests/test_deps_user.py research-kit/backend/app/main.py
git commit -m "feat(backend): current_user dep with dev bypass"
```

### Task D4 — `/v1/auth/login`, `/v1/auth/me`, `/v1/auth/logout`

**Files:**
- Create: `research-kit/backend/app/routers/__init__.py` (empty)
- Create: `research-kit/backend/app/routers/auth.py`
- Create: `research-kit/backend/app/schemas/__init__.py` (empty)
- Create: `research-kit/backend/app/schemas/auth.py`
- Create: `research-kit/backend/tests/test_auth_endpoints.py`
- Modify: `research-kit/backend/app/main.py`

- [ ] **Step 1: Failing test** — covers login, me, logout round-trip with fake Google.

```python
import pytest
from datetime import timezone
from sqlalchemy import select
from rk_shared.models import User
from tests.auth_fakes import make_keypair, issue_id_token

@pytest.mark.asyncio
async def test_login_me_logout(client, monkeypatch, db_engine):
    # set up fake Google verifier
    key, _ = make_keypair()
    from app.deps import google_verifier
    gv = google_verifier()
    pub_pem = key.public_key().public_bytes(
        __import__("cryptography").hazmat.primitives.serialization.Encoding.PEM,
        __import__("cryptography").hazmat.primitives.serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    gv.jwks._set_for_test({"k1": pub_pem})

    token = issue_id_token(sub="g-x", email="t@x", aud="cid", kid="k1", key=key)

    # login
    r = await client.post("/v1/auth/login", json={"google_id_token": token})
    assert r.status_code == 200, r.text
    body = r.json()
    sess = body["session_token"]
    assert body["user"]["email"] == "t@x"

    # me
    r2 = await client.get("/v1/auth/me", headers={"Authorization": f"Bearer {sess}"})
    assert r2.status_code == 200
    assert r2.json()["user"]["email"] == "t@x"

    # logout
    r3 = await client.post("/v1/auth/logout", headers={"Authorization": f"Bearer {sess}"})
    assert r3.status_code == 204

    # me after logout
    r4 = await client.get("/v1/auth/me", headers={"Authorization": f"Bearer {sess}"})
    assert r4.status_code == 401
```

For this test, the `client` fixture must initialize settings with `GOOGLE_CLIENT_ID=cid`. Update `conftest.py` to set that env before importing the app.

- [ ] **Step 2: Implement schemas** (`app/schemas/auth.py`)

```python
from pydantic import BaseModel
from datetime import datetime
from uuid import UUID

class LoginRequest(BaseModel):
    google_id_token: str

class UserOut(BaseModel):
    id: UUID
    email: str
    name: str | None = None

class LoginResponse(BaseModel):
    session_token: str
    user: UserOut
    expires_at: datetime

class MeResponse(BaseModel):
    user: UserOut
```

- [ ] **Step 3: Implement router** (`app/routers/auth.py`)

```python
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, db, google_verifier, session_service
from app.errors import AuthError
from app.schemas.auth import LoginRequest, LoginResponse, MeResponse, UserOut
from rk_shared.models import User

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, s: AsyncSession = Depends(db)) -> LoginResponse:
    claims = await google_verifier().verify(body.google_id_token)
    sub = claims["sub"]; email = claims["email"]; name = claims.get("name")
    u = (await s.execute(select(User).where(User.google_sub == sub))).scalar_one_or_none()
    if not u:
        u = User(google_sub=sub, email=email, name=name)
        s.add(u)
    else:
        u.email = email; u.name = name
    await s.flush()
    token = await session_service().issue(s, user_id=u.id)
    await s.commit()
    return LoginResponse(
        session_token=token,
        user=UserOut(id=u.id, email=u.email, name=u.name),
        expires_at=datetime.now(tz=timezone.utc) + timedelta(hours=24),
    )


@router.get("/me", response_model=MeResponse)
async def me(u: User = Depends(current_user)) -> MeResponse:
    return MeResponse(user=UserOut(id=u.id, email=u.email, name=u.name))


@router.post("/logout", status_code=204)
async def logout(authorization: str = Depends(lambda r=None: None),
                 u: User = Depends(current_user),
                 s: AsyncSession = Depends(db)) -> Response:
    # extract raw token from request
    from fastapi import Request
    # simpler: re-parse from request via dependency
    raise NotImplementedError  # replaced below
```

The `logout` body above is a placeholder; the real implementation needs the raw token. Refactor:

```python
from fastapi import Header

@router.post("/logout", status_code=204)
async def logout(
    authorization: str | None = Header(default=None),
    s: AsyncSession = Depends(db),
    u: User = Depends(current_user),
) -> Response:
    if authorization and authorization.lower().startswith("bearer "):
        await session_service().revoke(s, authorization.split(" ", 1)[1])
        await s.commit()
    return Response(status_code=204)
```

- [ ] **Step 4: Wire router in `main.py`**

```python
from app.routers import auth as auth_router
app.include_router(auth_router.router)
```

- [ ] **Step 5: Run; expect pass.**

- [ ] **Step 6: Commit**

```bash
git add research-kit/backend/app/routers research-kit/backend/app/schemas research-kit/backend/tests/test_auth_endpoints.py research-kit/backend/app/main.py
git commit -m "feat(backend): /v1/auth login/me/logout"
```

### Task D5 — Phase D checkpoint

- [ ] Append checkpoint, commit.

---

## Phase E — Projects CRUD (template for all CRUD)

This phase establishes the pattern: schema, repository, router, row-level isolation tests. Subsequent CRUD phases reuse the pattern verbatim.

### Task E1 — Schemas

**Files:**
- Create: `research-kit/backend/app/schemas/projects.py`

- [ ] **Step 1: Write**

```python
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field

class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)

class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)

class ProjectOut(BaseModel):
    id: UUID
    name: str
    created_at: datetime
```

- [ ] **Step 2: Commit**

```bash
git add research-kit/backend/app/schemas/projects.py
git commit -m "feat(backend): project schemas"
```

### Task E2 — Repository + tests

**Files:**
- Create: `research-kit/backend/app/repos/__init__.py` (empty)
- Create: `research-kit/backend/app/repos/projects.py`
- Create: `research-kit/backend/tests/test_projects_repo.py`

- [ ] **Step 1: Failing test**

```python
import pytest, uuid
from rk_shared.models import User

@pytest.mark.asyncio
async def test_create_list_filters_by_user(db_engine):
    from app.repos.projects import ProjectRepo
    async with db_engine() as s:
        u1 = User(google_sub="a", email="a"); u2 = User(google_sub="b", email="b")
        s.add_all([u1, u2]); await s.commit(); await s.refresh(u1); await s.refresh(u2)
        repo = ProjectRepo(s)
        p1 = await repo.create(u1.id, name="X")
        p2 = await repo.create(u2.id, name="Y")
        await s.commit()
        listed = await repo.list_for(u1.id)
        ids = {p.id for p in listed}
        assert p1.id in ids and p2.id not in ids
```

- [ ] **Step 2: Implement**

```python
from uuid import UUID
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import NotFoundError
from rk_shared.models import Project


class ProjectRepo:
    def __init__(self, s: AsyncSession): self.s = s

    async def create(self, user_id: UUID, *, name: str) -> Project:
        p = Project(user_id=user_id, name=name)
        self.s.add(p)
        await self.s.flush()
        return p

    async def list_for(self, user_id: UUID) -> list[Project]:
        return list((await self.s.execute(
            select(Project).where(Project.user_id == user_id).order_by(Project.created_at)
        )).scalars())

    async def get(self, user_id: UUID, project_id: UUID) -> Project:
        p = (await self.s.execute(
            select(Project).where(Project.id == project_id, Project.user_id == user_id)
        )).scalar_one_or_none()
        if not p:
            raise NotFoundError("project not found")
        return p

    async def update(self, user_id: UUID, project_id: UUID, *, name: str | None) -> Project:
        p = await self.get(user_id, project_id)
        if name is not None: p.name = name
        await self.s.flush()
        return p

    async def delete(self, user_id: UUID, project_id: UUID) -> None:
        p = await self.get(user_id, project_id)
        await self.s.delete(p)
```

- [ ] **Step 3: Run; pass.**

- [ ] **Step 4: Commit**

```bash
git add research-kit/backend/app/repos research-kit/backend/tests/test_projects_repo.py
git commit -m "feat(backend): project repository with isolation"
```

### Task E3 — Router + endpoint tests

**Files:**
- Create: `research-kit/backend/app/routers/projects.py`
- Create: `research-kit/backend/tests/test_projects_endpoints.py`
- Modify: `research-kit/backend/app/main.py`

- [ ] **Step 1: Failing test (uses dev bypass for brevity)** — sets env in fixture; create + list + cross-user isolation.

```python
import pytest

@pytest.mark.asyncio
async def test_projects_crud(client_dev_alice, client_dev_bob):
    r = await client_dev_alice.post("/v1/projects", json={"name":"Lit Review"})
    assert r.status_code == 201
    pid = r.json()["id"]

    r2 = await client_dev_alice.get("/v1/projects")
    assert any(p["id"]==pid for p in r2.json())

    # Bob cannot see Alice's project
    r3 = await client_dev_bob.get("/v1/projects")
    assert all(p["id"]!=pid for p in r3.json())

    r4 = await client_dev_alice.patch(f"/v1/projects/{pid}", json={"name":"Renamed"})
    assert r4.json()["name"] == "Renamed"

    # Bob cannot delete Alice's project (404, not 403, to avoid leaking existence)
    r5 = await client_dev_bob.delete(f"/v1/projects/{pid}")
    assert r5.status_code == 404

    r6 = await client_dev_alice.delete(f"/v1/projects/{pid}")
    assert r6.status_code == 204
```

(Add `client_dev_alice` and `client_dev_bob` fixtures in conftest that set DEV bypass headers.)

- [ ] **Step 2: Implement router**

```python
from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, db
from app.repos.projects import ProjectRepo
from app.schemas.projects import ProjectIn, ProjectOut, ProjectPatch
from rk_shared.models import User

router = APIRouter(prefix="/v1/projects", tags=["projects"])


def _to_out(p) -> ProjectOut:
    return ProjectOut(id=p.id, name=p.name, created_at=p.created_at)


@router.get("", response_model=list[ProjectOut])
async def list_projects(u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    return [_to_out(p) for p in await ProjectRepo(s).list_for(u.id)]


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(body: ProjectIn, u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    p = await ProjectRepo(s).create(u.id, name=body.name)
    await s.commit()
    return _to_out(p)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(project_id: UUID, body: ProjectPatch,
                          u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    p = await ProjectRepo(s).update(u.id, project_id, name=body.name)
    await s.commit()
    return _to_out(p)


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: UUID, u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    await ProjectRepo(s).delete(u.id, project_id)
    await s.commit()
```

- [ ] **Step 3: Wire in `main.py`**.

- [ ] **Step 4: Add `client_dev_alice` / `client_dev_bob` fixtures** to `conftest.py`:

```python
@pytest.fixture
async def client_dev_alice(client):
    client.headers["X-Dev-User"] = "alice@example.com"
    yield client

@pytest.fixture
async def client_dev_bob(client):
    client.headers["X-Dev-User"] = "bob@example.com"
    yield client
```

(Note: requires `DEV_AUTH_BYPASS=true` and `ENV=development` in test env. Add to conftest setup.)

- [ ] **Step 5: Run; pass.**

- [ ] **Step 6: Commit**

```bash
git add research-kit/backend/app/routers/projects.py research-kit/backend/tests research-kit/backend/app/main.py
git commit -m "feat(backend): projects CRUD with row-level isolation"
```

### Task E4 — Phase E checkpoint

---

## Phase F — Claims CRUD + batch + idempotency

### Task F1 — Schemas + repo + endpoints

**Files:**
- Create: `research-kit/backend/app/schemas/claims.py`
- Create: `research-kit/backend/app/repos/claims.py`
- Create: `research-kit/backend/app/routers/claims.py`
- Create: `research-kit/backend/tests/test_claims.py`

Pattern same as Phase E. Specifics:

- [ ] **Step 1: Schemas**

```python
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field

class ClaimInput(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    paper_title: str | None = None
    doi: str | None = None
    paper_url: str | None = None
    page: str | None = None
    site: str  # 'elicit'|'scispace'|'consensus' validated in router
    page_url: str | None = None
    extracted_at: datetime | None = None
    client_ref: str | None = None     # extension-side correlation id; stored in claims.text? no — use a separate column? Decision: skip for now, return server ids in original order

class ClaimOut(BaseModel):
    id: UUID
    project_id: UUID
    text: str
    paper_title: str | None
    doi: str | None
    paper_url: str | None
    page: str | None
    site: str
    status: str
    confidence: float | None
    quote: str | None
    reason: str | None
    page_url: str | None
    extracted_at: datetime | None
    created_at: datetime
    updated_at: datetime

class ClaimsBatchRequest(BaseModel):
    project_id: UUID
    claims: list[ClaimInput] = Field(max_length=100)
    idempotency_key: str | None = None

class ClaimsBatchResponse(BaseModel):
    created: list[ClaimOut]

class ClaimPatch(BaseModel):
    status: str | None = None
    quote: str | None = None
    confidence: float | None = None
    reason: str | None = None
    page: str | None = None
```

- [ ] **Step 2: Repo with batch insert**

```python
from uuid import UUID
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import NotFoundError, ValidationError_
from rk_shared.models import Claim, Project
from rk_shared.types import ClaimStatus, Site


class ClaimRepo:
    def __init__(self, s: AsyncSession): self.s = s

    async def _ensure_project(self, user_id: UUID, project_id: UUID) -> None:
        owns = (await self.s.execute(
            select(Project.id).where(Project.id == project_id, Project.user_id == user_id)
        )).scalar_one_or_none()
        if not owns:
            raise NotFoundError("project not found")

    async def batch_create(self, user_id: UUID, project_id: UUID, items: list[dict]) -> list[Claim]:
        await self._ensure_project(user_id, project_id)
        rows: list[Claim] = []
        for it in items:
            site = it.get("site")
            if site not in {s.value for s in Site}:
                raise ValidationError_(f"invalid site: {site}")
            c = Claim(
                user_id=user_id, project_id=project_id,
                text=it["text"], paper_title=it.get("paper_title"),
                doi=it.get("doi"), paper_url=it.get("paper_url"),
                page=it.get("page"), site=site,
                status=ClaimStatus.PENDING.value, confidence=None,
                quote=None, reason=None, page_url=it.get("page_url"),
                extracted_at=it.get("extracted_at"),
            )
            self.s.add(c); rows.append(c)
        await self.s.flush()
        return rows

    async def list(self, user_id: UUID, *, project_id: UUID, status: str | None,
                   limit: int = 50) -> list[Claim]:
        q = select(Claim).where(Claim.user_id == user_id, Claim.project_id == project_id)
        if status: q = q.where(Claim.status == status)
        q = q.order_by(Claim.created_at).limit(limit)
        return list((await self.s.execute(q)).scalars())

    async def get(self, user_id: UUID, claim_id: UUID) -> Claim:
        c = (await self.s.execute(
            select(Claim).where(Claim.id == claim_id, Claim.user_id == user_id)
        )).scalar_one_or_none()
        if not c: raise NotFoundError("claim not found")
        return c

    async def patch(self, user_id: UUID, claim_id: UUID, **fields) -> Claim:
        c = await self.get(user_id, claim_id)
        for k, v in fields.items():
            if v is not None: setattr(c, k, v)
        c.updated_at = datetime.now(tz=timezone.utc)
        await self.s.flush()
        return c
```

- [ ] **Step 3: Idempotency helper** (used by batch + runs)

Create `research-kit/backend/app/idempotency.py`:

```python
import hashlib, json
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from rk_shared.models import Run     # reused for storing keys? No — keys live per resource

# For claims/batch we use Redis-only (24h dedup). Runs uses runs.idempotency_key column.

import redis.asyncio as aioredis

class RedisIdem:
    def __init__(self, redis: aioredis.Redis): self.r = redis

    @staticmethod
    def _hash(payload: dict) -> str:
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()

    async def get_or_set(self, *, user_id, key: str, payload_hash: str, value: str | None = None,
                         ttl_sec: int = 86400) -> str | None:
        rkey = f"idem:{user_id}:{key}"
        existing = await self.r.get(rkey)
        if existing:
            stored = json.loads(existing)
            if stored["hash"] != payload_hash:
                from app.errors import ConflictError
                raise ConflictError("idempotency_key reused with different payload")
            return stored.get("value")
        if value is not None:
            await self.r.set(rkey, json.dumps({"hash": payload_hash, "value": value}), ex=ttl_sec)
        return None
```

- [ ] **Step 4: Redis helper**

Create `research-kit/backend/app/redis_pool.py`:

```python
import redis.asyncio as aioredis
from app.config import get_settings

_redis: aioredis.Redis | None = None

async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis
```

- [ ] **Step 5: Router**

```python
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, db
from app.idempotency import RedisIdem
from app.redis_pool import get_redis
from app.repos.claims import ClaimRepo
from app.schemas.claims import (
    ClaimsBatchRequest, ClaimsBatchResponse, ClaimOut, ClaimPatch
)
from rk_shared.models import User

router = APIRouter(prefix="/v1/claims", tags=["claims"])


def _out(c) -> ClaimOut:
    return ClaimOut.model_validate(c, from_attributes=True)


@router.post("/batch", response_model=ClaimsBatchResponse)
async def batch_create(
    body: ClaimsBatchRequest,
    u: User = Depends(current_user),
    s: AsyncSession = Depends(db),
):
    items = [c.model_dump() for c in body.claims]
    if body.idempotency_key:
        r = await get_redis()
        idem = RedisIdem(r)
        payload_hash = RedisIdem._hash({"project_id": str(body.project_id), "claims": items})
        cached_ids = await idem.get_or_set(
            user_id=u.id, key=body.idempotency_key, payload_hash=payload_hash
        )
        if cached_ids:
            from rk_shared.models import Claim
            from sqlalchemy import select
            ids = [UUID(x) for x in cached_ids.split(",")]
            rows = list((await s.execute(select(Claim).where(Claim.id.in_(ids)))).scalars())
            return ClaimsBatchResponse(created=[_out(c) for c in rows])

    rows = await ClaimRepo(s).batch_create(u.id, body.project_id, items)
    await s.commit()
    if body.idempotency_key:
        r = await get_redis()
        idem = RedisIdem(r)
        payload_hash = RedisIdem._hash({"project_id": str(body.project_id), "claims": items})
        await idem.get_or_set(
            user_id=u.id, key=body.idempotency_key, payload_hash=payload_hash,
            value=",".join(str(c.id) for c in rows),
        )
    return ClaimsBatchResponse(created=[_out(c) for c in rows])


@router.get("", response_model=list[ClaimOut])
async def list_claims(project_id: UUID, status: str | None = Query(default=None),
                       limit: int = Query(default=50, le=200),
                       u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    rows = await ClaimRepo(s).list(u.id, project_id=project_id, status=status, limit=limit)
    return [_out(c) for c in rows]


@router.patch("/{claim_id}", response_model=ClaimOut)
async def patch_claim(claim_id: UUID, body: ClaimPatch,
                      u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    c = await ClaimRepo(s).patch(u.id, claim_id,
                                 status=body.status, quote=body.quote,
                                 confidence=body.confidence, reason=body.reason, page=body.page)
    await s.commit()
    return _out(c)
```

- [ ] **Step 6: Tests** — see test outline:

```python
@pytest.mark.asyncio
async def test_batch_idempotent(client_dev_alice, redis_container):
    # create project
    r = await client_dev_alice.post("/v1/projects", json={"name":"P"})
    pid = r.json()["id"]
    body = {
        "project_id": pid,
        "claims": [{"text":"c1","site":"elicit"},{"text":"c2","site":"elicit"}],
        "idempotency_key": "key-1",
    }
    r1 = await client_dev_alice.post("/v1/claims/batch", json=body)
    r2 = await client_dev_alice.post("/v1/claims/batch", json=body)
    assert r1.json()["created"] == r2.json()["created"]    # same ids returned

@pytest.mark.asyncio
async def test_batch_idem_conflict(client_dev_alice, redis_container):
    r = await client_dev_alice.post("/v1/projects", json={"name":"P"})
    pid = r.json()["id"]
    base = {"project_id": pid, "idempotency_key":"k2"}
    a = await client_dev_alice.post("/v1/claims/batch", json={**base, "claims":[{"text":"a","site":"elicit"}]})
    b = await client_dev_alice.post("/v1/claims/batch", json={**base, "claims":[{"text":"b","site":"elicit"}]})
    assert a.status_code == 200 and b.status_code == 409
```

(Add `redis_container` fixture in conftest using testcontainers Redis; set `REDIS_URL` env from it for the duration of the session.)

- [ ] **Step 7: Run; pass.**

- [ ] **Step 8: Commit**

```bash
git add research-kit/backend/app research-kit/backend/tests
git commit -m "feat(backend): claims batch + idempotency, list, patch"
```

### Task F2 — Phase F checkpoint

---

> **Note to plan author:** Phases G, H, I, J, K, L, M, N continue with the same TDD-per-step structure. The remaining phases are documented in a follow-up plan file `2026-05-08-researchkit-backend-goclaw.part2.md` (next document) to keep each plan file digestible. **Do not start Phase G implementation until Part 2 is written.**

---

## Phase G–N Summary (full detail in part 2)

- **G — Inbox + Conflicts CRUD** — repository + router pattern from Phase E, plus cascade-delete tests verifying that deleting a project removes its inbox items and conflicts.
- **H — Worker scaffold + MockRunner + EventBus** — `worker/main.py` arq settings; `worker/runners/base.py` Protocol; `worker/runners/mock.py` deterministic event scripts; `worker/event_bus.py` with advisory-lock seq allocation; **invariant tests #1 (persist-before-publish) and #2 (monotonic seq under concurrent publishes)**.
- **I — Runs API (POST / GET / cancel) + arq enqueue + idempotency** — `/v1/runs`, `/v1/runs/{id}`, `/v1/runs/{id}/cancel`; **invariant test #4 (idempotency dedup) and #5 (cancel within 2s)**.
- **J — SSE replay-then-tail** — `app/events/replay.py` reads PG up to N then subscribes Redis from N+1; **invariant tests #3 (no-dup overlap), #6 (per-kind timeouts), #7 (worker-crash retry idempotent), #8 (GoClaw outage recoverable flag)**.
- **K — GoClaw container + bootstrap + smoke gate** — add `goclaw` and `goclaw_postgres` services; `infra/goclaw/agents/*.yaml` with vanilla configs; `bootstrap.sh` calls `goclaw-cli` to upsert; `tests/contract/test_goclaw_smoke.py` streams a chat completion. **Plan halts here on failure.**
- **L — GoClawRunner + prompts** — `worker/runners/goclaw.py` using `AsyncOpenAI` with `base_url=GOCLAW_URL/v1` and per-user headers; `worker/prompts/{verify,extract,chat,draft,conflict}.py` with `build_messages(input)`; runner unit tests with `respx` mocking the OpenAI-compatible endpoint; live contract test gated by env.
- **M — Extension API client + Google sign-in + schema-v3 wipe** — `src/api/{client,auth,projects,claims,inbox,conflicts,runs}.ts`; `src/state/{authSlice,syncSlice}.ts`; `src/state/migration.ts` v3 wipe; `manifest.json` oauth2 entry; React Query setup.
- **N — Verify pipeline rewire + finalize** — `background_minimal.ts` posts to `/v1/claims/batch` then `/v1/runs` (kind=verify) with EventSource for stream; remove legacy `/verify` and `/extract` FastAPI routes; CORS for chrome-extension; final E2E happy-path Playwright stub; remove old code.

Each phase ends with a checkpoint commit appended to this plan file.

---

## Checkpoint A — passed 2026-05-08 14:15
- /health responds via scaffolding
- pytest test_health.py green (1 passed)
- docker-compose.yml structure created

## Checkpoint F — passed 2026-05-08
- app/schemas/claims.py ClaimInput/Out/Batch/Patch schemas
- app/repos/claims.py ClaimRepo with batch insert + site validation
- app/idempotency.py RedisIdem (24h dedup via Redis)
- app/redis_pool.py async Redis singleton
- app/routers/claims.py /v1/claims/batch, list, patch
- conftest.py: redis_url fixture + autouse reset_redis_pool
- 15 tests passing

## Checkpoint E — passed 2026-05-08
- app/schemas/projects.py ProjectIn/Patch/Out
- app/repos/projects.py ProjectRepo with row-level isolation
- app/routers/projects.py CRUD endpoints (/v1/projects)
- conftest.py updated: client_dev_alice/bob fixtures, explicit init_engine
- 13 tests passing

## Checkpoint D — passed 2026-05-08
- Google ID token verifier with JWKS cache + fake for tests
- Session token service (issue/validate/revoke, naive UTC datetimes)
- current_user dependency with DEV_AUTH_BYPASS
- /v1/auth/login, /me, /logout endpoints + full round-trip test
- 11 tests passing

## Checkpoint C — passed 2026-05-08
- app/config.py Settings (pydantic-settings) + test
- app/logging.py structlog JSON + request_id/user_id context vars
- app/middleware.py RequestIdMiddleware (echoes X-Request-Id)
- app/errors.py APIError hierarchy + global handlers
- /health still green; all 4 tests pass

## Checkpoint B — passed 2026-05-08
- rk_shared types/enums/events committed
- SQLAlchemy ORM models (10 tables) in rk_shared/models.py
- Alembic init + 0001_initial migration (manual, no Docker autogenerate)
- test_migrations.py written (testcontainers, requires Docker)
- app/db.py async engine + get_session + init_engine
- conftest.py updated with pg_url/db_engine/client session fixtures

---

## Self-review (run after Phase N is complete)

- [ ] Spec coverage: every section in the design spec maps to one or more tasks above (Part 1 + Part 2).
- [ ] Placeholder scan: no TBD/TODO outside the explicit "Phase G–N Summary" pointer.
- [ ] Type consistency: `RunKind`, `RunStatus`, `RunEvent`, `ClaimStatus`, `Site` defined once in `rk_shared/types.py` and `events.py`; no parallel definitions in routers.
- [ ] Each invariant from spec §4.2 has a numbered, named test in Phase H–J.
- [ ] Smoke gate (K) is a halt point.
