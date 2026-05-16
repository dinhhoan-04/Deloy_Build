# Extract Pipeline Redesign — Pure-LLM, Provider-Agnostic

**Date:** 2026-05-11
**Status:** Design — pending implementation plan
**Author:** brainstorming session with NguyenVietHung

## Problem

The extension's claim-extraction pipeline is broken end-to-end. Site-specific DOM adapters (Elicit / SciSpace / Consensus) exist in `research-kit/extension/src/adapters/` but:

- `registry.ts` is empty — no `registerAdapter()` calls anywhere → `getAdapter(site)` always returns `null`.
- `extractClaimsHybrid()` in `hybrid.ts` is exported but never invoked (grep across repo confirms 0 callers).
- `content.ts` only handles badge updates and never triggers extraction.
- `background_minimal.ts` listens for `MSG_CLAIMS_EXTRACTED` but no sender exists.
- `dom-serializer.ts` is unwired.
- Backend `extract_service.py` uses Anthropic SDK; the user has no Anthropic API key.
- Adapters use brittle CSS selectors (`[class*="title"]`, `[class*="answer"]`) that break on minor DOM changes from any of the three target sites.

In short: code was scaffolded but never connected. The user is testing the product, hits the verify step, and finds nothing flowing through.

## Goal

Ship a working extraction pipeline that:

1. Extracts the **minimum viable verify payload** per claim: `claim text + paper title + DOI/URL + authors + year`.
2. Preserves **claim ↔ paper correspondence** correctly. Mixing up which claim cites which paper makes the verify step worthless.
3. Survives DOM changes across Elicit / SciSpace / Consensus without per-site maintenance.
4. Uses only providers the user has keys for: **Google Gemini (free tier, primary)** and **OpenAI (paid, fallback)**.
5. Auto-triggers on supported result pages, skips homepages, no caching in v1.

## Non-Goals (v1)

- URL/content-hash caching — defer until pipeline is stable.
- Pagination / infinite scroll — extract only the DOM available at idle.
- Selection-based extract (user highlights → extract only that span).
- Streaming LLM response.
- Retry with backoff after both providers fail.
- Per-user quota tracking.

## Architecture

```
[Content script]                    [Background SW]              [Backend]                   [LLM]
detectSite(url)
  ↓
shouldExtract(url)? ─ no → skip
  ↓ yes
wait DOM idle 1.5s
  ↓
serializeDOMToMarkdown()
  ↓
sendMessage(EXTRACT_REQUEST,
            {url, site, markdown})
                                    POST /v1/extract
                                    {url, site, page_markdown}
                                                                 LLMClient.extract()
                                                                 ─ Gemini Flash (primary)
                                                                 └ OpenAI 4o-mini (fallback)
                                                                                              structured
                                                                                              JSON output
                                                                 ↓
                                                                 validate_correspondence()
                                                                 (drop orphan paperIds,
                                                                  merge dup titles)
                                    ← {papers, claims, extractMeta}
flatten claim×paper
  ↓
MSG_CLAIMS_EXTRACTED
                                    enqueueForTab → /v1/verify
                                    (existing, unchanged)
```

**Key decisions:**

- **One LLM call** returns both `papers[]` and `claims[]` in a single response. Schema binds them via `paperIds`. No round-trips for extraction.
- **Backend proxies the LLM call** — API keys never reach the extension.
- **`shouldExtract(url)` gate runs in the content script**. URL pattern table per site (homepages excluded). Backend is not called for non-result pages.
- **Site-specific adapters are deleted entirely**. Pure-LLM path is the only path.

## Data Contract

### LLM structured output schema

This schema is the spine that prevents claim↔paper mix-up.

```jsonc
{
  "papers": [
    {
      "id": "p1",                  // local sequential ID assigned by LLM (p1, p2, ...)
      "title": "...",              // required
      "doi": "10.xxxx/yyyy" | null,
      "url": "https://..." | null, // arxiv / pubmed / publisher link if no DOI
      "authors": ["Smith", "Doe"], // last names; may be empty
      "year": 2023 | null,
      "anchorText": "[1]"          // marker as it appears on the page (sup, [1], (Smith 2023))
    }
  ],
  "claims": [
    {
      "id": "c1",
      "text": "Antibiotic resistance increases by 15% annually...",
      "paperIds": ["p1", "p3"]     // 1..N; every id MUST exist in papers[]
    }
  ]
}
```

**Constraint enforcement:**

- Schema sets `additionalProperties: false`, `claims[].paperIds.minItems: 1`. Claims without citations are excluded at the LLM level.
- Backend post-validates every `paperIds[i]` against `papers[].id`. Orphan references → drop the offending claim and emit a warning. **Never auto-fix orphan IDs** — silently rewriting correspondence is worse than dropping a claim.
- Title-similarity dedupe: papers with identical titles but different ids are merged into one (`p3 <- p7`), and every `paperIds` reference is remapped.

### System prompt — three-step instruction

```
1. First, scan the entire page and list ALL papers/citations referenced.
   Assign each a unique id (p1, p2, ...). Extract title/doi/authors/year
   ONLY from text that appears on this page — do not invent.

2. Then, for each AI-generated factual claim, identify which paper(s)
   from your list above support it (by id). If a claim has no clear
   citation on this page, EXCLUDE it entirely.

3. Never copy a paper title into claim.text. Claims are claims, papers
   are papers — they reference by id only.
```

This forces a "list-then-reference" pattern that empirically reduces hallucinated correspondence.

### Flatten to `ClaimItem[]` for the verify queue

The current `/v1/verify` endpoint takes `1 claim × 1 paper`. The extension flattens the LLM response so each (claim, paper) pair becomes one queue item:

```
{papers: [p1, p3], claims: [{id: c1, paperIds: [p1, p3]}]}
  ↓
ClaimItem[
  { id: "c1::p1", claimGroupId: "c1", text: "...", paperTitle, doi, ... },
  { id: "c1::p3", claimGroupId: "c1", text: "...", paperTitle, doi, ... },
]
```

`claimGroupId` lets the sidebar group verify results back under the original claim.

> **Note for implementer:** add a comment at the flatten point explaining this exists only because `/v1/verify` is currently 1-claim-×-1-paper. If `/v1/verify` is later refactored to consume `{papers, claims}` directly, this flatten step should be deleted.

### URL gate `shouldExtract(url)`

Whitelist (default = no extract):

| Site | Match (extract) | Skip (homepage / non-result) |
|---|---|---|
| Elicit | `elicit.com/notebook/<id>`, `elicit.com/sharable/<id>` | `elicit.com/`, `elicit.com/notebooks` (list), `/login`, `/settings` |
| SciSpace | `scispace.com/search?q=`, `scispace.com/literature-review/`, `scispace.com/papers/`, `scispace.com/chat/` | `scispace.com/`, `/login`, `/pricing` |
| Consensus | `consensus.app/results?`, `consensus.app/papers/` | `consensus.app/`, `/search` (no query yet), `/login` |

Lives in `src/shared/site-detect.ts` alongside `detectSite()`.

**Edge cases:**
- SPA navigation → MutationObserver detects URL change → re-evaluate `shouldExtract` → re-extract if it now passes.
- Empty result page (search submitted, no results yet): `shouldExtract` may pass but markdown will be < 500 chars → content script skips before POSTing.

## Component Changes

### Backend (Python — `research-kit/backend/`)

**Created:**

| File | Purpose |
|---|---|
| `app/llm/__init__.py` | Public surface: `async def extract_via_llm(markdown, site, url) -> ExtractResult` |
| `app/llm/providers.py` | `GeminiProvider`, `OpenAIProvider` with shared protocol `async def extract(system, user, schema) -> dict` |
| `app/llm/schema.py` | JSON schema for `papers + claims`. Used for both Gemini `responseSchema` and OpenAI `response_format=json_schema` strict mode |
| `app/llm/prompt.py` | System prompt constant + `build_user(markdown, site, url)` helper |
| `app/llm/validator.py` | `validate_correspondence(raw) -> (cleaned, warnings)` |
| `app/routers/extract.py` | `POST /v1/extract` (the file the user has open in their IDE) |
| `app/schemas/extract.py` | Pydantic request/response models |

**Modified:**
- `app/main.py` — register `extract` router.
- `app/config.py` — add `gemini_api_key`, `openai_api_key`, `llm_primary_provider: Literal["gemini","openai"] = "gemini"`. Switch `Settings.model_config` to `env_file="../infra/.env"` for local-dev convenience.

**Deleted:**
- `app/extract_service.py` (Anthropic-based, unused going forward).

**Provider abstraction (compact):**

```python
class LLMProvider(Protocol):
    name: str
    async def extract(self, system: str, user: str, schema: dict) -> dict: ...

class GeminiProvider:    # httpx → generativelanguage.googleapis.com, generateContent + responseSchema
    name = "gemini"

class OpenAIProvider:    # AsyncOpenAI, response_format=json_schema strict mode
    name = "openai"

async def extract_via_llm(markdown, site, url):
    primary, fallback = get_providers()  # ordered list from settings
    last_err = None
    for provider in [primary, fallback]:
        try:
            raw = await provider.extract(SYSTEM, build_user(markdown, site, url), SCHEMA)
            cleaned, warnings = validate_correspondence(raw)
            return ExtractResult(
                papers=cleaned["papers"],
                claims=cleaned["claims"],
                meta={"provider": provider.name, "warnings": warnings, ...},
            )
        except (RateLimitError, ProviderError, json.JSONDecodeError) as e:
            log.warning("provider=%s failed: %s", provider.name, e)
            last_err = e
            continue
    raise ExtractFailed(f"all providers exhausted: {last_err}")
```

### Extension (TypeScript — `research-kit/extension/`)

**Deleted:**
- `src/adapters/elicit-adapter.ts`
- `src/adapters/scispace-adapter.ts`
- `src/adapters/consensus-adapter.ts`
- `src/adapters/hybrid.ts`
- `src/adapters/registry.ts`
- `src/adapters/index.ts` (old re-exports)
- `src/adapters/types.ts` (old `PageModel`)

**Kept and tweaked:**
- `src/adapters/dom-serializer.ts` — relax DOI-only `<a>` filter (keep all hrefs); preserve `<sup>` text content; keep elements with `data-citation-id` / `data-doi` attributes. 60K-byte budget unchanged.

**Created:**
- `src/extract/run-extract.ts` — orchestrator: serialize → POST `/v1/extract` → flatten → return `ClaimItem[]`. Includes the implementer comment at the flatten point.
- `src/extract/types.ts` — `ExtractedPaper`, `ExtractedClaim`, `ExtractResponse` mirroring backend.
- `src/shared/site-detect.ts` extension — add `shouldExtract(url): boolean` with the URL pattern table above.

**Modified:**
- `src/content.ts` — wire pipeline:
  ```
  detectSite(url) → shouldExtract(url) → debounce DOM idle 1.5s
    → run-extract → sendMessage(MSG_CLAIMS_EXTRACTED, {tabId, claims})
  Re-trigger on URL change (existing MutationObserver).
  Per-tab in-flight flag prevents concurrent extracts on the same page.
  ```
- `src/shared/verify-types.ts` — add optional `claimGroupId?: string` to `ClaimItem`.
- `src/background_minimal.ts` — **no change**. The existing `MSG_CLAIMS_EXTRACTED` listener already handles whatever the content script sends.

> **Question for implementer:** `src/sidebar/usePageModels.ts` imports `PageModel` from `../adapters` (the deleted module). Decide during implementation whether to: (a) update it to consume the new `ExtractResponse` shape, or (b) inline a minimal `PageModel` type if the sidebar still needs the old shape elsewhere. Choose by reading the actual call sites.

## Configuration

**File of record:** `research-kit/infra/.env` (real) and `infra/.env.example` (template).

`research-kit/backend/.env*` is legacy and **not read** by the docker-compose flow. Do not touch it; do not create new files there.

**New env vars in `infra/.env`:**

```bash
# Existing GoClaw keys (unchanged — used by GoClaw service)
GOCLAW_GEMINI_API_KEY=...
GOCLAW_OPENAI_API_KEY=...

# NEW — used by the backend extract service
GEMINI_API_KEY=...                  # standard naming, Google GenAI SDK auto-reads
OPENAI_API_KEY=...                  # standard naming, OpenAI SDK auto-reads
LLM_PRIMARY_PROVIDER=gemini         # gemini | openai
```

Standard names (`GEMINI_API_KEY`, `OPENAI_API_KEY`) are intentional — official SDKs auto-detect them, no manual passing needed. The user can reuse the same key value as `GOCLAW_GEMINI_API_KEY` if they prefer; the variables are independent.

**Local dev (uvicorn outside docker):** `app/config.py` sets `env_file="../infra/.env"`, so running uvicorn from `research-kit/backend/` picks up the same single source of truth.

## Failure Modes

| Failure | Where | Handling |
|---|---|---|
| URL doesn't match `shouldExtract` | Content script | Skip silently |
| Markdown < 500 chars (empty page) | Content script | Skip, no POST |
| Gemini 429 / quota | Backend LLM client | Auto-fallback to OpenAI; log warning |
| OpenAI also fails | Backend LLM client | Return 503 `{code: "extract_unavailable"}` + warnings; extension skips enqueue |
| LLM returns schema-invalid JSON | Backend validator | Treat as provider error, fall back. OpenAI strict mode rarely fails this way but handled |
| Orphan `paperIds` (claim references missing id) | `validate_correspondence` | Drop the claim + warning. Never auto-fix |
| Duplicate paper title (different ids) | `validate_correspondence` | Merge into one id, remap `paperIds` references |
| Backend down | Extension `run-extract` | Log error, do not broadcast `MSG_CLAIMS_EXTRACTED`, no auto-retry (user can reload tab) |
| SPA navigation mid-extract | Content script | URL mismatch on response → drop, do not broadcast |
| Concurrent extract on same tab | Content script | In-flight flag per `tabId`; second invocation blocks until first completes |

## Observability

Each `/v1/extract` response carries `extractMeta`:

```json
{
  "extractMeta": {
    "provider": "gemini",
    "latencyMs": 2840,
    "inputChars": 28430,
    "papersCount": 12,
    "claimsCount": 7,
    "warnings": [
      "dropped_orphan_claim: c5 referenced p99",
      "merged_duplicate_paper: p3<-p7 (same title)"
    ]
  }
}
```

Backend logs structured via existing `app/logging.py`. Sidebar does not surface `extractMeta` to users; developers can inspect via DevTools console. This is enough to debug correspondence problems without standing up tracing infra.

## Testing

- **Backend unit:** `validate_correspondence` against fixtures covering orphan paperIds, duplicate titles, empty `claims`, empty `papers`.
- **Backend integration:** one test per provider — record one real response, replay via httpx mock. CI does not call live LLMs.
- **Extension unit:** `shouldExtract(url)` covers ~15 URLs (3 sites × 5 cases each: homepage / login / settings / result page / list page).
- **End-to-end:** manual, by the user, while testing the product. Not automated in v1.

## Open Questions

1. `usePageModels.ts` consumes `PageModel` from the soon-to-be-deleted `adapters` module. Resolve during implementation per the note above.
2. Whether `GEMINI_API_KEY` should be aliased to `GOCLAW_GEMINI_API_KEY` automatically when the dedicated key is unset (user-friendliness vs explicitness). Default: explicit, no fallback aliasing.
