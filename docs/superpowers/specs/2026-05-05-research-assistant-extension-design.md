# Research Assistant Extension — Design Spec

**Date:** 2026-05-05
**Status:** Draft, awaiting user review
**Author:** Brainstormed with Claude (Opus 4.7)
**Replaces / supersedes:** Earlier `research-kit/extension/` per-site capture flow (chatbot-targeted) is dropped. This spec re-bases the extension on a normalized adapter layer plus a backend agent for academic AI tools.

---

## 1. Problem Statement

Researchers using AI tools that surface academic papers (Elicit, SciSpace, Consensus) face two unsolved problems:

1. **Verification friction.** Each tool surfaces claims with citations, but verifying a single claim, link, or paragraph requires manual click-through, source reading, and judgment. There is no in-place "is this claim actually supported by the cited paper?" affordance.
2. **Cross-tool synthesis.** A user often runs the same question across two or three tools to triangulate. Synthesizing the results — agreement, contradictions, coverage gaps — happens by hand in another doc.

The previous extension iteration tried to solve a related problem for chatbots (ChatGPT, Perplexity), but ran into severe DOM-extraction churn and never got to a clean agent layer. We are dropping the chatbot surfaces and re-targeting academic-research AI tools with a cleaner architecture.

## 2. Goals and Non-Goals

### Goals
- A browser extension that works on **Elicit, SciSpace, and Consensus**, providing two interaction surfaces:
  - A **sidebar chat** for open-ended requests ("summarize this report", "compare with the SciSpace tab I had open").
  - **Selection actions** — highlight a paragraph, claim, or citation, get a quick action menu (Verify / Summarize / Cross-check).
- A **single backend agent** (Anthropic SDK, A1 pattern) with a small toolbox that operates exclusively on a normalized `PageModel`, never raw HTML.
- **Per-feature retrieval strategy:** single-site features extract only the relevant DOM region; multi-site features collect normalized models from each open tab.
- **Verification fidelity:** every verification result includes a verbatim quote from the source paper (or a clear "not found"), reusing the project's `verbatim_quote` invariant.

### Non-Goals (v1)
- Chatbots (ChatGPT, Perplexity, Claude.ai, Gemini). Re-add later if there is real demand.
- Generic websites (Wikipedia, blogs, Google search). Out of scope — the adapter model is for known AI tools.
- Browser-side LLM calls (option B). Always dropped — API key would be exposed.
- Multi-step browser automation by the agent (clicking, scrolling, navigating on the user's behalf). That is the future C/D evolution.
- Persistent cross-session capture library. v1 is request-scoped: the extension reads tabs that are open at request time.

## 3. Key Decisions (from brainstorm)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Scope = AI tools only (no generic web) | Adapter-per-site is feasible only for known surfaces |
| 2 | UX = sidebar chat + selection actions (hybrid) | Selection covers "verify this specific thing"; sidebar covers cross-site synthesis |
| 3 | State = per-feature retrieval (not always full HTML) | Single-site → DOM region; multi-site → enumerate open tabs at request time |
| 4 | Agent location = A (thin extension + brain backend) for v1 | Fastest to ship, API key safe, easy to iterate prompts |
| 5 | Backend = A1 (single agent + tool list) | Simplest; refactor to A2/A3 only after tool count > 15 |
| 6 | DOM extraction = layered with `PageModel` abstraction | Per-site complexity confined to one adapter file; backend tools are DOM-agnostic |
| 7 | Sites for v1: Elicit, SciSpace, Consensus | Academic-paper AI tools where verification has highest value |

### Future evolution (explicitly recorded, not built)
- **Phase 2 → C/D:** browser-as-tool-surface. The backend agent calls into the extension via WebSocket (`extract_dom`, `get_open_tabs`, `scroll_to`, `screenshot`) so it can resolve vague user requests through multi-step page interaction. Migration path: keep current backend tools (which take `PageModel`) and add a second tool family that takes "browser handles" — old tools keep working.
- **A1 → A2/A3:** if the toolbox grows past ~15 entries and the agent starts mis-selecting tools, introduce a router (Haiku) that classifies intent and dispatches to a specialized agent.
- **Persistent capture library:** if users repeatedly ask "synthesize the 5 Elicit reports I read this week," add explicit "research session" pinning (option C from the brainstorm).
- **LLM extraction fallback:** if site-adapter telemetry shows frequent breakage, add a circuit breaker that ships a raw HTML chunk to a cheap LLM (Haiku) for ad-hoc extraction.

## 4. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  EXTENSION (Chrome, MV3, TypeScript, React)                    │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Site Adapters — the ONLY place per-site DOM lives       │ │
│  │  src/extension/adapters/                                 │ │
│  │    elicit-adapter.ts                                     │ │
│  │    scispace-adapter.ts                                   │ │
│  │    consensus-adapter.ts                                  │ │
│  │  Each implements: SiteAdapter interface → PageModel      │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Sidebar (React)                                         │ │
│  │  - Chat thread, model = backend agent                    │ │
│  │  - Shows tool-call traces (verify_link, summarize, …)    │ │
│  │  - "Include other open AI tabs" toggle                   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Selection action layer (content script overlay)         │ │
│  │  - Detects text selection in supported sites             │ │
│  │  - Floating bubble: Verify / Summarize / Cross-check     │ │
│  │  - Result rendered in overlay (or routed to sidebar)     │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Background service worker                               │ │
│  │  - Single backend HTTP client                            │ │
│  │  - tab enumeration for multi-site requests               │ │
│  │  - adapter health telemetry                              │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────┬───────────────────────────────────┘
                             │  HTTPS (POST PageModel + request)
                             ▼
┌────────────────────────────────────────────────────────────────┐
│  BACKEND (Python 3.11, FastAPI)                                │
│                                                                │
│  POST /agent/run                                               │
│    body: { request: str, page_models: [PageModel],             │
│            selection?: SelectionRef, mode: "chat"|"action" }   │
│    response: streamed agent events (text + tool_use + tool_res)│
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Agent (Anthropic SDK, claude-sonnet-4-6)                │ │
│  │  - Single agent loop with tool-use                       │ │
│  │  - Prompt cache on system prompt + tool schemas          │ │
│  │  - Streams events back via SSE                           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Tools (operate on PageModel — never raw HTML)           │ │
│  │    verify_link(citation_id, page_model)                  │ │
│  │    verify_claim(text, citation_id, page_model)           │ │
│  │    extract_section(message_id, page_model)               │ │
│  │    summarize(page_model)                                 │ │
│  │    cross_compare(page_models[])                          │ │
│  │    fetch_paper(url)   ← network: DOI/PDF resolver        │ │
│  │    web_search(query)  ← network: fallback search         │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  Storage (SQLite for v1):                                      │
│    - request_log (audit), adapter_telemetry                    │
│    - paper_cache (URL → resolved metadata + extracted text)    │
└────────────────────────────────────────────────────────────────┘
```

## 5. The `PageModel` Contract

This is the single most load-bearing artifact in the system. It is the contract between the extension's per-site adapters and every backend tool. Get it wrong and you pay everywhere.

```typescript
interface PageModel {
  site: "elicit" | "scispace" | "consensus";
  schemaVersion: "1.0";
  capturedAt: string;                       // ISO-8601
  url: string;
  title: string;

  // The user's question / prompt to the AI tool, if recoverable from the page
  query?: string;

  // Top-level synthesized answer / report the tool produced
  // (Elicit "report", SciSpace summary, Consensus claim summary).
  // For Elicit table mode, this is null and `tableRows` is populated.
  answer?: {
    id: string;                             // stable hash
    text: string;                           // plain-text, paragraph-preserving
    paragraphs: Paragraph[];                // each paragraph + its citation refs
  };

  // Elicit "table" mode and similar — rows of structured extractions
  tableRows?: TableRow[];

  // Citations (papers cited anywhere on the page)
  citations: Citation[];

  // Optional: only present when the request was triggered by a text selection
  selection?: SelectionRef;

  // Adapter health metadata
  adapterMeta: {
    adapterVersion: string;                 // "elicit/2026-05-05"
    extractionWarnings: string[];           // empty = clean extract
    selectorHits: Record<string, number>;   // for telemetry
  };
}

interface Paragraph {
  id: string;
  text: string;
  citationIds: string[];                    // refs into PageModel.citations
}

interface Citation {
  id: string;                               // stable within page
  label: string;                            // e.g., "[3]" or "Smith 2021"
  url?: string;                             // resolved URL if available
  doi?: string;
  title?: string;
  authors?: string[];
  year?: number;
  rawAnchorText: string;                    // what was visible on the page
}

interface TableRow {
  id: string;
  paperCitationId: string;                  // FK to Citation
  cells: Record<string, { text: string; citationIds: string[] }>;
}

interface SelectionRef {
  text: string;
  contextBefore: string;                    // ~200 chars
  contextAfter: string;                     // ~200 chars
  nearestParagraphId?: string;
  nearestCitationIds: string[];
}
```

**Invariants:**
- `PageModel` is the only thing that crosses the extension→backend boundary for page content. Backend tools accept `PageModel` (or fragments of it) as input — never raw HTML strings.
- `Citation.id` is stable within a page so tools can cross-reference (`verify_link(citation_id="c3", page_model=…)`).
- `extractionWarnings` is non-empty when the adapter could not fully populate the model. Backend should surface this to the user ("I had trouble reading this page — results may be incomplete") rather than silently degrade.

## 6. Site Adapters

### Interface

```typescript
interface SiteAdapter {
  readonly site: PageModel["site"];
  readonly version: string;                 // e.g., "elicit/2026-05-05"

  matches(url: string): boolean;
  toPageModel(doc: Document, opts?: { selection?: Range }): PageModel;
}
```

Adapters live in `extension/src/adapters/` and are registered at extension load. The background worker dispatches to the right adapter based on the active tab's URL.

### Resilience tactics (per the brainstorm)
1. **Resilient selectors:** prefer `[role="…"]`, `[data-…]`, semantic tags, ARIA labels. Avoid auto-generated CSS class names.
2. **Multi-tier selectors:** every field has primary + ≥1 fallback selector. Adapter records which tier hit (`selectorHits`) for telemetry.
3. **Snapshot tests:** `tests/extension/fixtures/` holds saved HTML per site (one healthy snapshot, plus diff snapshots after each observed DOM change). Adapter tests run offline against these.
4. **Health telemetry:** if `toPageModel` returns empty `answer`/`citations` on a page that visually has them, the background worker emits a `adapter_low_yield` event. v1 logs to backend; later we can alert on it.
5. **(Phase 2, not built in v1)** LLM extraction fallback when `extractionWarnings` exceeds a threshold.

### Per-site notes (from current code + observable site behavior)
- **Elicit:** has a "report" mode (free-text answer with inline citations) and a "table" mode (structured extraction across papers). Adapter must detect the mode and emit either `answer` or `tableRows`. Existing `elicit.ts` content script already encodes some of this — we will rewrite it against the `SiteAdapter` interface, not extend the old shape.
- **SciSpace:** chat-style interface with sources panel; the AI summary and citations are separated in the DOM. Adapter must stitch claim → citation back together via on-page anchor links.
- **Consensus:** "claim" cards with supporting / contradicting papers. Adapter emits `answer` (the consensus statement) + `citations` with a `stance` field (extension to the schema below if needed).

### Schema extension for Consensus

If Consensus emits a stance per citation, extend `Citation` with an optional field:

```typescript
interface Citation {
  // … existing fields
  stance?: "supporting" | "contradicting" | "mixed" | "neutral";
}
```

This is optional — adapters that don't have stance information leave it unset.

## 7. Backend Tools

Each tool is a Python function with an Anthropic tool schema, registered in a single `tools.py`. All take `PageModel` (or a list of them) as input. None take raw HTML.

| Tool | Inputs | Returns | Notes |
|------|--------|---------|-------|
| `verify_link` | `citation_id`, `page_model` | `{ status, fetched_url, title, abstract?, fetch_error? }` | Resolves the citation URL/DOI, fetches metadata. No claim comparison — just "does the link resolve to a real paper?" |
| `verify_claim` | `claim_text`, `citation_id`, `page_model` | `{ verdict: supported\|partial\|unsupported\|uncertain, verbatim_quote?, page?, reasoning }` | Ports the verification approach used by the existing `verify-claim` Claude skill into a Python tool: fetch source via `fetch_paper`, locate evidence, return verbatim quote or `not_found`. `verbatim_quote` is sacred. |
| `extract_section` | `paragraph_id` or selection, `page_model` | `{ text, citation_ids }` | Used when agent wants to focus on a specific paragraph the user selected. |
| `summarize` | `page_model`, `style?` | `{ summary, key_claims[] }` | Single-page summary. |
| `cross_compare` | `page_models[]` | `{ agreements[], contradictions[], coverage_gaps[], per_source_summary[] }` | Multi-site synthesis. Inputs are 2–5 normalized models. |
| `fetch_paper` | `url` or `doi` | `{ title, abstract, full_text?, source }` | Network. Caches in `paper_cache`. Used by `verify_*`. |
| `web_search` | `query` | `{ results[] }` | Network. Used as last-resort source-finder when a citation has no URL/DOI. |

**Total: 7 tools.** Below the ~15 threshold where A1 starts to break down — confirms A1 is the right call for v1.

### Tool implementation rules
- All tools are pure functions of input + (cache, network). No global state.
- All tools log to `request_log` with input hash, latency, outcome.
- `verify_*` tools must return either a `verbatim_quote` from the source or a clear `not_found` — never paraphrase. (Same invariant as ARAS `EvidenceItem`.)
- Tool errors return structured error objects, never raise — the agent should be able to recover and try alternatives.

## 8. Sidebar UX

- **Single chat thread per browser session.** Cleared when the side panel is closed (v1 — no persistence).
- **Active context strip** at top of sidebar shows: current tab URL, detected site, "include N other open AI tabs" toggle.
- **Tool-use trace:** when the agent calls a tool, the sidebar renders a collapsed card ("🔧 verify_link → ✓ resolved to nature.com/…"). User can expand to see inputs/outputs. This is for trust, not just debugging.
- **Citations rendered as chips** with hover-card showing `Citation` metadata; click opens source in new tab.
- **Streaming:** SSE from `/agent/run`, render as it arrives.

## 9. Selection Action UX

- Content script attaches a `selectionchange` listener (debounced, 250ms).
- When selection length is between 10 and 2000 chars and is inside the adapter's recognized content area, show a floating bubble anchored above the selection.
- Bubble buttons: **Verify**, **Summarize**, **Cross-check**.
  - **Verify** → calls `/agent/run` with mode=`action`, request="verify the selected text", `page_model.selection` populated.
  - **Summarize** → "summarize the selected passage and surrounding context".
  - **Cross-check** → "find what other open AI tabs say about this".
- Result renders in a dismissible overlay anchored to the selection. A "Continue in sidebar" button promotes the result into the main sidebar thread.

## 10. Backend API

Single endpoint, streamed:

```
POST /agent/run
Content-Type: application/json
Body: {
  request: string,
  page_models: PageModel[],
  selection?: SelectionRef,
  mode: "chat" | "action",
  conversation_id?: string,        // for sidebar threading; ignored in action mode
}

Response: text/event-stream
  event: text         data: {"delta": "…"}
  event: tool_use     data: {"name": "verify_link", "input": {…}}
  event: tool_result  data: {"name": "verify_link", "output": {…}}
  event: done         data: {"stop_reason": "end_turn"}
  event: error        data: {"message": "…"}
```

Auth for v1: extension sends a static API token from extension settings (user pastes once). Real auth deferred — the backend is intended to be self-hosted by the user during v1.

## 11. Tech Stack

- **Extension:** TypeScript, React 18, Vite + `@crxjs/vite-plugin`, MV3, Chrome target only for v1 (Firefox later).
- **Backend:** Python 3.11, FastAPI, Anthropic SDK (with prompt caching `cache_control={"type":"ephemeral"}`), SQLite via SQLAlchemy, `httpx` for paper fetching.
- **Models:** `claude-sonnet-4-6` for the main agent. `claude-haiku-4-5-20251001` reserved for future router/extraction fallback.
- **Reuse from current repo:** the FastAPI app skeleton, `verify-claim` and `verify-batch` skill logic (port into `verify_claim` tool), prompt caching pattern from `src/agent.py`. The current `extension/src/content/{chatgpt,perplexity,elicit}.ts` files are reference material — the Elicit one informs the new adapter, the others are dropped.

## 12. Repo Layout (proposed)

```
research-kit/
  extension/
    src/
      adapters/                    # NEW — per-site adapters
        types.ts                   # SiteAdapter, PageModel
        elicit-adapter.ts
        scispace-adapter.ts
        consensus-adapter.ts
        registry.ts                # url → adapter dispatch
      sidebar/                     # renamed from sidepanel/
        App.tsx, ChatThread.tsx, ToolCallCard.tsx, …
      content/
        selection-overlay.ts       # NEW — selection bubble
        adapter-host.ts            # NEW — runs the matched adapter on demand
      background.ts                # tab enumeration, telemetry, HTTP client
      shared/
        api.ts                     # /agent/run client (SSE)
        types.ts                   # mirrors PageModel from adapters/types.ts
    tests/
      fixtures/
        elicit/{report-mode.html, table-mode.html}
        scispace/{chat.html}
        consensus/{claim.html}
      adapters/{elicit,scispace,consensus}.test.ts
    manifest.json                  # host_permissions: elicit/scispace/consensus only
  backend/
    app/
      main.py                      # FastAPI, /agent/run SSE endpoint
      agent.py                     # Anthropic loop with prompt caching
      tools/
        __init__.py
        verify_link.py
        verify_claim.py
        extract_section.py
        summarize.py
        cross_compare.py
        fetch_paper.py
        web_search.py
      models/                      # Pydantic mirrors of PageModel
      storage/                     # SQLAlchemy models, paper_cache
      telemetry.py
    tests/
      unit/                        # tools tested against PageModel fixtures
      integration/                 # /agent/run end-to-end
```

## 13. Testing Strategy

- **Adapter unit tests** (per site, against snapshot HTML in `tests/fixtures/`): assert `PageModel` shape, citation count, paragraph count, selection extraction. These are the early-warning system for site DOM changes.
- **Tool unit tests** (Python, against PageModel JSON fixtures): exercise each tool independently. No network — `fetch_paper` and `web_search` use recorded fixtures.
- **Agent integration tests:** small set of end-to-end scenarios (verify a known-good citation, verify a known-bad one, cross-compare 2 fixtures) hitting a recorded LLM trace or a small live model in CI.
- **Manual smoke test checklist** per site, run before each release: open a real Elicit / SciSpace / Consensus result, verify selection bubble appears, run each action, confirm sidebar streams correctly.

## 14. Telemetry & Observability

- `request_log`: every `/agent/run` invocation — request hash, mode, model, tool calls made, latency, token usage, outcome.
- `adapter_telemetry`: per-extraction event with `adapterVersion`, `extractionWarnings`, `selectorHits`. Lets us see when an adapter's primary selectors stop hitting and fallbacks take over.
- No PII in telemetry. URLs are hashed unless the user opts in.

## 15. Difficulty Estimate

| Workstream | Difficulty | Estimate |
|------------|-----------:|---------:|
| `PageModel` schema + types shared extension/backend | 3/10 | 4h |
| Elicit adapter (rewrite) + fixtures + tests | 5/10 | 10h |
| SciSpace adapter + fixtures + tests | 5/10 | 8h |
| Consensus adapter + fixtures + tests | 5/10 | 8h |
| Sidebar React UI (chat, tool-trace, citation chips) | 5/10 | 14h |
| Selection overlay + bubble | 5/10 | 8h |
| Background worker (HTTP client, tab enum, telemetry) | 4/10 | 6h |
| FastAPI `/agent/run` SSE endpoint + agent loop | 4/10 | 8h |
| 7 tools | 5/10 | 16h |
| `paper_cache` + SQLite storage | 3/10 | 4h |
| Tests (adapter snapshots + tool unit + integration) | 4/10 | 10h |
| Manifest, build pipeline, packaging | 3/10 | 4h |
| **Total MVP** | **~5/10** | **~100h** |

The earlier brainstorm estimate of 50–65h assumed reuse of more existing code and 5 tools instead of 7. The number above is honest for a from-mostly-scratch v1 with three sites.

The single highest-risk item is **adapter durability under DOM churn** — this is mitigated, not eliminated, by snapshot tests and telemetry.

## 16. Open Questions for User Review

1. **Browser scope.** Chrome only for v1, or also Firefox? Firefox MV3 still has gaps; recommend Chrome only.
2. **Sidebar persistence.** v1 ships with no chat persistence (cleared on side-panel close). Acceptable for MVP, or do you want lightweight in-memory persistence per browser session?
3. **Auth model.** v1 assumes self-hosted backend with a static token. Confirm this matches deployment intent, or do we need real auth?
4. **`fetch_paper` source priority.** When verifying a citation: try Unpaywall first? Crossref? OpenAlex? Direct publisher? Confirm the order of fallbacks before implementing.
5. **Consensus stance field.** Add the optional `Citation.stance` field as proposed, or keep `Citation` strictly minimal in v1?

These are not blockers for the implementation plan — they can be answered when the relevant task is scheduled — but they should be resolved before that task begins.
