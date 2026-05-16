# FILE MAP — Research Kit

> Thống kê tác dụng của tất cả file liên quan đến Research Kit (Chrome Extension + Backend).
> Sản phẩm: Sidebar nghiên cứu học thuật trên Elicit/SciSpace/Consensus.

---

## 📁 Root

| File | Tác dụng |
|------|----------|
| `README.md` | Tổng quan sản phẩm và hướng dẫn dev |
| `CLAUDE.md` | Hướng dẫn cho AI agent về project (auto-loaded) |
| `AGENTS.md` | Quy tắc làm việc cho team |
| `DEPLOYMENT_GUIDE.md` | Hướng dẫn deploy lên Render + Chrome Web Store |
| `QUICKSTART.md` | Setup local trong 5 phút |
| `FILE_MAP.md` | File này — bản đồ codebase |

---

## 📁 research-kit/backend/

### `app/` — FastAPI Server

| File | Tác dụng |
|------|----------|
| `main.py` | **Entry point.** Khởi tạo FastAPI app, CORS, middleware, mount tất cả routers |
| `config.py` | Settings từ env vars (database, redis, API keys, runner mode) |
| `db.py` | SQLAlchemy async engine init |
| `deps.py` | FastAPI dependency injection (db session, current user) |
| `errors.py` | Global error handler — chuẩn hoá HTTP error responses |
| `middleware.py` | RequestIdMiddleware (inject X-Request-ID vào mỗi request) |
| `queue.py` | ARQ job queue helpers |
| `redis_pool.py` | Redis connection pool |
| `verify_service.py` | Business logic verify: fetch PDF → LLM check → trả kết quả |
| `openalex.py` | OpenAlex API client (tra cứu metadata bài báo) |
| `pdf_fetch.py` | Tải PDF từ DOI / URL |
| `idempotency.py` | Idempotency key middleware cho POST requests |
| `logging.py` | Logging config |

### `app/routers/` — API Endpoints

| Router | Prefix | Tác dụng |
|--------|--------|----------|
| `auth.py` | `/v1/auth` | Google OAuth login/logout, session |
| `verify.py` | `/v1/verify` | Verify claim vs paper (auto-fetch PDF hoặc upload) |
| `inbox.py` | `/v1/inbox` | CRUD inbox items; bulk archive/unarchive |
| `projects.py` | `/v1/projects` | CRUD research projects |
| `claims.py` | `/v1/claims` | CRUD claims trong project |
| `drafts.py` | `/v1/drafts` | Tạo và export draft (.md/.docx) |
| `conflicts.py` | `/v1/conflicts` | Detect conflicting claims |
| `extract.py` | `/v1/extract` | Extract claims/citations từ page content |
| `runs.py` | `/v1/runs` | Track verify job runs, SSE stream status |
| `demo.py` | `/v1/demo` | Demo endpoints (không cần auth) |

### `app/llm/` — LLM Layer

| File | Tác dụng |
|------|----------|
| `providers.py` | Multi-provider client (OpenAI / Groq / Gemini / Anthropic) |
| `prompt.py` | Prompt templates cho verify, extract, conflict detection |
| `schema.py` | Pydantic schemas cho LLM responses |
| `validator.py` | Validate và parse LLM output |

### `app/models/` — Database Models

SQLAlchemy ORM models: User, InboxItem, Project, Claim, Draft, VerifyRun, ConflictGroup.

### `app/repos/` — Repository Layer

Data access layer — tách DB queries khỏi router logic.

### `app/schemas/` — Pydantic Schemas

Request/response schemas cho tất cả endpoints.

### `app/auth/` — Authentication

| File | Tác dụng |
|------|----------|
| `google.py` | Google OAuth flow |
| `session.py` | Session management (Redis-backed) |

### `alembic/` — Database Migrations

| Migration | Tác dụng |
|-----------|----------|
| `0001_initial.py` | Schema ban đầu |
| `0002_paper_content.py` | Thêm paper content cache |
| `0003_verify_and_paper_scope_cache.py` | Verify result + scope cache |
| `0004_inbox_archived_at.py` | archived_at column cho inbox |
| `0005_drafts.py` | Drafts table |

### Config

| File | Tác dụng |
|------|----------|
| `.env` | API keys + DB URLs thực — không commit |
| `.env.example` | Template để setup |
| `pyproject.toml` | Dependencies và package config |

---

## 📁 research-kit/extension/

### Config

| File | Tác dụng |
|------|----------|
| `manifest.json` | Manifest v3. Permissions, content scripts, side panel, service worker |
| `vite.config.ts` | Build config — compile TypeScript/React → `dist/` |
| `package.json` | Dependencies: React, Zustand, Tailwind 4, vite-plugin-crx |

### `src/` — Source Code

#### Background & Content

| File | Tác dụng |
|------|----------|
| `background_minimal.ts` | Service worker. Mở side panel khi phát hiện research site |
| `content.ts` | Content script. Detect site, extract page content khi sidebar yêu cầu |

#### `src/shared/` — Utilities & API Client

| File | Tác dụng |
|------|----------|
| `api.ts` | HTTP client với auth header, base URL config |
| `auth.ts` | Auth state helpers (check login, get session) |
| `sse.ts` | SSE (Server-Sent Events) client cho verify streaming |
| `site-detect.ts` | Detect site từ URL → `'elicit' \| 'scispace' \| 'consensus' \| null` |
| `messages.ts` | Chrome message types (content ↔ background ↔ sidebar) |
| `storage.ts` | Chrome storage helpers |
| `types.ts` | Shared TypeScript types |
| `site-state.ts` | Per-tab site state tracking |
| `verify-types.ts` | Types cho verify flow (VerifyResult, status enum) |
| `errors.ts` | Error classes và HTTP error parsing |

#### `src/extract/` — Content Extraction

| File | Tác dụng |
|------|----------|
| `run-extract.ts` | Orchestrate extraction: detect site, parse DOM, trả structured claims/citations |
| `types.ts` | ExtractResult, Citation, Claim types |

#### `src/adapters/` — Site-Specific Parsers

| File | Tác dụng |
|------|----------|
| `dom-serializer.ts` | DOM → structured data cho từng site (Elicit/SciSpace/Consensus) |

#### `src/sidebar/` — React UI (Side Panel)

**State:**

| File | Tác dụng |
|------|----------|
| `state/` | Zustand stores: verify, inbox, projects, claims, drafts, conflicts, UI |

**Hooks:**

| File | Tác dụng |
|------|----------|
| `hooks/` | useVerify, useInbox, useProjects, useDrafts, useConflicts — data fetching + mutations |

**Components:**

| File | Tác dụng |
|------|----------|
| `components/` | Atoms, Shell (layout), Tab panels (Verify/Inbox/Projects/Drafts/Conflicts), Overlays |

**Selectors:**

| File | Tác dụng |
|------|----------|
| `selectors/` | Derived state selectors cho từng feature |

### `dist/` — Built Extension (auto-generated)

> Output của `npm run build`. Load folder này vào `chrome://extensions/`.

---

## 📁 research-kit/worker/

ARQ worker cho background jobs (verify PDF processing khi dùng queue mode).

---

## 📁 research-kit/infra/

Docker Compose config: backend + worker + PostgreSQL + Redis.

---

## 📁 docs/

| Thư mục | Tác dụng |
|---------|----------|
| `docs/GoClaw/` | Backend API reference (endpoints, WebSocket protocol, Docker) |
| `docs/bugs/` | Bug tracking notes |
| `docs/superpowers/specs/` | Design specs (lịch sử thiết kế) |
| `docs/superpowers/plans/` | Implementation plans (lịch sử triển khai) |

---

## Luồng dữ liệu

```
User mở Elicit/SciSpace/Consensus
    ↓
[content.ts] Detect site → gửi 'page-detected' tới background
    ↓
[background_minimal.ts] Mở side panel
    ↓
User paste text có citations vào Verify tab
    ↓
[sidebar] Gọi POST /v1/verify qua api.ts
    ↓
[verify.py] Fetch PDF → LLM check claim vs paper text
    ↓
SSE stream: verified / partial / not_found / inaccessible + verbatim quote
    ↓
[sidebar] Render kết quả theo từng claim
```

---

## Lệnh hàng ngày

```bash
# Backend
cd research-kit/backend
uvicorn app.main:app --port 8000 --reload

# Extension
cd research-kit/extension
npm run build     # hoặc npm run dev (watch)
npm test

# Migrations
cd research-kit/backend
alembic upgrade head
```
