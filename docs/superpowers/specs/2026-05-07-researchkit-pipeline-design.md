# ResearchKit Pipeline — Product Design Spec

**Date:** 2026-05-07  
**Status:** Draft — pending implementation plan  
**Product:** Browser extension (Chrome/Edge) for academic researchers

---

## 1. Problem

Researchers using AI-assisted tools (Elicit, Consensus, SciSpace) face four compounding pain points:

1. **Hallucination** — AI summaries cite papers incorrectly; numbers, quotes, and attributions are wrong
2. **Cross-tool fragmentation** — results from multiple tools contradict each other with no way to reconcile
3. **Writing friction** — verified evidence scattered across tabs; no path from notes to literature review draft
4. **Citation management overhead** — exporting to Zotero, reformatting, tracking what's been read

**Primary users:** PhD/Master students and academic researchers. Students are prioritized (larger population, clearer pain).

---

## 2. Product Vision

**ResearchKit** is a browser extension sidebar that acts as the researcher's pipeline hub: from AI tool output → verified evidence → synthesized draft. It does not replace Elicit/Consensus/SciSpace — it makes their output trustworthy and actionable.

**Core design principle: "Suggest, don't force."**  
Every feature is opt-in and user-controllable. Verify runs automatically in the background but can be paused or disabled at any time. No step in the pipeline forces the researcher to proceed. The extension surfaces suggestions; the researcher decides.

---

## 3. Phased Delivery

### Phase 1 — MVP (Ship first)

Focus: Auto-Verify Badge. Deliver measurable value with minimum scope.

**Features:**
| Feature | Description |
|---------|-------------|
| Auto-Verify Badge | Scan page → detect claims + paper links → badge ✅ ⚠️ ❌ injected inline on DOM. Runs in background even when sidebar is closed. |
| Verify Progress Indicator | Persistent bar in sidebar + floating mini-indicator: "Verifying 4/12 claims… 33%". Can pause/resume at any time. |
| Claim Tooltip | Hover badge → popup with verbatim quote, paper title, page number, confidence score |
| Verify Toggle | Global on/off switch. Off = no API calls, no badges. Accessible from sidebar and floating indicator. |
| Verify Summary Panel | Sidebar "Verify" tab: list all claims on current page, filterable by status (verified / partial / not found) |

### Phase 2 — Core Pipeline

**Features:**
| Feature | Description |
|---------|-------------|
| Research Inbox | Save verified claims with verbatim quotes to a persistent per-project inbox |
| Cross-Tool Conflict Detector | Detect when Elicit and Consensus summarize the same paper differently → flag side-by-side |
| AI Chat (context-aware) | Chat interface using only verified claims as context. "What do these papers agree on?" → grounded answers only |
| Literature Review Drafter | Select claims from Inbox → AI generates paragraph draft → copy to Word/Notion. Citations auto-formatted (APA/MLA/Vancouver). Only triggers on user action. |
| Project Sessions | Each research topic is a separate session. Inbox, claims, drafts persist per project. |
| Export | Zotero RIS export, Markdown for Obsidian/Notion. User-triggered only. |

---

## 4. User Workflow

```
1. SEARCH       User opens Elicit / Consensus / SciSpace
                → Extension detects site, sidebar available
                → Auto-verify starts in background (if enabled)

2. AUTO-VERIFY  Extension extracts claims + paper links from page
                → Hybrid adapter (DOM + LLM) structures the data
                → Backend verifies each claim via OpenAlex + Claude
                → Badges appear progressively as results return (~2-4s each)
                → User can see progress, pause, or ignore

3. COLLECT      [Phase 2] User clicks "Save to Inbox" on verified claims
                → Saved with verbatim quote, paper metadata, source tool
                → Organized per project session

4. CROSS-ANALYZE [Phase 2] When same paper appears in multiple tools
                → Conflict Detector flags discrepancies automatically
                → User reviews side-by-side, decides which to trust

5. DRAFT        [Phase 2, user-triggered] User selects claims from Inbox
                → Clicks "Draft Literature Review"
                → AI generates paragraph, citations inline
                → User copies to their writing tool

6. EXPORT       [Phase 2, user-triggered, optional]
                → Zotero RIS or Markdown export
                → Only when user explicitly requests
```

---

## 5. Technical Architecture

### 5.1 Browser Extension (Chrome Manifest v3)

**`content.ts`** — Runs on Elicit, Consensus, SciSpace pages
- Detect site via URL
- Extract page content using Hybrid Adapter (see §5.4)
- Inject badge DOM nodes next to claims
- Listen for verify results from background, update badges
- Send `page-detected` and `claims-extracted` messages to background

**`background.ts`** (Service Worker)
- Receive extracted claims, enqueue verify jobs
- Manage concurrent verify queue (3 parallel max)
- Track global progress state per tab
- Route messages between content.ts ↔ sidebar
- Persist verified claims to `chrome.storage.local`
- Survive sidebar close — queue continues running

**`sidebar/`** (React + Zustand)
- 4 tabs: Verify · Inbox · Chat · Draft
- Persistent progress bar with pause/resume
- Settings panel: toggle verify, choose LLM provider, per-site toggles
- State: Zustand for UI state; chrome.storage for persistence

**`adapters/`** — Hybrid Adapter pattern (see §5.4)

### 5.2 Backend (FastAPI, Python)

**`verify_service.py`** — Core MVP service
- `POST /verify` — receives `{claim, doi, paper_url, title}`
- Calls OpenAlex API to get open-access full-text URL
- Fetches full-text HTML/PDF text (Unpaywall fallback if needed)
- Calls Claude API to locate verbatim quote supporting/refuting claim
- Returns `{status: verified|partial|not_found, verbatim_quote, page_ref, confidence}`
- DOI-level cache to avoid re-fetching same paper

**`chat_service.py`** — Phase 2, extends current `main_openai.py`
- WebSocket `/ws/chat`
- Context = verified claims from user's Inbox
- Only synthesizes grounded, verified information

**`draft_service.py`** — Phase 2
- `POST /draft` — receives list of verified claims
- Returns streamed literature review paragraph
- Citation formatting: APA/MLA/Vancouver

### 5.3 External Services

| Service | Purpose | Cost |
|---------|---------|------|
| OpenAlex API | Paper lookup by DOI/title, open-access full-text URL | Free, 100k req/day |
| Unpaywall API | Fallback full-text URL when OpenAlex lacks it | Free |
| Claude API (`claude-sonnet-4-6`) | Verify claims, chat, draft. Prompt caching for repeated paper content | Per token |
| Semantic Scholar API | Fallback paper lookup by fuzzy title match | Free |

### 5.4 Hybrid Adapter Pattern

DOM-based adapters are fragile because Elicit/Consensus/SciSpace have multiple layout modes (table, report, chat, results list) and change their DOM structure without notice.

**Solution: Hybrid Adapter**

```
For each page load:
1. Try DOM selectors (fast, free, zero latency)
   - If confident extraction (>N claims found, structured data present) → use DOM result
2. If low confidence or empty result:
   - Send page innerText (or simplified HTML) to LLM
   - LLM prompt: "Extract all claims and their cited paper references from this research tool page"
   - LLM returns structured JSON: [{claim, paper_title, doi, authors, year}]
3. Merge: DOM result + LLM result, deduplicate
```

**Benefits:**
- Handles all layout variations without per-mode CSS selectors
- LLM normalizes claim text (useful for downstream verify)
- DOM path still fast for clear cases; LLM only invoked when needed
- Adding a new site = write a basic adapter shell, LLM handles the hard parts

### 5.5 Storage

| Store | Contents |
|-------|---------|
| `chrome.storage.local` | Verified claims, Research Inbox, Project sessions, user settings/toggles |
| Backend in-memory cache | Verify results keyed by DOI — avoids re-fetching same paper across users/sessions |

---

## 6. Key Invariants

- **Verify is non-blocking.** It runs in background; researcher never waits for it before browsing.
- **Every badge has an explanation.** ✅ badge must link to a verbatim quote. ⚠️ must explain why partial (abstract-only, etc.). ❌ must show what was searched.
- **Draft uses only verified data.** Literature Review Drafter only pulls from Inbox claims with status=verified or partial. Never uses unverified claims.
- **User can turn off anything.** Every automated behavior has a visible toggle. No silent background processes.
- **not_found is honest, never fabricated.** If claim cannot be verified, status=not_found. Never invent a quote.

---

## 7. What This Is Not

- Not a replacement for Elicit/Consensus/SciSpace — works alongside them
- Not a reference manager (Zotero/Mendeley) — export to those tools
- Not a general-purpose AI chatbot — Chat is grounded in verified research evidence only
- Not a PDF reader — focuses on AI tool output, not raw PDFs (PDF upload is a fallback for paywall only)

---

## 8. Open Questions (Phase 2)

- Citation style selection: per-project or global setting?
- Conflict detection sensitivity: how different must two summaries be to flag as conflict?
- Project session sync: local-only or optional cloud sync?
- LLM provider for hybrid adapter: same as verify provider, or separate cheaper model?
