# Quick Start — 5 Minutes

Get Research Kit running locally.

## Prerequisites

- Chrome browser
- Python 3.11+
- Node.js 18+
- PostgreSQL + Redis (or Docker)

---

## Option A: Docker (Easiest)

```bash
cd research-kit/infra
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY (or OPENAI/GROQ/GOOGLE key)

docker compose up --build
```

Backend: `http://localhost:8000/health`

Skip to **Step 3**.

---

## Option B: Manual

### Step 1: Backend (2 min)

```bash
cd research-kit/backend

# Install dependencies
pip install -e ".[dev]"

# Set up env
cp .env.example .env
# Edit .env: DATABASE_URL, REDIS_URL, and at least one LLM key

# Run migrations
alembic upgrade head

# Start server
uvicorn app.main:app --port 8000 --reload
```

Verify: `curl http://localhost:8000/health` → `{"status":"ok"}`

### Step 2: Extension (1 min)

```bash
cd research-kit/extension
npm install
npm run build
```

---

## Step 3: Load Extension in Chrome

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select `research-kit/extension/dist/`

---

## Step 4: Test

1. Open [https://elicit.com](https://elicit.com) — the ResearchKit sidebar opens automatically
2. Go to the **Verify** tab
3. Paste any AI-generated text with citations (URLs or DOIs)
4. Click **Verify** — results stream in with `verified / partial / not_found` status per claim

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Sidebar doesn't open | Make sure you're on elicit.com, scispace.com, or consensus.app |
| `health` returns error | Check backend is running and DATABASE_URL is set |
| Verify returns error | Check at least one LLM API key is set in `.env` |
| Extension not updating | Rebuild (`npm run build`) then click Refresh in `chrome://extensions/` |

---

## Next Steps

- **Deploy:** See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- **File reference:** See [FILE_MAP.md](./FILE_MAP.md)
