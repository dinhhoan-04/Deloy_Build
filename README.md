# ResearchKit

Chrome extension sidebar for academic research — verify AI-generated claims, manage sources, draft literature reviews.

Works on [Elicit](https://elicit.com), [SciSpace](https://scispace.com), and [Consensus](https://consensus.app).

---

## What it does

| Feature | Description |
|---------|-------------|
| **Verify** | Check AI-generated claims against cited papers. Returns `verified / partial / not_found / inaccessible` with a verbatim quote. |
| **Inbox** | Collect and manage sources extracted from research pages. Archive, add to projects. |
| **Projects** | Organise verified claims and sources into research projects. |
| **Drafts** | Export literature review drafts as `.md` or `.docx` with date metadata. |
| **Conflicts** | Detect conflicting claims across sources. |

---

## Architecture

```
research-kit/
├── extension/          # Chrome extension (React + TypeScript + Vite)
│   └── src/
│       ├── sidebar/    # Main UI — tabs, state, components
│       ├── shared/     # API client, auth, SSE, types
│       ├── extract/    # Content extraction from research pages
│       └── content.ts  # Content script injected into pages
│
├── backend/            # FastAPI + PostgreSQL + Redis
│   └── app/
│       ├── routers/    # auth, verify, inbox, projects, claims, drafts, conflicts, extract, runs
│       ├── llm/        # LLM providers (OpenAI / Groq / Gemini)
│       ├── models/     # SQLAlchemy models
│       ├── repos/      # DB access layer
│       └── main.py     # Entry point
│
├── worker/             # ARQ background worker (async jobs)
├── shared/             # Shared Python types/schemas
├── infra/              # Docker Compose + Render config
└── landing/            # Landing page
```

---

## Local Development

### Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL + Redis (or Docker)

### Backend

```bash
cd research-kit/backend

# Install dependencies
pip install -e ".[dev]"

# Set up environment
cp .env.example .env
# Edit .env: DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY (or OPENAI/GROQ/GOOGLE)

# Run migrations
alembic upgrade head

# Start server
uvicorn app.main:app --port 8000 --reload
```

Health check: `curl http://localhost:8000/health`

### Extension

```bash
cd research-kit/extension

npm install
npm run build        # Production build → dist/
npm run dev          # Watch mode
npm test             # Run tests
```

Load in Chrome:
1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `research-kit/extension/dist/`

### Worker (optional — for async verify jobs)

```bash
cd research-kit/worker
python -m arq worker.WorkerSettings
```

### Docker Compose (all services)

```bash
cd research-kit/infra
docker compose up --build
```

---

## Deployment

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for the AWS deployment overview and [research-kit/infra/aws/README.md](./research-kit/infra/aws/README.md) for the step-by-step scripts.

---

## Docs

| File | Purpose |
|------|---------|
| [FILE_MAP.md](./FILE_MAP.md) | Full file reference |
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | AWS deployment overview |
| [research-kit/infra/aws/README.md](./research-kit/infra/aws/README.md) | AWS infrastructure + deploy scripts |
| [QUICKSTART.md](./QUICKSTART.md) | 5-minute local setup |
| [docs/GoClaw/](./docs/GoClaw/) | Backend API reference |
