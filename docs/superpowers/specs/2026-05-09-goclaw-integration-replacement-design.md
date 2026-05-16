# GoClaw Integration Replacement — Design

**Date:** 2026-05-09
**Branch:** `new-idea-agent`
**Status:** Approved (replaces Phase K/L of `2026-05-08-researchkit-backend-goclaw-design.md`)
**Supersedes:** all GoClaw-related code & plan currently in `research-kit/infra/goclaw/` and the stub `runner_factory.py` `goclaw` branch.

## 1. Problem

The current GoClaw integration was planned against incomplete/incorrect documentation (DeepWiki snapshot of `nextlevelbuilder/goclaw`). After auditing the official `goclaw-docs` repository (`getting-started/`, `agents/`, `core-concepts/`, `reference/`, `advanced/`, `deployment/`), we found ≥20 mismatches that would prevent the gateway from even starting:

- Wrong port (`8080` vs real `18790`).
- Wrong env var names (`AUTH_TOKEN` vs `GOCLAW_GATEWAY_TOKEN`, `DATABASE_URL` vs `GOCLAW_POSTGRES_DSN`); missing `GOCLAW_ENCRYPTION_KEY`.
- Non-existent image tag `:0.7.0` and non-existent `goclaw-cli` image.
- Phantom CLI command `goclaw-cli agent upsert --file <yaml>`.
- YAML "agent" schema with `name/id/system_prompt/tools` fields that do not exist in GoClaw — real personality lives in 6 Markdown context files in the database.
- Custom `tools` inline JSON-schema instead of MCP server registration.
- Plan to mount Markdown context as a volume (GoClaw stores context in DB, not filesystem).

Rebuilding on correct docs unlocks the user's stated goal: leverage GoClaw to keep RK's agent-core code minimal.

## 2. Goals & Non-Goals

### Goals
1. GoClaw container starts cleanly against real published image with correct env + config.
2. 5 RK agents (`rk-verify`, `rk-extract`, `rk-conflict`, `rk-draft`, `rk-chat`) are declaratively defined and reproducibly seeded with deterministic personality + JSON output rules.
3. RK custom logic (`search_inbox`, `get_inbox_items`, `fetch_paper`) exposed via a single MCP server, consumed by GoClaw via streamable-HTTP.
4. Worker runs agents through GoClaw with thin (~150 LOC) WebSocket client; cancel within 2s; rich event stream feeds existing `RunEvent` table.
5. All 8 invariants (currently green with `MockRunner`) remain green with `RK_RUNNER=goclaw`.
6. Rollback path: flipping `RK_RUNNER=mock` env restores prior behavior with no code change.

### Non-Goals
- Multi-tenant beyond per-`user_id` session scoping.
- Channels, cron, sandbox, browser automation, knowledge vault, knowledge graph, evolution, skills system. All explicitly disabled.
- Memory/embeddings (off for all 5 agents — RK provides recall via MCP each turn).
- Subagents/team delegation.
- Migration from MockRunner data; mock and goclaw runners produce semantically equivalent outputs but no shared state.

## 3. Architecture

```
extension/web ── HTTP ── rk-backend (FastAPI) ── Postgres (rk)
                          │       └─ Redis (cancel, idempotency, queue)
                          ├─ /api/...
                          ├─ /sse/runs/{id}      (replay-then-tail)
                          └─ /mcp                (FastMCP streamable-http,
                                                   Bearer RK_MCP_TOKEN)
                                ▲
                                │ tools/call
                                │
worker (RQ) ── WS /ws ──── goclaw (gateway:18790)
                              │      └─ Postgres (goclaw, pgvector:pg18)
                              │
                              └─ config.json (5 agents + 1 MCP + 1 provider)
                                  + agent_context_files (DB)
                                    seeded by goclaw_init container
```

**Data flow per run:**
```
worker tasks._execute_run_impl(run_id)
  → GoClawRunner.run(kind, user_id, run_id, messages, on_event, cancel)
    → WS connect /ws  (user_id=str(run.user_id))
    → chat.send {message, sessionKey, agentId}
    │
    ├─ run.started   → on_event(type="started")
    ├─ chunk         → on_event(type="token", text=...)
    ├─ tool.call     → on_event(type="tool_call", payload=...)
    │       ↓ GoClaw forwards MCP call
    │    rk-backend /mcp → Postgres → result
    ├─ tool.result   → on_event(type="tool_result", payload=...)
    ├─ run.completed → return {content, usage}
    │
    ├─ if cancel.is_set: chat.abort{sessionKey} → run.cancelled → raise CancelledByUser
    └─ finally: sessions.delete{key=sessionKey}  (stateless agents only)
```

## 4. Components

| # | Component | Path | LOC est. | Purpose |
|---|---|---|---|---|
| C1 | `config.json` | `research-kit/infra/goclaw/config.json` | 80 lines | Declares agents, provider, MCP server; disables all v3 systems |
| C2 | Context files | `research-kit/infra/goclaw/agents/<key>/{AGENTS,SOUL,CAPABILITIES,IDENTITY,TOOLS,USER_PREDEFINED}.md` | 30 files × 30-80 lines | Per-agent personality + JSON output schema + few-shot |
| C3 | `goclaw-init` | `research-kit/tools/goclaw-init/` (`Dockerfile` + `init.py` + `pyproject.toml`) | 120 LOC | One-shot WS client that seeds context files via `agents.files.set` |
| C4 | MCP server | `research-kit/backend/app/mcp/` (`server.py`, `tools.py`, `auth.py`) + router mount | 200 LOC | FastMCP streamable-http exposing 3 tools |
| C5 | `GoClawRunner` | `research-kit/worker/runners/goclaw.py` | 150 LOC | WS runner: chat.send + event→RunEvent + chat.abort |
| C6 | Compose rewrite | `research-kit/infra/docker-compose.yml`, `infra/.env.example`, `infra/.env` | — | Correct image, env, ports, mount, init service |
| C7 | Test additions | `backend/tests/contract/test_mcp_*.py`, `backend/tests/contract/test_goclaw_smoke.py` (rewrite), `worker/tests/test_goclaw_runner.py` | 300 LOC tests | Contract + unit |
| C8 | Old code removal | `infra/goclaw/bootstrap.sh`, `infra/goclaw/agents/*.yaml` (5), service `goclaw_bootstrap` | — | Delete |

### C1 — `config.json` (key shape)

```jsonc
{
  "gateway": {
    "host": "0.0.0.0", "port": 18790,
    "token": "env:GOCLAW_GATEWAY_TOKEN",
    "rate_limit_rpm": 0, "tool_status": false, "block_reply": true
  },
  "providers": {
    "anthropic": { "api_key": "env:GOCLAW_ANTHROPIC_API_KEY" }
  },
  "agents": {
    "defaults": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5-20250929",
      "agent_type": "predefined",
      "max_tokens": 4096, "temperature": 0.2,
      "max_tool_iterations": 8, "max_tool_calls": 12,
      "context_window": 200000,
      "restrict_to_workspace": true,
      "memory": { "enabled": false }
    },
    "list": {
      "rk-verify":   { "displayName": "RK Verify",
                       "tools": { "allow": [], "alsoAllow": ["rk_fetch_paper"] } },
      "rk-extract":  { "displayName": "RK Extract",
                       "model": "claude-haiku-4-5-20251001",
                       "tools": { "allow": [] } },
      "rk-conflict": { "displayName": "RK Conflict",
                       "tools": { "allow": [] } },
      "rk-draft":    { "displayName": "RK Draft",
                       "tools": { "allow": [], "alsoAllow": ["rk_get_inbox_items"] } },
      "rk-chat":     { "displayName": "RK Chat",
                       "tools": { "allow": [], "alsoAllow": ["rk_search_inbox","rk_get_inbox_items"] } }
    }
  },
  "tools": {
    "allow": [],
    "rate_limit_per_hour": 10000,
    "scrub_credentials": true,
    "execApproval": { "security": "deny", "ask": "off" },
    "browser": { "enabled": false },
    "mcp_servers": {
      "rk-inbox": {
        "transport": "streamable-http",
        "url": "http://backend:8000/mcp",
        "headers": { "Authorization": "Bearer env:RK_MCP_TOKEN" },
        "tool_prefix": "rk_",
        "timeout_sec": 30,
        "enabled": true
      }
    }
  },
  "subagents": { "maxConcurrent": 0, "maxSpawnDepth": 1, "maxChildrenPerAgent": 0 },
  "sandbox":   { "mode": "off" },
  "telemetry": { "enabled": false },
  "bindings":  []
}
```

### C2 — Context files content strategy

Per agent, 6 Markdown files. Content responsibility split per `goclaw-docs/agents/context-files.md`:

- **AGENTS.md** — operating rules, tool-use guidance, output format. **Where the JSON schema + few-shot examples live.** Example for `rk-verify`:
  ```markdown
  # AGENTS.md
  ## Task
  Decide whether a given paper supports a claim.
  ## Output
  Reply with EXACTLY ONE valid JSON object, no prose:
  { "verdict": "verified"|"partial"|"not_found"|"error",
    "confidence": 0.0..1.0, "quote": "...", "reason": "..." }
  ## Tools
  Call `rk_fetch_paper` only if the user message lacks paper text. Otherwise reason from given content.
  ## Examples
  ...
  ```
- **SOUL.md** — personality (formal, precise, evidence-driven). No rules.
- **CAPABILITIES.md** — domain expertise summary (e.g. "expertise in scientific paper analysis, citation verification").
- **IDENTITY.md** — `Name`, `Emoji`, `Purpose` fields per template.
- **TOOLS.md** — when to use each MCP tool (only meaningful for `rk-verify`, `rk-draft`, `rk-chat`; minimal for others).
- **USER_PREDEFINED.md** — baseline user-handling ("user is a researcher; respond in user's input language").

### C3 — `goclaw-init`

Container that runs once after `goclaw` is healthy. Uses `websockets` + stdlib JSON. Algorithm:

```
1. WS connect to ws://goclaw:18790/ws
2. Send connect req {token: env GOCLAW_GATEWAY_TOKEN, user_id: "system", protocol: 3}
3. Verify ok
4. For each subdir in /agents/:
   - For each of 6 file names:
     - Read file content
     - Send agents.files.set {agentId: <subdir-name>, fileName, content}
     - Verify ok response
5. Exit 0
```

Idempotent: ghi đè nội dung mỗi lần chạy. Nếu agent chưa tồn tại (config.json chưa load), retry với backoff.

### C4 — MCP server

Module `app/mcp/`:
- `auth.py` — Bearer middleware, compares `Authorization` header with `RK_MCP_TOKEN` env (constant-time compare).
- `tools.py` — 3 tool implementations:
  - `search_inbox(query: str, limit: int = 10) -> list[ClaimDigest]` — wraps existing `inbox_repo.search()` (BM25 over `text`).
  - `get_inbox_items(ids: list[UUID]) -> list[ClaimFull]` — wraps `inbox_repo.get_many()`.
  - `fetch_paper(url: str) -> {text: str, metadata: dict}` — wraps existing `paper_fetcher.fetch_with_cache()`.
- `server.py` — instantiate `mcp.server.fastmcp.FastMCP` with streamable-http transport, register tools, mount under `/mcp`.
- Add `mcp` package to `backend/pyproject.toml`.

Schemas: reuse existing `app/schemas/claims.py` and `app/schemas/inbox.py`. Output dicts derived via `model_dump()`.

### C5 — `GoClawRunner`

Single class implementing existing `AgentRunner` Protocol from `worker/runners/base.py`. Sketch:

```python
class GoClawRunner:
    def __init__(self, ws_url, token):
        self._url, self._token = ws_url, token

    async def run(self, *, kind, user_id, run_id, messages, on_event, cancel, request_id):
        agent_key = f"rk-{kind.value.lower()}"
        is_chat = kind == RunKind.CHAT
        session_key = (
            f"rk:project:{messages[0]['project_id']}:chat" if is_chat
            else f"rk:run:{run_id}"
        )
        prompt = self._render_messages(messages)
        async with websockets.connect(f"{self._url}/ws") as ws:
            await self._connect(ws, str(user_id))
            req_id = str(uuid4())
            await self._send(ws, "chat.send", {
                "message": prompt, "sessionKey": session_key, "agentId": agent_key
            }, req_id)
            cancel_task = asyncio.create_task(self._cancel_watcher(ws, session_key, cancel))
            try:
                final = None
                async for frame in self._iter_events(ws):
                    final = await self._handle_frame(frame, on_event)
                    if final is not None:  # run.completed / run.failed / run.cancelled
                        return final
            finally:
                cancel_task.cancel()
                if not is_chat:
                    await self._send(ws, "sessions.delete", {"key": session_key}, str(uuid4()))
```

`_handle_frame`:
- `event=agent payload.type=run.started` → emit `RunEvent("started", ...)`
- `event=chat payload.type=chunk` → emit `RunEvent("token", {text: payload.text})`
- `event=agent payload.type=tool.call` → emit `RunEvent("tool_call", payload)`
- `event=agent payload.type=tool.result` → emit `RunEvent("tool_result", payload)`
- `event=agent payload.type=run.completed` → return `{content, usage}`
- `event=agent payload.type=run.failed` → raise `UpstreamError(code, msg, recoverable=payload.retryable)`
- `event=agent payload.type=run.cancelled` → raise `CancelledByUser()`

`_cancel_watcher`: poll `cancel.is_set()` mỗi 500ms; khi set, send `chat.abort {sessionKey}`. Escape hatch: if no `run.cancelled` within 2s, force-close ws + raise CancelledByUser.

### C6 — Compose rewrite

Service list (final):
- `postgres` (RK app DB) — unchanged
- `redis` — unchanged
- `goclaw_postgres` (pgvector:pg18) — exists, healthcheck unchanged
- **`goclaw`** — image `ghcr.io/nextlevelbuilder/goclaw:latest` (pin in L8), expose 18790, mount `./goclaw/config.json:/app/config.json:ro`, env from `.env` only
- **`goclaw_init`** — new build context `../tools/goclaw-init`, mount `./goclaw/agents:/agents:ro`, depends_on `goclaw: service_healthy`, `restart: "no"`
- `worker` — `RK_RUNNER=goclaw`, depends_on `goclaw_init: service_completed_successfully`, env `GOCLAW_WS_URL=ws://goclaw:18790`, `GOCLAW_GATEWAY_TOKEN`
- `backend` — depends_on `goclaw_init: service_completed_successfully`, env `RK_MCP_TOKEN`

`.env.example` rewrite:
```
ENV=development
DATABASE_URL=postgresql+asyncpg://rk:rk@postgres:5432/rk
REDIS_URL=redis://redis:6379/0

# GoClaw gateway
GOCLAW_WS_URL=ws://goclaw:18790
GOCLAW_GATEWAY_TOKEN=changeme-32-bytes-random
GOCLAW_ENCRYPTION_KEY=changeme-openssl-rand-hex-32
GOCLAW_PG_PASSWORD=goclaw

# LLM provider (read by GoClaw)
GOCLAW_ANTHROPIC_API_KEY=

# MCP auth (shared between backend and GoClaw)
RK_MCP_TOKEN=changeme-32-bytes-random

# Runner selection
RK_RUNNER=goclaw   # mock | goclaw

# Auth
GOOGLE_CLIENT_ID=
SESSION_SECRET=changeme-32-bytes-random
DEV_AUTH_BYPASS=false
```

Remove from current `.env.example`: `ANTHROPIC_API_KEY` (replaced by `GOCLAW_ANTHROPIC_API_KEY`), `GOCLAW_TOKEN` (renamed), `GOCLAW_DATABASE_URL` (renamed to `_PG_PASSWORD` + DSN constructed in compose).

## 5. Error handling

| Failure mode | Detection | Worker behavior | User-visible |
|---|---|---|---|
| WS connect refuses | `websockets.exceptions.InvalidStatusCode` / OSError | `UpstreamError("upstream", recoverable=True)` → existing retry logic | run status `failed`, recoverable=True |
| WS drop mid-run | `ConnectionClosed` exception | Same as above | Same |
| `run.failed` event | frame parsing | Map `payload.error.code` → `UpstreamError(code, msg, recoverable=payload.retryable)` | run failed with goclaw's reason |
| Cancel ack timeout (>2s) | `asyncio.timeout` in cancel_watcher | Force WS close, raise `CancelledByUser` | run `cancelled` (invariant #4 still satisfied from worker side) |
| MCP tool exception | GoClaw forwards as `tool.result` with `is_error=true` | Surface as `RunEvent("tool_result", ...)`; agent decides how to recover. No worker-level error. | Visible in event stream |
| MCP unauthorized (Bearer mismatch) | First `tools/list` fails at GoClaw startup | GoClaw logs error; `rk-inbox` server `connected:false`; agents that use `rk_*` tools fail at runtime | run failed: tool unavailable |
| `goclaw_init` fails | Exit code ≠ 0 | `restart: "no"` so compose stops; backend/worker won't start (depends_on `service_completed_successfully`) | Stack does not come up; ops-visible |
| Image pull failure | docker pull error | Standard compose error | ops-visible |

## 6. Testing strategy

| Tier | Test name | Real components | Fixture/mock |
|---|---|---|---|
| Unit | `test_goclaw_runner_event_mapping` | none | Replay scripted WS frames; assert RunEvents emitted in order |
| Unit | `test_goclaw_runner_cancel_path` | none | Scripted: chat.send → 1 chunk → cancel.set → assert chat.abort sent → emit run.cancelled → assert CancelledByUser raised within 2s |
| Unit | `test_goclaw_runner_session_cleanup` | none | Verify `sessions.delete` called for stateless kinds, NOT for CHAT |
| Unit | `test_goclaw_init_seeds_all_files` | none | Mock WS; verify 30 `agents.files.set` calls (5 agents × 6 files) |
| Contract | `test_mcp_auth_required` | rk-backend (testclient) | Wrong token → 401 |
| Contract | `test_mcp_tools_list_exposes_three` | rk-backend (testclient) | `tools/list` returns search_inbox, get_inbox_items, fetch_paper |
| Contract | `test_mcp_search_inbox_returns_claims` | rk-backend + Postgres | Seed 3 claims, search returns matches |
| Contract | `test_goclaw_streams_chat_completion` (rewrite) | real GoClaw container | Connect WS, chat.send, expect chunk events; **HALT POINT for L7** |
| Contract | `test_goclaw_mcp_tools_visible` | real GoClaw + rk-backend | `GET /v1/mcp/servers` returns rk-inbox connected=true with 3 tools (prefixed `rk_`) |
| Integration | All 8 invariants re-run with `RK_RUNNER=goclaw` | full stack | Existing test files; switch env var |

L7 gate: smoke + invariants must all pass before L8.

## 7. Roll-out & rollback

- Each phase = one commit on `new-idea-agent`. Tests pass before commit.
- After L7 green, PR to `main`.
- Rollback strategy: env `RK_RUNNER=mock` reverts worker to deterministic mock. Already supported in [runner_factory.py](research-kit/worker/runner_factory.py). No code revert needed.
- Image pin (L8): record exact `vX.Y.Z` in `docker-compose.yml` after smoke passes.

## 8. Decisions made (resolved during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Transport for runner | WebSocket `/ws`, not HTTP `/v1/chat/completions` | Native `chat.abort` for cancel; rich event stream (`tool.call`/`tool.result`) feeds RunEvent table directly |
| Session model | Stateless per run for verify/extract/conflict/draft (`rk:run:{id}` + delete after); sticky for chat (`rk:project:{id}:chat`) | Stateless = deterministic + cleanup. Chat = continuity within project |
| Memory system | Off for all agents | Avoids embedding-key dependency; MCP search_inbox per turn provides recall |
| MCP tool surface | 3 tools: `search_inbox`, `get_inbox_items`, `fetch_paper` | `fetch_paper` lets rk-verify decide when to fetch (saves tokens vs always-prefetch) |
| Agent type | `predefined` without `description` | Deterministic (template seed + override), avoids LLM-summoned variance |
| Tool whitelist mechanism | `tools.allow: []` global + per-agent `alsoAllow` for MCP tools | Strictest possible deny; explicit MCP allowlist per agent |
| Image tag | `:latest` for L7 smoke, pin to `vX.Y.Z` at L8 | Reduces upfront version research; pin after we know it works |
| Init mechanism | Dedicated container `goclaw_init` running WS `agents.files.set` | Idempotent, runs once, gates downstream services via `service_completed_successfully` |

## 9. Risks & verification gates

| Risk | Mitigation / verification at |
|---|---|
| MCP tool name format with prefix unclear (`rk_search_inbox` vs other) | Verify in L7 via `GET /v1/mcp/servers/<id>/tools`; adjust `alsoAllow` strings if different |
| `tools.allow: []` may not block all built-ins | L7 test: prompt agent to call `bash` → must fail. If leaks, add `tools.deny: [...]` explicit list |
| `headers.Authorization: "Bearer env:RK_MCP_TOKEN"` env-substitution timing | L7 backend log inspection; if literal string, use full env injection on goclaw service instead |
| WS frame field names may differ from docs | First L7 run: log all event types; reconcile with `_handle_frame` |
| `chat.abort` ack latency >2s | `_cancel_watcher` enforces 2s deadline with force-close fallback |
| Hot-reload of `mcp_servers` | Verify by editing config.json runtime → check goclaw log "config reloaded" |

## 10. Out of scope (explicit)

- Multi-tenant isolation beyond per-`user_id` session scoping.
- GoClaw v3 systems (vault, KG, evolution, skills, episodic memory).
- Channels (telegram/discord/slack/etc), cron, sandbox, browser, TTS.
- Subagents / team delegation.
- OpenTelemetry / Jaeger.
- Migrating production data between mock and goclaw.

## 11. Acceptance

Phase L is complete when:
1. `docker compose up -d` brings up all services including `goclaw_init` exits 0.
2. `pytest backend/tests/contract/test_goclaw_smoke.py` passes against the running stack (no `skip`).
3. `pytest backend/tests/contract/test_mcp_*.py` passes.
4. All 8 invariants pass with `RK_RUNNER=goclaw`.
5. `RK_RUNNER=mock` rollback verified (re-run invariants).
6. Image tag pinned to specific `vX.Y.Z` in compose.
