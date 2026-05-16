# Quick Fixes: Inbox Bulk Ops, Verify Error Semantics, Draft Export Metadata

**Date:** 2026-05-15  
**Scope:** 3 independent backend/frontend fixes in one session  
**Branch:** new-idea-agent

---

## 1. Inbox Bulk Archive / Unarchive

### Problem

`archiveMany` and `unarchiveMany` in `inbox.ts` fire `Promise.allSettled(ids.map(id => api.patchInboxItem(...)))` — N parallel HTTP requests for N selected items. Backend only has `PATCH /v1/inbox/{id}`.

### Design

**Backend — new endpoint:**

```
PATCH /v1/inbox/bulk
Body: { ids: list[UUID], archived_at: datetime | null }
Response: list[InboxOut]
```

Implementation in `inbox.py` router:
- Add `InboxBulkPatch` schema: `ids: list[UUID]`, `archived_at: datetime | None`
- Add `bulk_patch_inbox` route at `PATCH /v1/inbox/bulk`
- Add `InboxRepo.bulk_patch(user_id, ids, archived_at)` method using `UPDATE ... WHERE id IN (...) AND user_id = ?`, returning updated rows

Ownership: filter by `user_id` in the WHERE clause — items belonging to other users are silently skipped (not an error, same as PATCH single).

**Frontend — api.ts:**

Add:
```ts
export async function bulkPatchInbox(
  ids: string[],
  archived_at: string | null,
): Promise<InboxItem[]>
```

**Frontend — inbox.ts slice:**

Replace `Promise.allSettled(ids.map(...))` with single `bulkPatchInbox` call in both `archiveMany` and `unarchiveMany`.

### Files changed

- `research-kit/backend/app/schemas/inbox.py` — add `InboxBulkPatch`
- `research-kit/backend/app/repos/inbox.py` — add `bulk_patch`
- `research-kit/backend/app/routers/inbox.py` — add route
- `research-kit/extension/src/shared/api.ts` — add `bulkPatchInbox`
- `research-kit/extension/src/sidebar/state/slices/inbox.ts` — use bulk call

---

## 2. Verify Error Semantics

### Problem

**background_minimal.ts** catches all exceptions as `'Network error'` regardless of HTTP status. **VerifyTab.tsx** shows `'Upload failed. Please retry.'` for all upload errors. Users cannot distinguish between transient errors (retry helps) and permanent ones (retry won't help).

Backend already returns structured errors:
- `503` → `{ code: "verify_unavailable" | "verify_provider_error", message: "..." }`
- `400` → validation error

### Design

**background_minimal.ts `verifyOne`:**

After `fetch(...)`, check `resp.ok` before `resp.json()`:
- If `!resp.ok`: read body, set reason based on status:
  - `503` → `"Service unavailable — try again later"`
  - `429` → `"Rate limited — try again later"`
  - `400` → `"Invalid request"`
  - other → `"Server error (${resp.status})"`
  - Set `status: 'error'`, broadcast `'failed'` step
- Network throw (fetch rejects): keep `'Network error'`

**VerifyTab.tsx `handleUploadPdf`:**

`verifyWithPdf` throws `ApiError` (already defined in api.ts with `.status` field) on non-ok responses. Update catch block:
```ts
catch (e) {
  const msg = e instanceof ApiError
    ? e.status === 400 ? 'Validation error — check the PDF'
    : e.status === 503 ? 'Service unavailable — try again later'
    : `Upload failed (${e.status})`
    : 'Upload failed. Please retry.'
  showToast(msg, 'error')
}
```

No backend changes needed.

### Files changed

- `research-kit/extension/src/background_minimal.ts` — structured error handling in `verifyOne`
- `research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx` — typed error messages in `handleUploadPdf`

---

## 3. Draft Export Metadata

### Problem

`GET /v1/drafts/{id}/export?format=md` returns raw markdown with no metadata. `format=docx` returns a document with only heading and body paragraphs. Academic workflows expect at minimum a date on exported documents.

### Design

**`.md` export:** Prepend YAML frontmatter before the markdown body:

```
---
title: {draft.title}
date: {draft.updated_at.strftime("%Y-%m-%d")}
---

{draft.markdown}
```

**`.docx` export:** After `doc.add_heading(title, level=0)`, add a paragraph with the date:
```python
doc.add_paragraph(f"Last updated: {draft.updated_at.strftime('%Y-%m-%d')}")
```

Date source: `draft.updated_at` (already on the model, always present).

No new fields, no migration, no UI changes.

### Files changed

- `research-kit/backend/app/routers/drafts.py` — update `export_draft` and `_build_docx`

---

## Out of Scope

- Author field (requires user profile linkage — separate feature)
- DOI references in export (requires claim→draft relationship — separate feature)
- Streaming verify progress (polling or SSE — separate session)
- Draft PATCH schema (already works — no change needed)
