# Conflict Detection Visibility — Design

**Date:** 2026-05-16
**Status:** Approved
**Owner:** ResearchKit extension + backend

## Problem

Conflict detection (`_detect_conflicts` in [research-kit/backend/app/routers/claims.py](../../../research-kit/backend/app/routers/claims.py)) runs as a fire-and-forget background task after `PATCH /v1/claims/{id}` with `status ∈ {verified, partial}`. The pipeline is silent end-to-end:

- No frontend signal that detection is running or has completed.
- LLM failures (missing API key, quota, timeout) log a warning and return — user sees "no conflicts" but cannot distinguish "checked and clean" from "never ran" or "failed".
- Backend stores no per-claim record of whether detection has been attempted.

The user pain: **after saving verified claims through the normal extension workflow, the user has no way to know whether conflict detection has run.**

## Goals

- Show users, in the ConflictsTab, whether the project's conflict checks are up to date.
- Distinguish three states clearly: in-progress, complete (with timestamp), and pending (not yet checked or failed).
- Avoid invasive UI: status lives in the ConflictsTab header only, not on every ClaimCard.
- Minimal blast radius: one schema migration, one new endpoint, one frontend hook.

## Non-Goals

- Per-claim conflict-check status surfaced on ClaimCards (deferred).
- Distinguishing "check failed" from "check never attempted" — both render as "pending". A separate `conflicts_check_error` column was considered and rejected for now.
- Surfacing failures via toast/notification (separate concern).
- Live progress streaming via SSE/WebSocket (polling is sufficient).
- Auto-triggering re-checks for claims whose checks have failed.

## Architecture

### Data flow

```
User saves claim (verified/partial)
        |
        v
PATCH /v1/claims/{id}  --returns 200 immediately
        |
        +--> asyncio background task: _detect_conflicts(claim)
                |
                +-- LLM call succeeds  -> set claim.conflicts_checked_at = utcnow()
                +-- early return (no DOI/title, no candidates, all paired) -> set timestamp
                +-- provider missing or exception -> leave NULL

User opens ConflictsTab
        |
        v
GET /v1/conflicts/check-status?project_id=X  (poll every 3s while pending > 0)
        |
        v
Header renders: "Checking N claims..." | "Last checked T ago" | (hidden)
```

### Components

**Backend (Python / FastAPI / SQLAlchemy):**

- `rk_shared.models.Claim` — new field `conflicts_checked_at: Optional[datetime]`.
- Alembic migration `0007_claim_conflicts_checked_at.py` — add nullable column, no backfill.
- `app.routers.claims._detect_conflicts` — set timestamp at success branches per the table below.
- `app.repos.conflicts.ConflictRepo.check_status(user_id, project_id)` — new method, single query.
- `app.routers.conflicts` — new route `GET /v1/conflicts/check-status`.
- `app.schemas.conflicts.ConflictCheckStatusOut` — new pydantic schema.

**Frontend (TypeScript / React):**

- `shared/api.ts` — `getConflictCheckStatus(projectId)`.
- `shared/types.ts` — `ConflictCheckStatus` type.
- `sidebar/state/slices/conflicts.ts` (or sibling slice) — `conflictCheckStatus` slice + `loadCheckStatus(projectId)` action.
- `sidebar/components/tabs/ConflictsTab.tsx` — new header sub-component `ConflictsCheckHeader`.
- `sidebar/hooks/useConflictCheckPolling.ts` — new hook for tab-active polling.
- `sidebar/App.tsx` — optimistic bump on PATCH verified/partial.

## Detailed Design

### Schema migration

Migration `0007_claim_conflicts_checked_at.py`:

```python
def upgrade():
    op.add_column("claim", sa.Column("conflicts_checked_at", sa.DateTime(), nullable=True))

def downgrade():
    op.drop_column("claim", "conflicts_checked_at")
```

No backfill. Pre-existing verified/partial claims will appear as pending until the next time the user verifies anything in that paper group, at which point `_detect_conflicts` will run and set the timestamp. This is acceptable because the in-flight pool is small and the column is per-claim, not per-project — it self-heals over normal usage.

### `_detect_conflicts` timestamp logic

| Branch | Location (current line in claims.py) | Set timestamp? |
|---|---|---|
| Claim has no DOI and no paper_title | line 81-82 | yes |
| `all_candidates` is empty | line 87 | yes |
| All candidate pairs already conflicted | line 97-98 | yes |
| LLM call succeeds (conflicts found or not) | after line 137 commit | yes |
| `provider = None` (no API key configured) | line 101-102 | no — leave NULL so retry on next save once key is added |
| LLM raises exception | line 114-116 | no — leave NULL so user sees pending and knows it failed |

Implementation: small helper inside the function:

```python
async def _mark_checked(s, claim_id):
    await s.execute(
        update(Claim)
        .where(Claim.id == claim_id, Claim.user_id == user_id)
        .values(conflicts_checked_at=datetime.now(timezone.utc).replace(tzinfo=None))
    )
    await s.commit()
```

Call `_mark_checked(s, new_claim_id)` at each success branch. The existing `await s.commit()` at the end of the LLM-success path is followed by `_mark_checked`.

### Endpoint contract

**Request:**
```
GET /v1/conflicts/check-status?project_id={uuid}
Authorization: <session>
```

**Response 200:**
```json
{
  "last_checked_at": "2026-05-16T10:23:45Z",
  "pending_count": 2
}
```

- `last_checked_at`: ISO-8601 UTC, or `null` if no claim in the project has ever been checked.
- `pending_count`: integer count of claims with `status IN ('verified', 'partial')` AND `conflicts_checked_at IS NULL`.

**Auth/ownership:** uses `Depends(current_user)` like sibling routes. If the project is not owned by the user (or does not exist), respond `200 {null, 0}` rather than 404 — this endpoint is a benign indicator and avoiding 404 keeps the polling loop simple. Project existence/ownership check is not security-critical because no claim content is exposed.

**Repo method:**
```python
async def check_status(self, user_id: UUID, project_id: UUID) -> tuple[datetime | None, int]:
    row = (await self.s.execute(
        select(
            func.max(Claim.conflicts_checked_at),
            func.count().filter(
                Claim.status.in_(["verified", "partial"]),
                Claim.conflicts_checked_at.is_(None),
            ),
        ).where(Claim.user_id == user_id, Claim.project_id == project_id)
    )).one()
    return row[0], row[1]
```

### Frontend — `ConflictsCheckHeader`

Renders above both empty-state and list in [ConflictsTab.tsx](../../../research-kit/extension/src/sidebar/components/tabs/ConflictsTab.tsx).

| Condition | Render |
|---|---|
| `pending_count > 0` | spinner icon + `"Checking {N} claim{s}…"` |
| `pending_count == 0 && last_checked_at != null` | check icon + `"Last checked {relativeTime}"` (e.g. "2 min ago") |
| `pending_count == 0 && last_checked_at == null` | header hidden (no claims have triggered detection yet) |

Relative-time formatting: lightweight, "Xs ago" / "X min ago" / "X h ago". No external dep required if a helper does not exist; otherwise reuse.

Style: single horizontal row, `border-bottom`, padding consistent with existing `tokens.css` spacing tokens, `var(--rk-text-3)` color, ~12px font. Hidden state takes zero vertical space.

### Polling hook

`useConflictCheckPolling(projectId: string, isTabActive: boolean)`:

- On mount, `projectId` change, or `isTabActive` flipping true → fetch immediately.
- If most-recent `pending_count > 0` → `setInterval(fetch, 3000)`.
- When `pending_count` transitions from `> 0` to `0` → call `loadConflicts(projectId)` (the existing slice action) to refetch the conflicts list so any newly created conflicts appear in the same view.
- Cleanup interval on: tab inactive, projectId change, `pending_count == 0`, unmount.
- Errors (network/auth) are swallowed silently — next poll retries. Header keeps last known state.

`isTabActive` is derived from the existing `currentTab` selector in `useStore` (`currentTab === 'conflicts'`).

### Optimistic bump

In [App.tsx:200](../../../research-kit/extension/src/sidebar/App.tsx#L200), after `await patchClaim(backendId, { status: 'verified' | 'partial', ... })` succeeds, optimistically increment `conflictCheckStatus.data.pending_count += 1`. This makes the header switch to "Checking…" within the same render, without waiting up to 3s for the next poll tick. The next poll's authoritative value will overwrite this optimistic value.

This bump applies regardless of whether the ConflictsTab is currently active — when the user later switches to it, the state is already correct.

## Testing

### Backend (`research-kit/backend/tests/`)

`test_conflict_detect.py` — add:
- `test_detect_conflicts_sets_checked_at_on_llm_success` — happy path, timestamp populated.
- `test_detect_conflicts_sets_checked_at_when_no_doi_no_title` — early return path.
- `test_detect_conflicts_sets_checked_at_when_no_candidates` — early return path.
- `test_detect_conflicts_sets_checked_at_when_all_pairs_already_exist` — dedupe early return.
- `test_detect_conflicts_leaves_null_when_no_provider` — provider missing leaves NULL.
- `test_detect_conflicts_leaves_null_when_llm_raises` — exception leaves NULL.

`test_conflicts.py` — add:
- `test_check_status_empty_project` — returns `{null, 0}`.
- `test_check_status_counts_pending` — verified + partial claims with NULL checked_at count correctly.
- `test_check_status_returns_max_timestamp` — `last_checked_at = MAX(...)`.
- `test_check_status_ignores_other_projects` — project isolation.
- `test_check_status_ignores_other_users` — user isolation.
- `test_check_status_excludes_pending_status_claims` — only `verified`/`partial` claims are counted as pending checks (not `status=pending`).

### Frontend (`research-kit/extension/src/sidebar/components/tabs/`)

`ConflictsTab.test.tsx` — add:
- Renders spinner + "Checking 2 claims…" when `pending_count > 0`.
- Renders "Last checked X ago" when `pending_count = 0 && last_checked_at != null`.
- Header hidden when `pending_count = 0 && last_checked_at = null`.
- Polling fires on mount when tab active.
- Polling continues while `pending_count > 0`.
- Polling stops when `pending_count` transitions to 0; `loadConflicts` is invoked once at that transition.
- Polling does not run when tab inactive.
- Optimistic bump after `patchClaim` with `status = verified` reflects in header immediately.

### Migration

`test_migrations.py` — the existing infra exercises up/down. Verify migration `0007` runs clean both directions.

## Error Handling

| Failure | Behavior |
|---|---|
| Endpoint 500 / network error | Hook swallows, keeps last state, retries next interval. No error UI. |
| User logs out mid-poll | Next fetch 401 → swallowed; interval cleanup happens on unmount when the auth flow re-renders. |
| Backend `_detect_conflicts` exception | Timestamp stays NULL; claim appears in `pending_count`; user sees indefinite "Checking…" until either the next verify retriggers detection or the claim is manually re-saved. This is the chosen tradeoff — option B/C from brainstorming were rejected for scope. |
| User switches project mid-poll | Hook resets state and refetches for new project. |

## Open Questions

None. All decisions resolved during brainstorming.

## Out of Scope (Possible Follow-ups)

- Surface failure cause (separate `conflicts_check_error` column + UI).
- Per-claim badge on ClaimCard.
- Manual "Retry checks" button when `pending_count > 0` for an extended period.
- Toast notification when new conflicts appear.
