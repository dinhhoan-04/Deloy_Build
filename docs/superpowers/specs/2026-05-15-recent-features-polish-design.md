# Recent Features Polish — Design Spec

**Date:** 2026-05-15
**Status:** Draft
**Scope:** Correctness, performance, and cleanup fixes for code shipped in the last ~2 weeks (inbox bulk ops, verify error semantics, draft export, conflict confirm flow). No new features.

## Goals

Fix 13 issues surfaced in a focused review of recently-touched code. Each issue is mechanical or has a small, well-scoped design decision; together they polish the recent feature batch before it gets built upon.

## Non-goals

- New features.
- Refactoring code outside the recent diffs.
- Real retry logic for failed verifications (only fix the misleading status message).
- UI changes beyond what's needed to consume new error fields.

---

## Backend (Python) — `research-kit/backend`

### A1. Revert claim deletion on inbox remove

**File:** `app/repos/inbox.py:74-79`

`InboxRepo.remove()` currently deletes both the inbox item and the underlying `Claim`. Revert so `DELETE /v1/inbox/{id}` only removes the inbox row; the claim stays visible in the Verify tab.

```python
async def remove(self, user_id: UUID, inbox_id: UUID) -> None:
    item = await self._get_item(user_id, inbox_id)
    await self.s.delete(item)
```

**Test impact:** `tests/test_inbox.py` — adjust the test that asserts claim deletion to assert claim survives.

**Rationale:** Inbox is "saved claims pinned to a project," not the sole storage of a claim. Cascading delete makes "remove from inbox" destructive in a way the UI does not signal.

---

### A2. Conflict resolution state columns

**Files:** new migration `alembic/versions/0006_conflict_resolved.py`; `rk_shared/models.py`; `app/repos/conflicts.py`.

Add two columns to `conflicts`:
- `resolved_at: timestamptz | null`
- `accepted_claim_id: uuid | null`

Update `ConflictRepo.confirm()`:
- Replace the `json.loads(conflict.resolution)` idempotency guard with `if conflict.resolved_at: raise ValidationError("conflict is already confirmed")`.
- On success, set `conflict.resolved_at = utcnow()` and `conflict.accepted_claim_id = accepted_claim_id` in addition to writing the legacy `resolution` JSON string (kept for LLM suggestion payloads).

**No data backfill needed** — existing rows get NULL `resolved_at`, treated as unresolved.

**Test impact:** `tests/test_conflict_confirm.py` — assert both columns are set; assert second `confirm` raises `ValidationError`. `tests/test_migrations.py` runs the new migration.

---

### A3. Remove inline `__import__` in DraftRepo

**File:** `app/repos/drafts.py:33`

Replace `__import__("sqlalchemy").text("now()")` with `text("now()")` and add `from sqlalchemy import text` at the top of the file.

---

### A4. Stable order in `InboxRepo.bulk_patch`

**File:** `app/repos/inbox.py:60-72`

Return items in the order of the input `ids`. Build the result by indexing the re-selected rows by id:

```python
result = await self.s.execute(
    select(InboxItem).where(InboxItem.id.in_(ids), InboxItem.user_id == user_id)
)
by_id = {i.id: i for i in result.scalars()}
return [by_id[i] for i in ids if i in by_id]
```

**Test impact:** new test in `tests/test_inbox.py` — patch 3 ids in reverse-creation order, assert response order matches input.

---

### A5. JSONB containment for `find_by_claim_pair`

**File:** `app/repos/conflicts.py:36-45`

Replace the Python loop with a single JSONB containment query:

```python
from sqlalchemy import or_, and_
a, b = str(claim_id_a), str(claim_id_b)
stmt = select(Conflict).where(
    Conflict.user_id == user_id,
    Conflict.project_id == project_id,
    Conflict.sides.op("@>")([{"claim_id": a}]),
    Conflict.sides.op("@>")([{"claim_id": b}]),
)
```

Also expose `pairs_for_project(user_id, project_id) -> set[frozenset[UUID]]` for use by A13:

```python
async def pairs_for_project(self, user_id, project_id):
    rows = await self.list_for(user_id, project_id=project_id)
    out: set[frozenset[UUID]] = set()
    for c in rows:
        ids = [UUID(s["claim_id"]) for s in (c.sides or []) if s.get("claim_id")]
        if len(ids) >= 2:
            out.add(frozenset(ids[:2]))
    return out
```

**Test impact:** `tests/test_conflicts.py` — keep existing assertions, add a row that should not match (only one side overlaps) to prove the AND-containment is correct.

---

### A6. Rename `ValidationError_` → `ValidationError`

**Files:** `app/errors.py`; all import sites (grep for `ValidationError_`).

Pure rename. The trailing underscore was a leftover; the class does not collide with anything in the active import paths (`pydantic.ValidationError` is not imported alongside).

**Test impact:** none beyond updating any test that imports the old name.

---

### A13. Batch conflict detection (single LLM call)

**File:** `app/routers/claims.py:49-110`

Current loop calls `provider.extract` once per candidate pair. Replace with a single batched call.

**Constants & prompt:**
```python
_CONFLICT_DETECT_MAX_CANDIDATES = 10
_CONFLICT_DETECT_BATCH_SYSTEM = """..."""  # see below
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
        }
    },
    "required": ["contradictions"],
}
```

System prompt (sketch — final wording in implementation):

> You are checking whether a new scientific claim contradicts any of several existing claims from the same paper. For each candidate, output `contradicts: true` only when the two claims make incompatible factual statements about the same quantity, direction, or outcome. Output one entry per candidate id provided.

**Algorithm:**

```
new_claim = load(new_claim_id)
candidates = query same-paper verified/partial claims, ORDER BY created_at DESC LIMIT 10
if not candidates: return

existing_pairs = conflict_repo.pairs_for_project(user_id, project_id)  # one query
candidates = [c for c in candidates
              if frozenset({new_claim_id, c.id}) not in existing_pairs]
if not candidates: return

user_msg = {
  "claim_new": {"id": str(new_claim_id), "text": new_claim.text},
  "candidates": [{"id": str(c.id), "text": c.text} for c in candidates],
  "paper_title": new_claim.paper_title,
  "doi": new_claim.doi,
}
try:
  result = await provider.extract(_CONFLICT_DETECT_BATCH_SYSTEM,
                                  json.dumps(user_msg),
                                  _CONFLICT_DETECT_BATCH_SCHEMA)
except Exception as exc:
  logger.warning("batch conflict detect failed: %s", exc)
  return

candidate_by_id = {str(c.id): c for c in candidates}
for entry in result.get("contradictions", []):
    if not entry.get("contradicts"): continue
    existing = candidate_by_id.get(entry.get("candidate_id"))
    if not existing: continue  # hallucinated id
    await conflict_repo.create(...)  # same shape as today
await s.commit()
```

**If `len(all_same_paper_candidates) > 10`:** log `logger.info("conflict detect truncated %d candidates to %d", n, 10)`.

**Test impact:** `tests/test_conflict_detect.py`:
- Mock provider to return a batched response; assert exactly one `provider.extract` call.
- Test with 15 candidates → only 10 in the user message, log emitted.
- Test hallucinated `candidate_id` → skipped.
- Test existing pair skip → no LLM call when all candidates already conflicted.

---

## Extension (TypeScript) — `research-kit/extension`

### B7. `verifyWithPdf` goes through `apiFetch`

**File:** `src/shared/api.ts:147-161`

Extend `apiFetch` to support `FormData`:

```ts
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const isFormData = init.body instanceof FormData
  const headers: Record<string, string> = {
    ...authHeader(),
    ...(init.headers as Record<string, string> || {}),
  }
  if (!isFormData) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (res.status === 401) { await signOut(); throw new AuthExpiredError() }
  if (!res.ok) throw await ApiError.fromResponse(res)  // see B10
  return res
}
```

Then `verifyWithPdf` becomes:

```ts
const res = await apiFetch('/verify/upload', { method: 'POST', body: form })
return res.json()
```

**Test impact:** `tests/shared/api.test.ts` — add a test that FormData body does not set `Content-Type` but does include `Authorization`.

---

### B8. Per-tab progress update

**File:** `src/background_minimal.ts:185-198`

Replace the `for (const [tabId, prog] of progressByTab)` loop with a single update keyed by `claim.tabId`:

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
      ? 'Verification complete' : `Verifying ${nextRunning} in progress`,
  })
  broadcastProgress(claim.tabId)
}
```

**Test impact:** unit test on `verifyOne` flow — seed two tabs in `progressByTab`, complete a claim on tab A, assert tab B's `completed` is unchanged.

---

### B9. Stop reporting "retrying" on failure

**File:** `src/background_minimal.ts:177`

In the network-error catch, broadcast `'failed'` directly instead of `'retrying'`. The subsequent `broadcastClaimStep(... 'failed')` at line 183 stays as the single source of truth.

```ts
} catch {
  // (set error result, no intermediate 'retrying' step)
  ...
}
// line 183 unchanged — broadcasts 'failed' for error status
```

**Test impact:** none new — existing flow tests should still pass.

---

### B10. Structured error envelope in `ApiError`

**Files:** `src/shared/errors.ts`; `src/shared/api.ts`; `src/sidebar/components/tabs/VerifyTab.tsx`.

Backend `app/errors.py` emits `{error: {code, message, ...}}`. Parse it on the client:

```ts
export class ApiError extends Error {
  constructor(public status: number, public body: string, public code?: string) {
    super(body); this.name = 'ApiError'
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
```

In `VerifyTab.handleUploadPdf`, prefer `e.code` when present:

```ts
const msg = e instanceof ApiError
  ? (e.code === 'pdf_too_large' ? 'PDF too large'
     : e.code === 'pdf_invalid' ? 'PDF is not readable'
     : e.status === 400 ? 'Validation error — check the PDF'
     : e.status === 503 ? 'Service unavailable — try again later'
     : `Upload failed (${e.status})`)
  : 'Upload failed. Please retry.'
```

Final code list confirmed against `app/errors.py` during implementation.

**Test impact:** `VerifyTab.test.tsx` — add a case where the mocked fetch returns a JSON error body with `error.code: "pdf_too_large"` and assert the friendly message renders.

---

### B11. Single useEffect in `ConflictResolutionPanel`

**File:** `src/sidebar/components/atoms/ConflictResolutionPanel.tsx:28-40`

Collapse the two effects into one keyed on `conflict.id`:

```ts
useEffect(() => {
  let pick: string | null = null
  const sug = (() => {
    try { return conflict.resolution ? JSON.parse(conflict.resolution) : null }
    catch { return null }
  })()
  if (sug?.kind === 'suggestion') {
    if (sug.recommendation === 'side_a' && conflict.sides[0]) pick = conflict.sides[0].claim_id
    else if (sug.recommendation === 'side_b' && conflict.sides[1]) pick = conflict.sides[1].claim_id
  }
  setSelected(pick)
}, [conflict.id, conflict.resolution])
```

Deps include `conflict.resolution` so that when a suggestion arrives (same conflict id, new resolution string), the recommended side gets pre-selected.

**Test impact:** existing component tests still pass; add a test that switching `conflict.id` resets `selected` even when both conflicts have a `side_a` recommendation.

---

### B12. Tab cleanup for `claimsMap` / `results` / `progressByTab`

**File:** `src/background_minimal.ts`

Register `chrome.tabs.onRemoved`:

```ts
chrome.tabs.onRemoved.addListener((tabId) => {
  progressByTab.delete(tabId)
  // Drop claims that belonged to the closed tab
  for (const [id, c] of claimsMap) {
    if (c.tabId === tabId) { claimsMap.delete(id); results.delete(id) }
  }
  // Also drop queued items for that tab
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].tabId === tabId) queue.splice(i, 1)
  }
})
```

**Test impact:** new test in extension test suite — seed maps for two tabs, fire `onRemoved` for one, assert only that tab's entries are gone.

---

## Implementation order

Three independent PR-able groups:

1. **A-data** — A1 (revert claim delete), A2 (conflict columns + migration). Land first because A2 ships a migration.
2. **A-cleanup + A-perf** — A3, A4, A5, A6, A13. A13 depends on `pairs_for_project` added in A5.
3. **B-extension** — B7, B8, B9, B10, B11, B12. Independent of A; can land in parallel after A-data.

## Risk

- **A2 migration:** non-destructive (additive columns); rollback = drop columns. Safe.
- **A13 prompt drift:** batched prompt is new; if false-positive rate changes, the existing pair-skip logic still prevents duplicate conflict rows. Worst case: a few extra `Conflict` rows in dev.
- **B7 FormData branch in `apiFetch`:** every other call path keeps JSON behavior; new branch only triggers when `body instanceof FormData`. No regression surface for existing calls.

## Out of scope (explicit)

- Real verify retry on network error (B9 only removes the misleading message).
- Inbox UX redesign — A1 just reverts behavior; no new "delete claim" action.
- LLM cost telemetry for A13.
- Conflict detection for cross-paper claims.
