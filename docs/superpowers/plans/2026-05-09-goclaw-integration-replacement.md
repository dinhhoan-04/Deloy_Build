# GoClaw Integration Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken GoClaw integration in ResearchKit with a correct, real-image-backed gateway + 5 predefined agents + MCP-served custom tools + a thin WebSocket runner — keeping all 8 invariants green and `RK_RUNNER=mock` as a rollback.

**Architecture:** GoClaw container (`ghcr.io/nextlevelbuilder/goclaw`) reads `config.json` declaring 5 predefined agents and one MCP server (`rk-inbox` served by rk-backend at `/mcp`). A `goclaw_init` one-shot container seeds 30 Markdown context files into GoClaw's DB via the `agents.files.set` WebSocket method. Worker uses a thin `GoClawRunner` (~150 LOC) that talks WS `/ws` (`chat.send` / `chat.abort` / `sessions.delete`) and maps events to existing `RunEvent` rows. `RK_RUNNER=mock` flips back to `MockRunner` with no code change.

**Tech Stack:** Docker Compose, GoClaw v3 (Go), PostgreSQL + pgvector, Redis, FastAPI, FastMCP (`mcp[server]` Python SDK), `websockets` (Python), pytest.

**Spec:** `docs/superpowers/specs/2026-05-09-goclaw-integration-replacement-design.md`

---

## File Structure

**New files:**
- `research-kit/infra/goclaw/config.json`
- `research-kit/infra/goclaw/agents/{rk-verify,rk-extract,rk-conflict,rk-draft,rk-chat}/{AGENTS,SOUL,CAPABILITIES,IDENTITY,TOOLS,USER_PREDEFINED}.md` (30 files)
- `research-kit/tools/goclaw-init/Dockerfile`
- `research-kit/tools/goclaw-init/init.py`
- `research-kit/tools/goclaw-init/pyproject.toml`
- `research-kit/backend/app/mcp/__init__.py`
- `research-kit/backend/app/mcp/auth.py`
- `research-kit/backend/app/mcp/tools.py`
- `research-kit/backend/app/mcp/server.py`
- `research-kit/worker/runners/goclaw.py`
- `research-kit/backend/tests/contract/test_mcp_auth.py`
- `research-kit/backend/tests/contract/test_mcp_tools.py`
- `research-kit/backend/tests/contract/test_goclaw_mcp_visible.py`
- `research-kit/worker/tests/test_goclaw_runner.py`
- `research-kit/worker/tests/test_goclaw_init.py` *(unit test for init algorithm — co-located with worker tests)*

**Modified files:**
- `research-kit/infra/docker-compose.yml`
- `research-kit/infra/.env.example`
- `research-kit/infra/.env`
- `research-kit/backend/app/main.py` (mount `/mcp`)
- `research-kit/backend/pyproject.toml` (add `mcp` dep)
- `research-kit/worker/runner_factory.py` (wire env into `GoClawRunner`)
- `research-kit/backend/tests/contract/test_goclaw_smoke.py` (rewrite from skip-stub to real)

**Deleted files:**
- `research-kit/infra/goclaw/bootstrap.sh`
- `research-kit/infra/goclaw/agents/{verify,extract,chat,draft,conflict}.yaml`

---

## Phase L0 — Cleanup Old GoClaw Stubs

### Task L0.1: Delete obsolete YAML + bootstrap files

**Files:**
- Delete: `research-kit/infra/goclaw/bootstrap.sh`
- Delete: `research-kit/infra/goclaw/agents/verify.yaml`
- Delete: `research-kit/infra/goclaw/agents/extract.yaml`
- Delete: `research-kit/infra/goclaw/agents/chat.yaml`
- Delete: `research-kit/infra/goclaw/agents/draft.yaml`
- Delete: `research-kit/infra/goclaw/agents/conflict.yaml`

- [ ] **Step 1: Remove the files**

```bash
git rm research-kit/infra/goclaw/bootstrap.sh \
       research-kit/infra/goclaw/agents/verify.yaml \
       research-kit/infra/goclaw/agents/extract.yaml \
       research-kit/infra/goclaw/agents/chat.yaml \
       research-kit/infra/goclaw/agents/draft.yaml \
       research-kit/infra/goclaw/agents/conflict.yaml
```

- [ ] **Step 2: Verify nothing imports them**

```bash
rg -n 'bootstrap.sh|agents/.*\.yaml' research-kit/
```
Expected: zero hits other than possible leftover references in compose (handled in L1).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(goclaw): remove obsolete bootstrap.sh + per-agent YAML stubs"
```

---

## Phase L1 — Compose & Env Rewrite

### Task L1.1: Rewrite `.env.example`

**Files:**
- Modify: `research-kit/infra/.env.example` (full rewrite)

- [ ] **Step 1: Write the new content**

Replace contents with exactly:

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

- [ ] **Step 2: Sync developer `.env`**

```bash
cp research-kit/infra/.env.example research-kit/infra/.env
# fill in real values locally; do not commit .env
openssl rand -hex 32   # use for GOCLAW_GATEWAY_TOKEN, GOCLAW_ENCRYPTION_KEY, RK_MCP_TOKEN, SESSION_SECRET
```

- [ ] **Step 3: Commit `.env.example` only**

```bash
git add research-kit/infra/.env.example
git commit -m "chore(infra): rewrite .env.example for real GoClaw env vars"
```

### Task L1.2: Rewrite `docker-compose.yml`

**Files:**
- Modify: `research-kit/infra/docker-compose.yml` (full rewrite of services)

- [ ] **Step 1: Read current compose file to preserve postgres/redis/backend/worker definitions**

Run: `cat research-kit/infra/docker-compose.yml`

- [ ] **Step 2: Replace with new content**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: rk
      POSTGRES_PASSWORD: rk
      POSTGRES_DB: rk
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rk -d rk"]
      interval: 3s
      timeout: 3s
      retries: 20
    volumes:
      - rk_pg_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 3s
      retries: 20

  goclaw_postgres:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: goclaw
      POSTGRES_PASSWORD: ${GOCLAW_PG_PASSWORD}
      POSTGRES_DB: goclaw
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U goclaw -d goclaw"]
      interval: 3s
      timeout: 3s
      retries: 20
    volumes:
      - goclaw_pg_data:/var/lib/postgresql/data

  goclaw:
    image: ghcr.io/nextlevelbuilder/goclaw:latest
    depends_on:
      goclaw_postgres:
        condition: service_healthy
    environment:
      GOCLAW_GATEWAY_TOKEN: ${GOCLAW_GATEWAY_TOKEN}
      GOCLAW_ENCRYPTION_KEY: ${GOCLAW_ENCRYPTION_KEY}
      GOCLAW_POSTGRES_DSN: postgres://goclaw:${GOCLAW_PG_PASSWORD}@goclaw_postgres:5432/goclaw?sslmode=disable
      GOCLAW_AUTO_UPGRADE: "true"
      GOCLAW_ANTHROPIC_API_KEY: ${GOCLAW_ANTHROPIC_API_KEY}
      RK_MCP_TOKEN: ${RK_MCP_TOKEN}
    ports:
      - "18790:18790"
    volumes:
      - ./goclaw/config.json:/app/config.json:ro
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O - http://localhost:18790/health || exit 1"]
      interval: 3s
      timeout: 3s
      retries: 30

  goclaw_init:
    build:
      context: ../tools/goclaw-init
      dockerfile: Dockerfile
    depends_on:
      goclaw:
        condition: service_healthy
      backend:
        condition: service_started
    environment:
      GOCLAW_WS_URL: ws://goclaw:18790
      GOCLAW_GATEWAY_TOKEN: ${GOCLAW_GATEWAY_TOKEN}
    volumes:
      - ./goclaw/agents:/agents:ro
    restart: "no"

  backend:
    build:
      context: ..
      dockerfile: infra/Dockerfile.backend
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      ENV: ${ENV}
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      RK_MCP_TOKEN: ${RK_MCP_TOKEN}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      SESSION_SECRET: ${SESSION_SECRET}
      DEV_AUTH_BYPASS: ${DEV_AUTH_BYPASS}
    ports:
      - "8000:8000"

  worker:
    build:
      context: ..
      dockerfile: infra/Dockerfile.worker
    depends_on:
      redis:
        condition: service_healthy
      goclaw_init:
        condition: service_completed_successfully
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      RK_RUNNER: ${RK_RUNNER}
      GOCLAW_WS_URL: ${GOCLAW_WS_URL}
      GOCLAW_GATEWAY_TOKEN: ${GOCLAW_GATEWAY_TOKEN}

volumes:
  rk_pg_data:
  goclaw_pg_data:
```

- [ ] **Step 3: Validate compose config syntax**

Run: `docker compose -f research-kit/infra/docker-compose.yml --env-file research-kit/infra/.env config > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add research-kit/infra/docker-compose.yml
git commit -m "chore(infra): rewrite compose for real GoClaw image + goclaw_init service"
```

---

## Phase L2 — `config.json`

### Task L2.1: Create `config.json`

**Files:**
- Create: `research-kit/infra/goclaw/config.json`

- [ ] **Step 1: Write the file**

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790,
    "token": "env:GOCLAW_GATEWAY_TOKEN",
    "rate_limit_rpm": 0,
    "tool_status": false,
    "block_reply": true
  },
  "providers": {
    "anthropic": { "api_key": "env:GOCLAW_ANTHROPIC_API_KEY" }
  },
  "agents": {
    "defaults": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5-20250929",
      "agent_type": "predefined",
      "max_tokens": 4096,
      "temperature": 0.2,
      "max_tool_iterations": 8,
      "max_tool_calls": 12,
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
                       "tools": { "allow": [], "alsoAllow": ["rk_search_inbox", "rk_get_inbox_items"] } }
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

- [ ] **Step 2: Validate JSON**

Run: `python -c "import json; json.load(open('research-kit/infra/goclaw/config.json'))" && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add research-kit/infra/goclaw/config.json
git commit -m "feat(goclaw): config.json with 5 predefined agents + rk-inbox MCP"
```

---

## Phase L3 — Context Files (30 Markdown files)

Per spec §C2: each agent gets 6 files: `AGENTS.md`, `SOUL.md`, `CAPABILITIES.md`, `IDENTITY.md`, `TOOLS.md`, `USER_PREDEFINED.md`.

All `USER_PREDEFINED.md` and `SOUL.md` are short and shared in shape. `AGENTS.md` is the only one with substantial per-agent content (it carries the JSON output schema + few-shot examples).

### Task L3.1: rk-verify context files

**Files:**
- Create: `research-kit/infra/goclaw/agents/rk-verify/AGENTS.md`
- Create: `research-kit/infra/goclaw/agents/rk-verify/SOUL.md`
- Create: `research-kit/infra/goclaw/agents/rk-verify/CAPABILITIES.md`
- Create: `research-kit/infra/goclaw/agents/rk-verify/IDENTITY.md`
- Create: `research-kit/infra/goclaw/agents/rk-verify/TOOLS.md`
- Create: `research-kit/infra/goclaw/agents/rk-verify/USER_PREDEFINED.md`

- [ ] **Step 1: Write `AGENTS.md`**

```markdown
# AGENTS.md

## Task
Decide whether a given paper supports a stated claim.

## Output
Reply with EXACTLY ONE valid JSON object, no prose, no Markdown fences:

```
{
  "verdict": "verified" | "partial" | "not_found" | "error",
  "confidence": 0.0,
  "quote": "<exact verbatim sentence(s) from the paper>",
  "reason": "<one short sentence>"
}
```

- `verdict=verified`: the paper directly states the claim.
- `verdict=partial`: the paper supports parts of the claim but not all.
- `verdict=not_found`: paper text was provided but no support exists.
- `verdict=error`: input was unusable (no text, fetch failed, etc.).
- `confidence`: float in [0,1].
- `quote`: must be a literal substring of the supplied paper text. Empty string only when verdict=not_found or error.

## Tools
- Call `rk_fetch_paper` ONLY if the user message lacks paper text and supplies a URL.
- Otherwise reason from the supplied content. Never call other tools.
- Never call a tool more than once per run.

## Examples
Input: claim="X causes Y", paper text contains "X is a primary driver of Y in mice".
Output: {"verdict":"partial","confidence":0.6,"quote":"X is a primary driver of Y in mice","reason":"Supports causation only in mice."}
```

- [ ] **Step 2: Write `SOUL.md`**

```markdown
# SOUL.md
You are formal, precise, and evidence-driven. You never speculate beyond the supplied text. You quote verbatim and cite confidence honestly.
```

- [ ] **Step 3: Write `CAPABILITIES.md`**

```markdown
# CAPABILITIES.md
Expertise in scientific paper analysis, claim verification, citation matching, and evidence quoting.
```

- [ ] **Step 4: Write `IDENTITY.md`**

```markdown
# IDENTITY.md
- Name: RK Verify
- Emoji: 🔍
- Purpose: Decide if a paper supports a claim, with verbatim evidence.
```

- [ ] **Step 5: Write `TOOLS.md`**

```markdown
# TOOLS.md
- `rk_fetch_paper(url)` — fetch and cache a paper's text + metadata. Use only when the user supplies a URL and no inline paper text.
```

- [ ] **Step 6: Write `USER_PREDEFINED.md`**

```markdown
# USER_PREDEFINED.md
The user is a researcher. Respond in the user's input language. Do not invent text not present in the supplied paper.
```

- [ ] **Step 7: Commit**

```bash
git add research-kit/infra/goclaw/agents/rk-verify
git commit -m "feat(goclaw): rk-verify context files (6)"
```

### Task L3.2: rk-extract context files

**Files:**
- Create: `research-kit/infra/goclaw/agents/rk-extract/{AGENTS,SOUL,CAPABILITIES,IDENTITY,TOOLS,USER_PREDEFINED}.md`

- [ ] **Step 1: `AGENTS.md`**

```markdown
# AGENTS.md
## Task
Extract atomic, verifiable claims from a supplied document.

## Output
Reply with EXACTLY ONE valid JSON object, no prose:

{
  "claims": [
    { "text": "<single declarative sentence>",
      "topic": "<short tag>",
      "page": <int|null>,
      "confidence": 0.0 }
  ]
}

- Each claim is one self-contained, verifiable statement.
- Drop opinions, methodology descriptions, and references.
- Do not call any tool.
```

- [ ] **Step 2: `SOUL.md`**

```markdown
# SOUL.md
You are concise, literal, and exhaustive. You prefer high precision over recall.
```

- [ ] **Step 3: `CAPABILITIES.md`**

```markdown
# CAPABILITIES.md
Expertise in claim extraction from academic and technical text. Skilled at separating claims from rhetoric.
```

- [ ] **Step 4: `IDENTITY.md`**

```markdown
# IDENTITY.md
- Name: RK Extract
- Emoji: 🪡
- Purpose: Convert documents into a list of atomic verifiable claims.
```

- [ ] **Step 5: `TOOLS.md`**

```markdown
# TOOLS.md
This agent uses no tools. Reason from the supplied document only.
```

- [ ] **Step 6: `USER_PREDEFINED.md`**

```markdown
# USER_PREDEFINED.md
The user is a researcher. Respond in the user's input language. Output JSON only.
```

- [ ] **Step 7: Commit**

```bash
git add research-kit/infra/goclaw/agents/rk-extract
git commit -m "feat(goclaw): rk-extract context files (6)"
```

### Task L3.3: rk-conflict context files

**Files:**
- Create: `research-kit/infra/goclaw/agents/rk-conflict/{AGENTS,SOUL,CAPABILITIES,IDENTITY,TOOLS,USER_PREDEFINED}.md`

- [ ] **Step 1: `AGENTS.md`**

```markdown
# AGENTS.md
## Task
Detect contradictions between two or more supplied claims.

## Output
Reply with EXACTLY ONE valid JSON object, no prose:

{
  "conflicts": [
    { "a": <int>, "b": <int>, "kind": "direct"|"scope"|"unit"|"unrelated",
      "explanation": "<one sentence>" }
  ]
}

- `a`/`b` are 0-indexed positions in the input claims array.
- `unrelated` MUST NOT be emitted; if no conflict, return `{ "conflicts": [] }`.
- Do not call any tool.
```

- [ ] **Step 2: `SOUL.md`**

```markdown
# SOUL.md
You are skeptical, careful, and value precision over recall. You only flag a conflict when it is logically necessary.
```

- [ ] **Step 3: `CAPABILITIES.md`**

```markdown
# CAPABILITIES.md
Expertise in detecting logical contradictions, scope mismatches, and unit inconsistencies between claims.
```

- [ ] **Step 4: `IDENTITY.md`**

```markdown
# IDENTITY.md
- Name: RK Conflict
- Emoji: ⚖️
- Purpose: Detect contradictions across a set of claims.
```

- [ ] **Step 5: `TOOLS.md`**

```markdown
# TOOLS.md
This agent uses no tools. Reason from the supplied claim list only.
```

- [ ] **Step 6: `USER_PREDEFINED.md`**

```markdown
# USER_PREDEFINED.md
The user is a researcher. Respond in the user's input language. Output JSON only.
```

- [ ] **Step 7: Commit**

```bash
git add research-kit/infra/goclaw/agents/rk-conflict
git commit -m "feat(goclaw): rk-conflict context files (6)"
```

### Task L3.4: rk-draft context files

**Files:**
- Create: `research-kit/infra/goclaw/agents/rk-draft/{AGENTS,SOUL,CAPABILITIES,IDENTITY,TOOLS,USER_PREDEFINED}.md`

- [ ] **Step 1: `AGENTS.md`**

```markdown
# AGENTS.md
## Task
Draft a section of a research write-up using the supplied list of claim IDs.

## Output
Reply with EXACTLY ONE valid JSON object, no prose:

{
  "title": "<section title>",
  "markdown": "<section body in Markdown>",
  "citations": [ { "claim_id": "<uuid>", "anchor": "<inline-token>" } ]
}

- Every factual sentence MUST cite a `claim_id` from the supplied IDs via `[anchor]`.
- Do not invent claims not in the supplied IDs.

## Tools
- Call `rk_get_inbox_items(ids=[...])` ONCE to fetch the full claim payloads at the start. Do not call again.
```

- [ ] **Step 2: `SOUL.md`**

```markdown
# SOUL.md
You are clear, structured, and never speculative. You write tightly and cite every fact.
```

- [ ] **Step 3: `CAPABILITIES.md`**

```markdown
# CAPABILITIES.md
Expertise in academic writing, citation hygiene, and structuring evidence-backed prose.
```

- [ ] **Step 4: `IDENTITY.md`**

```markdown
# IDENTITY.md
- Name: RK Draft
- Emoji: ✍️
- Purpose: Compose cited Markdown sections from a list of claim IDs.
```

- [ ] **Step 5: `TOOLS.md`**

```markdown
# TOOLS.md
- `rk_get_inbox_items(ids)` — fetch full claim records by ID. Call once at run start.
```

- [ ] **Step 6: `USER_PREDEFINED.md`**

```markdown
# USER_PREDEFINED.md
The user is a researcher. Respond in the user's input language. Output JSON only.
```

- [ ] **Step 7: Commit**

```bash
git add research-kit/infra/goclaw/agents/rk-draft
git commit -m "feat(goclaw): rk-draft context files (6)"
```

### Task L3.5: rk-chat context files

**Files:**
- Create: `research-kit/infra/goclaw/agents/rk-chat/{AGENTS,SOUL,CAPABILITIES,IDENTITY,TOOLS,USER_PREDEFINED}.md`

- [ ] **Step 1: `AGENTS.md`**

```markdown
# AGENTS.md
## Task
Answer the researcher's questions about claims in their inbox.

## Output
Reply in natural Markdown prose, citing claim IDs in square brackets like `[a1b2c3]`. No JSON wrapper.

## Tools
- `rk_search_inbox(query, limit=10)` — find relevant claims.
- `rk_get_inbox_items(ids=[...])` — fetch full claim payloads after narrowing via search.

## Behavior
- Always search before answering questions about specific claims.
- Cite every factual statement with the matching claim ID.
- If no relevant claims, say so and stop.
```

- [ ] **Step 2: `SOUL.md`**

```markdown
# SOUL.md
You are a friendly research assistant: precise, conversational, and grounded only in the user's inbox.
```

- [ ] **Step 3: `CAPABILITIES.md`**

```markdown
# CAPABILITIES.md
Expertise in retrieving, summarizing, and explaining claims from a research inbox.
```

- [ ] **Step 4: `IDENTITY.md`**

```markdown
# IDENTITY.md
- Name: RK Chat
- Emoji: 💬
- Purpose: Conversational interface to the researcher's claim inbox.
```

- [ ] **Step 5: `TOOLS.md`**

```markdown
# TOOLS.md
- `rk_search_inbox(query, limit)` — BM25 search over inbox text.
- `rk_get_inbox_items(ids)` — fetch full claim records by ID.
```

- [ ] **Step 6: `USER_PREDEFINED.md`**

```markdown
# USER_PREDEFINED.md
The user is a researcher exploring their own inbox. Respond in the user's input language. Always cite.
```

- [ ] **Step 7: Commit**

```bash
git add research-kit/infra/goclaw/agents/rk-chat
git commit -m "feat(goclaw): rk-chat context files (6)"
```

### Task L3.6: Verify all 30 files exist

- [ ] **Step 1: Count files**

Run: `find research-kit/infra/goclaw/agents -name '*.md' | wc -l`
Expected: `30`

- [ ] **Step 2: Verify file names**

```bash
for d in rk-verify rk-extract rk-conflict rk-draft rk-chat; do
  ls research-kit/infra/goclaw/agents/$d | sort
done
```
Expected: each subdir lists exactly `AGENTS.md CAPABILITIES.md IDENTITY.md SOUL.md TOOLS.md USER_PREDEFINED.md`.

---

## Phase L4 — `goclaw-init` Container

### Task L4.1: Create `goclaw-init` Python project

**Files:**
- Create: `research-kit/tools/goclaw-init/pyproject.toml`
- Create: `research-kit/tools/goclaw-init/init.py`
- Create: `research-kit/tools/goclaw-init/Dockerfile`

- [ ] **Step 1: `pyproject.toml`**

```toml
[project]
name = "goclaw-init"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["websockets>=12.0"]
```

- [ ] **Step 2: `init.py`**

```python
"""Seed GoClaw agent context files via WebSocket `agents.files.set`.

Idempotent: each run overwrites the named context file content.
Retries on initial connect / "agent not found" until config.json is loaded.
"""
from __future__ import annotations
import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

import websockets

WS_URL = os.environ["GOCLAW_WS_URL"]
TOKEN = os.environ["GOCLAW_GATEWAY_TOKEN"]
AGENTS_DIR = Path(os.environ.get("AGENTS_DIR", "/agents"))
FILE_NAMES = [
    "AGENTS.md", "SOUL.md", "CAPABILITIES.md",
    "IDENTITY.md", "TOOLS.md", "USER_PREDEFINED.md",
]
MAX_ATTEMPTS = 30
BACKOFF_SEC = 2.0


async def _request(ws, method: str, params: dict) -> dict:
    req_id = str(uuid.uuid4())
    await ws.send(json.dumps({"type": "req", "id": req_id, "method": method, "params": params}))
    while True:
        raw = await ws.recv()
        msg = json.loads(raw)
        if msg.get("id") == req_id and msg.get("type") in ("res", "err"):
            return msg


async def _connect(ws) -> None:
    res = await _request(ws, "connect", {"token": TOKEN, "user_id": "system", "protocol": 3})
    if res.get("type") != "res":
        raise RuntimeError(f"connect failed: {res}")


async def _seed_one(ws, agent_id: str, file_name: str, content: str) -> None:
    for attempt in range(1, MAX_ATTEMPTS + 1):
        res = await _request(ws, "agents.files.set", {
            "agentId": agent_id, "fileName": file_name, "content": content,
        })
        if res.get("type") == "res":
            print(f"  ok: {agent_id}/{file_name}", flush=True)
            return
        err = res.get("error", {})
        code = err.get("code", "")
        if "not_found" in code or "unknown_agent" in code:
            print(f"  retry {attempt}/{MAX_ATTEMPTS}: agent {agent_id} not yet loaded", flush=True)
            await asyncio.sleep(BACKOFF_SEC)
            continue
        raise RuntimeError(f"agents.files.set failed: {res}")
    raise RuntimeError(f"timed out waiting for agent {agent_id} to be loaded")


async def main() -> int:
    agent_dirs = sorted(p for p in AGENTS_DIR.iterdir() if p.is_dir())
    if not agent_dirs:
        print(f"no agent dirs in {AGENTS_DIR}", file=sys.stderr)
        return 1
    async with websockets.connect(f"{WS_URL}/ws") as ws:
        await _connect(ws)
        for agent_dir in agent_dirs:
            agent_id = agent_dir.name
            print(f"seeding {agent_id}", flush=True)
            for file_name in FILE_NAMES:
                fp = agent_dir / file_name
                if not fp.exists():
                    raise FileNotFoundError(fp)
                await _seed_one(ws, agent_id, file_name, fp.read_text(encoding="utf-8"))
    print("done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

- [ ] **Step 3: `Dockerfile`**

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml init.py ./
RUN pip install --no-cache-dir websockets>=12.0
CMD ["python", "init.py"]
```

- [ ] **Step 4: Smoke build**

Run: `docker build -t rk-goclaw-init research-kit/tools/goclaw-init`
Expected: image builds without error.

- [ ] **Step 5: Commit**

```bash
git add research-kit/tools/goclaw-init
git commit -m "feat(infra): goclaw-init one-shot WS seeder for agent context files"
```

### Task L4.2: Unit test for the init algorithm

**Files:**
- Create: `research-kit/worker/tests/test_goclaw_init.py`

- [ ] **Step 1: Write failing test**

```python
"""Verify goclaw-init issues 30 agents.files.set calls (5 agents x 6 files).

We import the script as a module and stub the websockets layer with a fake.
"""
from __future__ import annotations
import asyncio
import json
import sys
import types
from pathlib import Path

import pytest

INIT_DIR = Path(__file__).resolve().parents[2] / "tools" / "goclaw-init"


class FakeWS:
    def __init__(self):
        self.sent: list[dict] = []
        self._pending: list[str] = []

    async def send(self, raw: str) -> None:
        msg = json.loads(raw)
        self.sent.append(msg)
        # auto-respond OK
        self._pending.append(json.dumps({"id": msg["id"], "type": "res", "result": {}}))

    async def recv(self) -> str:
        return self._pending.pop(0)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


def _load_init_module(monkeypatch, agents_dir: Path):
    # build minimal websockets stub
    fake_ws = FakeWS()

    async def fake_connect(url):
        return fake_ws

    fake_websockets = types.SimpleNamespace(connect=fake_connect)
    monkeypatch.setitem(sys.modules, "websockets", fake_websockets)
    monkeypatch.setenv("GOCLAW_WS_URL", "ws://x")
    monkeypatch.setenv("GOCLAW_GATEWAY_TOKEN", "t")
    monkeypatch.setenv("AGENTS_DIR", str(agents_dir))

    sys.path.insert(0, str(INIT_DIR))
    if "init" in sys.modules:
        del sys.modules["init"]
    import init  # type: ignore
    return init, fake_ws


def test_init_seeds_all_30_files(monkeypatch, tmp_path):
    agents_dir = tmp_path / "agents"
    for agent in ["rk-verify", "rk-extract", "rk-conflict", "rk-draft", "rk-chat"]:
        d = agents_dir / agent
        d.mkdir(parents=True)
        for fn in ["AGENTS.md", "SOUL.md", "CAPABILITIES.md",
                   "IDENTITY.md", "TOOLS.md", "USER_PREDEFINED.md"]:
            (d / fn).write_text(f"# {agent}/{fn}\n")
    init, fake_ws = _load_init_module(monkeypatch, agents_dir)
    rc = asyncio.run(init.main())
    assert rc == 0
    methods = [m["method"] for m in fake_ws.sent]
    assert methods.count("connect") == 1
    assert methods.count("agents.files.set") == 30
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd research-kit && pytest worker/tests/test_goclaw_init.py -v`
Expected: FAIL until init.py from L4.1 is on disk (if running before commit, will fail with import error). If already created in L4.1 it should pass — re-order accepted.

- [ ] **Step 3: Run, expect PASS**

Run: `cd research-kit && pytest worker/tests/test_goclaw_init.py -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add research-kit/worker/tests/test_goclaw_init.py
git commit -m "test(goclaw-init): verify 30 agents.files.set calls"
```

---

## Phase L5 — MCP Server in rk-backend

### Task L5.1: Add `mcp` dependency

**Files:**
- Modify: `research-kit/backend/pyproject.toml`

- [ ] **Step 1: Add dep**

Add to the `dependencies` array in `pyproject.toml`:
```toml
"mcp>=1.2.0",
```

- [ ] **Step 2: Reinstall locally**

Run: `cd research-kit/backend && pip install -e .`
Expected: install succeeds.

### Task L5.2: Bearer auth middleware

**Files:**
- Create: `research-kit/backend/app/mcp/__init__.py` (empty)
- Create: `research-kit/backend/app/mcp/auth.py`

- [ ] **Step 1: Write `auth.py`**

```python
"""Bearer auth for the MCP endpoint, using constant-time comparison."""
from __future__ import annotations
import hmac
import os
from fastapi import HTTPException, Request


def require_mcp_token(request: Request) -> None:
    expected = os.environ.get("RK_MCP_TOKEN")
    if not expected:
        raise HTTPException(500, "RK_MCP_TOKEN not configured")
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    presented = auth.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(presented, expected):
        raise HTTPException(401, "invalid bearer token")
```

- [ ] **Step 2: Commit (deferred — combine after L5.4)**

### Task L5.3: Tool implementations

**Files:**
- Create: `research-kit/backend/app/mcp/tools.py`

- [ ] **Step 1: Identify existing repo / fetcher signatures**

Run: `rg -n 'def search|def get_many|def fetch_with_cache' research-kit/backend/app`
Record the exact module paths and function signatures of `inbox_repo.search`, `inbox_repo.get_many`, and `paper_fetcher.fetch_with_cache`. If any is missing, stop and discuss with the user before continuing — they are listed as "existing" in the spec.

- [ ] **Step 2: Write `tools.py`**

```python
"""MCP tool implementations for ResearchKit.

Each tool wraps an existing backend repo / fetcher. Output uses
`model_dump()` on existing pydantic schemas so the MCP layer adds no
new shapes.
"""
from __future__ import annotations
from typing import Any
from uuid import UUID

from app.repos import inbox_repo
from app import paper_fetcher  # adjust import to match real module path
from app.deps import db_session_factory


async def search_inbox(query: str, limit: int = 10) -> list[dict[str, Any]]:
    async with db_session_factory() as session:
        rows = await inbox_repo.search(session, query=query, limit=limit)
        return [r.model_dump(mode="json") for r in rows]


async def get_inbox_items(ids: list[str]) -> list[dict[str, Any]]:
    parsed = [UUID(x) for x in ids]
    async with db_session_factory() as session:
        rows = await inbox_repo.get_many(session, ids=parsed)
        return [r.model_dump(mode="json") for r in rows]


async def fetch_paper(url: str) -> dict[str, Any]:
    text, metadata = await paper_fetcher.fetch_with_cache(url)
    return {"text": text, "metadata": metadata}
```

> If actual import paths differ, fix them now. If `db_session_factory` is exposed under a different name, adapt the import — do not invent a new factory.

### Task L5.4: FastMCP server + mount

**Files:**
- Create: `research-kit/backend/app/mcp/server.py`
- Modify: `research-kit/backend/app/main.py`

- [ ] **Step 1: Write `server.py`**

```python
"""FastMCP streamable-http server exposing 3 RK tools."""
from __future__ import annotations
from mcp.server.fastmcp import FastMCP

from app.mcp import tools as t

mcp_server = FastMCP("rk-inbox")


@mcp_server.tool()
async def search_inbox(query: str, limit: int = 10) -> list[dict]:
    """BM25 search over the user's claim inbox."""
    return await t.search_inbox(query=query, limit=limit)


@mcp_server.tool()
async def get_inbox_items(ids: list[str]) -> list[dict]:
    """Fetch full claim records by UUID."""
    return await t.get_inbox_items(ids=ids)


@mcp_server.tool()
async def fetch_paper(url: str) -> dict:
    """Fetch and cache a paper's text + metadata by URL."""
    return await t.fetch_paper(url=url)


def streamable_http_app():
    """Return the ASGI app for streamable-http transport."""
    return mcp_server.streamable_http_app()
```

- [ ] **Step 2: Mount at `/mcp` in `main.py`**

Read current main.py, then add (near other route mounts):

```python
from fastapi import Depends
from app.mcp.auth import require_mcp_token
from app.mcp.server import streamable_http_app

app.mount(
    "/mcp",
    streamable_http_app(),
    name="mcp",
)

# Auth dependency for /mcp routes — added via middleware on the sub-app
@app.middleware("http")
async def mcp_bearer_guard(request, call_next):
    if request.url.path.startswith("/mcp"):
        try:
            require_mcp_token(request)
        except Exception as e:
            from fastapi.responses import JSONResponse
            status = getattr(e, "status_code", 401)
            return JSONResponse({"detail": str(e)}, status_code=status)
    return await call_next(request)
```

- [ ] **Step 3: Sanity-import**

Run: `cd research-kit/backend && python -c "from app.main import app; print('ok')"`
Expected: `ok` (no ImportError).

- [ ] **Step 4: Commit L5 set**

```bash
git add research-kit/backend/app/mcp research-kit/backend/app/main.py research-kit/backend/pyproject.toml
git commit -m "feat(backend): MCP server (/mcp) with 3 tools + Bearer auth"
```

### Task L5.5: Contract test — auth required

**Files:**
- Create: `research-kit/backend/tests/contract/test_mcp_auth.py`

- [ ] **Step 1: Write the test**

```python
import os
from fastapi.testclient import TestClient


def test_mcp_requires_bearer(monkeypatch):
    monkeypatch.setenv("RK_MCP_TOKEN", "secret")
    from app.main import app
    client = TestClient(app)
    r = client.get("/mcp/")
    assert r.status_code == 401


def test_mcp_rejects_wrong_bearer(monkeypatch):
    monkeypatch.setenv("RK_MCP_TOKEN", "secret")
    from app.main import app
    client = TestClient(app)
    r = client.get("/mcp/", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401
```

- [ ] **Step 2: Run**

Run: `cd research-kit/backend && pytest tests/contract/test_mcp_auth.py -v`
Expected: PASS (both).

- [ ] **Step 3: Commit**

```bash
git add research-kit/backend/tests/contract/test_mcp_auth.py
git commit -m "test(mcp): bearer token required + rejected on mismatch"
```

### Task L5.6: Contract test — tools/list exposes three

**Files:**
- Create: `research-kit/backend/tests/contract/test_mcp_tools.py`

- [ ] **Step 1: Write the test**

```python
"""Verify the MCP server exposes exactly the three RK tools."""
import asyncio
from app.mcp.server import mcp_server


def test_three_tools_registered():
    tools = asyncio.run(mcp_server.list_tools())
    names = sorted(t.name for t in tools)
    assert names == ["fetch_paper", "get_inbox_items", "search_inbox"]
```

- [ ] **Step 2: Run**

Run: `cd research-kit/backend && pytest tests/contract/test_mcp_tools.py -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add research-kit/backend/tests/contract/test_mcp_tools.py
git commit -m "test(mcp): tools/list exposes search_inbox, get_inbox_items, fetch_paper"
```

---

## Phase L6 — `GoClawRunner`

### Task L6.1: Skeleton + event mapping unit test (TDD)

**Files:**
- Create: `research-kit/worker/runners/goclaw.py` (skeleton first)
- Create: `research-kit/worker/tests/test_goclaw_runner.py`

- [ ] **Step 1: Write failing test for event mapping**

```python
"""Replay scripted WS frames and assert RunEvents are emitted in order."""
from __future__ import annotations
import asyncio
import json
import sys
import types
from uuid import uuid4
from unittest.mock import AsyncMock

import pytest

from rk_shared.types import RunKind


class _ScriptedWS:
    def __init__(self, frames: list[dict]):
        self._out = list(frames)
        self.sent: list[dict] = []

    async def send(self, raw):
        self.sent.append(json.loads(raw))

    async def recv(self):
        if not self._out:
            await asyncio.sleep(3600)
        return json.dumps(self._out.pop(0))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


def _install_fake_websockets(monkeypatch, ws):
    async def fake_connect(url):
        return ws
    monkeypatch.setitem(sys.modules, "websockets",
                        types.SimpleNamespace(connect=fake_connect))


@pytest.mark.asyncio
async def test_event_mapping_emits_started_token_completed(monkeypatch):
    frames = [
        # connect ok
        {"type": "res", "id": "<connect>", "result": {}},
        # chat.send accepted
        {"type": "res", "id": "<send>", "result": {}},
        # streamed events
        {"type": "event", "event": "agent",
         "payload": {"type": "run.started"}},
        {"type": "event", "event": "chat",
         "payload": {"type": "chunk", "text": "hello"}},
        {"type": "event", "event": "agent",
         "payload": {"type": "run.completed",
                     "content": "hello",
                     "usage": {"input_tokens": 10, "output_tokens": 5}}},
        # sessions.delete ok
        {"type": "res", "id": "<del>", "result": {}},
    ]
    ws = _ScriptedWS(frames)
    _install_fake_websockets(monkeypatch, ws)

    from worker.runners.goclaw import GoClawRunner

    emitted = []
    async def on_event(ev):
        emitted.append(ev.type)
        return 1

    cancel = AsyncMock()
    cancel.is_set = AsyncMock(return_value=False)

    runner = GoClawRunner(ws_url="ws://x", token="t")
    result = await runner.run(
        kind=RunKind.VERIFY, user_id=uuid4(), run_id=uuid4(),
        messages=[{"role": "user", "content": "claim X"}],
        on_event=on_event, cancel=cancel, request_id="req-1",
    )

    assert result["content"] == "hello"
    assert "started" in emitted
    assert "token" in emitted
    sent_methods = [m.get("method") for m in ws.sent]
    assert "connect" in sent_methods
    assert "chat.send" in sent_methods
    assert "sessions.delete" in sent_methods  # stateless kind cleans up
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd research-kit && pytest worker/tests/test_goclaw_runner.py::test_event_mapping_emits_started_token_completed -v`
Expected: FAIL (`ModuleNotFoundError: worker.runners.goclaw`).

- [ ] **Step 3: Implement minimal `GoClawRunner`**

```python
"""Thin WebSocket client that runs a single chat against GoClaw."""
from __future__ import annotations
import asyncio
import json
from contextlib import suppress
from uuid import UUID, uuid4

import websockets

from rk_shared.events import RunEvent
from rk_shared.types import RunKind
from worker.runners.base import AgentRunner, CancelToken, CancelledByUser

CANCEL_POLL_SEC = 0.5
CANCEL_DEADLINE_SEC = 2.0


class UpstreamError(Exception):
    def __init__(self, code: str, message: str, recoverable: bool):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.recoverable = recoverable


class GoClawRunner(AgentRunner):
    def __init__(self, ws_url: str, token: str):
        self._url = ws_url.rstrip("/")
        self._token = token

    async def run(self, *, kind, user_id, run_id, messages, on_event,
                  cancel, request_id):
        agent_key = f"rk-{kind.value.lower()}"
        is_chat = kind == RunKind.CHAT
        if is_chat:
            project_id = messages[0].get("project_id", run_id)
            session_key = f"rk:project:{project_id}:chat"
        else:
            session_key = f"rk:run:{run_id}"
        prompt = self._render(messages)

        async with websockets.connect(f"{self._url}/ws") as ws:
            await self._req(ws, "connect",
                            {"token": self._token, "user_id": str(user_id),
                             "protocol": 3})
            send_id = await self._req_async(ws, "chat.send", {
                "message": prompt, "sessionKey": session_key,
                "agentId": agent_key,
            })

            cancel_task = asyncio.create_task(
                self._cancel_watcher(ws, session_key, cancel)
            )
            try:
                final = None
                while final is None:
                    raw = await ws.recv()
                    msg = json.loads(raw)
                    if msg.get("type") != "event":
                        continue
                    final = await self._handle(msg, on_event)
                return final
            finally:
                cancel_task.cancel()
                with suppress(asyncio.CancelledError):
                    await cancel_task
                if not is_chat:
                    with suppress(Exception):
                        await self._req(ws, "sessions.delete",
                                        {"key": session_key})

    @staticmethod
    def _render(messages: list[dict]) -> str:
        if len(messages) == 1 and messages[0].get("role") == "user":
            return messages[0].get("content", "")
        # multi-turn: flatten with role tags
        parts = [f"[{m.get('role','user')}] {m.get('content','')}"
                 for m in messages]
        return "\n\n".join(parts)

    async def _req(self, ws, method: str, params: dict) -> dict:
        req_id = str(uuid4())
        await ws.send(json.dumps({"type": "req", "id": req_id,
                                   "method": method, "params": params}))
        while True:
            raw = await ws.recv()
            msg = json.loads(raw)
            if msg.get("id") == req_id and msg.get("type") in ("res", "err"):
                if msg["type"] == "err":
                    err = msg.get("error", {})
                    raise UpstreamError(err.get("code", "upstream"),
                                        err.get("message", ""),
                                        recoverable=True)
                return msg
            # otherwise drop unrelated frames

    async def _req_async(self, ws, method: str, params: dict) -> str:
        req_id = str(uuid4())
        await ws.send(json.dumps({"type": "req", "id": req_id,
                                   "method": method, "params": params}))
        return req_id

    async def _handle(self, msg: dict, on_event) -> dict | None:
        ev = msg.get("event")
        payload = msg.get("payload", {}) or {}
        ptype = payload.get("type")
        if ev == "agent" and ptype == "run.started":
            await on_event(RunEvent(type="started", data={}))
            return None
        if ev == "chat" and ptype == "chunk":
            await on_event(RunEvent(type="token",
                                     data={"text": payload.get("text", "")}))
            return None
        if ev == "agent" and ptype == "tool.call":
            await on_event(RunEvent(type="tool_call", data=payload))
            return None
        if ev == "agent" and ptype == "tool.result":
            await on_event(RunEvent(type="tool_result", data=payload))
            return None
        if ev == "agent" and ptype == "run.completed":
            return {"content": payload.get("content", ""),
                    "usage": payload.get("usage", {})}
        if ev == "agent" and ptype == "run.failed":
            err = payload.get("error", {}) or {}
            raise UpstreamError(err.get("code", "upstream"),
                                err.get("message", ""),
                                recoverable=bool(payload.get("retryable", False)))
        if ev == "agent" and ptype == "run.cancelled":
            raise CancelledByUser()
        return None

    async def _cancel_watcher(self, ws, session_key: str,
                              cancel: CancelToken):
        while True:
            await asyncio.sleep(CANCEL_POLL_SEC)
            if await cancel.is_set():
                with suppress(Exception):
                    await ws.send(json.dumps({
                        "type": "req", "id": str(uuid4()),
                        "method": "chat.abort",
                        "params": {"sessionKey": session_key},
                    }))
                # main loop has CANCEL_DEADLINE_SEC to receive run.cancelled
                await asyncio.sleep(CANCEL_DEADLINE_SEC)
                with suppress(Exception):
                    await ws.close()
                return
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd research-kit && pytest worker/tests/test_goclaw_runner.py::test_event_mapping_emits_started_token_completed -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add research-kit/worker/runners/goclaw.py research-kit/worker/tests/test_goclaw_runner.py
git commit -m "feat(worker): GoClawRunner skeleton + event mapping (started/token/completed)"
```

### Task L6.2: Cancel within 2s test

- [ ] **Step 1: Append failing test**

In `research-kit/worker/tests/test_goclaw_runner.py`:

```python
@pytest.mark.asyncio
async def test_cancel_emits_chat_abort_within_2s(monkeypatch):
    import time
    frames = [
        {"type": "res", "id": "<connect>", "result": {}},
        {"type": "res", "id": "<send>", "result": {}},
        {"type": "event", "event": "agent",
         "payload": {"type": "run.started"}},
        {"type": "event", "event": "chat",
         "payload": {"type": "chunk", "text": "..."}},
        # then nothing arrives — cancel kicks in
        {"type": "event", "event": "agent",
         "payload": {"type": "run.cancelled"}},
    ]
    ws = _ScriptedWS(frames)
    _install_fake_websockets(monkeypatch, ws)
    from worker.runners.goclaw import GoClawRunner
    from worker.runners.base import CancelledByUser

    cancel = AsyncMock()
    cancel.is_set = AsyncMock(side_effect=[False, True, True, True])

    runner = GoClawRunner(ws_url="ws://x", token="t")
    t0 = time.monotonic()
    with pytest.raises(CancelledByUser):
        await runner.run(
            kind=RunKind.VERIFY, user_id=uuid4(), run_id=uuid4(),
            messages=[{"role": "user", "content": "x"}],
            on_event=lambda ev: AsyncMock(return_value=1)(),
            cancel=cancel, request_id="r",
        )
    elapsed = time.monotonic() - t0
    assert elapsed < 2.5, f"cancel took {elapsed}s"
    sent_methods = [m.get("method") for m in ws.sent]
    assert "chat.abort" in sent_methods
```

- [ ] **Step 2: Run, expect PASS** (logic already implemented in L6.1)

Run: `cd research-kit && pytest worker/tests/test_goclaw_runner.py::test_cancel_emits_chat_abort_within_2s -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add research-kit/worker/tests/test_goclaw_runner.py
git commit -m "test(goclaw-runner): cancel emits chat.abort within 2s"
```

### Task L6.3: Session cleanup test (sticky for chat, delete for stateless)

- [ ] **Step 1: Append test**

```python
@pytest.mark.asyncio
async def test_chat_kind_does_not_delete_session(monkeypatch):
    frames = [
        {"type": "res", "id": "<connect>", "result": {}},
        {"type": "res", "id": "<send>", "result": {}},
        {"type": "event", "event": "agent",
         "payload": {"type": "run.completed", "content": "hi", "usage": {}}},
    ]
    ws = _ScriptedWS(frames)
    _install_fake_websockets(monkeypatch, ws)
    from worker.runners.goclaw import GoClawRunner

    cancel = AsyncMock()
    cancel.is_set = AsyncMock(return_value=False)

    runner = GoClawRunner(ws_url="ws://x", token="t")
    await runner.run(
        kind=RunKind.CHAT, user_id=uuid4(), run_id=uuid4(),
        messages=[{"role": "user", "content": "hi", "project_id": "p1"}],
        on_event=lambda ev: AsyncMock(return_value=1)(),
        cancel=cancel, request_id="r",
    )
    methods = [m.get("method") for m in ws.sent]
    assert "sessions.delete" not in methods
    # session key must use project scope
    send = next(m for m in ws.sent if m.get("method") == "chat.send")
    assert send["params"]["sessionKey"] == "rk:project:p1:chat"
```

- [ ] **Step 2: Run, expect PASS**

Run: `cd research-kit && pytest worker/tests/test_goclaw_runner.py::test_chat_kind_does_not_delete_session -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add research-kit/worker/tests/test_goclaw_runner.py
git commit -m "test(goclaw-runner): chat kind keeps session, stateless deletes"
```

### Task L6.4: Wire factory env

**Files:**
- Modify: `research-kit/worker/runner_factory.py`

- [ ] **Step 1: Read current**

Run: `cat research-kit/worker/runner_factory.py`

- [ ] **Step 2: Update goclaw branch to pass env**

Find:
```python
        if backend == "goclaw":
            from worker.runners.goclaw import GoClawRunner
            return GoClawRunner()
```

Replace with:
```python
        if backend == "goclaw":
            from worker.runners.goclaw import GoClawRunner
            return GoClawRunner(
                ws_url=os.environ["GOCLAW_WS_URL"],
                token=os.environ["GOCLAW_GATEWAY_TOKEN"],
            )
```

- [ ] **Step 3: Quick smoke**

Run: `cd research-kit && GOCLAW_WS_URL=ws://x GOCLAW_GATEWAY_TOKEN=t RK_RUNNER=goclaw python -c "from worker.runner_factory import build_runner; from rk_shared.types import RunKind; print(type(build_runner(RunKind.VERIFY)).__name__)"`
Expected: `GoClawRunner`

- [ ] **Step 4: Commit**

```bash
git add research-kit/worker/runner_factory.py
git commit -m "feat(worker): wire env into GoClawRunner via runner_factory"
```

---

## Phase L7 — Smoke + Invariants (HALT POINT)

### Task L7.1: Bring up the stack

- [ ] **Step 1: Compose up**

```bash
cd research-kit/infra
docker compose pull goclaw
docker compose up -d
docker compose ps
```
Expected: all services `healthy` or `running`; `goclaw_init` in state `exited (0)`.

- [ ] **Step 2: Inspect goclaw_init logs**

Run: `docker compose logs goclaw_init`
Expected: 30 lines like `ok: rk-verify/AGENTS.md`, plus a final `done`.

- [ ] **Step 3: STOP if init fails**

If `goclaw_init` does not exit 0:
- read `docker compose logs goclaw` for hints (token mismatch, agent not loaded, etc.)
- read `docker compose logs goclaw_init` for the failing call
- Common causes: `agents.files.set` field name mismatch (try `agentKey` vs `agentId`), connect protocol number, request envelope shape. Reconcile with `goclaw-docs/reference/websocket-protocol.md` and update `init.py` accordingly. Recommit.

### Task L7.2: Verify rk-inbox MCP visible to GoClaw

**Files:**
- Create: `research-kit/backend/tests/contract/test_goclaw_mcp_visible.py`

- [ ] **Step 1: Write the test (uses real running stack)**

```python
"""Hits the running gateway's REST API to verify our MCP server is connected."""
import os
import httpx
import pytest

GOCLAW_HTTP = os.environ.get("GOCLAW_HTTP_URL", "http://localhost:18790")
TOKEN = os.environ.get("GOCLAW_GATEWAY_TOKEN")


@pytest.mark.skipif(not TOKEN, reason="set GOCLAW_GATEWAY_TOKEN to run")
def test_rk_inbox_mcp_connected_with_three_tools():
    r = httpx.get(
        f"{GOCLAW_HTTP}/v1/mcp/servers",
        headers={"Authorization": f"Bearer {TOKEN}"},
        timeout=10.0,
    )
    assert r.status_code == 200, r.text
    servers = r.json()
    rk = next((s for s in servers if s.get("id") == "rk-inbox" or s.get("name") == "rk-inbox"), None)
    assert rk, f"rk-inbox not found in {servers}"
    assert rk.get("connected") is True
    tool_names = {t.get("name") for t in rk.get("tools", [])}
    assert {"rk_search_inbox", "rk_get_inbox_items", "rk_fetch_paper"}.issubset(tool_names)
```

- [ ] **Step 2: Run**

```bash
export $(grep -v '^#' research-kit/infra/.env | xargs)
cd research-kit/backend && pytest tests/contract/test_goclaw_mcp_visible.py -v
```
Expected: PASS. If field names differ, reconcile with `goclaw-docs/reference/rest-api.md` and adjust the test (and tool prefix in `config.json` if `rk_` did not apply).

- [ ] **Step 3: Commit**

```bash
git add research-kit/backend/tests/contract/test_goclaw_mcp_visible.py
git commit -m "test(goclaw): rk-inbox MCP server connected with 3 prefixed tools"
```

### Task L7.3: Rewrite smoke test

**Files:**
- Modify: `research-kit/backend/tests/contract/test_goclaw_smoke.py` (full replace)

- [ ] **Step 1: Write the real smoke**

```python
"""Smoke: open a WS to the running goclaw, send chat to rk-verify, expect a chunk + run.completed."""
import asyncio
import json
import os
import uuid

import pytest
import websockets

WS_URL = os.environ.get("GOCLAW_WS_URL", "ws://localhost:18790")
TOKEN = os.environ.get("GOCLAW_GATEWAY_TOKEN")


@pytest.mark.skipif(not TOKEN, reason="set GOCLAW_GATEWAY_TOKEN to run")
def test_chat_send_streams_to_completion():
    async def _run():
        async with websockets.connect(f"{WS_URL}/ws") as ws:
            req = {"type": "req", "id": str(uuid.uuid4()),
                   "method": "connect",
                   "params": {"token": TOKEN, "user_id": "smoke",
                              "protocol": 3}}
            await ws.send(json.dumps(req))
            assert json.loads(await ws.recv())["type"] == "res"

            send_id = str(uuid.uuid4())
            await ws.send(json.dumps({
                "type": "req", "id": send_id, "method": "chat.send",
                "params": {"message": "Reply with the JSON: {\"verdict\":\"not_found\",\"confidence\":0,\"quote\":\"\",\"reason\":\"no paper\"}",
                           "sessionKey": f"smoke:{uuid.uuid4()}",
                           "agentId": "rk-verify"},
            }))
            saw_started = False
            saw_completed = False
            async with asyncio.timeout(60):
                while not saw_completed:
                    msg = json.loads(await ws.recv())
                    if msg.get("type") != "event":
                        continue
                    p = msg.get("payload", {})
                    if p.get("type") == "run.started":
                        saw_started = True
                    if p.get("type") == "run.completed":
                        saw_completed = True
            assert saw_started and saw_completed
    asyncio.run(_run())
```

- [ ] **Step 2: Run**

```bash
cd research-kit/backend && pytest tests/contract/test_goclaw_smoke.py -v
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add research-kit/backend/tests/contract/test_goclaw_smoke.py
git commit -m "test(goclaw): rewrite smoke to hit real gateway via WS chat.send"
```

### Task L7.4: Reconcile WS frame shape if needed

- [ ] **Step 1: Capture a real frame transcript**

If L6 unit tests use field names that the live gateway does not emit, log raw frames during the smoke test and compare with `_handle`. To capture, temporarily add `print(raw)` in `_handle` (or run a quick interactive script).

- [ ] **Step 2: Adjust `_handle` field paths**

Common likely deltas:
- payload field for chunk text may be `delta` or `content` instead of `text`
- the event group names may differ (e.g. `agent` vs `chat`)
- `tool.call`/`tool.result` may live under different `event` group

Update `_handle` in `worker/runners/goclaw.py` and the corresponding fake frames in `test_goclaw_runner.py`. Re-run all 3 unit tests + smoke.

- [ ] **Step 3: Commit reconciliation (only if changes were needed)**

```bash
git add research-kit/worker/runners/goclaw.py research-kit/worker/tests/test_goclaw_runner.py
git commit -m "fix(goclaw-runner): reconcile WS frame field names with live gateway"
```

### Task L7.5: Run all 8 invariants with `RK_RUNNER=goclaw`

- [ ] **Step 1: Set runner**

```bash
export RK_RUNNER=goclaw
cd research-kit
```

- [ ] **Step 2: Run worker test suite**

```bash
pytest worker/tests/ -v -x
```
Expected: ALL PASS, including:
- `test_cancel_within_2s.py`
- `test_crash_retry.py`
- `test_event_bus_monotonic_seq.py`
- `test_event_bus_persist_before_publish.py`
- `test_execute_run.py`
- `test_kind_timeouts.py`
- `test_goclaw_outage_recoverable.py`

- [ ] **Step 3: Run backend test suite**

```bash
pytest backend/tests/ -v -x
```
Expected: ALL PASS.

- [ ] **Step 4: STOP HERE if any invariant fails**

This is the HALT POINT defined in spec §6. Do not advance to L8. Diagnose:
- If cancel >2s: revisit `_cancel_watcher` deadline + check that the gateway acks `chat.abort` quickly. The 2s force-close branch should still satisfy invariant #4.
- If `goclaw_outage_recoverable` flaky: confirm WS connect errors map to `UpstreamError(recoverable=True)`.

Once everything is green, continue.

### Task L7.6: Verify rollback path

- [ ] **Step 1: Switch to mock**

```bash
export RK_RUNNER=mock
docker compose -f research-kit/infra/docker-compose.yml up -d worker
```

- [ ] **Step 2: Re-run invariants**

```bash
cd research-kit && pytest worker/tests/ -v -x
```
Expected: ALL PASS (mock path).

- [ ] **Step 3: Switch back to goclaw**

```bash
export RK_RUNNER=goclaw
docker compose -f research-kit/infra/docker-compose.yml up -d worker
```

---

## Phase L8 — Pin Image + Final Cleanup

### Task L8.1: Pin GoClaw image to a specific version

- [ ] **Step 1: Read which exact digest worked at L7**

```bash
docker inspect ghcr.io/nextlevelbuilder/goclaw:latest --format '{{ index .RepoDigests 0 }}'
```
Note the printed digest, e.g. `ghcr.io/nextlevelbuilder/goclaw@sha256:abc...`. Also check the equivalent semver tag:

```bash
docker run --rm ghcr.io/nextlevelbuilder/goclaw:latest --version 2>&1 | head -1
```

- [ ] **Step 2: Update compose**

In `research-kit/infra/docker-compose.yml`, replace
```yaml
    image: ghcr.io/nextlevelbuilder/goclaw:latest
```
with the captured `vX.Y.Z` (preferred) or the digest form:
```yaml
    image: ghcr.io/nextlevelbuilder/goclaw:vX.Y.Z
```

- [ ] **Step 3: Re-pull + re-run smoke**

```bash
cd research-kit/infra
docker compose pull goclaw
docker compose up -d goclaw goclaw_init
docker compose logs goclaw_init | tail -5
cd .. && pytest backend/tests/contract/test_goclaw_smoke.py -v
```
Expected: smoke still PASS on pinned tag.

- [ ] **Step 4: Commit**

```bash
git add research-kit/infra/docker-compose.yml
git commit -m "chore(infra): pin goclaw image to vX.Y.Z (post-smoke)"
```

### Task L8.2: Final acceptance check

- [ ] **Step 1: Re-run full suite end-to-end**

```bash
cd research-kit/infra && docker compose down -v && docker compose up -d
cd .. && pytest worker/tests backend/tests -v
```
Expected: ALL PASS, fresh stack.

- [ ] **Step 2: Open PR to main**

```bash
git push -u origin new-idea-agent
gh pr create --title "GoClaw integration replacement (real image + MCP + thin WS runner)" \
  --body "$(cat <<'EOF'
## Summary
- Replaces broken GoClaw stub plan with real `ghcr.io/nextlevelbuilder/goclaw` integration.
- 5 predefined agents seeded via `goclaw_init` WS one-shot (`agents.files.set`).
- Custom RK tools served from a single `/mcp` (FastMCP, Bearer-auth).
- ~150 LOC `GoClawRunner` (WS chat.send/abort/sessions.delete).
- All 8 invariants green with `RK_RUNNER=goclaw`; `RK_RUNNER=mock` rollback verified.

## Test plan
- [x] `goclaw_init` exits 0 and seeds 30 files
- [x] `test_mcp_auth.py`, `test_mcp_tools.py` PASS
- [x] `test_goclaw_smoke.py`, `test_goclaw_mcp_visible.py` PASS
- [x] All 8 invariants PASS with `RK_RUNNER=goclaw`
- [x] All 8 invariants PASS with `RK_RUNNER=mock`
- [x] Image pinned to specific `vX.Y.Z`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Acceptance Criteria (from spec §11)

1. ✅ `docker compose up -d` — all services healthy, `goclaw_init` exits 0.
2. ✅ `pytest backend/tests/contract/test_goclaw_smoke.py` — PASS, no skip.
3. ✅ `pytest backend/tests/contract/test_mcp_*.py` — PASS.
4. ✅ All 8 invariants PASS with `RK_RUNNER=goclaw`.
5. ✅ `RK_RUNNER=mock` rollback verified.
6. ✅ Image tag pinned in `docker-compose.yml`.
