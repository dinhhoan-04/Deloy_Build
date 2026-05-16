# ResearchKit Brainstorming Artifacts

> Tất cả insights từ brainstorm session ngày 2026-05-07. Dùng để thống nhất vision khi phát triển tiếp Phase 2, Phase 3.

---

## 1. THREE APPROACHES ANALYZED

### Approach A: Verify-First Badge
**Inline badges trực tiếp trên DOM trang**
- Ưu: Zero friction, không cần thay đổi workflow user, MVP nhanh nhất
- Nhược: Passive (chỉ verify), không giải quyết writing friction, giá trị giới hạn nếu không có full-text access
- **Decision:** MVP feature (Phase 1) → Deferred để Phase 2

### Approach B: Research Pipeline Hub ⭐ RECOMMENDED
**Extension là trung tâm của toàn bộ research workflow**
- Flow: Collect → Verify → Cross-analyze → Draft
- Ưu: Giải quyết ALL 4 pain points, differentiated, sticky, tự nhiên với workflow
- Nhược: Phức tạp hơn, cần state management
- **Decision:** CORE VISION → Phase 2 lấy làm main

### Approach C: Conversational Co-pilot
**Chat interface + research-aware context**
- Ưu: UX quen thuộc, flexible
- Nhược: Không có structure, giống nhiều tool khác đã có
- **Decision:** Deferred → combine vào Phase 2 chat context

---

## 2. USER WORKFLOW — 6 STEPS

```
1. SEARCH       User opens Elicit / Consensus / SciSpace
                → Extension detects site, sidebar available
                → Auto-verify starts in background

2. AUTO-VERIFY  Extension extracts claims + paper links from page
                → Hybrid adapter (DOM + LLM) structures data
                → Backend verifies via OpenAlex + Claude
                → Badges appear progressively (~2-4s each)

3. COLLECT      [Phase 2] User clicks "Save to Inbox" on verified claims
                → Saved với verbatim quote, paper metadata, source tool
                → Organized per project session

4. CROSS-ANALYZE [Phase 2] When same paper appears in multiple tools
                → Conflict Detector flags discrepancies
                → User reviews side-by-side

5. DRAFT        [Phase 2, user-triggered] User selects claims from Inbox
                → AI generates paragraph, citations inline
                → User copies to their writing tool

6. EXPORT       [Phase 2, user-triggered, optional]
                → Zotero RIS or Markdown export
```

---

## 3. FEATURE MATRIX — V1 vs V2 vs V3

| Tính Năng | V1 (MVP) | V2 (Core) | V3 (Future) |
|-----------|----------|-----------|-------------|
| **Verify Badge Inline** | ✅ | — | — |
| **Verify Progress Indicator** | ✅ | — | — |
| **Claim Tooltip** | ✅ | — | — |
| **Verify Toggle** | ✅ | — | — |
| **Verify Summary Panel** | ✅ | — | — |
| **Hybrid Adapter (LLM fallback)** | ✅ | — | — |
| **Research Inbox** | — | ✅ | — |
| **Cross-Tool Conflict Detector** | — | ✅ | — |
| **AI Chat (context-aware)** | — | ✅ | — |
| **Literature Review Drafter** | — | ✅ | — |
| **Project Sessions** | — | ✅ | — |
| **Export (Zotero/Markdown)** | — | ✅ | — |
| **Citation Mgmt Integration** | — | — | ✅ |
| **Multi-provider LLM** | — | — | ✅ |
| **Cloud Sync** | — | — | ✅ |

---

## 4. SIDEBAR UI LAYOUT — 4 TABS

```
┌─────────────────────────────────────┐
│ 🔬 ResearchKit       [● LIVE] [⚙]  │
├─────────────────────────────────────┤
│ [Verifying 4/12 ████░░░░] 33% [pause]
├─────────────────────────────────────┤
│ [✓ Verify] [📌 Inbox] [💬 Chat] [✍️ Draft]
├─────────────────────────────────────┤
│                                      │
│ ✓ VERIFY TAB (Active)               │
│ ─────────────────────────────────   │
│ This page · 12 claims found         │
│ [✓ 3] [⚠ 5] [✗ 1]                  │
│                                      │
│ ✅ VERIFIED                          │
│ "Sleep increases memory recall"      │
│ Walker 2017 · p.142 · OpenAccess    │
│ [Save to Inbox] [View Quote]        │
│                                      │
│ ⚠️ PARTIAL — abstract only          │
│ "REM sleep accounts for 80%..."     │
│ Smith 2020 · paywall · abstract     │
│ [Upload PDF] [Skip]                 │
│                                      │
│ ❌ NOT FOUND                        │
│ "Participants showed 40% improve"   │
│ Chen 2019 · full-text checked      │
│                                      │
└─────────────────────────────────────┘
```

---

## 5. ARCHITECTURE — 5 LAYERS

### Browser Layer
- **content.ts** — Detect site, extract claims via hybrid adapter, inject badges, listen for results
- **background.ts** — Queue manager (3 concurrent), progress tracking, message routing
- **sidebar (React)** — 4 tabs UI (Verify, Inbox, Chat, Draft)
- **adapters/** — Elicit/SciSpace/Consensus DOM parsers

### Backend Layer
- **verify_service.py** — Fetch paper via OpenAlex, call Claude for verbatim quote
- **chat_service.py** — [Phase 2] WebSocket stream with context
- **draft_service.py** — [Phase 2] Literature review generation + citation formatting
- **extract_service.py** — LLM claim extraction for hybrid adapter fallback

### External APIs
- **OpenAlex** — Paper lookup by DOI/title (free, 100k req/day)
- **Unpaywall** — Fallback full-text URLs
- **Claude API** — Verify + chat + draft (claude-sonnet-4-6 with prompt caching)
- **Semantic Scholar** — Fallback fuzzy title match

### Storage
- **chrome.storage.local** — Verified claims, inbox, project sessions, settings
- **Backend in-memory cache** — Verify results by DOI (avoid re-fetch)

### Data Flow
```
content.ts extract claims + DOI
    → background.ts queue
        → POST /verify endpoint
            → OpenAlex API (get full-text URL)
                → Fetch PDF/HTML
                    → Claude (find verbatim quote)
                        → Return {status, quote, confidence}
                            → background.ts update badge DOM
                                → sidebar show result
```

---

## 6. KEY DESIGN PRINCIPLES

### "Suggest, Don't Force"
- Verify chạy tự động nhưng có thể pause/toggle OFF
- Mọi step trong pipeline đều optional
- Extension surfaces suggestions; user decides

### Verify is Non-Blocking
- Chạy background service worker → researcher không phải wait
- Progress bar visible nhưng researcher vẫn browse bình thường

### Every Badge Has Explanation
- ✅ must link to verbatim quote
- ⚠️ must explain why partial (paywall, abstract-only)
- ❌ must show what was searched

### Draft Uses Only Verified Data
- Literature Review Drafter chỉ pull claims với status=verified|partial
- Never fabricate → `not_found=True` instead

### not_found is Honest
- Never invent quote
- If claim cannot be verified → status=not_found (explicit)

---

## 7. TECH STACK DECISIONS

| Component | Choice | Why |
|-----------|--------|-----|
| Extension | Chrome MV3 (Manifest v3) | Modern standard, security |
| Frontend Framework | React + TypeScript | Existing codebase |
| State Management | Zustand (client-side) + chrome.storage.local | Lightweight, no server needed |
| Backend Framework | FastAPI | Already in codebase |
| LLM Provider | Claude (Anthropic) | Best for verification task, prompt caching |
| Paper Lookup | OpenAlex API | Free tier sufficient, good coverage |
| Full-text Fallback | Unpaywall | Complements OpenAlex well |
| Model | claude-sonnet-4-6 | Fast + affordable for streaming |
| Cache | In-memory (DOI-level) | No DB needed for V1 |

---

## 8. PAIN POINTS SOLVED — Priority Order

| Pain Point | V1 | V2 | V3 |
|------------|----|----|-----|
| **Hallucination Verification** | ✅ Badge | ✅ Detailed Report | ✅ Continuous Learning |
| **Cross-Tool Fragmentation** | — | ✅ Conflict Detector | ✅ Auto-reconcile |
| **Writing Friction** | — | ✅ AI Draft | ✅ Collaborative Editing |
| **Citation Management** | — | ✅ Export | ✅ Sync to Zotero |

---

## 9. NEXT STEPS — ROADMAP

### Phase 2: Core Pipeline (4-6 weeks)
1. Research Inbox (persistent storage, per-project)
2. Cross-Tool Conflict Detector (side-by-side comparison)
3. AI Chat with context (only use verified claims)
4. Literature Review Drafter (paragraph generation)
5. Project sessions (isolation per research topic)

### Phase 3: Enhancement (2-3 weeks)
1. Citation formatting (APA/MLA/Vancouver)
2. Export integrations (Zotero, Obsidian, Notion)
3. Multi-provider LLM (OpenAI, Gemini as fallback)
4. Cloud sync (optional user login)

### Phase 4: Scale (TBD)
1. Premium tier (faster verify, more providers)
2. Research team collaboration
3. Citation analytics (which papers are most cited)

---

## 10. IMPLEMENTATION CHECKLIST — V1 Complete

- [x] OpenAlex client (lookup by DOI/title)
- [x] Verify service (fetch full-text + Claude verify)
- [x] Extract service (LLM fallback for hybrid adapter)
- [x] Backend routes (/verify, /extract)
- [x] Hybrid adapter (DOM + LLM extraction)
- [x] Badge injection (inline ✅⚠️❌ indicators)
- [x] Background queue (3 concurrent, progress tracking)
- [x] Content script (claim extraction + badge injection)
- [ ] Sidebar Verify tab UI (defer to Phase 2)
- [ ] Integration smoke test (manual in Chrome)

---

## 11. DESIGN REFERENCE FILES

- **Spec:** `docs/superpowers/specs/2026-05-07-researchkit-pipeline-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-07-researchkit-phase1-mvp.md`
- **Brainstorm:** This file
- **Code:** `research-kit/` (backend + extension)

---

## How to Use This Document

1. **Before starting Phase 2:** Read Section 1-3 to align on vision
2. **During implementation:** Reference Section 4-5 for UI/architecture
3. **For new teammates:** Read Section 6-8 to understand design philosophy
4. **Roadmap planning:** See Section 9 for what comes next
5. **Progress tracking:** Update Section 10 checklist as you ship

---

**Last Updated:** 2026-05-07  
**Status:** Phase 1 MVP Complete, Phase 2 Ready to Plan
