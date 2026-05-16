# Brainstorm Notes — Backend + GoClaw Integration

**Date:** 2026-05-08
**Companion to:** `2026-05-08-researchkit-backend-goclaw-design.md`
**Purpose:** Record the Q&A and decisions reached during brainstorming, so the rationale is preserved beyond the spec itself.

---

## Context entering the session

- Phase 1 MVP and Phase 2 Foundation (sidebar UI shell) shipped (commit `93050e1`).
- Backend currently a direct-LLM FastAPI prototype (`main_openai.py`), all state in `chrome.storage.local`.
- User's stated direction: GoClaw as agent core (vanilla, host-only — no customization), backend = FastAPI + Redis + Postgres.

---

## Decisions log

### Q1 — Scope of this round

**Options offered:**
- A. GoClaw integration + backend infra only (no Chat/Draft/Conflicts UI yet)
- B. Build one feature end-to-end first to validate
- C. Full Phase 2.5 features at once
- D. Other

**Decision: A.** Infra-only round. Chat/Draft/Conflicts kinds are scaffolded with prompts + tests but UI wiring deferred to Phase 2.5.

---

### Q2 — Role of Postgres

**Options offered:**
- A. Server of record — Inbox/Projects/Claims/Conflicts sync to PG; chrome.storage becomes cache; needs user/auth.
- B. Only agent artifacts (verify cache, runs, drafts); inbox/projects stay local-first.
- C. Hybrid — agent + verify cache server-side; inbox/projects local with optional `/sync`.
- D. Other.

**Decision: A.** Postgres is the source of truth. Auth is **Google OAuth**.

**Implications:**
- chrome.storage post-migration only holds preferences/UI state + session token.
- Schema-version-3 migration wipes existing local data (decision Y2 below).
- Every row in PG carries `user_id` for isolation.

---

### Q3 — GoClaw deployment & interface

**Options offered:**
- A. GoClaw HTTP API + shared docker-compose (FastAPI + GoClaw + PG + Redis on same VPS).
- B. GoClaw deployed independently, called over public HTTPS.
- C. Spawn GoClaw per-request (sidecar).
- D. Recommend.

**Decision: A.** Single docker-compose stack. Only `backend` exposes a port; `goclaw`, `postgres`, `redis` internal.

**Confirmed during research (see Q5):** GoClaw exposes HTTP REST (OpenAI-compatible) — no ambiguity.

---

### Q4 — What goes through GoClaw

**Options offered:**
- A. All LLM calls (verify, extract, chat, draft, conflict).
- B. Only agentic/multi-step (chat/draft/conflict); verify/extract stay direct.
- C. Only chat + draft.
- D. Other.

**Decision: A.** All LLM calls route through GoClaw. FastAPI no longer holds LLM SDK clients. Verify and Extract become server-side **runs** (`kind=verify`, `kind=extract`), invoked by extension via `POST /v1/runs`.

**Consequence:** Legacy `/verify` and `/extract` FastAPI endpoints are **removed** in this round.

---

### Q5 — Redis role

**Options offered:**
- A. Cache + rate-limit + session store.
- B. + job queue (arq) for long jobs.
- C. + pub/sub to fan out streaming events from worker → FastAPI → SSE.
- D. Recommend.

**Decision: D → C.** Redis covers cache + queue + pub/sub. Required because:
- Multi-instance FastAPI must reach the streaming output of any worker.
- arq is async-native and lightweight.
- Pub/sub is the natural transport for token-by-token chunks.

---

### Q6 — Deployment target & data migration

**Options offered:**
- 1A. docker-compose dev/VPS-dev only this round.
- 1B. Production deploy (HTTPS, domain, backups).
- 2X. Wipe & start fresh (no migration of existing local Inbox/Projects).
- 2Y. Migrate: extension uploads existing local data on first login.

**Decision: A + X.** Dev compose only. On schema-version bump 2 → 3, `chrome.storage.local.clear()` runs before mount, and a toast informs the user.

---

### Q7 — Run lifecycle architecture

**Approaches presented:**
1. **Synchronous proxy** — extension ↔ FastAPI ↔ GoClaw streaming in one HTTP request. Simple but loses output on disconnect; doesn't scale across FastAPI instances.
2. **Job + polling** — POST creates job, client polls `/jobs/{id}`. Survives disconnect; bad for token-streaming UX.
3. **Job + Redis pub/sub fanout** ⭐ recommended — POST → arq enqueues → worker invokes GoClaw → publishes chunks to Redis channel → FastAPI SSE handler subscribes per `run_id`. Persist-before-publish into Postgres for replay on reconnect.

**Decision: 3.** User accepted with explicit caution: *"phương án này phức tạp, lên spec và kế hoạch cẩn thận kẻo AI code ra lỗi"* — translated as a directive to write rigorous invariant tests for every property of the run lifecycle (each enumerated in §4.2 of the spec).

---

### Q8 — GoClaw interface contract (research-driven, replacing initial assumptions)

Original Section 5 of brainstorming proposed an adapter abstraction with a discovery spike. User redirected: *"đi research về GoClaw rồi quyết định cho chắc."*

**Research conducted:**
- GitHub: `nextlevelbuilder/goclaw` (the active gateway implementation).
- Docs: `docs.goclaw.sh`, in-repo `docs/18-http-api.md`.

**Confirmed surface:**
- `POST /v1/chat/completions` — OpenAI-compatible, SSE streaming.
- `POST /v1/agents/{id}/wake` — pre-configured agent invocation.
- Auth: `Authorization: Bearer <gateway_token>`.
- Multi-tenant headers: `X-GoClaw-User-Id`, `X-GoClaw-Tenant-Id`, `X-GoClaw-Agent-Id`.
- Postgres 18 + pgvector required (separate from our DB).
- Session/history endpoints are **WebSocket RPC only** — explicitly unused; we own session/history via `runs` + `run_events`.

**Decisions resulting from research:**
1. Pre-configure 5 agents in GoClaw (one per kind), declared in `infra/goclaw/agents/*.yaml`, bootstrapped via `goclaw-cli` in a `goclaw_bootstrap` one-shot service.
2. Worker uses **OpenAI Python SDK** with `base_url` pointed at GoClaw — no custom HTTP client.
3. Two separate Postgres containers: `postgres` (ours) and `goclaw_postgres` (GoClaw internal).
4. One gateway token shared by worker for all traffic; per-user isolation handled by `X-GoClaw-User-Id` header.
5. `runs.id` (our UUID) is canonical; `runs.goclaw_run_id` stored only for debug correlation.
6. `AgentRunner` ABC retained even though GoClaw is now concrete — keeps swap-out cheap (e.g. to LangGraph or Claude Agent SDK later).
7. **Smoke gate** = first task of implementation plan: stand up GoClaw, hit `/v1/chat/completions`, see streaming chunks. Plan halts here on failure.

**Sources:**
- [nextlevelbuilder/goclaw on GitHub](https://github.com/nextlevelbuilder/goclaw)
- [GoClaw HTTP API doc (in-repo)](https://github.com/nextlevelbuilder/goclaw/blob/main/docs/18-http-api.md)
- [docs.goclaw.sh](https://docs.goclaw.sh/)

---

## Walkthrough sections approved by user (in order)

1. **Architecture overview** — boxes & arrows, container list. ✅
2. **Data model** — Postgres schema (users, sessions, projects, claims, inbox_items, conflicts, runs, run_events, verify_cache); row-level isolation in repository layer; FK ON DELETE CASCADE. ✅
3. **Run lifecycle & event flow** — T0–T4 sequence; 8 invariants each backed by a test (persist-before-publish, monotonic seq, replay-then-tail no-dup, idempotency, cooperative cancel, per-kind timeouts, worker-crash idempotent retry, GoClaw outage recoverable flag). ✅
4. **Auth (Google OAuth)** — getAuthToken → ID token → server verifies via JWKS → issues HMAC session token (24h sliding). DEV_AUTH_BYPASS env-gated dev path. ✅
5. **GoClaw integration contract** — revised post-research; OpenAI SDK against `/v1/chat/completions`; 5 pre-configured agents; bootstrap one-shot; AgentRunner ABC kept for swap. ✅
6. **FastAPI endpoints** — full table; conventions for pagination, errors, idempotency, input caps. ✅
7. **Worker (arq) design** — runners/, prompts/, EventBus with advisory-lock seq allocation, cancel via Redis flag, heartbeat for readiness checks. ✅
8. **Extension changes** — `src/api/`, `src/state/auth+sync`, schema-v3 wipe migration, verify pipeline rewired through `/v1/runs`, React Query for server cache. ✅
9. **Repo layout & docker-compose** — flat monorepo (`backend/`, `worker/`, `shared/rk_shared/`, `infra/`); compose services and `.env.example`. ✅
10. **Errors, observability, security, testing** — error taxonomy, structlog with `request_id`/`user_id`/`run_id`, no PII in logs, health/readiness, CORS for chrome-extension, testcontainers integration tests + contract test against live GoClaw (skipped unless env set). ✅

---

## Items deliberately deferred (recorded for future)

- Production deployment spec (HTTPS, domain, secrets manager, backups).
- Conflicts/Chat/Draft UI wiring (Phase 2.5).
- Cross-device sync, offline conflict resolution beyond simple retry queue.
- Prometheus / OpenTelemetry.
- Per-user rate limiting.
- WebSocket-based GoClaw session protocol.

---

## Open questions to resolve during plan-writing

(Mirror of spec §13)

1. Exact GoClaw image tag to pin (verify in smoke gate).
2. Advisory lock granularity for seq allocation — proposed `pg_advisory_xact_lock(hashtext(run_id::text))`; benchmark during integration.
3. Whether to read `verify_cache` at runner entry to skip GoClaw for repeat DOIs (proposed: yes for `kind=verify`, TTL 30 days).
4. Google OAuth client_id provisioning for dev and prod (action item before merging plan).
