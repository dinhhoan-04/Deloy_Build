# Research Kit — App Completion Design

**Date:** 2026-05-09
**Branch:** `new-idea-agent`
**Status:** Approved (pending user review)
**Builds on:** `2026-05-09-goclaw-integration-replacement-design.md` (GoClaw runtime), `2026-05-08-researchkit-backend-goclaw-design.md` (backend skeleton).

## 1. Goal

Finish wiring Research Kit into an end-to-end usable application. With GoClaw runtime merged and backend REST/SSE/MCP layers in place, the remaining work is: (a) make the 5 worker prompts produce valid structured output, (b) connect the Chrome extension to the real backend (auth, REST, SSE), (c) implement the two placeholder tabs (Chat, Draft), and (d) wire all unfinished UI handlers.

### In scope
1. 5 worker prompts (`verify`, `extract`, `conflict`, `draft`, `chat`) with prompt-only JSON output, validated and persisted worker-side.
2. Extension Google OAuth via `chrome.identity.launchWebAuthFlow` → backend `/v1/auth/login` session token persisted in `chrome.storage.local`.
3. Rewrite `extension/src/shared/api.ts` to target real backend endpoints (`/v1/{auth,projects,claims,inbox,conflicts,runs}`).
4. SSE consumer for `/v1/runs/{id}/stream` over streaming `fetch`, with `Last-Event-ID` resume and reconnect.
5. Backend↔extension sync: backend is source of truth, fetch on sidebar open / project switch, mutations write-through.
6. ChatTab: thread UI, client-side history, each message starts a new `RunKind.CHAT`.
7. DraftTab: select-from-inbox UI, triggers `RunKind.DRAFT`, renders streaming markdown.
8. App.tsx: implement the seven TODO handlers (archive, add-to-project, conflict resolve, expand state, save claim, inbox toggle-select, project create dialog).
9. ConflictsTab: wire `PATCH /v1/conflicts/{id}` with structured resolution payload.
10. InboxTab: wire `DELETE /v1/inbox/{id}` for single remove and client-side bulk archive.

### Out of scope
- New MCP write tools (worker parses agent JSON instead).
- Backend bulk-delete endpoint for inbox (client loop suffices).
- Real-time backend push channels (no WebSocket fanout).
- Persistent chat threads in DB (kept in `chrome.storage.local`).
- GoClaw config / agent personality changes (settled in prior design).
- Drafts persistence in backend (kept client-side; out of scope for this iteration).
- Migration of any prior `chrome.storage` data (dev users; wipe-on-version-bump).

### Success criteria
- `RK_RUNNER=goclaw` plus the new prompts produces valid, schema-conformant JSON for each `RunKind`, persisted to the correct tables.
- Google sign-in works; session token persists across reload; 401 cleanly returns user to login gate.
- Every tab fetches authoritative data from the backend; mutations refetch after success.
- Existing 8 backend invariants remain green.
- Manual E2E checklist (§8) passes against a real GoClaw stack.

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Extension (MV3)                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ sidebar/ (React)                                     │   │
│  │   App.tsx → tabs (Verify/Inbox/Conflicts/Chat/Draft) │   │
│  │   state/useStore.ts (Zustand) + per-slice modules   │   │
│  └────────────────┬────────────────────────────────────┘   │
│  ┌────────────────▼────────────────────────────────────┐   │
│  │ shared/api.ts  (typed REST + SSE client)            │   │
│  │   apiFetch wrapper: injects auth header,            │   │
│  │                     handles 401 → signOut           │   │
│  │   streamRun(runId): AsyncIterable<RunEvent>         │   │
│  └────────────────┬────────────────────────────────────┘   │
│  ┌────────────────▼────────────────────────────────────┐   │
│  │ shared/auth.ts (NEW)                                │   │
│  │   googleSignIn() via chrome.identity                │   │
│  │   token in chrome.storage.local, onAuthChange       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                    │ HTTPS (Bearer session_token)
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  rk-backend (FastAPI)  — UNCHANGED in this iteration        │
│  /v1/auth/* /v1/projects /v1/claims /v1/inbox               │
│  /v1/conflicts /v1/runs (POST/GET/cancel/stream)            │
│  /mcp ───── (only goclaw consumer; extension never sees)    │
└────────────┬─────────────────────────────────┬──────────────┘
             │                                 │
       Postgres + Redis             ┌──────────▼─────────┐
                                    │ worker (RQ)        │
                                    │   tasks.py         │
                                    │   prompts/* (NEW   │
                                    │     real content)  │
                                    │   result_parser.py │
                                    │     (NEW)          │
                                    │   _finalize writes │
                                    │     claims/        │
                                    │     conflicts on   │
                                    │     successful     │
                                    │     parse          │
                                    │   GoClawRunner     │
                                    └──────────┬─────────┘
                                               │ WS
                                               ▼
                                          GoClaw gateway
```

**Two new things outside straight wiring:**

1. **Extension `shared/auth.ts`** — single module owning OAuth + token persistence. `api.ts` and components never touch `chrome.storage.local` for auth directly.
2. **Worker `result_parser.py`** — given `RunKind` + `goclaw_response.content`, parse JSON, validate via Pydantic schema, return parsed dict or raise `OutputParseError`. `_execute_run_impl` calls this between `runner.run` and `_finalize`. For verify/extract/conflict, `_finalize` performs DB writeback.

**Boundaries:**
- Extension knows only REST + SSE. No knowledge of GoClaw, MCP, worker internals.
- Worker is the only place mapping GoClaw output → RK domain (claims, conflicts).
- Backend routers stay thin DB-CRUD; agent execution lives in worker + GoClaw.

## 3. Worker Prompts & JSON Schema

Each prompt file in `worker/prompts/` exports `build_messages(input: dict) -> list[dict]` and an `OutputSchema` Pydantic model. Schema validation lives in `worker/result_parser.py`.

### Common pattern

```python
# worker/prompts/verify.py
from pydantic import BaseModel, Field
from typing import Literal
import json

class VerifyOutput(BaseModel):
    verdict: Literal["supported", "partially_supported", "unsupported", "uncertain"]
    confidence: float = Field(ge=0, le=1)
    quote: str | None = None
    page: int | None = None
    reason: str

SYSTEM = """You are RK-Verify. Given a claim and a paper, determine whether
the paper supports the claim. Output ONLY a JSON object matching this schema:
{schema}
Rules:
- "quote" must be verbatim from the paper.
- "confidence" reflects evidence strength (0..1).
- No prose outside the JSON.
"""

def build_messages(input: dict) -> list[dict]:
    claim = input["claim"]
    return [
        {"role": "system", "content": SYSTEM.format(
            schema=json.dumps(VerifyOutput.model_json_schema(), indent=2))},
        {"role": "user", "content": json.dumps({
            "claim_text": claim["text"],
            "paper_urls": [c["url"] for c in claim["citations"]],
        })},
    ]
```

### Per-kind summary

| Kind | Input shape | Output schema | Side effects on success |
|---|---|---|---|
| `verify` | `{claim_id, claim: {text, citations: [{url}]}}` | `VerifyOutput(verdict, confidence, quote, page, reason)` | `ClaimRepo.patch(claim_id, status=verdict, quote, confidence, reason, page)` |
| `extract` | `{paper_url, sections?}` | `ExtractOutput(claims: [{text, page, section}])` | `ClaimRepo.batch_create(project_id, claims)` with `status='pending'` |
| `conflict` | `{conflict_id, group_key, sides: [{verify_run_id, verdict, ...}]}` | `ConflictOutput(suggested_resolution, rationale, sides_analysis)` | `ConflictRepo.patch(conflict_id, resolution={kind:'suggestion', text:..., rationale:...})` (final accept still manual) |
| `draft` | `{claims: [{id, text, citations, verdict?, quote?}], style?}` | `DraftOutput(markdown, sections)` | Stored in `run.result` only |
| `chat` | `{messages: [{role, content}]}` | `ChatOutput(text)` | Stored in `run.result` only |

### Few-shot

Each prompt embeds one ~150-token worked example in the system message, clearly labeled `EXAMPLE` with synthetic DOIs/quotes. Schema discovery via `model_json_schema()` is the heavy lift; few-shot exists to anchor format only.

### `worker/result_parser.py`

```python
PARSERS: dict[RunKind, type[BaseModel]] = {
    RunKind.VERIFY:   VerifyOutput,
    RunKind.EXTRACT:  ExtractOutput,
    RunKind.CONFLICT: ConflictOutput,
    RunKind.DRAFT:    DraftOutput,
    RunKind.CHAT:     ChatOutput,
}

class OutputParseError(Exception): ...

def parse_output(kind: RunKind, content: str) -> BaseModel:
    try:
        data = json.loads(_strip_code_fences(content))
        return PARSERS[kind].model_validate(data)
    except (json.JSONDecodeError, ValidationError) as e:
        raise OutputParseError(str(e))
```

`_strip_code_fences` removes optional ```` ```json ```` / ```` ``` ```` wrapping that some models emit.

### Retry-on-parse-fail

In `_execute_run_impl`, on `OutputParseError`: retry once, appending to messages: `[..., {role:'assistant', content: <raw>}, {role:'user', content:'Output was not valid JSON. Return ONLY the JSON object.'}]`. If second attempt also fails → run ends `FAILED` with `error.code='parse'`. Single retry only — keep cost bounded.

### DB writeback (`_finalize` extension)

On successful parse:
- `RunKind.VERIFY` → `ClaimRepo.patch(...)` keyed off `run.input["claim_id"]`.
- `RunKind.EXTRACT` → `ClaimRepo.batch_create(run.project_id, parsed.claims)`.
- `RunKind.CONFLICT` → `ConflictRepo.patch(conflict_id, resolution={kind:'suggestion', text:..., rationale:...})`.
- `DRAFT/CHAT` → no extra writeback; `run.result = parsed.model_dump()`.

All writebacks idempotent (set-state operations) — safe under at-least-once worker delivery.

## 4. Extension Auth Module

### File: `extension/src/shared/auth.ts` (new)

OAuth 2.0 Implicit flow via `chrome.identity.launchWebAuthFlow`:

```typescript
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const REDIRECT_URI = chrome.identity.getRedirectURL()

type AuthState = { token: string; user: UserOut; expiresAt: number } | null
let _state: AuthState = null
const _listeners = new Set<(s: AuthState) => void>()

export async function googleSignIn(): Promise<AuthState> {
  const nonce = crypto.randomUUID()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  url.searchParams.set('response_type', 'id_token')
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('nonce', nonce)

  const redirected = await chrome.identity.launchWebAuthFlow({
    url: url.toString(), interactive: true,
  })
  const idToken = new URL(redirected.replace('#', '?')).searchParams.get('id_token')
  if (!idToken) throw new Error('No id_token returned')

  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ google_id_token: idToken }),
  })
  if (!res.ok) throw new Error(`Login failed: ${res.status}`)
  const { session_token, user, expires_at } = await res.json()

  const next = { token: session_token, user, expiresAt: Date.parse(expires_at) }
  await chrome.storage.local.set({ rk_auth: next })
  _setState(next)
  return next
}

export async function loadStoredAuth(): Promise<AuthState> { /* read + expiry check */ }
export async function signOut(): Promise<void> { /* revoke best-effort + clear */ }
export function getToken(): string | null { return _state?.token ?? null }
export function getUser() { return _state?.user ?? null }
export function authHeader(): Record<string,string> {
  return _state ? { Authorization: `Bearer ${_state.token}` } : {}
}
export function onAuthChange(fn: (s: AuthState) => void) { ... }
```

### Manifest

Add `"identity"` permission. `oauth2.client_id` not used (we go through `launchWebAuthFlow`, not `getAuthToken`).

### Google Cloud Console (one-time)

- Create OAuth 2.0 Client ID, type **Web application**.
- Authorized redirect URIs: `https://<extension-id>.chromiumapp.org/`.
- Pin extension ID via `manifest.key` so dev/prod IDs match.
- Set `VITE_GOOGLE_CLIENT_ID` in `extension/.env`.

### App-level integration

- `useAuth()` hook subscribes to `onAuthChange`.
- No auth → render `<LoginGate>` (centered "Sign in with Google"); skip rest of UI.
- Auth → render existing tabs; expose `signOut` in `SettingsPanel`.
- `apiFetch` is the only place that reads/clears auth on 401.

## 5. `api.ts` Rewrite & SSE Client

### Layout

`extension/src/shared/api.ts` becomes a thin router. Types in `extension/src/shared/types.ts` (expanded). Old functions (`verify`, `collect`, `verifyLinks`, `streamAgentRun`) deleted — they target dead endpoints.

### Endpoint surface (all behind `apiFetch`)

```typescript
listProjects(): Promise<Project[]>
createProject(name: string): Promise<Project>

listClaims(projectId: UUID, status?: string): Promise<Claim[]>
batchCreateClaims(projectId: UUID, claims: ClaimInput[], idempotencyKey?: string): Promise<Claim[]>
patchClaim(claimId: UUID, patch: ClaimPatch): Promise<Claim>

listInbox(projectId: UUID): Promise<InboxItem[]>
addToInbox(projectId: UUID, claimId: UUID): Promise<InboxItem>
removeFromInbox(inboxId: UUID): Promise<void>

listConflicts(projectId: UUID): Promise<Conflict[]>
patchConflict(conflictId: UUID, resolution: ResolutionPayload): Promise<Conflict>

createRun(body: RunCreate): Promise<RunCreateResponse>
getRun(runId: UUID): Promise<Run>
cancelRun(runId: UUID): Promise<void>
streamRun(runId: UUID, opts?: { lastSeq?: number, signal?: AbortSignal }): AsyncIterable<RunEvent>
```

### `apiFetch` chokepoint

```typescript
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init.headers || {}) },
  })
  if (res.status === 401) { await signOut(); throw new AuthExpiredError() }
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res
}
```

### `streamRun` — SSE consumer with reconnect

```typescript
export async function* streamRun(
  runId: string,
  { lastSeq = 0, signal }: { lastSeq?: number; signal?: AbortSignal } = {}
): AsyncIterable<RunEvent> {
  let seq = lastSeq
  let backoff = 500
  while (!signal?.aborted) {
    try {
      const res = await fetch(`${API_URL}/runs/${runId}/stream`, {
        headers: { ...authHeader(), 'Last-Event-ID': String(seq) },
        signal,
      })
      if (res.status === 401) { await signOut(); throw new AuthExpiredError() }
      if (!res.ok) throw new ApiError(res.status, await res.text())
      backoff = 500
      for await (const evt of parseSSE(res.body!)) {
        if (evt.id) seq = parseInt(evt.id, 10)
        const data = JSON.parse(evt.data) as RunEvent
        yield data
        if (data.type === 'status' &&
            ['succeeded','failed','cancelled'].includes(data.payload?.status)) return
      }
    } catch (e) {
      if (signal?.aborted || e instanceof AuthExpiredError) throw e
      await sleep(backoff); backoff = Math.min(backoff * 2, 10_000)
    }
  }
}
```

`parseSSE(stream)` — small standalone helper in `extension/src/shared/sse.ts` yielding `{event, id, data}` per SSE spec. Testable without network.

### Event vocabulary (worker → SSE → extension)

| Worker `bus.publish` type | SSE payload | UI consumer |
|---|---|---|
| `status` (running/succeeded/failed/cancelled) | `{type:'status', payload:{status}}` | progress bar + run state |
| `token` | `{type:'token', payload:{text}}` | streaming text accumulator (chat/draft) |
| `tool_call` | `{type:'tool_call', payload:{name, args}}` | tool-call card (chat dev mode) |
| `tool_result` | `{type:'tool_result', payload:{name, result}}` | same |
| `error` | `{type:'error', payload:{code, message, recoverable}}` | toast + run status |

`RunEvent` is a discriminated union in `shared/types.ts` matching this table.

### `useRunStream` hook

```typescript
export function useRunStream(runId: string | null) {
  const [tokens, setTokens] = useState('')
  const [status, setStatus] = useState<RunStatus>('queued')
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [error, setError] = useState<RunError | null>(null)
  useEffect(() => {
    if (!runId) return
    const ctrl = new AbortController()
    ;(async () => {
      try {
        for await (const evt of streamRun(runId, { signal: ctrl.signal })) {
          // dispatch by evt.type into state
        }
      } catch (e) { if (!ctrl.signal.aborted) setError(toRunError(e)) }
    })()
    return () => ctrl.abort()
  }, [runId])
  return { tokens, status, toolCalls, error }
}
```

Used by VerifyTab progress, ChatTab, DraftTab.

## 6. Sync Model & Store

### Source-of-truth shift

Backend = source of truth. Store holds a cache plus per-slice flags:

```typescript
type Slice<T> = { data: T; status: 'idle'|'loading'|'ready'|'error'; error?: string; lastFetched?: number }
```

`chrome.storage` persists only UI state: `currentProjectId`, `activeSites`, `onboardingDone`, `inboxSelectedIds`. Domain data (projects, claims, inbox, conflicts) is re-fetched per session.

### Fetch triggers

| Event | Action |
|---|---|
| Sidebar mounts + auth ready | `loadProjects()`; if none selected, pick first |
| `currentProjectId` changes | parallel `loadClaims/loadInbox/loadConflicts(pid)` |
| Tab switch | passive; show stale indicator with refresh if `lastFetched > 60s` |
| User refresh | re-fetch slices for current project |
| After mutation | refetch the affected slice |

### Mutations (write-through, no optimistic in v1)

```typescript
async function archiveInbox(ids: string[]) {
  store.set({ inbox: { ...store.inbox, status: 'loading' } })
  try {
    await Promise.all(ids.map(id => removeFromInbox(id)))
    await loadInbox(currentProjectId)
  } catch (e) {
    toast.error(`Archive failed: ${e.message}`)
    await loadInbox(currentProjectId)
  }
}
```

### Run-driven mutations

Backend writes happen after worker `_finalize`, not synchronously with click. Pattern:

```typescript
async function startVerify(claim: Claim) {
  const { run_id } = await createRun({
    kind: 'verify',
    project_id: currentProjectId,
    input: { claim_id: claim.id, claim: { text: claim.text, citations: claim.citations } },
  })
  trackRun(run_id, claim.id)
}
```

`trackRun` registers a per-run subscription: on terminal `succeeded`, refetch the affected slice (verify→claims, extract→claims, conflict→conflicts, draft→runs only).

### Slice modules

`extension/src/sidebar/state/`:
- `useStore.ts` — root combine.
- `slices/auth.ts` — mirror of `shared/auth.ts` state.
- `slices/projects.ts`, `slices/claims.ts`, `slices/inbox.ts`, `slices/conflicts.ts`, `slices/runs.ts` — each with state + actions.
- `slices/ui.ts` — tab, settingsOpen, expandedIds, onboardingDone (persisted).

Splits the existing ~400-LoC monolith into single-purpose, independently testable units.

### Schema versioning

`rk_schema_version` key in `chrome.storage.local`. On absent or older value, wipe domain caches and write current version (`2`). No migration logic.

## 7. Tab Implementations

### VerifyTab

- Source: `claims.data.filter(c => c.status === 'pending' || matches active filter)`.
- Verify button → `startVerify(claim)`; row subscribes to `useRunStream(runIdForClaim)` for live progress.
- Save button → `patchClaim(id, {status:'saved'})` then `addToInbox(projectId, id)`.
- Expand state → `ui.expandedIds` Set.

### InboxTab

- Source: `inbox.data` joined client-side with `claims.data` (resolve `claim_id`).
- Toggle select → `ui.toggleInboxSelected(id)`.
- Single remove → `removeFromInbox(item.id)`.
- Bulk archive → `archiveInbox([...selectedIds])`.
- Add to project → `ProjectPicker` modal → `Promise.all(selectedIds.map(id => addToInbox(targetProjectId, claimIdOf(id))))`, refresh.

### ConflictsTab

- Source: `conflicts.data`.
- Per-conflict card with sides side-by-side.
- "Suggest resolution" (when no `resolution.suggestion` exists) → `createRun({kind:'conflict', input:{conflict_id, group_key, sides}})`; on success refresh shows suggestion.
- "Accept side X" / "Custom" → `patchConflict(id, {resolution: ResolutionPayload})`.
- Resolution payload (in `shared/types.ts`):
  ```typescript
  type ResolutionPayload =
    | { kind: 'accept_side', side_id: string, note?: string }
    | { kind: 'reject_all', note: string }
    | { kind: 'suggestion', text: string, rationale: string }  // worker writes
  ```

### ChatTab

Layout: ActiveContextStrip + scrolling message list + input row.

State per project, stored under `chat:{projectId}` in `chrome.storage.local`:
```typescript
type ChatThread = { messages: Array<{role, content, runId?, toolCalls?}> }
```

Send flow:
1. Append user message.
2. `createRun({kind:'chat', project_id, input:{messages: thread.messages}})`.
3. `useRunStream(runId)` accumulates tokens into a draft assistant message.
4. On `succeeded`: finalize message with `getRun(runId).result.text`, persist thread.
5. On `failed`: error bubble + retry button.

Cancel button → `cancelRun(runId)`.

### DraftTab

Layout: source claim picker (from inbox) + style selector + Generate + streaming markdown view + Copy/Save.

Generate flow:
1. Extension resolves selected `inbox_claim_ids` → full claim objects (already in `claims.data` cache) → `createRun({kind:'draft', project_id, input:{claims: [...], style}})`. Worker doesn't refetch from DB — keeps run input self-contained and deterministic.
2. `useRunStream` accumulates tokens; render with `react-markdown` (verify dependency in plan).
3. Save → persist final markdown to `chrome.storage.local` under `drafts:{projectId}`.

### App.tsx wiring (the seven TODOs)

| TODO | Implementation |
|---|---|
| `handleArchive` | `archiveInbox(ids)` |
| `handleAddToProject` | `ProjectPicker` modal → `addManyToProject` |
| `handleResolveConflict` | `patchConflict` |
| `expandedIds` / `onToggleExpand` | `ui.expandedIds` slice |
| `onSave` | `saveClaim` (patch + addToInbox) |
| `onToggleSelect` (inbox) | `ui.toggleInboxSelected` |
| `onCreateProject` | `ProjectCreateModal` → `createProject` |

### New component / hook files

- `components/tabs/ChatTab.tsx`, `components/tabs/DraftTab.tsx` (replace placeholders)
- `components/atoms/MessageBubble.tsx`
- `components/atoms/MarkdownView.tsx`
- `components/atoms/ProjectCreateModal.tsx`
- `components/atoms/ConflictResolutionPanel.tsx`
- `hooks/useRunStream.ts`
- `hooks/useAuth.ts`
- `hooks/useToast.ts` (if not present)

## 8. Error Handling, Testing, Rollout

### Error taxonomy

| Source | Class | UI surface |
|---|---|---|
| 401 anywhere | `AuthExpiredError` | auto-signOut → login gate, toast "Session expired" |
| Other 4xx | `ApiError(status, body)` | toast with body; no retry |
| 5xx / network | retry once with backoff; on persistent failure → toast "Server unavailable" |
| SSE drop | silent reconnect ≤30s; then "Connection lost, retrying…" banner |
| Worker `OutputParseError` | run `failed` `error.code='parse'` → "Agent returned invalid output" + Retry |
| Worker `UpstreamError` | run `failed` `recoverable=true` → Retry enabled |
| Worker timeout | `error.code='timeout'` → toast "Run timed out" |

Toasts via existing `Toast` atom plus `useToast()` hook.

### Tests

**Worker (pytest):**
- `tests/unit/test_result_parser.py` — round-trip per schema; malformed JSON → OutputParseError; code-fence stripping.
- `tests/unit/test_prompts.py` — `build_messages` shape per kind; system message contains schema; user message has expected fields.
- `tests/integration/test_run_writeback.py` — fake GoClaw response (mocked runner) → assert claims/conflicts table rows after `_finalize`.
- `tests/integration/test_parse_retry.py` — first call returns prose, second returns JSON → run succeeds.

**Backend:**
- Existing contract tests should still pass.
- Add: SSE `Last-Event-ID` resume returns events from given seq.

**Extension (vitest + @testing-library/react):**
- `shared/sse.test.ts` — split frames, multi-line `data:`, comments, `id:` extraction.
- `shared/auth.test.ts` — mock `chrome.identity.launchWebAuthFlow` + fetch; token persistence; `onAuthChange`.
- `shared/api.test.ts` — `apiFetch` injects header; 401 → signOut; 5xx → ApiError.
- `hooks/useRunStream.test.tsx` — mock async iterable; state transitions.
- `state/slices/*.test.ts` — each slice action against mocked api.
- `components/tabs/ChatTab.test.tsx` — send → run created → tokens stream → message finalized.
- `components/tabs/DraftTab.test.tsx` — generate → markdown rendered → save persists.

**Manual E2E checklist (no automation in scope):**
1. Sign in with Google → see project list.
2. Open Elicit; extract claims → claims appear in Verify tab.
3. Click verify on a claim → progress visible → claim updates with verdict.
4. Save claim → appears in Inbox.
5. Select 2 inbox items → archive → both removed.
6. Open Chat → ask question → response streams.
7. Open Draft → select claims → generate → markdown appears → save.
8. Conflicts: trigger conflict run → suggestion appears → accept side → resolution stored.
9. Cancel mid-run → run state = cancelled.
10. Sign out → login gate returns.

### Rollout phases (handoff to writing-plans)

1. **Foundation** — worker prompts + result_parser + writeback + worker tests. Validate end-to-end via curl: `POST /v1/runs` then `GET /v1/runs/{id}/stream` produces a valid verify result with a real claim. Rollback gate: if GoClaw + prompts don't produce valid JSON consistently, fix prompts before extension work.
2. **Auth + api.ts rewrite** — extension can list projects/claims/inbox/conflicts; no mutations, no runs.
3. **Run streaming + Verify/Chat/Draft** — SSE client, `useRunStream`, three tabs operational.
4. **Mutations + remaining wiring** — archive/add-to-project/resolve/save/createProject/expand. Final E2E.

### Risk register

| Risk | Mitigation |
|---|---|
| Prompt JSON output unreliable | Single retry with stricter reminder; force provider JSON mode in GoClaw provider config where supported (document required provider). |
| Redirect URI mismatch | Pin extension ID via `manifest.key`; document Google Console setup. |
| SSE behind reverse proxy buffering | Verify `proxy_buffering off` if proxy added. Direct dev unaffected. |
| Worker writeback race | Idempotent set-state operations; safe under at-least-once. |
| Old `chrome.storage` collisions | `rk_schema_version=2` wipe-on-mismatch. |

## 9. Open Questions

None at design time. All choices ratified in brainstorm Q1–Q8 with subsequent re-check against the GoClaw architecture.
