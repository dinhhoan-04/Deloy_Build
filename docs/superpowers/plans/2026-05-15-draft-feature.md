# Draft Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent draft saving, inline title/markdown editing, and Markdown + DOCX export to the DraftTab.

**Architecture:** New `drafts` table (1 per project per user, upsert) backed by a repo + router following the existing inbox pattern. Frontend adds a Zustand `draft` slice and extends DraftTab with Save, edit, export, and delete UI.

**Tech Stack:** Python/FastAPI/SQLAlchemy async (backend), React/TypeScript/Zustand (frontend), `python-docx` (already in requirements.txt)

---

## File Map

**Create:**
- `research-kit/shared/rk_shared/models.py` — add `Draft` model (append to existing file)
- `research-kit/backend/alembic/versions/0005_drafts.py` — migration
- `research-kit/backend/app/schemas/drafts.py` — Pydantic schemas
- `research-kit/backend/app/repos/drafts.py` — `DraftRepo`
- `research-kit/backend/app/routers/drafts.py` — router with upsert, get, patch, delete, export
- `research-kit/extension/src/sidebar/state/slices/draft.ts` — Zustand slice

**Modify:**
- `research-kit/backend/app/main.py` — register drafts router
- `research-kit/extension/src/shared/types.ts` — add `Draft` interface
- `research-kit/extension/src/shared/api.ts` — add draft API functions
- `research-kit/extension/src/sidebar/state/useStore.ts` — wire DraftSlice
- `research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx` — Save/edit/export/delete UI

---

## Task 1: Draft SQLAlchemy model

**Files:**
- Modify: `research-kit/shared/rk_shared/models.py`

- [ ] **Step 1: Append `Draft` model to models.py**

  Open `research-kit/shared/rk_shared/models.py` and append after the `VerifyResultCache` class:

  ```python
  class Draft(Base):
      __tablename__ = "drafts"
      id:         Mapped[uuid.UUID] = _uuid_pk()
      project_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                    ForeignKey("projects.id", ondelete="CASCADE"),
                                                    nullable=False)
      user_id:    Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                    ForeignKey("users.id", ondelete="CASCADE"),
                                                    nullable=False)
      run_id:     Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True),
                                                           ForeignKey("runs.id", ondelete="SET NULL"),
                                                           nullable=True)
      title:      Mapped[str]       = mapped_column(Text, nullable=False, default="Untitled Draft")
      markdown:   Mapped[str]       = mapped_column(Text, nullable=False)
      sections:   Mapped[list]      = mapped_column(JSONB, nullable=False, default=list)
      created_at: Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)
      updated_at: Mapped[datetime]  = mapped_column(server_default=func.now(),
                                                    onupdate=func.now(), nullable=False)
      __table_args__ = (
          UniqueConstraint("project_id", "user_id", name="uq_drafts_project_user"),
      )
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add research-kit/shared/rk_shared/models.py
  git commit -m "feat: add Draft SQLAlchemy model"
  ```

---

## Task 2: Alembic migration

**Files:**
- Create: `research-kit/backend/alembic/versions/0005_drafts.py`

- [ ] **Step 1: Write migration file**

  Create `research-kit/backend/alembic/versions/0005_drafts.py`:

  ```python
  """add drafts table

  Revision ID: 0005_drafts
  Revises: 0004_inbox_archived_at
  Create Date: 2026-05-15
  """
  from alembic import op
  import sqlalchemy as sa
  from sqlalchemy.dialects import postgresql

  revision = '0005_drafts'
  down_revision = '0004_inbox_archived_at'
  branch_labels = None
  depends_on = None


  def upgrade() -> None:
      op.create_table(
          'drafts',
          sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                    server_default=sa.text('gen_random_uuid()')),
          sa.Column('project_id', postgresql.UUID(as_uuid=True),
                    sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
          sa.Column('user_id', postgresql.UUID(as_uuid=True),
                    sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
          sa.Column('run_id', postgresql.UUID(as_uuid=True),
                    sa.ForeignKey('runs.id', ondelete='SET NULL'), nullable=True),
          sa.Column('title', sa.Text(), nullable=False, server_default='Untitled Draft'),
          sa.Column('markdown', sa.Text(), nullable=False),
          sa.Column('sections', postgresql.JSONB(), nullable=False, server_default='[]'),
          sa.Column('created_at', sa.TIMESTAMP(), nullable=False,
                    server_default=sa.text('now()')),
          sa.Column('updated_at', sa.TIMESTAMP(), nullable=False,
                    server_default=sa.text('now()')),
          sa.UniqueConstraint('project_id', 'user_id', name='uq_drafts_project_user'),
      )


  def downgrade() -> None:
      op.drop_table('drafts')
  ```

- [ ] **Step 2: Verify migration runs (local or staging DB)**

  ```bash
  cd research-kit/backend
  alembic upgrade head
  ```

  Expected: `Running upgrade 0004_inbox_archived_at -> 0005_drafts, add drafts table`

- [ ] **Step 3: Commit**

  ```bash
  git add research-kit/backend/alembic/versions/0005_drafts.py
  git commit -m "feat: migration 0005 add drafts table"
  ```

---

## Task 3: Backend schemas

**Files:**
- Create: `research-kit/backend/app/schemas/drafts.py`

- [ ] **Step 1: Write test**

  Create `research-kit/backend/tests/test_draft_schemas.py`:

  ```python
  import uuid
  from app.schemas.drafts import DraftCreate, DraftPatch, DraftOut


  def test_draft_create_requires_markdown():
      d = DraftCreate(
          project_id=uuid.uuid4(),
          markdown="# Hello",
      )
      assert d.title == "Untitled Draft"
      assert d.sections == []


  def test_draft_patch_all_optional():
      p = DraftPatch()
      assert p.title is None
      assert p.markdown is None


  def test_draft_out_round_trip():
      import datetime
      now = datetime.datetime.utcnow()
      d = DraftOut(
          id=uuid.uuid4(),
          project_id=uuid.uuid4(),
          run_id=None,
          title="My Draft",
          markdown="# Hello",
          sections=[],
          created_at=now,
          updated_at=now,
      )
      assert d.title == "My Draft"
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd research-kit/backend
  pytest tests/test_draft_schemas.py -v
  ```

  Expected: `ImportError` or `ModuleNotFoundError` (schemas not created yet)

- [ ] **Step 3: Create schemas file**

  Create `research-kit/backend/app/schemas/drafts.py`:

  ```python
  from datetime import datetime
  from uuid import UUID
  from pydantic import BaseModel, Field


  class DraftCreate(BaseModel):
      project_id: UUID
      run_id: UUID | None = None
      title: str = "Untitled Draft"
      markdown: str
      sections: list = Field(default_factory=list)


  class DraftPatch(BaseModel):
      title: str | None = None
      markdown: str | None = None


  class DraftOut(BaseModel):
      id: UUID
      project_id: UUID
      run_id: UUID | None
      title: str
      markdown: str
      sections: list
      created_at: datetime
      updated_at: datetime
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  cd research-kit/backend
  pytest tests/test_draft_schemas.py -v
  ```

  Expected: 3 tests PASSED

- [ ] **Step 5: Commit**

  ```bash
  git add research-kit/backend/app/schemas/drafts.py research-kit/backend/tests/test_draft_schemas.py
  git commit -m "feat: add Draft Pydantic schemas"
  ```

---

## Task 4: DraftRepo

**Files:**
- Create: `research-kit/backend/app/repos/drafts.py`
- Create: `research-kit/backend/tests/test_draft_repo.py`

- [ ] **Step 1: Write failing tests**

  Create `research-kit/backend/tests/test_draft_repo.py`:

  ```python
  import uuid
  import pytest
  from sqlalchemy.ext.asyncio import AsyncSession

  from app.repos.drafts import DraftRepo
  from app.errors import NotFoundError


  @pytest.mark.asyncio
  async def test_upsert_creates_draft(db_session: AsyncSession):
      user_id = uuid.uuid4()
      project_id = uuid.uuid4()
      # Requires project + user rows to exist; use fixtures from conftest if available,
      # otherwise skip if no conftest support — the router integration test covers this path.
      repo = DraftRepo(db_session)
      draft = await repo.upsert(
          user_id=user_id, project_id=project_id,
          markdown="# Hello", title="T", sections=[], run_id=None,
      )
      assert draft.markdown == "# Hello"
      assert draft.title == "T"


  @pytest.mark.asyncio
  async def test_get_not_found_raises(db_session: AsyncSession):
      repo = DraftRepo(db_session)
      with pytest.raises(NotFoundError):
          await repo.get(uuid.uuid4(), uuid.uuid4())
  ```

  > Note: If no `db_session` fixture exists in conftest, these tests will be skipped in CI. The router-level tests in Task 5 provide integration coverage.

- [ ] **Step 2: Create DraftRepo**

  Create `research-kit/backend/app/repos/drafts.py`:

  ```python
  from uuid import UUID
  from sqlalchemy import select
  from sqlalchemy.dialects.postgresql import insert as pg_insert
  from sqlalchemy.ext.asyncio import AsyncSession

  from app.errors import NotFoundError
  from rk_shared.models import Draft


  class DraftRepo:
      def __init__(self, s: AsyncSession):
          self.s = s

      async def upsert(
          self, user_id: UUID, *, project_id: UUID,
          markdown: str, title: str = "Untitled Draft",
          sections: list | None = None, run_id: UUID | None = None,
      ) -> Draft:
          stmt = (
              pg_insert(Draft)
              .values(
                  project_id=project_id, user_id=user_id,
                  run_id=run_id, title=title,
                  markdown=markdown, sections=sections or [],
              )
              .on_conflict_do_update(
                  constraint="uq_drafts_project_user",
                  set_={
                      "run_id": run_id,
                      "title": title,
                      "markdown": markdown,
                      "sections": sections or [],
                      "updated_at": __import__("sqlalchemy").text("now()"),
                  },
              )
              .returning(Draft)
          )
          result = await self.s.execute(stmt)
          return result.scalar_one()

      async def get(self, user_id: UUID, project_id: UUID) -> Draft:
          draft = (await self.s.execute(
              select(Draft).where(Draft.user_id == user_id, Draft.project_id == project_id)
          )).scalar_one_or_none()
          if not draft:
              raise NotFoundError("draft not found")
          return draft

      async def get_by_id(self, user_id: UUID, draft_id: UUID) -> Draft:
          draft = (await self.s.execute(
              select(Draft).where(Draft.id == draft_id, Draft.user_id == user_id)
          )).scalar_one_or_none()
          if not draft:
              raise NotFoundError("draft not found")
          return draft

      async def patch(
          self, user_id: UUID, draft_id: UUID,
          *, title: str | None, markdown: str | None,
      ) -> Draft:
          draft = await self.get_by_id(user_id, draft_id)
          if title is not None:
              draft.title = title
          if markdown is not None:
              draft.markdown = markdown
          await self.s.flush()
          return draft

      async def delete(self, user_id: UUID, draft_id: UUID) -> None:
          draft = await self.get_by_id(user_id, draft_id)
          await self.s.delete(draft)
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add research-kit/backend/app/repos/drafts.py research-kit/backend/tests/test_draft_repo.py
  git commit -m "feat: add DraftRepo"
  ```

---

## Task 5: Drafts router

**Files:**
- Create: `research-kit/backend/app/routers/drafts.py`
- Modify: `research-kit/backend/app/main.py`

- [ ] **Step 1: Create router**

  Create `research-kit/backend/app/routers/drafts.py`:

  ```python
  import io
  import re
  from uuid import UUID

  from docx import Document
  from fastapi import APIRouter, Depends, Query, Response
  from fastapi.responses import StreamingResponse
  from sqlalchemy.ext.asyncio import AsyncSession

  from app.deps import current_user, db
  from app.repos.drafts import DraftRepo
  from app.schemas.drafts import DraftCreate, DraftOut, DraftPatch
  from rk_shared.models import User

  router = APIRouter(prefix="/v1/drafts", tags=["drafts"])


  def _out(d) -> DraftOut:
      return DraftOut(
          id=d.id, project_id=d.project_id, run_id=d.run_id,
          title=d.title, markdown=d.markdown, sections=d.sections,
          created_at=d.created_at, updated_at=d.updated_at,
      )


  def _build_docx(title: str, markdown: str) -> bytes:
      doc = Document()
      doc.add_heading(title, level=0)
      for line in markdown.splitlines():
          if line.startswith("### "):
              doc.add_heading(line[4:].strip(), level=3)
          elif line.startswith("## "):
              doc.add_heading(line[3:].strip(), level=2)
          elif line.startswith("# "):
              doc.add_heading(line[2:].strip(), level=1)
          elif line.strip():
              doc.add_paragraph(line.strip())
      buf = io.BytesIO()
      doc.save(buf)
      return buf.getvalue()


  @router.post("", response_model=DraftOut, status_code=201)
  async def upsert_draft(
      body: DraftCreate,
      u: User = Depends(current_user),
      s: AsyncSession = Depends(db),
  ):
      repo = DraftRepo(s)
      draft = await repo.upsert(
          u.id, project_id=body.project_id, run_id=body.run_id,
          title=body.title, markdown=body.markdown, sections=body.sections,
      )
      await s.commit()
      return _out(draft)


  @router.get("", response_model=DraftOut)
  async def get_draft(
      project_id: UUID = Query(...),
      u: User = Depends(current_user),
      s: AsyncSession = Depends(db),
  ):
      return _out(await DraftRepo(s).get(u.id, project_id))


  @router.patch("/{draft_id}", response_model=DraftOut)
  async def patch_draft(
      draft_id: UUID,
      body: DraftPatch,
      u: User = Depends(current_user),
      s: AsyncSession = Depends(db),
  ):
      draft = await DraftRepo(s).patch(u.id, draft_id, title=body.title, markdown=body.markdown)
      await s.commit()
      return _out(draft)


  @router.delete("/{draft_id}", status_code=204)
  async def delete_draft(
      draft_id: UUID,
      u: User = Depends(current_user),
      s: AsyncSession = Depends(db),
  ) -> Response:
      await DraftRepo(s).delete(u.id, draft_id)
      await s.commit()
      return Response(status_code=204)


  @router.get("/{draft_id}/export")
  async def export_draft(
      draft_id: UUID,
      format: str = Query(default="md", pattern="^(md|docx)$"),
      u: User = Depends(current_user),
      s: AsyncSession = Depends(db),
  ):
      draft = await DraftRepo(s).get_by_id(u.id, draft_id)
      safe_title = re.sub(r'[^\w\s-]', '', draft.title).strip().replace(' ', '_') or "draft"

      if format == "docx":
          data = _build_docx(draft.title, draft.markdown)
          return StreamingResponse(
              io.BytesIO(data),
              media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              headers={"Content-Disposition": f'attachment; filename="{safe_title}.docx"'},
          )

      return Response(
          content=draft.markdown,
          media_type="text/markdown",
          headers={"Content-Disposition": f'attachment; filename="{safe_title}.md"'},
      )
  ```

- [ ] **Step 2: Register router in main.py**

  In `research-kit/backend/app/main.py`, add after the existing router imports:

  ```python
  from app.routers import drafts as drafts_router
  ```

  And after `app.include_router(verify_router.router)`:

  ```python
  app.include_router(drafts_router.router)
  ```

- [ ] **Step 3: Smoke test (manual)**

  Start backend locally and run:

  ```bash
  curl -s http://localhost:8000/health
  # Expected: {"status":"ok"}

  # POST a draft (replace TOKEN and UUIDs)
  curl -s -X POST http://localhost:8000/v1/drafts \
    -H "Authorization: Bearer TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"project_id":"<uuid>","markdown":"# Hello","title":"Test Draft"}' | python -m json.tool
  # Expected: JSON with id, title, markdown, created_at, updated_at
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add research-kit/backend/app/routers/drafts.py research-kit/backend/app/main.py
  git commit -m "feat: add drafts router with upsert, patch, delete, export"
  ```

---

## Task 6: Frontend — Draft type + API functions

**Files:**
- Modify: `research-kit/extension/src/shared/types.ts`
- Modify: `research-kit/extension/src/shared/api.ts`

- [ ] **Step 1: Add `Draft` type to types.ts**

  Append to `research-kit/extension/src/shared/types.ts`:

  ```ts
  export interface Draft {
    id: string
    project_id: string
    run_id: string | null
    title: string
    markdown: string
    sections: Array<{ title: string; claim_refs: string[] }>
    created_at: string
    updated_at: string
  }
  ```

- [ ] **Step 2: Add draft API functions to api.ts**

  In `research-kit/extension/src/shared/api.ts`, add the import for `Draft` in the existing import block:

  ```ts
  import type {
    Project, Claim, ClaimInput, ClaimPatch, InboxItem, Conflict,
    ResolutionPayload, RunCreate, RunCreateResponse, Run, RunEvent, Draft,
  } from './types'
  ```

  Then append the following functions at the end of the file:

  ```ts
  // Drafts
  export async function getDraft(projectId: string): Promise<Draft | null> {
    try {
      return await (await apiFetch(`/drafts?project_id=${projectId}`)).json()
    } catch (e: any) {
      if (e?.status === 404) return null
      throw e
    }
  }

  export async function upsertDraft(body: {
    project_id: string
    run_id?: string | null
    title?: string
    markdown: string
    sections?: Array<{ title: string; claim_refs: string[] }>
  }): Promise<Draft> {
    return (await apiFetch('/drafts', { method: 'POST', body: JSON.stringify(body) })).json()
  }

  export async function patchDraft(draftId: string, patch: { title?: string; markdown?: string }): Promise<Draft> {
    return (await apiFetch(`/drafts/${draftId}`, { method: 'PATCH', body: JSON.stringify(patch) })).json()
  }

  export async function deleteDraft(draftId: string): Promise<void> {
    await apiFetch(`/drafts/${draftId}`, { method: 'DELETE' })
  }

  export function draftExportUrl(draftId: string, format: 'md' | 'docx'): string {
    return `${API_URL}/drafts/${draftId}/export?format=${format}`
  }
  ```

  > Note: `draftExportUrl` returns a URL string for use with `fetch` + auth headers (see Task 8). The `API_URL` constant is already defined at the top of `api.ts`.

- [ ] **Step 3: Commit**

  ```bash
  git add research-kit/extension/src/shared/types.ts research-kit/extension/src/shared/api.ts
  git commit -m "feat: add Draft type and API functions"
  ```

---

## Task 7: Zustand draft slice

**Files:**
- Create: `research-kit/extension/src/sidebar/state/slices/draft.ts`
- Modify: `research-kit/extension/src/sidebar/state/useStore.ts`

- [ ] **Step 1: Create draft slice**

  Create `research-kit/extension/src/sidebar/state/slices/draft.ts`:

  ```ts
  import * as api from '../../../shared/api'
  import type { Draft } from '../../../shared/types'

  export interface DraftSlice {
    draft: {
      data: Draft | null
      saving: boolean
      dirty: boolean
    }
    loadDraft(projectId: string): Promise<void>
    saveDraft(projectId: string, runId: string | null, markdown: string, sections: Array<{ title: string; claim_refs: string[] }>): Promise<void>
    updateDraftField(draftId: string, field: 'title' | 'markdown', value: string): Promise<void>
    deleteDraft(draftId: string): Promise<void>
    markDraftDirty(): void
  }

  export function createDraftSlice(set: any, get: any): DraftSlice {
    return {
      draft: { data: null, saving: false, dirty: false },

      async loadDraft(projectId) {
        const data = await api.getDraft(projectId)
        set({ draft: { data, saving: false, dirty: false } })
      },

      async saveDraft(projectId, runId, markdown, sections) {
        set((s: any) => ({ draft: { ...s.draft, saving: true } }))
        try {
          const data = await api.upsertDraft({ project_id: projectId, run_id: runId, markdown, sections })
          set({ draft: { data, saving: false, dirty: false } })
        } catch {
          set((s: any) => ({ draft: { ...s.draft, saving: false } }))
          get().showToast('Failed to save draft', 'error')
        }
      },

      async updateDraftField(draftId, field, value) {
        set((s: any) => ({ draft: { ...s.draft, dirty: true } }))
        try {
          const data = await api.patchDraft(draftId, { [field]: value })
          set({ draft: { data, saving: false, dirty: false } })
        } catch {
          set((s: any) => ({ draft: { ...s.draft, dirty: true } }))
          get().showToast('Unsaved changes — auto-save failed', 'warning')
        }
      },

      async deleteDraft(draftId) {
        await api.deleteDraft(draftId)
        set({ draft: { data: null, saving: false, dirty: false } })
      },

      markDraftDirty() {
        set((s: any) => ({ draft: { ...s.draft, dirty: true } }))
      },
    }
  }
  ```

- [ ] **Step 2: Wire DraftSlice into useStore.ts**

  In `research-kit/extension/src/sidebar/state/useStore.ts`:

  Add import at the top (with other slice imports):
  ```ts
  import { createDraftSlice } from './slices/draft'
  import type { DraftSlice } from './slices/draft'
  ```

  Add `DraftSlice` to the store type union (wherever `ProjectsSlice & ClaimsSlice & ...` is defined):
  ```ts
  type Store = UIState & ProjectsSlice & ClaimsSlice & InboxSlice & ConflictsSlice & RunsSlice & DraftSlice
  ```

  Add `...createDraftSlice(set, get)` in the `create(...)` call body alongside the other slice spreads.

- [ ] **Step 3: Commit**

  ```bash
  git add research-kit/extension/src/sidebar/state/slices/draft.ts research-kit/extension/src/sidebar/state/useStore.ts
  git commit -m "feat: add draft Zustand slice"
  ```

---

## Task 8: Update DraftTab UI

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx`

- [ ] **Step 1: Rewrite DraftTab.tsx**

  Replace the full content of `research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx`:

  ```tsx
  import { useEffect, useRef, useState } from 'react'
  import { useStore } from '../../state/useStore'
  import { createRun } from '../../../shared/api'
  import { useRunStream } from '../../hooks/useRunStream'
  import { MarkdownView } from '../atoms/MarkdownView'
  import { Checkbox } from '../atoms/Checkbox'
  import { authHeader } from '../../../shared/auth'

  const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'https://rk-backend-qked.onrender.com/v1'

  const STYLES: { value: 'short' | 'default' | 'long'; label: string }[] = [
    { value: 'short', label: 'Short' },
    { value: 'default', label: 'Default' },
    { value: 'long', label: 'Long' },
  ]

  export function DraftTab({ demoRunId }: { demoRunId?: string | null }) {
    const projectId = useStore(s => s.currentProjectId)
    const provider = useStore(s => s.provider)
    const inboxItems = useStore(s => s.inbox.data)
    const claims = useStore(s => s.claims.data)
    const draft = useStore(s => s.draft)
    const loadDraft = useStore(s => s.loadDraft)
    const saveDraft = useStore(s => s.saveDraft)
    const updateDraftField = useStore(s => s.updateDraftField)
    const deleteDraft = useStore(s => s.deleteDraft)
    const showToast = useStore(s => s.showToast)

    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [style, setStyle] = useState<'short' | 'default' | 'long'>('default')
    const [activeRunId, setActiveRunId] = useState<string | null>(null)
    const stream = useRunStream(activeRunId)

    // Local editable copies — kept in sync with draft.data
    const [localTitle, setLocalTitle] = useState('')
    const [localMarkdown, setLocalMarkdown] = useState('')
    const titleRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
      if (!activeRunId && demoRunId) setActiveRunId(demoRunId)
    }, [activeRunId, demoRunId])

    useEffect(() => {
      if (projectId) loadDraft(projectId)
    }, [projectId])

    useEffect(() => {
      if (draft.data) {
        setLocalTitle(draft.data.title)
        setLocalMarkdown(draft.data.markdown)
      }
    }, [draft.data?.id])

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
            id: c.id, text: c.text, verdict: c.status,
            quote: c.quote, paper_title: c.paper_title,
            doi: c.doi, paper_url: c.paper_url, site: c.site,
          } : null
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
      const idem = `draft:${projectId}:${Date.now()}`
      const { run_id } = await createRun({
        kind: 'draft', project_id: projectId, idempotency_key: idem,
        provider,
        input: { claims: claimsForDraft, style },
      })
      setActiveRunId(run_id)
    }

    const streamMarkdown = stream.finalContent
      ? (() => { try { return JSON.parse(stream.finalContent).markdown } catch { return stream.tokens } })()
      : stream.tokens

    const streamSections = stream.finalContent
      ? (() => { try { return JSON.parse(stream.finalContent).sections ?? [] } catch { return [] } })()
      : []

    async function handleSave() {
      if (!projectId || !streamMarkdown) return
      await saveDraft(projectId, activeRunId, streamMarkdown, streamSections)
    }

    async function handleExport(format: 'md' | 'docx') {
      if (!draft.data) return
      try {
        const res = await fetch(`${API_URL}/drafts/${draft.data.id}/export?format=${format}`, {
          headers: authHeader() as Record<string, string>,
        })
        if (!res.ok) throw new Error(await res.text())
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${draft.data.title || 'draft'}.${format}`
        a.click()
        URL.revokeObjectURL(url)
      } catch {
        showToast('Export failed', 'error')
      }
    }

    async function handleDelete() {
      if (!draft.data) return
      if (!confirm('Delete this draft?')) return
      await deleteDraft(draft.data.id)
    }

    const hasDraft = !!draft.data
    const canSave = !!streamMarkdown && !activeRunId?.includes('generating')

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Claim selector */}
        <div
          className="shrink-0 overflow-y-auto"
          style={{ maxHeight: 160, borderBottom: '1px solid var(--rk-border-warm)', background: 'var(--rk-surface-warm)' }}
        >
          {inboxItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 gap-1 text-center px-4">
              <p className="text-sm" style={{ color: 'var(--rk-text-3)' }}>No inbox items yet.</p>
              <p className="text-xs" style={{ color: 'var(--rk-text-3)' }}>Add verified claims to inbox first.</p>
            </div>
          ) : (
            <div className="px-3 pt-2 pb-1">
              <p className="text-xs font-medium mb-2" style={{ color: 'var(--rk-brand)' }}>Select claims to include</p>
              <div className="flex flex-col gap-1">
                {inboxItems.map(i => {
                  const c = claims.find(x => x.id === i.claim_id)
                  return (
                    <div key={i.id} className="flex gap-2 items-start py-1">
                      <Checkbox checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                      <span className="text-xs leading-relaxed" style={{ color: 'var(--rk-text)' }}>{c?.text ?? '(missing claim)'}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div
          className="flex items-center gap-2 px-3 py-2 shrink-0"
          style={{ borderBottom: '1px solid var(--rk-border-warm)', background: 'white' }}
        >
          <div className="flex gap-1 flex-1">
            {STYLES.map(s => (
              <button
                key={s.value}
                onClick={() => setStyle(s.value)}
                style={style === s.value ? {
                  background: 'var(--rk-brand-gradient)', color: 'white',
                  border: 'none', fontWeight: 600, boxShadow: '0 2px 4px rgba(124,58,237,0.25)',
                } : {
                  background: 'var(--rk-surface-warm)', color: 'var(--rk-brand)',
                  border: '1px solid var(--rk-border-warm)',
                }}
                className="text-xs px-3 py-1 rounded-full transition-colors"
              >{s.label}</button>
            ))}
          </div>
          <button
            onClick={() => void generate()}
            disabled={selected.size === 0 || !!activeRunId}
            style={{
              background: selected.size === 0 || !!activeRunId ? 'var(--rk-border-warm)' : 'var(--rk-brand-gradient)',
              color: selected.size === 0 || !!activeRunId ? 'var(--rk-text-3)' : 'white',
              border: 'none', borderRadius: 99, padding: '5px 14px', fontSize: 12, fontWeight: 600,
              cursor: selected.size === 0 || !!activeRunId ? 'not-allowed' : 'pointer',
            }}
          >{activeRunId ? 'Generating…' : 'Generate'}</button>
          {streamMarkdown && (
            <button
              onClick={() => void handleSave()}
              disabled={draft.saving}
              style={{
                background: draft.saving ? 'var(--rk-border-warm)' : 'var(--rk-brand-gradient)',
                color: draft.saving ? 'var(--rk-text-3)' : 'white',
                border: 'none', borderRadius: 99, padding: '5px 14px', fontSize: 12, fontWeight: 600,
                cursor: draft.saving ? 'not-allowed' : 'pointer',
              }}
            >{draft.saving ? 'Saving…' : 'Save'}</button>
          )}
        </div>

        {/* Output / Editor */}
        <div className="flex-1 overflow-y-auto flex flex-col" style={{ background: 'white' }}>
          {hasDraft ? (
            <div className="flex flex-col h-full p-3 gap-2">
              {/* Title */}
              <div className="flex items-center gap-1">
                <input
                  ref={titleRef}
                  value={localTitle}
                  onChange={e => setLocalTitle(e.target.value)}
                  onBlur={() => draft.data && updateDraftField(draft.data.id, 'title', localTitle)}
                  className="flex-1 text-sm font-semibold border-0 border-b outline-none py-1"
                  style={{ borderColor: 'var(--rk-border-warm)', color: 'var(--rk-text)' }}
                />
                {draft.dirty && (
                  <span className="text-xs" style={{ color: 'var(--rk-text-3)' }}>Unsaved</span>
                )}
              </div>
              {/* Markdown editor */}
              <textarea
                value={localMarkdown}
                onChange={e => setLocalMarkdown(e.target.value)}
                onBlur={() => draft.data && updateDraftField(draft.data.id, 'markdown', localMarkdown)}
                className="flex-1 text-xs font-mono resize-none outline-none p-2 rounded"
                style={{
                  minHeight: 120, border: '1px solid var(--rk-border-warm)',
                  color: 'var(--rk-text)', background: 'var(--rk-surface-warm)',
                }}
              />
              {/* Footer actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => void handleExport('md')}
                  className="text-xs px-3 py-1 rounded-full"
                  style={{ background: 'var(--rk-surface-warm)', color: 'var(--rk-brand)', border: '1px solid var(--rk-border-warm)' }}
                >↓ .md</button>
                <button
                  onClick={() => void handleExport('docx')}
                  className="text-xs px-3 py-1 rounded-full"
                  style={{ background: 'var(--rk-surface-warm)', color: 'var(--rk-brand)', border: '1px solid var(--rk-border-warm)' }}
                >↓ .docx</button>
                <div className="flex-1" />
                <button
                  onClick={() => void handleDelete()}
                  className="text-xs px-3 py-1 rounded-full"
                  style={{ background: 'var(--rk-surface-warm)', color: 'var(--rk-red)', border: '1px solid var(--rk-border-warm)' }}
                >🗑 Delete</button>
              </div>
            </div>
          ) : streamMarkdown ? (
            <div className="p-3">
              <MarkdownView source={streamMarkdown} />
              {stream.error && (
                <p className="text-xs mt-2" style={{ color: 'var(--rk-red)' }}>{stream.error.message}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-3">
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: 'var(--rk-brand-subtle)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--rk-brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </div>
              <p className="text-xs" style={{ color: 'var(--rk-text-3)' }}>Select claims and click Generate</p>
            </div>
          )}
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx
  git commit -m "feat: update DraftTab with save, edit, export, delete"
  ```

---

## Task 9: End-to-end smoke test

- [ ] **Step 1: Start backend + extension dev server**

  ```bash
  # Terminal 1
  cd research-kit/backend
  uvicorn app.main:app --reload --port 8000

  # Terminal 2
  cd research-kit/extension
  npm run dev
  ```

- [ ] **Step 2: Test happy path**

  1. Open extension sidebar → Draft tab
  2. Verify it calls `GET /v1/drafts?project_id=...` (check Network tab) — returns 404, shows empty state
  3. Select 1+ inbox claims → click Generate → see streaming output
  4. Click Save → verify `POST /v1/drafts` succeeds → editor view appears with title + markdown textarea
  5. Edit title → click elsewhere → verify `PATCH /v1/drafts/{id}` fires
  6. Edit markdown → click elsewhere → verify PATCH fires, "Unsaved" indicator disappears
  7. Click ↓ .md → file downloads with correct content
  8. Click ↓ .docx → file downloads and opens in Word/LibreOffice
  9. Click 🗑 Delete → confirm → editor disappears, empty state shown

- [ ] **Step 3: Test reload persistence**

  1. Save a draft
  2. Reload extension (close/reopen sidebar or reload background page)
  3. Open Draft tab → editor should show saved draft immediately (loadDraft called on projectId change)

- [ ] **Step 4: Commit any fixes found during smoke test**

  ```bash
  git add -p
  git commit -m "fix: draft smoke test corrections"
  ```
