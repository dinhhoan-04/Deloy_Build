## Tổng kết session — GoClaw Integration

---

## 1. Những gì đã build (7 components)

| Component        | Path                                           | Mô tả                                       |
| ---------------- | ---------------------------------------------- | --------------------------------------------- |
| `config.json`  | `infra/goclaw/config.json`                   | 5 agents, 3 providers, MCP server, security   |
| Context files    | `infra/goclaw/agents/<agent>/*.md`           | 30 files personality + JSON schema            |
| `goclaw-init`  | `tools/goclaw-init/`                         | WS one-shot container seed context files      |
| MCP server       | `backend/app/mcp/`                           | FastMCP streamable-HTTP, 3 tools, bearer auth |
| `GoClawRunner` | `worker/runners/goclaw.py`                   | WS client, event mapping, cancel 2s           |
| Tests            | `backend/tests/contract/`, `worker/tests/` | Unit tests GoClawRunner pass                  |
| Compose + env    | `infra/docker-compose.yml`, `.env.example` | Full stack definition                         |

---

## 2. Bug fixes và bài học

### 🐛 pgvector:pg18 volume mount path thay đổi

**Lỗi:** `goclaw_postgres` exit(1)
**Nguyên nhân:** pg18+ Docker images không dùng `/var/lib/postgresql/data` nữa
**Fix:**

```yaml
# Sai
volumes: [goclaw_pgdata:/var/lib/postgresql/data]
# Đúng
volumes: [goclaw_pgdata:/var/lib/postgresql]
```

**Bài học:** Khi dùng image major version mới (pg18), check breaking changes về volume paths.

---

### 🐛 GoClaw schema outdated + SSL error

**Lỗi:** GoClaw exit(1) — `Database schema is outdated: current v0, required v57`
**Fix:**

```yaml
environment:
  GOCLAW_POSTGRES_DSN: postgresql://...?sslmode=disable  # thiếu sslmode
  GOCLAW_AUTO_UPGRADE: "true"                             # thiếu auto-migrate
```

**Bài học:** GoClaw cần 2 env vars không được document rõ:

* `sslmode=disable` trong DSN (local Postgres không có SSL)
* `GOCLAW_AUTO_UPGRADE=true` để tự migrate schema khi khởi động

---

### 🐛 FastMCP route path sai khi mount

**Lỗi:** `tools/list` trả về 404
**Nguyên nhân:** FastMCP đăng ký route nội bộ tại `/mcp`. Khi FastAPI `mount("/mcp", sub_app)`, FastAPI strip prefix `/mcp` → sub_app nhận path `/`. Nhưng FastMCP route là `/mcp` bên trong → phải gọi `/mcp/mcp`.

```
External: /mcp/mcp → FastAPI strip /mcp → sub_app receives /mcp → FastMCP matches ✓
External: /mcp/    → FastAPI strip /mcp → sub_app receives /   → 404 ✗
```

**Fix:** URL trong `config.json` và tests phải dùng `/mcp/mcp`
**Bài học:** Khi mount Starlette sub-app, prefix bị strip — cần biết route nội bộ của sub-app là gì.

---

### 🐛 FastMCP RuntimeError trong tests

**Lỗi:** `RuntimeError: Task group is not initialized. Make sure to use run()`
**Nguyên nhân:** FastMCP dùng anyio task group, khởi tạo qua ASGI lifespan. httpx `ASGITransport` không trigger ASGI lifespan theo mặc định.
**Fix:** Không test qua HTTP stack — dùng FastMCP internal API:

```python
# Thay vì POST /mcp/mcp:
mcp = create_mcp_server()
tools = mcp._tool_manager.list_tools()
```

**Bài học:** FastMCP (và nhiều ASGI apps) cần lifespan events trước khi handle requests. Trong tests không có uvicorn → lifespan không chạy. Test internal API thay vì HTTP khi có thể.

---

### 🐛 setuptools multiple top-level packages

**Lỗi:** `pip install -e ".[dev]"` fail — `Multiple top-level packages discovered: ['app', 'alembic']`
**Fix:** Thêm vào `pyproject.toml`:

```toml
[tool.setuptools.packages.find]
include = ["app*"]
```

**Bài học:** Project có `alembic/` và `app/` cùng level → setuptools không biết package nào là main. Phải khai báo rõ.

---

### 🐛 Worker `No module named 'worker'`

**Lỗi:** arq không import được `worker.main`
**Nguyên nhân:** `Dockerfile.worker` thiếu `PYTHONPATH=/app`, CMD sai (`main.WorkerSettings` thay vì `worker.main.WorkerSettings`), và không install worker package.
**Fix:**

```dockerfile
ENV PYTHONPATH=/app
RUN pip install -e /app/shared && pip install -e /app/worker
CMD ["arq", "worker.main.WorkerSettings"]
```

**Bài học:** Khi dùng `arq` với package structure, cần `PYTHONPATH` trỏ đúng root và dùng fully-qualified module path.

---

### 🐛 Backend Settings fields lỗi thời

**Lỗi:** `goclaw_url` và `goclaw_token` required nhưng không có trong `.env` mới
**Nguyên nhân:** `config.py` còn fields từ trước khi rename env vars sang `GOCLAW_WS_URL` / `GOCLAW_GATEWAY_TOKEN`. Backend không dùng những fields này (chỉ worker dùng).
**Fix:** Xóa 2 fields khỏi `Settings`
**Bài học:** Khi rename env vars, phải update cả `Settings` class — pydantic-settings map field name → env var name tự động.

---

### 🐛 SESSION_SECRET quá ngắn

**Lỗi:** `String should have at least 32 characters, input_value='changeme-32-bytes-random'`
**Nguyên nhân:** Placeholder trong `.env.example` chỉ 24 ký tự
**Fix:** Dùng chuỗi ≥32 ký tự trong file `.env` thực tế

---

## 3. Kinh nghiệm chung

1. **Đọc docs thực tế trước khi code** — Hầu hết lỗi đầu tiên (port 8080, env var sai, image tag sai) đến từ dùng docs không chính xác.
2. **`goclaw_init Exited` = thành công** — One-shot container pattern: `restart: "no"` + `service_completed_successfully` là cách đúng để gate downstream services.
3. **FastMCP cần lifespan** — Bất kỳ ASGI app nào dùng anyio/asyncio task group đều cần lifespan events. Không thể test bằng raw `ASGITransport` mà không trigger lifespan.
4. **Docker mount paths thay đổi theo major version** — pg18, Node 22, v.v. đều có breaking changes. Luôn check release notes khi upgrade major version.
5. **`BaseHTTPMiddleware` không phù hợp với streaming** — Nếu cần middleware cho ASGI app dùng SSE/streaming, dùng pure ASGI middleware (class với `__call__`) thay vì `BaseHTTPMiddleware`.
