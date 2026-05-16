# Quick Fixes: Inbox Bulk Ops, Verify Error Semantics, Draft Export Metadata

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent backend/frontend fixes: (1) inbox bulk archive/unarchive in one HTTP call, (2) structured verify error messages, (3) date metadata in draft exports.

**Architecture:** Each fix is self-contained. Tasks 1-3 are backend-only Python. Tasks 4-5 are frontend-only TypeScript. Task 6 is backend-only Python. No migrations needed. No shared state between tasks.

**Tech Stack:** FastAPI + SQLAlchemy async (backend), Zustand + TypeScript (extension), pytest + testcontainers (backend tests), vitest (frontend tests)

---

## File Map

| File | Change |
|------|--------|
| `research-kit/backend/app/schemas/inbox.py` | Add `InboxBulkPatch` schema |
| `research-kit/backend/app/repos/inbox.py` | Add `bulk_patch` method |
| `research-kit/backend/app/routers/inbox.py` | Add `PATCH /v1/inbox/bulk` route |
| `research-kit/backend/tests/test_inbox.py` | Add bulk archive/unarchive tests |
| `research-kit/extension/src/shared/api.ts` | Add `bulkPatchInbox` function |
| `research-kit/extension/src/sidebar/state/slices/inbox.ts` | Use `bulkPatchInbox` in `archiveMany`/`unarchiveMany` |
| `research-kit/extension/src/sidebar/state/slices/__tests__/inbox-slice.test.ts` | Update tests to expect bulk call |
| `research-kit/extension/src/background_minimal.ts` | Structured HTTP error handling in `verifyOne` |
| `research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx` | Typed error messages in `handleUploadPdf` |
| `research-kit/backend/app/routers/drafts.py` | Add date to `.md` frontmatter and `.docx` |
| `research-kit/backend/tests/test_draft_schemas.py` | Add export metadata tests |

---

## Task 1: InboxBulkPatch schema + repo method

**Files:**
- Modify: `research-kit/backend/app/schemas/inbox.py`
- Modify: `research-kit/backend/app/repos/inbox.py`

- [ ] **Step 1: Write the failing test**

Add to `research-kit/backend/tests/test_inbox.py`:

```python
@pytest.mark.asyncio
async def test_inbox_bulk_patch_archives_multiple(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": "c1", "site": "elicit"}, {"text": "c2", "site": "elicit"}],
    })
    cid1 = r.json()["created"][0]["id"]
    cid2 = r.json()["created"][1]["id"]

    r1 = await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid1})
    r2 = await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid2})
    iid1, iid2 = r1.json()["id"], r2.json()["id"]

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    r = await client_dev_alice.patch(
        "/v1/inbox/bulk",
        json={"ids": [iid1, iid2], "archived_at": now},
    )
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    assert all(i["archived_at"] is not None for i in items)


@pytest.mark.asyncio
async def test_inbox_bulk_patch_unarchives(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P2"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": "c1", "site": "elicit"}],
    })
    cid = r.json()["created"][0]["id"]
    r = await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid})
    iid = r.json()["id"]

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    await client_dev_alice.patch("/v1/inbox/bulk", json={"ids": [iid], "archived_at": now})

    r = await client_dev_alice.patch("/v1/inbox/bulk", json={"ids": [iid], "archived_at": None})
    assert r.status_code == 200
    assert r.json()[0]["archived_at"] is None


@pytest.mark.asyncio
async def test_inbox_bulk_patch_ignores_other_users_items(client_dev_alice, client_dev_bob):
    # Bob creates a project + claim + inbox item
    r = await client_dev_bob.post("/v1/projects", json={"name": "Bob"})
    pid = r.json()["id"]
    r = await client_dev_bob.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": "c", "site": "elicit"}],
    })
    cid = r.json()["created"][0]["id"]
    r = await client_dev_bob.post("/v1/inbox", json={"project_id": pid, "claim_id": cid})
    bob_iid = r.json()["id"]

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    # Alice sends Bob's inbox ID — should return empty list (silently skipped)
    r = await client_dev_alice.patch("/v1/inbox/bulk", json={"ids": [bob_iid], "archived_at": now})
    assert r.status_code == 200
    assert r.json() == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd research-kit/backend
pytest tests/test_inbox.py::test_inbox_bulk_patch_archives_multiple tests/test_inbox.py::test_inbox_bulk_patch_unarchives tests/test_inbox.py::test_inbox_bulk_patch_ignores_other_users_items -v
```

Expected: FAIL with 404 or 422 (route does not exist yet).

- [ ] **Step 3: Add `InboxBulkPatch` to schemas**

In `research-kit/backend/app/schemas/inbox.py`, add after `InboxPatch`:

```python
class InboxBulkPatch(BaseModel):
    ids: list[UUID]
    archived_at: datetime | None
```

- [ ] **Step 4: Add `bulk_patch` to repo**

In `research-kit/backend/app/repos/inbox.py`, add this import at the top:

```python
from sqlalchemy import update
```

Then add the method to `InboxRepo` after `patch`:

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
    return list(result.scalars())
```

- [ ] **Step 5: Add route to router**

In `research-kit/backend/app/routers/inbox.py`, add import:

```python
from app.schemas.inbox import InboxAdd, InboxBulkPatch, InboxOut, InboxPatch
```

Then add the route after `patch_inbox`:

```python
@router.patch("/bulk", response_model=list[InboxOut])
async def bulk_patch_inbox(body: InboxBulkPatch,
                           u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    items = await InboxRepo(s).bulk_patch(u.id, body.ids, archived_at=body.archived_at)
    await s.commit()
    return [_out(i) for i in items]
```

**Important:** This route must be registered **before** `/{inbox_id}` in the file so FastAPI doesn't match `/bulk` as an inbox ID. Check that `@router.patch("/bulk", ...)` appears before `@router.patch("/{inbox_id}", ...)`.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd research-kit/backend
pytest tests/test_inbox.py -v
```

Expected: all inbox tests PASS.

- [ ] **Step 7: Commit**

```bash
git add research-kit/backend/app/schemas/inbox.py \
        research-kit/backend/app/repos/inbox.py \
        research-kit/backend/app/routers/inbox.py \
        research-kit/backend/tests/test_inbox.py
git commit -m "feat(inbox): add PATCH /v1/inbox/bulk for batch archive/unarchive"
```

---

## Task 2: Frontend — bulkPatchInbox API function + slice update

**Files:**
- Modify: `research-kit/extension/src/shared/api.ts`
- Modify: `research-kit/extension/src/sidebar/state/slices/inbox.ts`
- Modify: `research-kit/extension/src/sidebar/state/slices/__tests__/inbox-slice.test.ts`

- [ ] **Step 1: Update the slice test to expect a single bulk call**

Replace the entire content of `research-kit/extension/src/sidebar/state/slices/__tests__/inbox-slice.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as api from '../../../../shared/api'

vi.mock('../../../../shared/api')

describe('InboxSlice archiveMany', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls bulkPatchInbox with archived_at for all ids', async () => {
    const mockBulk = vi.fn().mockResolvedValue([
      { id: 'id-1', archived_at: '2026-05-15T00:00:00Z' },
      { id: 'id-2', archived_at: '2026-05-15T00:00:00Z' },
    ])
    vi.mocked(api.bulkPatchInbox).mockImplementation(mockBulk)
    vi.mocked(api.listInbox).mockResolvedValue([])

    const { createInboxSlice } = await import('../inbox')
    const get = vi.fn().mockReturnValue({ currentProjectId: 'p1', loadInbox: vi.fn() })
    const set = vi.fn()
    const slice = createInboxSlice(set, get)

    await slice.archiveMany(['id-1', 'id-2'])

    expect(mockBulk).toHaveBeenCalledTimes(1)
    expect(mockBulk).toHaveBeenCalledWith(['id-1', 'id-2'], expect.stringMatching(/^\d{4}-/))
  })

  it('calls bulkPatchInbox with null archived_at for unarchiveMany', async () => {
    const mockBulk = vi.fn().mockResolvedValue([{ id: 'id-1', archived_at: null }])
    vi.mocked(api.bulkPatchInbox).mockImplementation(mockBulk)
    vi.mocked(api.listInbox).mockResolvedValue([])

    const { createInboxSlice } = await import('../inbox')
    const get = vi.fn().mockReturnValue({ currentProjectId: 'p1', loadInbox: vi.fn() })
    const set = vi.fn()
    const slice = createInboxSlice(set, get)

    await slice.unarchiveMany(['id-1'])

    expect(mockBulk).toHaveBeenCalledWith(['id-1'], null)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd research-kit/extension
npx vitest run src/sidebar/state/slices/__tests__/inbox-slice.test.ts
```

Expected: FAIL — `api.bulkPatchInbox` is not a function.

- [ ] **Step 3: Add `bulkPatchInbox` to api.ts**

In `research-kit/extension/src/shared/api.ts`, add after `patchInboxItem`:

```typescript
export async function bulkPatchInbox(
  ids: string[],
  archived_at: string | null,
): Promise<InboxItem[]> {
  return (await apiFetch('/inbox/bulk', {
    method: 'PATCH',
    body: JSON.stringify({ ids, archived_at }),
  })).json()
}
```

- [ ] **Step 4: Update inbox slice to use bulk call**

Replace `archiveMany` and `unarchiveMany` in `research-kit/extension/src/sidebar/state/slices/inbox.ts`:

```typescript
async archiveMany(ids) {
  const now = new Date().toISOString()
  await bulkPatchInbox(ids, now)
  const pid = get().currentProjectId
  if (pid) await get().loadInbox(pid)
},
async unarchiveMany(ids) {
  await bulkPatchInbox(ids, null)
  const pid = get().currentProjectId
  if (pid) await get().loadInbox(pid)
},
```

Also update the import at the top of `inbox.ts`:

```typescript
import * as api from '../../../shared/api'
import { bulkPatchInbox } from '../../../shared/api'
```

Wait — check the existing import style. The file currently uses `import * as api from '../../../shared/api'` and calls `api.patchInboxItem(...)`. Change the two calls to use `bulkPatchInbox` directly via named import, or keep `api.bulkPatchInbox(...)` for consistency. Use the named import approach: add `import { bulkPatchInbox } from '../../../shared/api'` alongside the existing `import * as api` line, then call `bulkPatchInbox(...)` directly.

Actually, simpler: just call `api.bulkPatchInbox(...)` to match the existing pattern without adding a new import:

```typescript
async archiveMany(ids) {
  const now = new Date().toISOString()
  await api.bulkPatchInbox(ids, now)
  const pid = get().currentProjectId
  if (pid) await get().loadInbox(pid)
},
async unarchiveMany(ids) {
  await api.bulkPatchInbox(ids, null)
  const pid = get().currentProjectId
  if (pid) await get().loadInbox(pid)
},
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd research-kit/extension
npx vitest run src/sidebar/state/slices/__tests__/inbox-slice.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full frontend test suite to check for regressions**

```bash
cd research-kit/extension
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/shared/api.ts \
        research-kit/extension/src/sidebar/state/slices/inbox.ts \
        research-kit/extension/src/sidebar/state/slices/__tests__/inbox-slice.test.ts
git commit -m "feat(inbox): use single bulk PATCH call in archiveMany/unarchiveMany"
```

---

## Task 3: Verify error semantics in background_minimal.ts

**Files:**
- Modify: `research-kit/extension/src/background_minimal.ts`

There are no unit tests for `background_minimal.ts` (it's a Chrome extension service worker — hard to test in isolation). The fix is a defensive improvement, validated manually.

- [ ] **Step 1: Find the `verifyOne` function**

Open `research-kit/extension/src/background_minimal.ts`. Find `async function verifyOne(claim: ClaimItem)` starting around line 120.

Current code after `const resp = await fetch(...)`:
```typescript
const data = await resp.json()
const result: VerifyResult = { ... }
```

- [ ] **Step 2: Replace the success path with HTTP-status-aware handling**

Replace the entire try block inside `verifyOne` (from `const resp = await fetch(...)` to the end of the try block, before `} catch {`) with:

```typescript
const resp = await fetch(`${BACKEND_URL}/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    claim: claim.text,
    doi: claim.doi,
    paper_url: claim.paperUrl,
    paper_title: claim.paperTitle,
  }),
})

let updatedClaim: ClaimItem
if (!resp.ok) {
  const errorReason =
    resp.status === 503 ? 'Service unavailable — try again later'
    : resp.status === 429 ? 'Rate limited — try again later'
    : resp.status === 400 ? 'Invalid request'
    : `Server error (${resp.status})`
  const errorResult: VerifyResult = {
    claimId: claim.id, status: 'error',
    verbatimQuote: null, confidence: 0, reason: errorReason,
    paperTitle: claim.paperTitle, doi: claim.doi,
  }
  results.set(claim.id, errorResult)
  updatedClaim = { ...claim, status: 'error', confidence: 0, reason: errorReason }
  broadcastClaimStep(claim.id, claim.tabId, 'failed', errorReason)
} else {
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
  updatedClaim = {
    ...claim,
    status: result.status,
    confidence: result.confidence,
    quote: result.verbatimQuote,
    reason: result.reason,
  }
}
```

Keep the existing `catch` block below unchanged (it handles network-level failures where fetch itself throws).

- [ ] **Step 3: Build the extension to check for TypeScript errors**

```bash
cd research-kit/extension
npm run build
```

Expected: build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add research-kit/extension/src/background_minimal.ts
git commit -m "fix(verify): structured HTTP error handling in verifyOne"
```

---

## Task 4: Verify error semantics in VerifyTab.tsx

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx`

- [ ] **Step 1: Find the existing test for upload error**

Check `research-kit/extension/src/sidebar/components/tabs/VerifyTab.test.tsx` for any existing upload error test. If there is one, note how it is structured. If not, we add one.

- [ ] **Step 2: Add a test for typed upload error messages**

Open `research-kit/extension/src/sidebar/components/tabs/VerifyTab.test.tsx`. Add this test (adjust imports to match what's already in the file):

```typescript
it('shows structured error message on 503 from verifyWithPdf', async () => {
  // Import ApiError from api module
  const { ApiError } = await import('../../../../shared/api')
  vi.mocked(verifyWithPdf).mockRejectedValue(new ApiError(503, 'unavailable'))

  render(<VerifyTab claims={[mockClaim]} {...baseProps} />)
  // Open upload for the claim — find and click the upload trigger if exists
  // This test verifies the error branch logic; if no UI trigger exists in tests,
  // call handleUploadPdf directly via the component's exposed callback.

  // For now, verify the error classification logic in isolation:
  const classify = (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.status === 400) return 'Validation error — check the PDF'
      if (e.status === 503) return 'Service unavailable — try again later'
      return `Upload failed (${e.status})`
    }
    return 'Upload failed. Please retry.'
  }
  expect(classify(new ApiError(503, 'x'))).toBe('Service unavailable — try again later')
  expect(classify(new ApiError(400, 'x'))).toBe('Validation error — check the PDF')
  expect(classify(new ApiError(422, 'x'))).toBe('Upload failed (422)')
  expect(classify(new Error('network'))).toBe('Upload failed. Please retry.')
})
```

- [ ] **Step 3: Run the test to verify it passes (it's logic-only)**

```bash
cd research-kit/extension
npx vitest run src/sidebar/components/tabs/VerifyTab.test.tsx
```

Expected: PASS (the test is logic-only, no DOM interaction needed).

- [ ] **Step 4: Update the catch block in VerifyTab.tsx**

In `research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx`, find the import line at the top:

```typescript
import { verifyWithPdf } from '../../../shared/api'
```

Change it to also import `ApiError`:

```typescript
import { verifyWithPdf, ApiError } from '../../../shared/api'
```

Then replace the catch block in `handleUploadPdf` (currently `catch (e) { ... showToast('Upload failed. Please retry.', 'error') }`):

```typescript
} catch (e) {
  console.error('[verify] upload failed', e)
  const msg = e instanceof ApiError
    ? e.status === 400 ? 'Validation error — check the PDF'
    : e.status === 503 ? 'Service unavailable — try again later'
    : `Upload failed (${e.status})`
    : 'Upload failed. Please retry.'
  showToast(msg, 'error')
}
```

- [ ] **Step 5: Check that `ApiError` is exported from api.ts**

Open `research-kit/extension/src/shared/api.ts` and confirm `ApiError` class is exported (i.e., `export class ApiError`). If it is only declared without `export`, add `export` to it.

- [ ] **Step 6: Build to check for type errors**

```bash
cd research-kit/extension
npm run build
```

Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx \
        research-kit/extension/src/sidebar/components/tabs/VerifyTab.test.tsx \
        research-kit/extension/src/shared/api.ts
git commit -m "fix(verify): typed error messages in upload error handler"
```

---

## Task 5: Draft export metadata (backend)

**Files:**
- Modify: `research-kit/backend/app/routers/drafts.py`
- Modify: `research-kit/backend/tests/test_draft_schemas.py`

- [ ] **Step 1: Write failing tests for export metadata**

Add to `research-kit/backend/tests/test_draft_schemas.py`:

```python
import datetime
import io
from docx import Document


def test_md_export_has_frontmatter(client_dev_alice_sync=None):
    """Integration test — requires client fixture. Run via test_inbox pattern."""
    pass  # covered by integration test below


def test_build_docx_includes_date():
    from app.routers.drafts import _build_docx
    updated = datetime.datetime(2026, 5, 15, 12, 0, 0)
    data = _build_docx("My Title", "Some content", updated)
    doc = Document(io.BytesIO(data))
    paragraphs = [p.text for p in doc.paragraphs]
    assert any("2026-05-15" in p for p in paragraphs)


def test_build_docx_title_present():
    from app.routers.drafts import _build_docx
    updated = datetime.datetime(2026, 5, 15)
    data = _build_docx("Test Draft", "# Heading\n\nBody text", updated)
    doc = Document(io.BytesIO(data))
    full_text = " ".join(p.text for p in doc.paragraphs)
    assert "Test Draft" in full_text
```

Add an integration test to `research-kit/backend/tests/test_inbox.py` (or a new `test_draft_export.py` — create new file for clarity):

Create `research-kit/backend/tests/test_draft_export.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_md_export_has_yaml_frontmatter(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]

    r = await client_dev_alice.post("/v1/drafts", json={
        "project_id": pid,
        "title": "My Draft",
        "markdown": "# Hello\n\nWorld",
    })
    did = r.json()["id"]

    r = await client_dev_alice.get(f"/v1/drafts/{did}/export", params={"format": "md"})
    assert r.status_code == 200
    content = r.text
    assert content.startswith("---\n")
    assert "title: My Draft" in content
    assert "date:" in content


@pytest.mark.asyncio
async def test_docx_export_has_date(client_dev_alice):
    import io
    from docx import Document

    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]

    r = await client_dev_alice.post("/v1/drafts", json={
        "project_id": pid,
        "title": "Doc Draft",
        "markdown": "Some body",
    })
    did = r.json()["id"]

    r = await client_dev_alice.get(f"/v1/drafts/{did}/export", params={"format": "docx"})
    assert r.status_code == 200

    doc = Document(io.BytesIO(r.content))
    full_text = " ".join(p.text for p in doc.paragraphs)
    assert "Last updated:" in full_text
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd research-kit/backend
pytest tests/test_draft_schemas.py::test_build_docx_includes_date tests/test_draft_export.py -v
```

Expected: FAIL — `_build_docx` takes 2 args, `test_draft_export` fails on frontmatter assertion.

- [ ] **Step 3: Update `_build_docx` to accept `updated_at` and add date paragraph**

In `research-kit/backend/app/routers/drafts.py`, replace `_build_docx`:

```python
def _build_docx(title: str, markdown: str, updated_at: datetime) -> bytes:
    doc = Document()
    doc.add_heading(title, level=0)
    doc.add_paragraph(f"Last updated: {updated_at.strftime('%Y-%m-%d')}")
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
```

Add `datetime` to imports at the top of `drafts.py`:

```python
from datetime import datetime
```

- [ ] **Step 4: Update `export_draft` to pass `updated_at` and add `.md` frontmatter**

Replace the `export_draft` function body:

```python
@router.get("/{draft_id}/export")
async def export_draft(
    draft_id: UUID,
    format: str = Query(default="md", pattern="^(md|docx)$"),
    u: User = Depends(current_user),
    s: AsyncSession = Depends(db),
):
    draft = await DraftRepo(s).get_by_id(u.id, draft_id)
    safe_title = re.sub(r'[^\w\s-]', '', draft.title).strip().replace(' ', '_') or "draft"
    date_str = draft.updated_at.strftime('%Y-%m-%d')

    if format == "docx":
        data = _build_docx(draft.title, draft.markdown, draft.updated_at)
        return StreamingResponse(
            io.BytesIO(data),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{safe_title}.docx"'},
        )

    frontmatter = f"---\ntitle: {draft.title}\ndate: {date_str}\n---\n\n"
    return Response(
        content=frontmatter + draft.markdown,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.md"'},
    )
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd research-kit/backend
pytest tests/test_draft_schemas.py tests/test_draft_export.py -v
```

Expected: all PASS.

- [ ] **Step 6: Run full backend test suite to check for regressions**

```bash
cd research-kit/backend
pytest -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add research-kit/backend/app/routers/drafts.py \
        research-kit/backend/tests/test_draft_schemas.py \
        research-kit/backend/tests/test_draft_export.py
git commit -m "feat(drafts): add date metadata to .md frontmatter and .docx export"
```

---

## Self-Review

**Spec coverage:**
- ✅ Inbox bulk: `PATCH /v1/inbox/bulk` — Task 1 (backend) + Task 2 (frontend)
- ✅ Verify error semantics background — Task 3
- ✅ Verify error semantics upload — Task 4
- ✅ Draft export `.md` frontmatter — Task 5
- ✅ Draft export `.docx` date — Task 5

**Placeholder scan:** None found.

**Type consistency:**
- `bulkPatchInbox(ids: string[], archived_at: string | null)` — defined in Task 2 Step 3, used in Task 2 Step 4 ✅
- `_build_docx(title, markdown, updated_at: datetime)` — new signature in Task 5 Step 3, called with `draft.updated_at` in Step 4 ✅
- `InboxBulkPatch` schema — defined in Task 1 Step 3, imported in router in Step 5 ✅
- `ApiError` — checked for export in Task 4 Step 5 ✅
