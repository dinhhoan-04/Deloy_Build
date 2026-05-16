# Inbox Hoàn Chỉnh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện luồng "verify → save → organize" bằng cách thêm archive/unarchive thật, Active/Archived toggle, filter/sort trong InboxTab, và project edit/delete UI.

**Architecture:** Backend thêm `archived_at` column vào `inbox_items` + PATCH endpoint. Frontend cập nhật store slices để gọi PATCH thay vì DELETE khi archive. InboxTab nhận prop `view` (active/archived) để split display. ProjectEditModal mới được trigger từ Footer hover.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), React/TypeScript/Zustand/Vitest (frontend), Alembic (migrations), testcontainers (backend tests), Vitest + Testing Library (frontend tests).

---

## File Map

### Backend
| File | Thay đổi |
|------|---------|
| `research-kit/shared/rk_shared/models.py` | Thêm `archived_at` vào `InboxItem` |
| `research-kit/backend/alembic/versions/0004_inbox_archived_at.py` | Migration mới |
| `research-kit/backend/app/repos/inbox.py` | Thêm `archive()`, `unarchive()` |
| `research-kit/backend/app/schemas/inbox.py` | Thêm `InboxPatch`, `archived_at` vào `InboxOut` |
| `research-kit/backend/app/routers/inbox.py` | Thêm `PATCH /{inbox_id}` |
| `research-kit/backend/tests/test_inbox.py` | Thêm tests archive/unarchive |

### Frontend
| File | Thay đổi |
|------|---------|
| `research-kit/extension/src/shared/types.ts` | Thêm `archived_at` vào `InboxItem` |
| `research-kit/extension/src/shared/api.ts` | Thêm `patchInboxItem`, `updateProject`, `deleteProject` |
| `research-kit/extension/src/sidebar/state/slices/inbox.ts` | Sửa `archiveMany` → PATCH, thêm `unarchiveMany` |
| `research-kit/extension/src/sidebar/state/slices/projects.ts` | Thêm `updateProject`, `deleteProject` |
| `research-kit/extension/src/sidebar/components/atoms/ProjectEditModal.tsx` | Component mới |
| `research-kit/extension/src/sidebar/components/shell/Footer.tsx` | Thêm edit icon + trigger modal |
| `research-kit/extension/src/sidebar/components/tabs/InboxTab.tsx` | Thêm Active/Archived toggle, filter pills, sort dropdown |
| `research-kit/extension/src/sidebar/App.tsx` | Wire `unarchiveMany`, `updateProject`, `deleteProject` |

---

## Task 1: Backend — Alembic migration + model column

**Files:**
- Modify: `research-kit/shared/rk_shared/models.py:76-89`
- Create: `research-kit/backend/alembic/versions/0004_inbox_archived_at.py`

- [ ] **Step 1: Thêm `archived_at` vào SQLAlchemy model**

Mở `research-kit/shared/rk_shared/models.py`, sửa class `InboxItem` (dòng 76–89):

```python
class InboxItem(Base):
    __tablename__ = "inbox_items"
    id:          Mapped[uuid.UUID] = _uuid_pk()
    user_id:     Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                   ForeignKey("users.id", ondelete="CASCADE"),
                                                   nullable=False)
    project_id:  Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                   ForeignKey("projects.id", ondelete="CASCADE"),
                                                   nullable=False)
    claim_id:    Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                   ForeignKey("claims.id", ondelete="CASCADE"),
                                                   nullable=False)
    saved_at:    Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(nullable=True)
    __table_args__ = (UniqueConstraint("project_id", "claim_id", name="uq_inbox_project_claim"),)
```

- [ ] **Step 2: Tạo migration file**

Tạo `research-kit/backend/alembic/versions/0004_inbox_archived_at.py`:

```python
"""add archived_at to inbox_items

Revision ID: 0004_inbox_archived_at
Revises: 0003_scope_cache
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa

revision = '0004_inbox_archived_at'
down_revision = '0003_scope_cache'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('inbox_items', sa.Column('archived_at', sa.TIMESTAMP(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('inbox_items', 'archived_at')
```

- [ ] **Step 3: Verify migration chạy được**

Từ `research-kit/backend/`:
```bash
alembic upgrade head
```
Expected: `Running upgrade 0003 -> 0004, add archived_at to inbox_items`

- [ ] **Step 4: Commit**

```bash
git add research-kit/shared/rk_shared/models.py research-kit/backend/alembic/versions/0004_inbox_archived_at.py
git commit -m "feat(backend): add archived_at column to inbox_items"
```

---

## Task 2: Backend — Schema + Repo + Router cho inbox archive

**Files:**
- Modify: `research-kit/backend/app/schemas/inbox.py`
- Modify: `research-kit/backend/app/repos/inbox.py`
- Modify: `research-kit/backend/app/routers/inbox.py`

- [ ] **Step 1: Cập nhật schemas**

Thay toàn bộ `research-kit/backend/app/schemas/inbox.py`:

```python
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class InboxAdd(BaseModel):
    project_id: UUID
    claim_id: UUID


class InboxPatch(BaseModel):
    archived_at: datetime | None


class InboxOut(BaseModel):
    id: UUID
    project_id: UUID
    claim_id: UUID
    saved_at: datetime
    archived_at: datetime | None = None
```

- [ ] **Step 2: Cập nhật InboxRepo**

Thay toàn bộ `research-kit/backend/app/repos/inbox.py`:

```python
from datetime import datetime
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

    async def _get_item(self, user_id: UUID, inbox_id: UUID) -> InboxItem:
        item = (await self.s.execute(
            select(InboxItem).where(InboxItem.id == inbox_id, InboxItem.user_id == user_id)
        )).scalar_one_or_none()
        if not item:
            raise NotFoundError("inbox item not found")
        return item

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

    async def patch(self, user_id: UUID, inbox_id: UUID, *, archived_at: datetime | None) -> InboxItem:
        item = await self._get_item(user_id, inbox_id)
        item.archived_at = archived_at
        await self.s.flush()
        return item

    async def remove(self, user_id: UUID, inbox_id: UUID) -> None:
        item = await self._get_item(user_id, inbox_id)
        await self.s.delete(item)
```

- [ ] **Step 3: Cập nhật router**

Thay toàn bộ `research-kit/backend/app/routers/inbox.py`:

```python
from uuid import UUID
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, db
from app.repos.inbox import InboxRepo
from app.schemas.inbox import InboxAdd, InboxOut, InboxPatch
from rk_shared.models import User

router = APIRouter(prefix="/v1/inbox", tags=["inbox"])


def _out(i) -> InboxOut:
    return InboxOut(
        id=i.id,
        project_id=i.project_id,
        claim_id=i.claim_id,
        saved_at=i.saved_at,
        archived_at=i.archived_at,
    )


@router.get("", response_model=list[InboxOut])
async def list_inbox(project_id: UUID = Query(...),
                     u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    return [_out(i) for i in await InboxRepo(s).list_for(u.id, project_id=project_id)]


@router.post("", response_model=InboxOut, status_code=201)
async def add_inbox(body: InboxAdd, u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    i = await InboxRepo(s).add(u.id, project_id=body.project_id, claim_id=body.claim_id)
    await s.commit()
    return _out(i)


@router.patch("/{inbox_id}", response_model=InboxOut)
async def patch_inbox(inbox_id: UUID, body: InboxPatch,
                      u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    i = await InboxRepo(s).patch(u.id, inbox_id, archived_at=body.archived_at)
    await s.commit()
    return _out(i)


@router.delete("/{inbox_id}", status_code=204)
async def delete_inbox(inbox_id: UUID, u: User = Depends(current_user),
                       s: AsyncSession = Depends(db)):
    await InboxRepo(s).remove(u.id, inbox_id)
    await s.commit()
    return Response(status_code=204)
```

- [ ] **Step 4: Commit**

```bash
git add research-kit/backend/app/schemas/inbox.py research-kit/backend/app/repos/inbox.py research-kit/backend/app/routers/inbox.py
git commit -m "feat(backend): add PATCH /inbox/:id for archive/unarchive"
```

---

## Task 3: Backend — Tests cho archive/unarchive

**Files:**
- Modify: `research-kit/backend/tests/test_inbox.py`

- [ ] **Step 1: Viết tests archive/unarchive**

Thêm vào cuối `research-kit/backend/tests/test_inbox.py`:

```python
@pytest.mark.asyncio
async def test_inbox_archive_unarchive(client_dev_alice):
    # Setup: project + claim + inbox item
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid, "claims": [{"text": "c", "site": "elicit"}]})
    cid = r.json()["created"][0]["id"]
    r = await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid})
    iid = r.json()["id"]

    # List: archived_at is null by default
    r = await client_dev_alice.get("/v1/inbox", params={"project_id": pid})
    item = r.json()[0]
    assert item["archived_at"] is None

    # Archive
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    r = await client_dev_alice.patch(f"/v1/inbox/{iid}", json={"archived_at": now})
    assert r.status_code == 200
    assert r.json()["archived_at"] is not None

    # List still returns item (frontend filters)
    r = await client_dev_alice.get("/v1/inbox", params={"project_id": pid})
    assert len(r.json()) == 1
    assert r.json()[0]["archived_at"] is not None

    # Unarchive
    r = await client_dev_alice.patch(f"/v1/inbox/{iid}", json={"archived_at": None})
    assert r.status_code == 200
    assert r.json()["archived_at"] is None


@pytest.mark.asyncio
async def test_inbox_patch_not_found(client_dev_alice):
    fake_id = str(uuid.uuid4())
    from datetime import datetime, timezone
    r = await client_dev_alice.patch(
        f"/v1/inbox/{fake_id}",
        json={"archived_at": datetime.now(timezone.utc).isoformat()}
    )
    assert r.status_code == 404
```

- [ ] **Step 2: Chạy test**

Từ `research-kit/backend/`:
```bash
pytest tests/test_inbox.py -v
```
Expected: tất cả tests PASS bao gồm 2 tests mới.

- [ ] **Step 3: Commit**

```bash
git add research-kit/backend/tests/test_inbox.py
git commit -m "test(backend): add archive/unarchive inbox tests"
```

---

## Task 4: Frontend — types.ts và api.ts

**Files:**
- Modify: `research-kit/extension/src/shared/types.ts:45-50`
- Modify: `research-kit/extension/src/shared/api.ts`

- [ ] **Step 1: Thêm `archived_at` vào InboxItem type**

Trong `research-kit/extension/src/shared/types.ts`, sửa interface `InboxItem`:

```typescript
export interface InboxItem {
  id: string
  project_id: string
  claim_id: string
  saved_at: string
  archived_at: string | null
}
```

- [ ] **Step 2: Thêm API functions mới vào api.ts**

Trong `research-kit/extension/src/shared/api.ts`, thêm vào cuối phần "Inbox" (sau dòng `removeFromInbox`):

```typescript
export async function patchInboxItem(
  inboxId: string,
  patch: { archived_at: string | null },
): Promise<InboxItem> {
  return (await apiFetch(`/inbox/${inboxId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })).json()
}
```

Thêm vào cuối phần "Projects" (sau `createProject`):

```typescript
export async function updateProject(id: string, name: string): Promise<Project> {
  return (await apiFetch(`/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })).json()
}
export async function deleteProject(id: string): Promise<void> {
  await apiFetch(`/projects/${id}`, { method: 'DELETE' })
}
```

- [ ] **Step 3: Kiểm tra TypeScript compile**

Từ `research-kit/extension/`:
```bash
npx tsc --noEmit
```
Expected: không có lỗi type error.

- [ ] **Step 4: Commit**

```bash
git add research-kit/extension/src/shared/types.ts research-kit/extension/src/shared/api.ts
git commit -m "feat(frontend): add patchInboxItem, updateProject, deleteProject to api"
```

---

## Task 5: Frontend — Store slices (inbox + projects)

**Files:**
- Modify: `research-kit/extension/src/sidebar/state/slices/inbox.ts`
- Modify: `research-kit/extension/src/sidebar/state/slices/projects.ts`

- [ ] **Step 1: Viết failing test cho archiveMany dùng PATCH**

Tạo/mở test file. Kiểm tra xem test pattern hiện tại trong `research-kit/extension/src/integration/store-storage.test.ts` để follow. Thêm vào `research-kit/extension/src/sidebar/state/slices/inbox.ts` một comment tạm thời để đánh dấu, sau đó viết test:

Mở `research-kit/extension/src/integration/store-storage.test.ts` và thêm:

```typescript
// Không có test cho archive hiện tại — tests sẽ được viết ở file mới
```

Tạo `research-kit/extension/src/sidebar/state/slices/__tests__/inbox-slice.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as api from '../../../../shared/api'

vi.mock('../../../../shared/api')

describe('InboxSlice archiveMany', () => {
  it('calls patchInboxItem with archived_at for each id', async () => {
    const mockPatch = vi.fn().mockResolvedValue({ id: '1', archived_at: '2026-05-15T00:00:00Z' })
    vi.mocked(api.patchInboxItem).mockImplementation(mockPatch)
    vi.mocked(api.listInbox).mockResolvedValue([])

    const { createInboxSlice } = await import('../inbox')
    const get = vi.fn().mockReturnValue({ currentProjectId: 'p1', loadInbox: vi.fn() })
    const set = vi.fn()
    const slice = createInboxSlice(set, get)

    await slice.archiveMany(['id-1', 'id-2'])

    expect(mockPatch).toHaveBeenCalledTimes(2)
    expect(mockPatch.mock.calls[0][1].archived_at).toBeTruthy()
    expect(mockPatch.mock.calls[1][1].archived_at).toBeTruthy()
  })

  it('calls patchInboxItem with null archived_at for unarchiveMany', async () => {
    const mockPatch = vi.fn().mockResolvedValue({ id: '1', archived_at: null })
    vi.mocked(api.patchInboxItem).mockImplementation(mockPatch)
    vi.mocked(api.listInbox).mockResolvedValue([])

    const { createInboxSlice } = await import('../inbox')
    const get = vi.fn().mockReturnValue({ currentProjectId: 'p1', loadInbox: vi.fn() })
    const set = vi.fn()
    const slice = createInboxSlice(set, get)

    await slice.unarchiveMany(['id-1'])

    expect(mockPatch).toHaveBeenCalledWith('id-1', { archived_at: null })
  })
})
```

- [ ] **Step 2: Chạy test để confirm fail**

Từ `research-kit/extension/`:
```bash
npx vitest run src/sidebar/state/slices/__tests__/inbox-slice.test.ts
```
Expected: FAIL — `slice.archiveMany` vẫn gọi `removeFromInbox`, `slice.unarchiveMany` is not a function.

- [ ] **Step 3: Sửa InboxSlice**

Thay toàn bộ `research-kit/extension/src/sidebar/state/slices/inbox.ts`:

```typescript
import * as api from '../../../shared/api'
import type { InboxItem } from '../../../shared/types'
import { idle } from './_slice'
import type { Slice } from './_slice'

export interface InboxSlice {
  inbox: Slice<InboxItem[]>
  loadInbox(projectId: string): Promise<void>
  addToInbox(projectId: string, claimId: string): Promise<void>
  removeFromInbox(inboxId: string): Promise<void>
  archiveMany(inboxIds: string[]): Promise<void>
  unarchiveMany(inboxIds: string[]): Promise<void>
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
      const now = new Date().toISOString()
      await Promise.allSettled(ids.map(id => api.patchInboxItem(id, { archived_at: now })))
      const pid = get().currentProjectId
      if (pid) await get().loadInbox(pid)
    },
    async unarchiveMany(ids) {
      await Promise.allSettled(ids.map(id => api.patchInboxItem(id, { archived_at: null })))
      const pid = get().currentProjectId
      if (pid) await get().loadInbox(pid)
    },
  }
}
```

- [ ] **Step 4: Chạy test inbox slice để confirm pass**

```bash
npx vitest run src/sidebar/state/slices/__tests__/inbox-slice.test.ts
```
Expected: PASS.

- [ ] **Step 5: Thêm updateProject và deleteProject vào ProjectsSlice**

Thay toàn bộ `research-kit/extension/src/sidebar/state/slices/projects.ts`:

```typescript
import * as api from '../../../shared/api'
import type { Project } from '../../../shared/types'
import { idle } from './_slice'
import type { Slice } from './_slice'

export interface ProjectsSlice {
  projects: Slice<Project[]>
  currentProjectId: string | null
  loadProjects(): Promise<void>
  createProject(name: string): Promise<Project>
  updateProject(id: string, name: string): Promise<void>
  deleteProject(id: string): Promise<void>
  switchProject(id: string): void
}

export function createProjectsSlice(set: any, get: any): ProjectsSlice {
  return {
    projects: idle<Project[]>([]),
    currentProjectId: null,
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
    async updateProject(id, name) {
      await api.updateProject(id, name)
      await get().loadProjects()
    },
    async deleteProject(id) {
      await api.deleteProject(id)
      set((s: any) => {
        const remaining = s.projects.data.filter((p: Project) => p.id !== id)
        const nextId = s.currentProjectId === id
          ? (remaining[0]?.id ?? null)
          : s.currentProjectId
        return {
          projects: { ...s.projects, data: remaining },
          currentProjectId: nextId,
        }
      })
    },
    switchProject(id) {
      set({ currentProjectId: id })
    },
  }
}
```

- [ ] **Step 6: Kiểm tra TypeScript compile**

```bash
npx tsc --noEmit
```
Expected: không có lỗi. Nếu có lỗi về `switchProject` hay `currentProjectId` đã được define ở store khác, điều chỉnh cho phù hợp với pattern hiện tại của `useStore.ts`.

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/sidebar/state/slices/inbox.ts \
        research-kit/extension/src/sidebar/state/slices/projects.ts \
        research-kit/extension/src/sidebar/state/slices/__tests__/inbox-slice.test.ts
git commit -m "feat(frontend): archive/unarchive inbox via PATCH, add updateProject/deleteProject to store"
```

---

## Task 6: Frontend — ProjectEditModal và Footer

**Files:**
- Create: `research-kit/extension/src/sidebar/components/atoms/ProjectEditModal.tsx`
- Modify: `research-kit/extension/src/sidebar/components/shell/Footer.tsx`
- Modify: `research-kit/extension/src/sidebar/App.tsx`

- [ ] **Step 1: Đọc Footer.tsx hiện tại để hiểu structure**

Đọc `research-kit/extension/src/sidebar/components/shell/Footer.tsx` để biết project selector hiện tại render như thế nào.

- [ ] **Step 2: Tạo ProjectEditModal**

Tạo `research-kit/extension/src/sidebar/components/atoms/ProjectEditModal.tsx`:

```typescript
import { useState } from 'react'

interface ProjectEditModalProps {
  project: { id: string; name: string }
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
  deleteDisabled?: boolean
}

export function ProjectEditModal({
  project, onRename, onDelete, onClose, deleteDisabled = false,
}: ProjectEditModalProps) {
  const [name, setName] = useState(project.name)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRename = async () => {
    if (!name.trim() || name === project.name) { onClose(); return }
    setSaving(true)
    try {
      await onRename(name.trim())
      onClose()
    } catch {
      setError('Rename failed. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setSaving(true)
    try {
      await onDelete()
      onClose()
    } catch (e: any) {
      setError(e?.message?.includes('in progress')
        ? 'Cannot delete — a run is in progress.'
        : 'Delete failed. Please retry.')
      setConfirmDelete(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--rk-bg)', boxShadow: '0 -4px 24px rgba(0,0,0,0.15)' }}
      >
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--rk-text-1)' }}>Edit Project</p>

        {error && (
          <p style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', borderRadius: 6, padding: '6px 10px' }}>
            {error}
          </p>
        )}

        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void handleRename() }}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
            border: '1px solid var(--rk-border-warm)', background: 'var(--rk-surface-warm)',
            color: 'var(--rk-text-1)', outline: 'none',
          }}
        />

        <div className="flex gap-2">
          <button
            onClick={() => void handleRename()}
            disabled={saving || !name.trim()}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'var(--rk-brand-gradient)', color: 'white', border: 'none',
              opacity: saving || !name.trim() ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13,
              border: '1px solid var(--rk-border-warm)', background: 'white',
              color: 'var(--rk-text-2)',
            }}
          >
            Cancel
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--rk-border-warm)', paddingTop: 12 }}>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleteDisabled || saving}
              title={deleteDisabled ? 'A run is in progress' : undefined}
              style={{
                width: '100%', padding: '8px 0', borderRadius: 8, fontSize: 13,
                border: '1px solid #fca5a5', background: 'white', color: '#dc2626',
                opacity: deleteDisabled ? 0.4 : 1,
              }}
            >
              Delete project…
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p style={{ fontSize: 12, color: 'var(--rk-text-2)', textAlign: 'center' }}>
                Delete "{project.name}"? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleDelete()}
                  disabled={saving}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    background: '#dc2626', color: 'white', border: 'none',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  style={{
                    padding: '7px 16px', borderRadius: 8, fontSize: 13,
                    border: '1px solid var(--rk-border-warm)', background: 'white',
                    color: 'var(--rk-text-2)',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Đọc Footer.tsx rồi thêm edit trigger**

Đọc `research-kit/extension/src/sidebar/components/shell/Footer.tsx`. Tìm nơi render tên project hiện tại (thường là một `<span>` hoặc `<button>`). Thêm edit icon bên cạnh:

Trong Footer, tìm đoạn render project name (ví dụ `currentProject?.name`). Wrap nó trong một `<div className="flex items-center gap-1 group">` và thêm icon button:

```typescript
// Thêm prop vào FooterProps interface:
onEditProject?: (project: { id: string; name: string }) => void

// Trong render, bên cạnh project name span, thêm:
{onEditProject && currentProject && (
  <button
    onClick={e => { e.stopPropagation(); onEditProject(currentProject) }}
    className="opacity-0 group-hover:opacity-100 transition-opacity"
    style={{ background: 'none', border: 'none', padding: '2px', color: 'var(--rk-text-3)', cursor: 'pointer' }}
    title="Edit project"
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  </button>
)}
```

- [ ] **Step 4: Wire trong App.tsx**

Trong `research-kit/extension/src/sidebar/App.tsx`:

Thêm state:
```typescript
const [editingProject, setEditingProject] = useState<{ id: string; name: string } | null>(null)
```

Thêm handlers:
```typescript
const handleEditProject = (project: { id: string; name: string }) => {
  setEditingProject(project)
}

const handleRenameProject = async (name: string) => {
  if (!editingProject) return
  await updateProject(editingProject.id, name)
}

const handleDeleteProject = async () => {
  if (!editingProject) return
  await deleteProject(editingProject.id)
}
```

Lấy `updateProject` và `deleteProject` từ `useStore()`.

Truyền vào Footer: `onEditProject={handleEditProject}`

Thêm modal sau các modal khác:
```typescript
{editingProject && (
  <ProjectEditModal
    project={editingProject}
    onRename={handleRenameProject}
    onDelete={handleDeleteProject}
    onClose={() => setEditingProject(null)}
    deleteDisabled={useStore.getState().runs.size > 0}
  />
)}
```

Import `ProjectEditModal` ở đầu file.

- [ ] **Step 5: TypeScript compile check**

```bash
npx tsc --noEmit
```
Expected: không có lỗi.

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/ProjectEditModal.tsx \
        research-kit/extension/src/sidebar/components/shell/Footer.tsx \
        research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(frontend): add ProjectEditModal with rename and delete"
```

---

## Task 7: Frontend — InboxTab Active/Archived/Filter/Sort

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/InboxTab.tsx`
- Modify: `research-kit/extension/src/sidebar/App.tsx`

- [ ] **Step 1: Viết failing test cho InboxTab Active/Archived view**

Mở `research-kit/extension/src/sidebar/components/tabs/InboxTab.test.tsx`. Thêm tests:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { InboxTab } from './InboxTab'

const makeItem = (overrides = {}) => ({
  id: '1', claimId: 'c1', text: 'Test claim', paperTitle: 'Paper',
  doi: null, paperUrl: null, page: '', site: 'elicit' as const,
  status: 'verified' as const, confidence: 0.9, quote: 'quote',
  reason: '', projectId: 'p1', savedAtMs: Date.now(), archived_at: null,
  ...overrides,
})

describe('InboxTab Active/Archived', () => {
  const baseProps = {
    items: [],
    selectedIds: new Set<string>(),
    onToggleSelect: vi.fn(),
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
    onAddToProject: vi.fn(),
    onClearSelection: vi.fn(),
  }

  it('shows Active/Archived toggle buttons', () => {
    render(<InboxTab {...baseProps} />)
    expect(screen.getByRole('button', { name: /active/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /archived/i })).toBeInTheDocument()
  })

  it('Active view shows only non-archived items', () => {
    const items = [
      makeItem({ id: '1', archived_at: null }),
      makeItem({ id: '2', archived_at: '2026-05-15T00:00:00Z' }),
    ]
    render(<InboxTab {...baseProps} items={items} />)
    // In active view, item 1 visible, item 2 not
    // PaperGroup groups by paper — just check count via group rendering
    expect(screen.getByRole('button', { name: /archived \(1\)/i })).toBeInTheDocument()
  })

  it('Archived view shows Unarchive button in bulk bar', () => {
    const items = [makeItem({ id: '1', archived_at: '2026-05-15T00:00:00Z' })]
    render(<InboxTab {...baseProps} items={items} selectedIds={new Set(['1'])} />)
    // Switch to archived view
    fireEvent.click(screen.getByRole('button', { name: /archived/i }))
    expect(screen.getByRole('button', { name: /unarchive/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Chạy test để confirm fail**

```bash
npx vitest run src/sidebar/components/tabs/InboxTab.test.tsx
```
Expected: FAIL — `onUnarchive` prop missing, no Active/Archived buttons.

- [ ] **Step 3: Cập nhật InboxTab**

Thay toàn bộ `research-kit/extension/src/sidebar/components/tabs/InboxTab.tsx`:

```typescript
import { useState } from 'react'
import type { InboxItem } from '../../../shared/verify-types'
import { groupInboxByPaper } from '../../selectors/inbox'
import { PaperGroup } from '../atoms/PaperGroup'

type InboxView = 'active' | 'archived'
type StatusFilter = 'all' | 'verified' | 'partial'
type SortOrder = 'newest' | 'oldest'

interface InboxTabProps {
  items: InboxItem[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onArchive: (ids: string[]) => void
  onUnarchive: (ids: string[]) => void
  onAddToProject: (ids: string[]) => void
  onClearSelection: () => void
  onRemove?: (id: string) => void
}

export function InboxTab({
  items, selectedIds, onToggleSelect, onArchive, onUnarchive,
  onAddToProject, onClearSelection, onRemove,
}: InboxTabProps) {
  const [view, setView] = useState<InboxView>('active')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortOrder>('newest')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const activeItems   = items.filter(i => !i.archived_at)
  const archivedItems = items.filter(i =>  i.archived_at)

  const baseItems = view === 'active' ? activeItems : archivedItems

  const filtered = baseItems
    .filter(i => statusFilter === 'all' || i.status === statusFilter)
    .sort((a, b) =>
      sort === 'newest'
        ? b.savedAtMs - a.savedAtMs
        : a.savedAtMs - b.savedAtMs
    )

  const groups = groupInboxByPaper(filtered)
  const selectedList = Array.from(selectedIds)

  const handleToggleExpand = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const pillStyle = (active: boolean): React.CSSProperties => active
    ? { background: 'var(--rk-brand-gradient)', border: '1px solid transparent', color: 'white', fontWeight: 600 }
    : { background: 'transparent', border: '1px solid var(--rk-border-warm)', color: 'var(--rk-text-3)' }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Active / Archived toggle + Sort */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--rk-border-warm)' }}
      >
        <div className="flex gap-1.5">
          {(['active', 'archived'] as InboxView[]).map(v => (
            <button
              key={v}
              onClick={() => { setView(v); onClearSelection() }}
              style={{ ...pillStyle(view === v), fontSize: 11, padding: '3px 10px', borderRadius: 99 }}
              className="capitalize transition-colors"
            >
              {v} ({v === 'active' ? activeItems.length : archivedItems.length})
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortOrder)}
          style={{
            fontSize: 11, color: 'var(--rk-text-3)', background: 'transparent',
            border: 'none', outline: 'none', cursor: 'pointer',
          }}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {/* Status filter pills (active view only) */}
      {view === 'active' && (
        <div
          className="flex gap-1.5 px-3 py-2 shrink-0"
          style={{ borderBottom: '1px solid var(--rk-border-warm)' }}
        >
          {(['all', 'verified', 'partial'] as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              style={{ ...pillStyle(statusFilter === f), fontSize: 11, padding: '2px 8px', borderRadius: 99 }}
              className="capitalize transition-colors hover:text-[var(--rk-brand)]"
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {/* List */}
      <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <p style={{ fontSize: 12, color: 'var(--rk-text-3)', lineHeight: 1.5 }}>
              {view === 'active' ? 'No active claims.' : 'No archived claims.'}
            </p>
          </div>
        ) : groups.map(group => (
          <PaperGroup
            key={group.groupKey}
            group={group}
            expanded={expandedKeys.has(group.groupKey)}
            onToggleExpand={handleToggleExpand}
            onRemoveItem={id => onRemove?.(id)}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>

      {/* Bulk action bar */}
      {selectedList.length > 0 && (
        <div
          className="flex items-center justify-between px-3 py-2 shrink-0"
          style={{ borderTop: '1px solid var(--rk-border-warm)', background: 'var(--rk-surface-warm)' }}
        >
          <span className="text-xs font-medium" style={{ color: 'var(--rk-brand)' }}>
            {selectedList.length} selected
          </span>
          <div className="flex gap-1.5">
            {view === 'active' ? (
              <>
                <button
                  onClick={() => onArchive(selectedList)}
                  style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 99,
                    border: '1px solid var(--rk-border-warm)',
                    background: 'white', color: 'var(--rk-text-2)',
                  }}
                >
                  Archive
                </button>
                <button
                  onClick={() => onAddToProject(selectedList)}
                  style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 99,
                    background: 'var(--rk-brand-gradient)',
                    border: 'none', color: 'white', fontWeight: 600,
                    boxShadow: '0 2px 6px rgba(124,58,237,0.25)',
                  }}
                >
                  Add to project
                </button>
              </>
            ) : (
              <button
                onClick={() => onUnarchive(selectedList)}
                style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 99,
                  background: 'var(--rk-brand-gradient)',
                  border: 'none', color: 'white', fontWeight: 600,
                  boxShadow: '0 2px 6px rgba(124,58,237,0.25)',
                }}
              >
                Unarchive
              </button>
            )}
            <button
              aria-label="clear"
              onClick={onClearSelection}
              style={{ fontSize: 11, color: 'var(--rk-text-3)', background: 'none', border: 'none' }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Cập nhật verify-types.ts nếu `InboxItem` ở đó cũng cần `archived_at`**

Mở `research-kit/extension/src/shared/verify-types.ts`. Tìm `InboxItem` type (đây là view model khác với `types.ts`). Thêm field:

```typescript
archived_at: string | null
```

- [ ] **Step 5: Cập nhật App.tsx — thêm onUnarchive + map archived_at**

Trong `research-kit/extension/src/sidebar/App.tsx`:

Lấy `unarchiveMany` từ `useStore()`.

Thêm handler:
```typescript
const handleUnarchive = async (ids: string[]) => {
  await unarchiveMany(ids)
}
```

Cập nhật `inboxViewItems` mapping để include `archived_at`:
```typescript
return {
  // ... các field hiện tại ...
  archived_at: i.archived_at ?? null,  // i là InboxItem từ backend
}
```

Truyền vào InboxTab:
```typescript
<InboxTab
  items={inboxViewItems}
  selectedIds={inboxSelectedIds}
  onToggleSelect={toggleInboxSelect}
  onArchive={handleArchive}
  onUnarchive={handleUnarchive}
  onAddToProject={handleAddToProject}
  onClearSelection={clearInboxSelection}
  onRemove={(id: string) => removeFromInbox(id)}
/>
```

- [ ] **Step 6: Chạy test InboxTab**

```bash
npx vitest run src/sidebar/components/tabs/InboxTab.test.tsx
```
Expected: PASS.

- [ ] **Step 7: Chạy toàn bộ test suite**

```bash
npx vitest run
```
Expected: tất cả PASS, không có regression.

- [ ] **Step 8: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/InboxTab.tsx \
        research-kit/extension/src/shared/verify-types.ts \
        research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(frontend): InboxTab Active/Archived toggle, filter by status, sort by date"
```

---

## Task 8: Frontend — Error banners trong tabs

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/InboxTab.tsx`
- Modify: `research-kit/extension/src/sidebar/App.tsx`

- [ ] **Step 1: Tạo ErrorBanner component inline**

Trong `InboxTab.tsx`, thêm trước return statement của component chính:

```typescript
// Lấy inbox status từ store — truyền qua prop
interface InboxTabProps {
  // ... existing props ...
  loadError?: string | null
  onRetry?: () => void
}
```

Thêm vào đầu phần List (trước `filtered.length === 0` check):

```typescript
{loadError && (
  <div
    className="flex items-center justify-between px-3 py-2 mx-3 mt-2 rounded-lg shrink-0"
    style={{ background: '#fffbeb', border: '1px solid #fbbf24' }}
  >
    <span style={{ fontSize: 12, color: '#92400e' }}>⚠ Could not load inbox.</span>
    {onRetry && (
      <button
        onClick={onRetry}
        style={{ fontSize: 11, color: '#b45309', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
      >
        Retry
      </button>
    )}
  </div>
)}
```

- [ ] **Step 2: Wire error state vào App.tsx**

Trong `App.tsx`, trong phần render InboxTab, thêm props:

```typescript
const inboxError = useStore(s => s.inbox.status === 'error' ? (s.inbox.error ?? 'Unknown error') : null)

// Trong JSX:
<InboxTab
  // ... existing props ...
  loadError={inboxError}
  onRetry={() => currentProjectId && loadInbox(currentProjectId)}
/>
```

- [ ] **Step 3: Cải thiện toast messages**

Trong `App.tsx`, tìm tất cả `showToast('Save failed. Please retry.', 'error')` và thay bằng:

```typescript
showToast(`Save failed — ${e instanceof Error ? e.message : 'network error'}. Please retry.`, 'error')
```

Trong `handleArchive`:
```typescript
const handleArchive = async (ids: string[]) => {
  try {
    await archiveMany(ids)
  } catch {
    showToast('Archive failed. Please retry.', 'error')
  }
}
```

Trong `handleUnarchive`:
```typescript
const handleUnarchive = async (ids: string[]) => {
  try {
    await unarchiveMany(ids)
  } catch {
    showToast('Unarchive failed. Please retry.', 'error')
  }
}
```

- [ ] **Step 4: Chạy full test suite**

```bash
npx vitest run
```
Expected: PASS.

- [ ] **Step 5: TypeScript compile check final**

```bash
npx tsc --noEmit
```
Expected: không có lỗi.

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/InboxTab.tsx \
        research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(frontend): add error banners with Retry in InboxTab, improve toast messages"
```

---

## Self-Review Checklist

### Spec coverage

| Requirement | Task |
|-------------|------|
| Backend `archived_at` column | Task 1 |
| `PATCH /inbox/:id` endpoint | Task 2 |
| Archive/unarchive tests backend | Task 3 |
| Frontend `patchInboxItem` API | Task 4 |
| `archiveMany` gọi PATCH thay DELETE | Task 5 |
| `unarchiveMany` mới | Task 5 |
| `updateProject`, `deleteProject` store | Task 5 |
| ProjectEditModal với rename + delete | Task 6 |
| Delete guard khi run đang chạy | Task 6 (frontend disable) |
| Footer edit icon trigger | Task 6 |
| InboxTab Active/Archived toggle | Task 7 |
| Filter Verified/Partial | Task 7 |
| Sort Newest/Oldest | Task 7 |
| Bulk Archive ở Active view | Task 7 |
| Bulk Unarchive ở Archived view | Task 7 |
| Error banner + Retry | Task 8 |
| Toast messages cụ thể hơn | Task 8 |

Tất cả requirements có task tương ứng. ✅

### Type consistency

- `patchInboxItem` được define Task 4, dùng Task 5 — nhất quán ✅
- `archived_at: string | null` thêm vào `types.ts` Task 4, `verify-types.ts` Task 7 — nhất quán ✅
- `unarchiveMany` define Task 5, wire Task 7 — nhất quán ✅
- `onUnarchive` prop define Task 7 InboxTab, pass Task 7 App.tsx — nhất quán ✅
- `updateProject`/`deleteProject` define Task 5, wire Task 6 — nhất quán ✅
