# Conflict Feature Improvement — Design Spec

**Date:** 2026-05-15

---

## Problem

The conflict feature has three gaps:
1. **No auto-detection** — conflicts are never created automatically; the endpoint exists but nothing triggers it
2. **Weak LLM suggestion** — one-line system prompt produces generic output with no per-side weight or recommendation
3. **Incomplete resolution flow** — "Accept →" patches a field but does not verify the accepted claim, delete the rejected one, or add to inbox

---

## Goals

1. Conflicts are detected automatically when a claim is verified against the same paper
2. AI suggestion gives a concrete recommendation (side_a / side_b / neither) with per-side evidence weight
3. Resolving a conflict verifies the accepted claim, deletes the rejected one, and adds it to inbox in one action

---

## Architecture

Three independent changes, all confined to existing files + one new endpoint:

| File | Change |
|---|---|
| `research-kit/backend/app/routers/claims.py` | Fire-and-forget conflict detection after PATCH |
| `research-kit/backend/app/routers/runs.py` | Rewrite CONFLICT system prompt + output schema |
| `research-kit/backend/app/routers/conflicts.py` | Add `POST /v1/conflicts/:id/confirm` endpoint |
| `research-kit/extension/src/sidebar/components/atoms/ConflictResolutionPanel.tsx` | Radio select + Confirm button + suggestion highlight |
| `research-kit/extension/src/shared/api.ts` | Add `confirmConflict()` function |
| `research-kit/extension/src/sidebar/state/slices/conflicts.ts` | Add `confirmConflict()` action |

No DB migrations. Uses existing `Conflict`, `Claim`, `InboxItem` models.

---

## Section 1: Auto-detect Conflicts

**Trigger:** `PATCH /v1/claims/:id` when `status` in body is `"verified"` or `"partial"`.

**Detection flow (background task):**
1. Query all other claims in the same project with the same DOI. If no DOI, fallback to `paper_title` match. Filter to status `verified` or `partial` only.
2. For each matching claim, call LLM once to check for contradiction:

```python
_CONFLICT_DETECT_SYSTEM = (
    "You detect contradictions between two scientific claims from the same paper. "
    "Return JSON: {\"contradicts\": bool, \"reason\": string}. "
    "contradicts=true only if the claims make incompatible assertions."
)
```

User message: `{"claim_a": claim_a.text, "claim_b": claim_b.text, "paper_title": ..., "doi": ...}`

Schema: `{"type": "object", "properties": {"contradicts": {"type": "boolean"}, "reason": {"type": "string"}}, "required": ["contradicts", "reason"]}`

3. If `contradicts = true` and no existing conflict contains both `claim_id`s → create conflict:
   - `group_key = doi or paper_title`
   - `sides = [{claim_id: new_claim.id, label: "Claim A", quote: new_claim.quote}, {claim_id: existing_claim.id, label: "Claim B", quote: existing_claim.quote}]`

**Duplicate guard:** Before creating, query conflicts table for any record whose `sides` JSONB contains both claim IDs.

**Async:** Wrapped in `asyncio.create_task()` — PATCH responds immediately, detection runs in background.

---

## Section 2: CONFLICT LLM Suggestion Prompt

**New system prompt:**

```
You are RK-Conflict, an academic research assistant that analyzes contradictions
between two claims from the same paper.

You receive two conflicting claims with their verbatim quotes. Analyze each side
and recommend which claim better represents the paper's findings.

RULES:
1. EVIDENCE: Base your analysis only on the verbatim quotes provided.
2. SIDES: For each side, assess how strongly the quote supports the claim (0.0–1.0).
3. SYNTHESIS: If both sides are partially valid, suggest a reconciliation sentence.
4. RECOMMENDATION: Pick "side_a", "side_b", or "neither" with a rationale.
5. OUTPUT: Return valid JSON matching the schema.
```

**Updated output schema:**

```json
{
  "recommendation": "side_a" | "side_b" | "neither",
  "rationale": "1-2 sentence string",
  "synthesis": "string or null",
  "sides_analysis": [
    { "side_id": "claim_id_string", "weight": 0.85, "note": "string" }
  ]
}
```

`recommendation` maps to `side_a` = first element in `conflict.sides`, `side_b` = second.

**Extension display:** When suggestion has `recommendation = "side_a"` or `"side_b"`, pre-select that radio button. Show `synthesis` text below the grid if `recommendation = "neither"`.

---

## Section 3: Resolution Confirm Flow

### New endpoint: `POST /v1/conflicts/:id/confirm`

**Request body:** `{ "accepted_claim_id": "uuid" }`

**Backend — single transaction:**
1. Load conflict, verify `accepted_claim_id` is one of `conflict.sides[*].claim_id`
2. Determine `rejected_claim_id` = the other side
3. `UPDATE claims SET status = 'verified' WHERE id = accepted_claim_id`
4. `DELETE FROM claims WHERE id = rejected_claim_id`
5. Upsert inbox item for `accepted_claim_id` in the project (skip if already exists)
6. Update conflict: `resolution = JSON.dumps({"kind": "confirmed", "accepted_claim_id": str(accepted_claim_id)})`
7. Commit

**Response:**
```json
{
  "conflict": { ...ConflictOut },
  "inbox_item": { ...InboxItemOut }
}
```

### Extension UI changes (`ConflictResolutionPanel`)

- Replace "Accept →" buttons with **radio-style side cards** — click anywhere on a side to select it; selected side gets brand-color border
- If AI suggestion has `recommendation = "side_a"` or `"side_b"` → pre-select that side on render
- If `recommendation = "neither"` → show synthesis text, no pre-selection
- **"Confirm" button** in footer — disabled until one side is selected; enabled once selected
- **"✦ Get AI Suggestion"** button remains; can be used before confirming
- On confirm: call `confirmConflict(conflict.id, selectedClaimId)` → show toast "Claim added to inbox" → remove conflict from store

### Zustand slice addition (`conflicts.ts`)

```ts
confirmConflict(conflictId: string, acceptedClaimId: string): Promise<void>
```

After success:
- Remove conflict from `conflicts.data`
- Append `inbox_item` to `inbox.data` (no reload needed)

### API function (`api.ts`)

```ts
export async function confirmConflict(
  conflictId: string, acceptedClaimId: string
): Promise<{ conflict: Conflict; inbox_item: InboxItem }> {
  return (await apiFetch(`/conflicts/${conflictId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ accepted_claim_id: acceptedClaimId }),
  })).json()
}
```

---

## What Does NOT Change

- `_draft_schema()` — unchanged
- Verify endpoint — unchanged
- Inbox endpoint — unchanged
- DB migrations — none needed; `sides` is already JSONB, `resolution` is already a text field
- Existing `PATCH /v1/conflicts/:id` — kept as-is for AI suggestion storage

---

## Success Criteria

- After verifying a claim, conflicts tab shows newly detected conflict within seconds (no manual refresh needed beyond switching tabs)
- AI suggestion pre-selects the recommended side
- Confirming a resolution removes the conflict, verifies the accepted claim, deletes the rejected one, and the inbox tab immediately shows the new item
- No conflict is created twice for the same pair of claims
