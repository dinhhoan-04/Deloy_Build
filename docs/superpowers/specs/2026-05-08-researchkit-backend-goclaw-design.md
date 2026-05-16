# ResearchKit Backend + GoClaw Integration — Design Spec

**Date:** 2026-05-08
**Status:** Draft — pending implementation plan
**Scope:** Backend infrastructure (FastAPI + Postgres + Redis + arq worker) and GoClaw agent integration. No new feature UI in this scope.
**Predecessors:**
- `2026-05-07-researchkit-pipeline-design.md` (Phase 1 MVP)
- `2026-05-07-researchkit-phase2-foundation-design.md` (Phase 2 sidebar shell)

**Successor:** Phase 2.5 feature specs (Conflicts UI, Context-aware Chat, Draft) — built on top of this infrastructure.

---

## 1. Goal & Scope

### 1.1 Goal

Replace the direct-LLM FastAPI prototype with a server-of-record backend that:

1. Owns all persistent state (users, projects, claims, inbox, conflicts, runs).
2. Authenticates users via Google OAuth.
3. Routes **all** LLM calls through a self-hosted **GoClaw** agent gateway (no GoClaw customization — vanilla deployment).
4. Streams agent output to the extension via Server-Sent Events with reconnect/replay guarantees.
5. Persists every agent run as an immutable event log in Postgres for audit and replay.

### 1.2 In Scope

- FastAPI gateway: auth, projects, claims, inbox, conflicts (CRUD), runs (POST + SSE).
- arq worker: executes runs by invoking GoClaw and broadcasting events.
- Postgres schema (Alembic-managed) for all server-of-record data.
- Redis: cache, arq queue, pub/sub fanout for streaming.
- GoClaw container with 5 pre-configured agents (verify / extract / chat / draft / conflict). Bootstrapped declaratively via `goclaw-cli` from checked-in YAML.
- docker-compose stack (`postgres`, `goclaw_postgres`, `redis`, `goclaw`, `goclaw_bootstrap`, `backend`, `worker`).
- Extension changes: API client layer, Google sign-in, source-of-truth shift from `chrome.storage` to server, schema-version-3 wipe migration.
- Verify pipeline rewired through new run subsystem (kind=`verify`, kind=`extract`).
- Test suite: unit, integration (testcontainers + MockRunner), contract test against GoClaw.

### 1.3 Out of Scope (defer to Phase 2.5)

- Chat UI (context-aware), Draft UI, Conflicts resolution UI. Backend kinds (`chat`, `draft`, `conflict`) are scaffolded with prompt templates + tests but not wired to extension UI in this scope.
- Production deployment (HTTPS, domain, secrets manager, backups). Target this scope: docker-compose dev/VPS-dev only.
- Migration of existing `chrome.storage` user data — explicit decision: **wipe and start fresh** on schema-version-3 upgrade.
- Multi-device sync, offline-first conflict resolution beyond the simple retry queue.
- Prometheus / OpenTelemetry. Log-based metrics only.
- Rate limiting beyond input size caps (Redis-based per-user limits noted as follow-up).

### 1.4 Principles (preserved)

- **Suggest, don't force** — no automation without an off-switch.
- **Persist-before-publish** — every streamed event is durable in Postgres before it hits Redis.
- **Adapter at every external boundary** — `AgentRunner` ABC isolates GoClaw; no GoClaw types leak into routers/models.
- **Server is source of truth** — extension state (projects, inbox, claims, conflicts) loads from server post-login; local cache is for UX only.
- **Idempotent everywhere** — every mutating endpoint accepts an idempotency key where retries can occur.

---

## 2. Architecture

```
┌─────────────────┐
│  Extension      │  Sidebar + content scripts
│  (Chrome MV3)   │  - chrome.identity.getAuthToken (Google)
└────────┬────────┘  - SSE client per run
         │ HTTPS (Bearer = session_token)
         ▼
┌─────────────────────────────────────────────┐
│  FastAPI gateway (stateless)                │
│  - /v1/auth/*  /v1/projects  /v1/claims     │
│  - /v1/inbox  /v1/conflicts  /v1/runs       │
│  - SSE handler: replay PG → tail Redis      │
└──┬───────────────────┬──────────────────┬───┘
   │ SQLAlchemy        │ arq enqueue      │ pub/sub
   ▼                   ▼                  │
┌────────┐      ┌────────────┐        ┌───┴───┐
│Postgres│      │ arq worker │───────▶│ Redis │
│ (rk)   │◀─────│ runners/   │        │ run:* │
└────────┘      │ event_bus  │        └───────┘
                └─────┬──────┘
                      │ HTTP (OpenAI-compatible streaming)
                      ▼
                ┌─────────────┐    ┌────────────┐
                │   GoClaw    │───▶│ goclaw_pg  │  (pgvector)
                │  vanilla    │    └────────────┘
                └─────────────┘
```

**Layer responsibilities:**

- **FastAPI** — stateless gateway; never calls LLM SDKs directly; never holds in-memory user state.
- **Worker (arq)** — sole component that talks to GoClaw; sole writer of `run_events`.
- **Postgres (`rk`)** — source of truth for server-owned data.
- **Redis** — arq queue, JWKS/session cache, pub/sub channels (`run:{id}`, `cancel:{id}`).
- **GoClaw** — vanilla gateway; pre-configured agents per `kind`; isolates per `X-GoClaw-User-Id`.
- **GoClaw Postgres** — internal to GoClaw, not accessed by our code.

**Containers** (one docker-compose network, only `backend` exposes a port):
`postgres`, `goclaw_postgres`, `redis`, `goclaw`, `goclaw_bootstrap` (one-shot), `backend`, `worker`.

---

## 3. Data Model

### 3.1 Postgres schema (Alembic-managed)

```sql
-- AUTH
users (
  id UUID PK,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)

sessions (
  token_hash TEXT PK,                         -- sha256(session_token)
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL
)
CREATE INDEX ON sessions(user_id);
CREATE INDEX ON sessions(expires_at);

-- PROJECT WORKSPACE
projects (
  id UUID PK,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
CREATE INDEX ON projects(user_id);

claims (
  id UUID PK,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  paper_title TEXT,
  doi TEXT,
  paper_url TEXT,
  page TEXT,
  site TEXT NOT NULL,                         -- 'elicit'|'scispace'|'consensus'
  status TEXT NOT NULL,                       -- 'pending'|'verified'|'partial'|'not_found'|'error'
  confidence REAL,
  quote TEXT,
  reason TEXT,
  page_url TEXT,
  extracted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
CREATE INDEX ON claims(project_id, status);
CREATE INDEX ON claims(doi);

inbox_items (
  id UUID PK,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, claim_id)
)

conflicts (
  id UUID PK,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doi TEXT,
  group_key TEXT NOT NULL,
  paper_title TEXT,
  flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolution TEXT,
  sides JSONB NOT NULL                        -- ConflictSide[]
)
CREATE INDEX ON conflicts(project_id);

-- AGENT RUNS
runs (
  id UUID PK,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                         -- 'verify'|'extract'|'chat'|'draft'|'conflict'
  status TEXT NOT NULL,                       -- 'queued'|'running'|'cancelling'|'succeeded'|'failed'|'cancelled'
  input JSONB NOT NULL,
  result JSONB,
  error JSONB,                                -- {message, recoverable, code}
  goclaw_run_id TEXT,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE(user_id, idempotency_key)
)
CREATE INDEX ON runs(user_id, created_at DESC);
CREATE INDEX ON runs(status) WHERE status IN ('queued','running','cancelling');

run_events (
  id BIGSERIAL PK,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL,                         -- 'token'|'tool_call'|'tool_result'|'status'|'error'|'final'|'log'
  payload JSONB NOT NULL,
  UNIQUE(run_id, seq)
)
CREATE INDEX ON run_events(run_id, seq);

-- CACHE (optional Postgres mirror; primary cache in Redis)
verify_cache (
  doi TEXT NOT NULL,
  claim_hash TEXT NOT NULL,                   -- sha256(normalized_claim_text)
  result JSONB NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doi, claim_hash)
)
```

**Row-level isolation:** every repository query filters on `user_id = current_user.id`. Enforced in repository layer (no Postgres RLS). All FK ON DELETE CASCADE so deleting a user wipes their data atomically.

### 3.2 Pydantic / TypeScript types

The shared Python package `rk_shared` defines enums + TypedDicts for `RunKind`, `RunStatus`, `RunEvent`, `ClaimStatus`, `Site`. Extension keeps existing `verify-types.ts` but adds server-mirror types in `src/api/types.ts` matching Pydantic schemas one-to-one.

---

## 4. Run lifecycle

### 4.1 Sequence

```
T0  Extension POST /v1/runs
    body: {kind, input, project_id?, idempotency_key}
    Authorization: Bearer <session_token>

T1  FastAPI:
    - resolve current_user via session token
    - if (user_id, idempotency_key) exists → return existing run
    - INSERT runs (status='queued')
    - arq.enqueue('execute_run', run_id)
    - 201 {run_id, status:'queued', stream_url:'/v1/runs/{id}/stream'}

T2  Extension opens SSE GET /v1/runs/{id}/stream?last_seq=0
    server replies with SSE headers; per-event format:
      event: run_event
      id: <seq>
      data: {"seq": N, "type": "...", "payload": {...}, "ts": "..."}

T3  FastAPI SSE handler:
    a. validate run belongs to current_user
    b. SELECT * FROM run_events WHERE run_id=? AND seq>last_seq ORDER BY seq
       → stream each as SSE; track max_seq_sent
    c. SUBSCRIBE redis channel "run:{id}"
    d. for each redis msg: if msg.seq > max_seq_sent → emit; update max_seq_sent
    e. on type in ('final','error','cancelled') → flush, close
    f. on client disconnect → unsubscribe; run continues server-side

T4  Worker picks up job:
    - re-read run; if status terminal → return (idempotent retry)
    - UPDATE status='running', started_at=now()
    - publish_event(type='status', payload={status:'running'})
    - build_messages(kind, input)
    - GoClawRunner.run(...) — streams chunks; for each chunk:
        publish_event(type, payload)        # persist + broadcast atomic-ish
        check cancel_token between chunks
    - on success: UPDATE status='succeeded', result=...; publish_event('final', result)
    - on cancel: UPDATE status='cancelled'; publish_event('status', {status:'cancelled'})
    - on error: UPDATE status='failed', error=...; publish_event('error', {message, recoverable})
```

### 4.2 Invariants (each is a test case)

1. **Persist-before-publish.** Worker always inserts `run_events` row first, then publishes to Redis. If publish fails, event is still replayable from Postgres.
2. **Monotonic seq.** Allocated by `INSERT INTO run_events ... RETURNING seq` using a counter computed inside the same DB transaction (advisory lock per run_id, or `SELECT COALESCE(MAX(seq),0)+1 FOR UPDATE`). Never derived from Redis.
3. **Replay-then-tail without dup.** SSE handler completes Postgres replay before subscribing Redis; client filters anything `<= max_seq_sent` in the overlap window. Tested by injecting publishes during replay.
4. **Idempotency window.** `(user_id, idempotency_key)` UNIQUE — a second POST returns the existing run; conflicting payload returns 409 `ConflictError`.
5. **Cancel is cooperative + bounded.** `POST /v1/runs/{id}/cancel` → set `status='cancelling'` and `redis.SET cancel:{id} 1 EX 300`. Worker checks `cancel_token.is_set()` between every chunk; raises `CancelledByUser`. Test asserts cancel completes within 2s on a runner emitting chunks every 100ms.
6. **Timeouts per kind.** `KIND_TIMEOUTS = {verify:30, extract:30, chat:60, draft:180, conflict:60}` (seconds). Worker enforces via `asyncio.timeout`; failure becomes `error.code='timeout'`.
7. **Worker crash + retry.** arq `max_tries=2`. Task entry checks `status in ('succeeded','failed','cancelled')` and returns no-op. If `status='running'` on retry (worker died mid-run): event log already has partial events; task resets to `running`, continues. (Note: GoClaw streams cannot be resumed; partial-run on retry yields a fresh GoClaw call, and the new events continue the same `seq` sequence — clients see this as continued streaming.)
8. **GoClaw outage during run.** UpstreamError → `error.recoverable=true` published; client may POST a new run with the same input (new idempotency key).

### 4.3 SSE wire format

```
event: run_event
id: 5
data: {"seq":5,"type":"token","payload":{"text":"hello"},"ts":"2026-05-08T12:00:00Z"}

event: run_event
id: 6
data: {"seq":6,"type":"final","payload":{...result...},"ts":"..."}
```

`id` is the SSE message ID (mirrors `seq`); browsers send `Last-Event-ID` on reconnect, which the handler uses as `last_seq` if the query param is absent.

---

## 5. Authentication

### 5.1 Flow

1. Extension calls `chrome.identity.getAuthToken({interactive:true})` → Google ID token (JWT).
2. Extension `POST /v1/auth/login` with `{google_id_token}`.
3. FastAPI verifies signature against Google JWKS (cached 1h in Redis); checks `aud == GOOGLE_CLIENT_ID`, `iss`, `exp`.
4. Upsert `users` row by `google_sub`.
5. Issue `session_token = secrets.token_urlsafe(32)`; store `sha256(token)` in `sessions` with 24h TTL and sliding renewal (`last_used_at` updated on each request; if `last_used_at + 24h > expires_at` extend).
6. Return `{session_token, user, expires_at}` to extension; extension stores in `chrome.storage.local`.

All subsequent calls use `Authorization: Bearer <session_token>`. Middleware dependency `current_user` performs lookup; cached 60s in Redis under `session:{hash}` to avoid DB read on every request.

### 5.2 Logout

`POST /v1/auth/logout` deletes the session row; extension clears local storage and calls `chrome.identity.removeCachedAuthToken`.

### 5.3 Dev bypass

When `ENV=development` and `DEV_AUTH_BYPASS=true`, FastAPI accepts `X-Dev-User: <email>` and synthesizes a session for that user (creating the user row if absent). Disabled by default; gated by both env flags.

### 5.4 Manifest changes

```json
{
  "permissions": ["identity", "storage", "activeTab"],
  "oauth2": {
    "client_id": "<from env at build>",
    "scopes": ["openid","email","profile"]
  },
  "host_permissions": ["https://api.researchkit.local/*", "http://localhost:8000/*"]
}
```

---

## 6. GoClaw integration

### 6.1 Confirmed surface (researched against `nextlevelbuilder/goclaw`)

- `POST /v1/chat/completions` — OpenAI-compatible, streaming via SSE (`data: {...}` + `data: [DONE]`).
- `POST /v1/agents/{id}/wake` — fire an agent invocation; returns `{content, run_id, usage}`.
- Auth: `Authorization: Bearer <gateway_token>`.
- Multi-tenant: `X-GoClaw-User-Id`, `X-GoClaw-Tenant-Id`, `X-GoClaw-Agent-Id`.
- Postgres 18 + pgvector (its own DB, separate from ours).
- Session/run history endpoints are WebSocket-RPC only — **not used**; we own session/history in `runs` + `run_events`.

### 6.2 Pre-configured agents

Five agents declared in `infra/goclaw/agents/*.yaml`, one per kind:

```
verify.yaml     model preference, system prompt, tools (web fetch, OpenAlex stub)
extract.yaml    model, prompt, no tools
chat.yaml       model, prompt, tool: search_inbox
draft.yaml      model, prompt, tool: get_inbox_items
conflict.yaml   model, prompt, no tools
```

`infra/goclaw/bootstrap.sh` runs `goclaw-cli` against the GoClaw container at startup (idempotent: upsert by stable agent name); checked into git; runs as a `goclaw_bootstrap` one-shot service in compose.

### 6.3 Worker → GoClaw call

Worker uses the OpenAI Python SDK with `base_url` pointed at GoClaw:

```python
client = AsyncOpenAI(
    base_url=f"{settings.GOCLAW_URL}/v1",
    api_key=settings.GOCLAW_TOKEN,
    default_headers={
        "X-GoClaw-User-Id": str(user_id),
        "X-GoClaw-Agent-Id": AGENT_IDS[kind],
        "X-Request-Id": request_id,
    },
)
async with client.chat.completions.stream(
    model=f"goclaw:{AGENT_IDS[kind]}",
    messages=messages,
) as stream:
    async for event in stream:
        if event.type == "content.delta":
            await on_event({"type":"token", "payload":{"text": event.delta}})
        elif event.type == "tool_call.created":
            await on_event({"type":"tool_call", "payload":{...}})
        # ... map other event types
        if cancel_token.is_set():
            raise CancelledByUser()
final = await stream.get_final_completion()
return parse_final(kind, final)
```

### 6.4 Runner abstraction

```
worker/runners/
├─ base.py        AgentRunner Protocol; RunEvent TypedDict; CancelToken
├─ goclaw.py      GoClawRunner — concrete; targets contract above
└─ mock.py        MockRunner — deterministic event sequences for tests
```

Routers and event_bus depend only on `AgentRunner` and `RunEvent`. Swapping GoClaw for another gateway is a single-file change.

### 6.5 Smoke gate

The first task of the implementation plan is a contract smoke test: spin up `goclaw` + `goclaw_bootstrap`, run a Python script that calls `/v1/chat/completions` with one of the five agents and asserts a streamed response. **The plan does not proceed past this gate until smoke passes.** Until then, all other work uses `MockRunner`.

---

## 7. FastAPI endpoints

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/health` | — | `{status:"ok"}` |
| GET | `/health/ready` | — | 200 if PG+Redis+GoClaw OK, else 503 |
| GET | `/v1/openapi.json` | — | OpenAPI |
| POST | `/v1/auth/login` | `{google_id_token}` | `{session_token,user,expires_at}` |
| POST | `/v1/auth/logout` | — | 204 |
| GET | `/v1/auth/me` | — | `{user}` |
| GET | `/v1/projects` | — | `Project[]` |
| POST | `/v1/projects` | `{name}` | `Project` |
| PATCH | `/v1/projects/{id}` | `{name?}` | `Project` |
| DELETE | `/v1/projects/{id}` | — | 204 |
| POST | `/v1/claims/batch` | `{project_id, claims:[ClaimInput], idempotency_key?}` | `{created,updated}` |
| GET | `/v1/claims` | `?project_id=&status=&limit=&cursor=` | paginated `Claim[]` |
| PATCH | `/v1/claims/{id}` | `{status?,quote?,confidence?,reason?,page?}` | `Claim` |
| GET | `/v1/inbox` | `?project_id=` | `InboxItem[]` |
| POST | `/v1/inbox` | `{project_id, claim_id}` | `InboxItem` |
| DELETE | `/v1/inbox/{id}` | — | 204 |
| GET | `/v1/conflicts` | `?project_id=` | `ConflictItem[]` |
| POST | `/v1/conflicts` | `{project_id, group_key, sides[]}` | `ConflictItem` |
| PATCH | `/v1/conflicts/{id}` | `{resolution}` | `ConflictItem` |
| POST | `/v1/runs` | `{kind, input, project_id?, idempotency_key}` | `201 {run_id,status,stream_url}` |
| GET | `/v1/runs/{id}` | — | `Run` |
| GET | `/v1/runs/{id}/stream` | `?last_seq=` | SSE |
| POST | `/v1/runs/{id}/cancel` | — | 202 |

**Conventions:**
- All except `/health`, `/health/ready`, `/v1/auth/login`, `/v1/openapi.json` require Bearer auth.
- Pagination cursor is opaque base64 of `(created_at, id)` tuple.
- Errors: `{error: {code, message, details?}}` with appropriate HTTP status.
- Idempotency-bearing endpoints: `POST /v1/runs`, `POST /v1/claims/batch`.
- Input caps: `claims/batch` ≤ 100 items; each claim text ≤ 4 KB; total payload ≤ 512 KB.

**In-scope wiring:** auth, projects, claims, inbox, runs (verify + extract). Conflicts endpoints + runs (chat / draft / conflict) are implemented and tested but extension UI consumes them only at Phase 2.5.

---

## 8. Worker (arq) design

### 8.1 Layout

```
worker/
├─ main.py                # WorkerSettings, function registry
├─ tasks.py               # @arq tasks: execute_run
├─ runners/
│  ├─ base.py
│  ├─ goclaw.py
│  └─ mock.py
├─ event_bus.py           # EventBus: persist+publish
├─ prompts/
│  ├─ verify.py           # build_messages(input) → list[ChatMessage]
│  ├─ extract.py
│  ├─ chat.py
│  ├─ draft.py
│  └─ conflict.py
├─ db.py
└─ tests/
```

### 8.2 Settings

- `max_jobs = 8` per worker (tunable). Multiple replicas for scale-out.
- `job_timeout = max(KIND_TIMEOUTS) + 30` safety.
- `max_tries = 2`. Task is idempotent (terminal-status early exit).
- Worker writes heartbeat key `worker:hb:{worker_id}` every 30s, TTL 60s; backend `/health/ready` counts live workers.

### 8.3 EventBus

```python
class EventBus:
    def __init__(self, run_id: UUID): ...

    async def publish(self, event: RunEvent) -> int:
        # returns assigned seq
        async with db.session.begin() as s:
            seq = await s.scalar(advisory_xact_lock(run_id))     # serialize per-run
            seq = (await s.scalar(select(func.coalesce(func.max(RunEventRow.seq), 0))
                                  .where(RunEventRow.run_id == run_id))) + 1
            s.add(RunEventRow(run_id=run_id, seq=seq, type=event.type,
                              payload=event.payload, ts=now()))
        await redis.publish(f"run:{run_id}", json.dumps({"seq": seq, **event}))
        return seq
```

Lock chosen over `RETURNING` to keep semantics explicit and easy to test. Throughput is acceptable since `seq` allocation is per-run, not global.

### 8.4 Cancel mechanism

Worker constructs `CancelToken(run_id)` backed by `redis.GET cancel:{run_id}`; checks every chunk inside `GoClawRunner` and at the start of each tool round-trip. `POST /v1/runs/{id}/cancel` writes the key (TTL 300s) and updates `status='cancelling'`.

---

## 9. Extension changes

### 9.1 New modules

```
src/api/
├─ client.ts        # fetchWithAuth, error mapping, retry policy
├─ auth.ts          # loginWithGoogle, refresh, logout
├─ projects.ts
├─ claims.ts
├─ inbox.ts
├─ conflicts.ts
└─ runs.ts          # createRun, openStream (EventSource w/ Last-Event-ID)

src/state/
├─ authSlice.ts     # session_token, user, status
└─ syncSlice.ts     # offline mutation queue (inbox.add, claim.update only)
```

### 9.2 Server-of-record shift

`chrome.storage.local` after migration holds **only** UI/preferences:

```
session_token, user_summary, verifyEnabled, activeSites, pausedSites,
provider, autoVerify, verifyDelay, onboardingDone, currentProjectId,
schemaVersion: 3
```

`projects`, `inboxItems`, `conflicts`, and claim data are fetched from server. React Query (`@tanstack/react-query`) handles cache + refetch + mutation lifecycle. Optimistic updates write to query cache; rollback on error with toast.

### 9.3 Verify pipeline rewire

```
content.ts extracts claims
   ↓ message
background_minimal:
   for each claim batch (debounced):
     POST /v1/claims/batch          # persist; receives claim_ids
     for each claim_id:
       POST /v1/runs (kind=verify, input={claim_id})
       open EventSource on /v1/runs/{id}/stream
       on type=='final': PATCH /v1/claims/{id} not needed — server already wrote it
                         broadcast to sidebar
       on type=='error': mark claim status='error', broadcast
```

The legacy `/verify` and `/extract` FastAPI endpoints are **removed**.

### 9.4 Migration to schema v3

```ts
async function migrate(): Promise<void> {
  const v = (await chrome.storage.local.get('schemaVersion')).schemaVersion ?? 1
  if (v < 3) {
    await chrome.storage.local.clear()
    await chrome.storage.local.set({ schemaVersion: 3 })
    showToast('Local data reset for new server-backed version. Please sign in.', 'warning')
  }
}
```

Runs once at extension load, before mounting Sidebar.

---

## 10. Repo layout & docker-compose

### 10.1 Layout

```
research-kit/
├─ extension/                  (UI — Phase 2 Foundation + new src/api, src/state additions)
├─ backend/                    (FastAPI; rewrite of current main_openai.py)
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ config.py
│  │  ├─ db.py
│  │  ├─ deps.py
│  │  ├─ models/
│  │  ├─ schemas/
│  │  ├─ routers/{auth,projects,claims,inbox,conflicts,runs}.py
│  │  ├─ auth/{google,session}.py
│  │  ├─ events/{replay,pubsub}.py
│  │  ├─ queue.py
│  │  └─ errors.py
│  ├─ alembic/
│  ├─ tests/
│  └─ pyproject.toml
├─ worker/                     (arq runner)
├─ shared/rk_shared/           (Python package: ORM, types, RunEvent — single source)
└─ infra/
   ├─ docker-compose.yml
   ├─ docker-compose.dev.yml   # override
   ├─ Dockerfile.backend
   ├─ Dockerfile.worker
   ├─ goclaw/
   │  ├─ agents/{verify,extract,chat,draft,conflict}.yaml
   │  └─ bootstrap.sh
   └─ .env.example
```

### 10.2 Compose services

```yaml
services:
  postgres:           # rk DB
  goclaw_postgres:    # pgvector/pgvector:pg18 — GoClaw internal
  redis:
  goclaw:             # ghcr.io/nextlevelbuilder/goclaw:<pinned-tag>
  goclaw_bootstrap:   # one-shot, depends on goclaw healthy
  backend:            # uvicorn; entrypoint runs alembic upgrade head first
  worker:             # arq
```

Only `backend` exposes a port (8000). Network internal; volumes for both Postgres datadirs and Redis AOF.

### 10.3 .env.example (key vars)

```
ENV=development
DATABASE_URL=postgresql+asyncpg://rk:rk@postgres:5432/rk
GOCLAW_DATABASE_URL=postgresql://goclaw:goclaw@goclaw_postgres:5432/goclaw
REDIS_URL=redis://redis:6379/0
GOCLAW_URL=http://goclaw:8080
GOCLAW_TOKEN=<gateway token>
GOOGLE_CLIENT_ID=
SESSION_SECRET=<32+ random bytes>
DEV_AUTH_BYPASS=false
```

---

## 11. Errors, observability, security

### 11.1 Error taxonomy

| Class | HTTP | Retryable | Notes |
|---|---|---|---|
| `AuthError` | 401 | no | invalid/expired session |
| `PermissionError` | 403 | no | cross-user access |
| `NotFoundError` | 404 | no | |
| `ValidationError` | 400 | no | Pydantic, size caps |
| `ConflictError` | 409 | no | idempotency key with different payload |
| `RateLimitError` | 429 | yes | follow-up; not enforced this scope |
| `UpstreamError` | 502 | yes | GoClaw 5xx / timeout |
| `InternalError` | 500 | no | unexpected |

Worker maps exceptions via `is_recoverable(exc)` into `error.recoverable`.

### 11.2 Logging

- `structlog` JSON logs.
- Every log line carries `request_id`, `user_id` (if authed), `run_id` (if applicable), `kind`.
- `request_id` generated by FastAPI middleware, propagated to arq job context, then to GoClaw via `X-Request-Id`.
- Levels: INFO lifecycle / WARN retryable / ERROR 5xx + worker exceptions.
- **Never log claim text, quote text, chat content, or draft output.** Log lengths and counts only.

### 11.3 Health & readiness

- `GET /health` always 200 (liveness).
- `GET /health/ready` checks PG ping, Redis ping, GoClaw `/health`, ≥1 live worker heartbeat. Returns 503 with details on fail.

### 11.4 Security

- HTTPS in prod (out of scope here, but config-ready).
- Session token plaintext only in transit; DB stores sha256.
- Postgres / Redis / GoClaw never exposed beyond compose network in deployed env.
- CORS: allow `chrome-extension://<ID>` and (dev) `http://localhost:5173`.
- Input caps as in §7.
- Secrets via env; never logged. `goclaw bootstrap` script reads `GOCLAW_TOKEN` from env.

### 11.5 Metrics

Counter wrappers in `app/metrics.py`: `run_started`, `run_finished{status}`, `sse_connected/disconnected`, `goclaw_call{status}`, `auth_login{result}`. Backed by structlog now; trivially swappable to Prometheus later.

---

## 12. Testing

### 12.1 Layers

1. **Unit (no I/O).** Pydantic schemas, error mapping, prompt builders, EventBus seq logic with mocked DB, idempotency dedup.
2. **Integration (testcontainers: postgres + redis; MockRunner).** Full lifecycle: POST → worker → SSE replay → final state. **Each invariant from §4.2 has a dedicated test.**
3. **Contract (live GoClaw).** `tests/contract/` tagged `@pytest.mark.contract`, skipped unless `GOCLAW_URL` set. Smoke: stream a chat completion against the verify agent.
4. **E2E (deferred wiring; minimal scaffold).** Playwright stub with one happy-path: login → create project → batch claims → POST verify run → stream → claim updated.

### 12.2 Coverage target

Backend + worker unit + integration ≥ 70% lines. Visibility only; no CI gate this scope.

### 12.3 Fixtures

- `factory_boy` for ORM rows.
- `httpx.MockTransport` for any synchronous external call (OpenAlex if reused).
- `MockRunner` accepts a script of `RunEvent` with delays for streaming-shaped tests.

---

## 13. Open Questions (resolve during plan)

- Exact GoClaw image tag to pin (resolve in smoke gate).
- Best advisory lock granularity for `seq` allocation (per-run via `pg_advisory_xact_lock(hashtext(run_id::text))` is the proposed default; benchmark during integration).
- Whether to add `verify_cache` reads at runner-entry to skip GoClaw calls for repeat DOIs (proposed: yes for `kind=verify` only; cache TTL 30 days).
- Google OAuth client_id provisioning (prod and dev): action item before merging plan.

---

## 14. Out of Scope (explicit)

- Conflicts resolution UI, Chat UI, Draft UI (Phase 2.5).
- HTTPS/domain/secrets-manager/backups (production deployment spec).
- Cross-device sync, conflict resolution beyond simple inbox/claim retry queue.
- Prometheus / OTel.
- Rate limiting (follow-up).
- WebSocket-based GoClaw session protocol (deliberately unused).
