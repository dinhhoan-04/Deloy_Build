# Research Kit — Complete Design Spec

**Date:** 2026-04-26
**Status:** Comprehensive product spec — ready for implementation planning (v1/v2 split happens in plan phase, not here)
**Product type:** Chrome extension + backend services + Google Docs/Drive integration

---

## Executive Summary

A **research kit** for academics — a collection of small, focused tools that **support** but never replace the researcher's reasoning. The kit consists of three core tools, each addressing a distinct pain point in modern AI-assisted research workflows.

**Core promise:** Every accuracy figure is **computed by deterministic formula**, never estimated by an AI agent. AI is used only for preprocessing (extracting things to check); scoring is math.

**Cost-optimized stack:** Groq + Gemma 4 for routine operations (~30-100x cheaper than Claude); Claude Sonnet only when reasoning quality justifies cost.

**Tagline:** *"Computed accuracy. Connected knowledge. Your reasoning, supported."*

---

## North Star Principles (Non-negotiable)

These principles override any feature decision. If a feature violates one, the feature loses.

| Principle                            | Concrete rule                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Support, never replace**     | Tool extracts, computes, retrieves, organizes. The researcher reasons, decides, concludes.                                                                                |
| **Computed, not estimated**    | All accuracy %s come from deterministic math. AI is used for preprocessing (extract claims, extract facts, generate embeddings). Scoring is never an LLM judgment.        |
| **User owns the query**        | Extension never auto-types into any AI tool. Suggestions are copy-paste only.                                                                                             |
| **Take, don't hunt**           | The kit operates only on data the user already has (current AI tool outputs, their Drive folder, their past sessions). It does NOT search the web for additional sources. |
| **Trust through transparency** | Every score has a visible formula. Component scores are surfaced. No "trust me 87%".                                                                                      |
| **Privacy local-first**        | Drive integration requires explicit OAuth. No content uploaded to backend without explicit consent. Extension preferences in `chrome.storage.local`.                    |
| **AI uncertainty is explicit** | Where AI plays a role (claim extraction, summarization), output is labeled "AI-extracted" or "AI-summarized" — never presented as ground truth.                          |

---

## The Three Tools

```
┌─ Research Kit ──────────────────────────────────────────────────────┐
│                                                                      │
│  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐       │
│  │  Tool 1        │   │  Tool 2        │   │  Tool 3        │       │
│  │  VERIFY        │   │  COLLECT       │   │  SECOND BRAIN  │       │
│  │                │   │                │   │                │       │
│  │  3-tier        │   │  Aggregate to  │   │  RAG over      │       │
│  │  computed %    │   │  Google Docs + │   │  user's KB     │       │
│  │  scoring       │   │  Postgres DB   │   │  (Drive +      │       │
│  │                │   │                │   │   past Docs)   │       │
│  └────────────────┘   └────────────────┘   └────────────────┘       │
│         │                      │                     │               │
│         └──────────────────────┼─────────────────────┘               │
│                                │                                     │
│                        Shared backend                                │
│                  (FastAPI + Postgres + Redis)                        │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

The tools are **independent** (each ships separately, value alone) but **composable** (work better together when all enabled).

---

## Tool 1: VERIFY — 3-Tier Computed Metric System

### Purpose

Given any AI-generated research content (with citations), compute deterministic accuracy scores at three granularities: per link, per sentence (claim), per paragraph. Surface scores inline so the user can see at a glance which parts to trust and which to manually re-check.

### Input

A block of text from any source (AI tool output, paper draft, blog post). Text contains:

- One or more sentences with factual claims
- Citations: URLs, DOIs, arXiv IDs, or numbered references with a reference list

### Output

For each unit (link / sentence / paragraph), a numeric score 0–100 plus component scores plus the formula used.

### Tier 1 — Link Validity Score

For each citation URL/DOI/arXiv ID:

```python
link_score = (
    50 if http_response_ok      # HTTP 200, not 404/timeout/redirect-loop
    else 0
) + (
    30 if paper_resolvable      # CrossRef returns metadata for DOI, OR arXiv API confirms ID, OR Unpaywall has record
    else 0
) + (
    20 if trusted_domain        # Whitelist: arxiv.org, doi.org, semanticscholar.org, ncbi.nlm.nih.gov, nature.com, science.org, ieee.org, acm.org, springer.com, sciencedirect.com, wiley.com, *.edu, *.gov
    else 0
)
# Range: 0, 20, 30, 50, 70, 80, 100
```

**Computation:** 100% deterministic. Zero LLM calls per link.
**Cost:** ~$0 per link (HTTP curl + free APIs).
**Latency:** ~300ms per link (parallel HTTP).

### Tier 2 — Sentence (Claim) Verification Score

For each sentence with at least one citation:

**Step 1: AI preprocessing (Gemma 4 via Groq)**

Extract structured facts from the claim:

```json
{
  "numbers": ["91.2%", "10000 samples", "p < 0.05"],
  "named_entities": ["BERT", "SQuAD 1.1", "Transformer"],
  "key_terms": ["F1 score", "fine-tuning", "encoder"],
  "claim_text": "<original claim sentence>"
}
```

This is preprocessing — AI is not judging accuracy.

**Step 2: Fetch source paper full-text**

Resolve citation → fetch paper:

- arXiv ID → arxiv.org/html/[id]
- DOI → Unpaywall API → OA PDF or HTML
- Direct URL → curl
- Paywalled → user-session cookie forwarding

If fetch fails → mark sentence as `score = N/A (paper inaccessible)`. Don't compute, don't fake.

**Step 3: Three deterministic computations**

```python
# Component 1: Verbatim quote match (string algorithm)
# Find the longest contiguous substring of claim that appears in paper text
verbatim_score = (
    len(longest_common_substring(claim, paper_text)) / len(claim)
) * 100
# Range: 0-100

# Component 2: Fact match rate
# Count how many extracted facts appear exactly (case-insensitive substring) in paper text
facts_found = sum(
    1 for fact in (numbers + named_entities + key_terms)
    if fact.lower() in paper_text.lower()
)
fact_match_rate = (facts_found / total_facts) * 100
# Range: 0-100

# Component 3: Semantic similarity (vector math)
# Embed claim and paper chunks (Gemma embeddings or all-MiniLM-L6-v2)
# Take maximum cosine similarity between claim and any chunk
chunks = chunk_paper(paper_text, window=500_words, stride=250_words)
claim_emb = embed(claim)
chunk_embs = embed_batch(chunks)
semantic_score = max(cosine_similarity(claim_emb, c_emb) for c_emb in chunk_embs) * 100
# Range: 0-100

# Final
sentence_score = (
    0.4 * verbatim_score +
    0.4 * fact_match_rate +
    0.2 * semantic_score
)
```

**Why these weights:**

- 0.4 verbatim: gold standard — exact text match means claim is taken from the paper
- 0.4 fact_match: facts (numbers, entities) being absent is the strongest "fabricated" signal
- 0.2 semantic: catches paraphrases that fact-match misses, but lowest weight because semantic similarity can be deceived

**Cost per sentence:** ~$0.002 (Gemma 4 fact extraction + embedding); paper fetch is shared across sentences citing same paper.
**Latency:** ~3-5s per sentence (dominated by paper fetch; cached after first).

### Tier 3 — Paragraph Composite Score

For each paragraph (block of consecutive sentences):

```python
sentences_with_citations = [s for s in paragraph.sentences if s.has_citation]
sentences_without = [s for s in paragraph.sentences if not s.has_citation]

citation_density = (len(sentences_with_citations) / len(paragraph.sentences)) * 100
# 100 = every sentence cites; 0 = nothing cited

if sentences_with_citations:
    avg_sentence_score = mean(s.score for s in sentences_with_citations if s.score != "N/A")
else:
    avg_sentence_score = 0  # No verifiable claims

paragraph_score = (
    0.3 * citation_density +
    0.7 * avg_sentence_score
)
```

A paragraph with high citation density but low sentence scores → "well-cited but factually weak."
A paragraph with low citation density → "claims not backed."

### Document-level rollup

```python
document_score = mean(p.score for p in paragraphs if p.score is not None)
```

Plus a quality breakdown:

- `# sentences with verifiable citations` / `total sentences`
- `# papers accessible` / `total papers cited`
- `# sentences with score ≥ 80` (high confidence)
- `# sentences with score < 50` (flagged for review)

### UI surface

Three-level drill-down:

```
┌─ Document: "Sleep and Memory Review" ─ Overall: 72/100 ─┐
│                                                          │
│ ⓘ Click any score to see formula breakdown               │
│                                                          │
│ ────────────────────────────────────────────────         │
│ Para 1: 85/100  ✓ Strong                                │
│  "Sleep deprivation impairs memory [1]."  93/100        │
│  "REM sleep is critical [2]."             87/100        │
│  Citations: [1] ✓ 100  [2] ✓ 80                         │
│                                                          │
│ Para 2: 41/100  ⚠ Review recommended                    │
│  "Studies show 99.2% efficacy [3]." → 18/100  🔴        │
│    └─ verbatim: 0% · fact_match: 25% · semantic: 60%    │
│    └─ "99.2%" not found in source [3] (says 86.4%)      │
│    └─ [Open source] [Re-verify]                          │
│                                                          │
│ ────────────────────────────────────────────────         │
│ How is this calculated? [Open formula]                  │
└──────────────────────────────────────────────────────────┘
```

Every score links to the components that produced it. No magic.

### Anti-hallucination rules (enforce in prompts)

When AI extracts facts (Step 1) or quotes (used for verbatim search), prompts must:

1. NEVER invent a fact not present in the claim text
2. Return empty list if no facts extractable
3. Output structured JSON only — refuse free-form prose
4. If extraction fails, return error → mark sentence as `score = N/A (extraction failed)`, do not fake

### Edge cases

| Case                                      | Handling                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Paper paywalled, user lacks access        | `score = N/A (paper inaccessible)` — disclose, don't guess                  |
| Paper not in English                      | Translate paper to English via Gemma → run normal pipeline; flag "translated" |
| Sentence has multiple citations           | Compute per-citation scores → take max as sentence score                      |
| Citation is to a blog/news (not academic) | Lower trusted_domain weight; flag as "non-peer-reviewed source"                |
| AI tool gave no citations                 | Mark all sentences `score = N/A (no citation)` → show banner                |

---

## Tool 2: COLLECT — Aggregate to Google Docs + Postgres

### Purpose

Capture a research session's content from multiple AI tools, summarize and organize it, and persist to a place the user already uses (Google Docs) plus a structured database for downstream tools (Second Brain).

### Input

User invokes Tool 2 from the extension after consulting one or more AI tools. Extension captures:

- Current page content (per-tool content scripts handle DOM parsing)
- Conversation history if applicable (tiered heuristic: meta-prompt → rich-prompt → last-10 fallback)
- Citations and reference lists

### Processing pipeline

```
1. Parse content per tool (content scripts)
   → list of {claim, citations, source_tool, timestamp}

2. Merge across tools
   → deduplicate citations (same DOI from multiple tools = one entry)
   → preserve which tool said what

3. Run Tool 1 (Verify) inline (optional, user toggles)
   → attach scores to each claim

4. Generate summary (Gemma 4 via Groq)
   → 1-paragraph topic summary
   → CLEARLY labeled as "AI summary, not asserted truth"

5. Group by tool, by claim type (high/low score), by topic
   → see Output structure below

6. Persist:
   a. Postgres `aggregate_sessions` table (structured)
   b. Google Docs (formatted document, user's Drive)
```

### Output structure (Google Docs format)

```markdown
# Research Session: [auto-detected topic]
**Date:** 2026-04-24
**Tools consulted:** Elicit, ChatGPT, Perplexity
**Verification mode:** Active (Tool 1 scores attached)

---

## Topic summary
*(AI-generated summary, not asserted truth — review with critical eye)*

[1-paragraph Gemma-generated summary]

---

## High-confidence findings (score ≥ 80)

- **Finding 1:** Sleep deprivation impairs memory consolidation
  - Score: 93/100 (verbatim 95% · fact_match 100% · semantic 78%)
  - Source: Walker et al. (2004) — [DOI link]
  - Cited by: Elicit, ChatGPT
  - Verbatim quote: "Sleep-deprived subjects showed reduced recall accuracy compared to..."

- **Finding 2:** ...

---

## Medium-confidence findings (score 50-79)

- **Finding 3:** ...

---

## Low-confidence findings (score < 50) — manual review recommended

- **Finding 4:** "Studies show 99.2% efficacy"
  - Score: 18/100
  - Issue: "99.2%" not found in cited paper (paper reports 86.4%)
  - Action: verify with author or different source

---

## Unverifiable claims (no citation or paper inaccessible)

- "REM sleep is responsible for emotional memory" (no citation provided)
- ...

---

## All raw outputs (expandable archive)

*(Note: Google Docs doesn't support collapsible sections. Implementation will use a secondary "Archive" document linked in TOC, or inline sections with clear headings that users can skip. Decision deferred to implementation plan.)*

### From Elicit
[Original Elicit content]

### From ChatGPT
[Original ChatGPT content]

### From Perplexity
[Original Perplexity content]

---

## Suggested follow-up questions
*(Copy any to clipboard, then ask in your AI tool of choice — extension does not auto-submit)*

- "How does [Finding 1] change for older populations?"
- "What's the evidence for [Finding 4]'s 99.2% figure?"

---

## References (deduplicated)

1. Walker, M. P. et al. (2004). [DOI]
2. Smith, J. (2007). [DOI]
3. ... (papers cited across all tools, deduplicated)
```

### Database schema (Postgres)

```sql
CREATE TABLE aggregate_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    topic TEXT NOT NULL,                    -- AI-detected
    created_at TIMESTAMP DEFAULT NOW(),
    tools_used TEXT[] NOT NULL,             -- ["elicit", "chatgpt", "perplexity"]
    google_doc_id TEXT,                     -- Drive file ID for round-trip
    google_doc_url TEXT,
    summary TEXT,                           -- Gemma-generated
    raw_content_by_tool JSONB               -- Original captures
);

CREATE TABLE aggregate_claims (
    id UUID PRIMARY KEY,
    session_id UUID REFERENCES aggregate_sessions(id),
    claim_text TEXT NOT NULL,
    citations JSONB,                        -- list of citation URLs/DOIs
    verify_score INT,                       -- 0-100 or NULL
    verify_components JSONB,                -- {verbatim, fact_match, semantic}
    source_tools TEXT[],                    -- ["elicit", "chatgpt"]
    embedding VECTOR(384)                   -- pgvector for Second Brain
);

CREATE TABLE aggregate_references (
    id UUID PRIMARY KEY,
    session_id UUID REFERENCES aggregate_sessions(id),
    paper_url TEXT NOT NULL,
    paper_title TEXT,
    paper_doi TEXT,
    accessibility TEXT                      -- "open_access" | "session_required" | "inaccessible"
);
```

### Google Docs integration

**Auth:** Google OAuth scopes:

- `https://www.googleapis.com/auth/drive.file` (create files in user's Drive)
- `https://www.googleapis.com/auth/documents` (create/edit Docs)

**Creation:** First time user enables Tool 2:

1. Extension prompts OAuth consent
2. User grants
3. Backend creates folder `/Research Kit/` in user's Drive
4. Each session creates a new Doc inside, named `YYYY-MM-DD - [topic]`

**Updates:** Re-running Tool 2 on same session updates the same Doc (idempotent).

### Cost & latency

- Per session: ~$0.005 LLM (Gemma summary + topic detection) + $0.002 per claim verified
- Latency: 5-15s for capture + summarize; longer if Verify enabled
- Storage: ~5KB Postgres per session + 1 Google Doc

---

## Tool 3: SECOND BRAIN — RAG over user's knowledge base

### Purpose

Connect new research questions (across multiple AI tools) with user's existing knowledge — past sessions, papers in their Drive, papers they've cited before. The user gets context they would otherwise have to search for manually.

### Input

Two trigger paths:

**Path A — Active research (user is in the middle of research):**

- Extension monitors queries user types into supported AI tools
- Each new query embedded → compared to recent (last 30 days) queries
- If max cosine similarity > 0.7 → suggest: "*This looks related to your '[X]' research session. Add to it?*"
- User confirms → query grouped into existing session
- Backend then runs RAG over user's KB and surfaces relevant past content

**Path B — Explicit Second Brain query:**

- User clicks "Search my knowledge" button in extension
- Types question
- Backend runs RAG → returns top 10 relevant items from KB

### Knowledge base sources (priority order)

**Tier 1 (always indexed) — User's personal corpus:**

- Past Tool 2 sessions (Google Docs in `/Research Kit/` folder) — auto-indexed when created
- User's chosen Drive folder of papers (single folder, picked at onboarding)
  - Indexed: PDF and DOCX files
  - Re-indexed: every 24h or on user-triggered refresh

**Tier 2 (post-MVP, if research demand emerges) — Institutional & external:**

- Zotero library (if user provides API key)
- Mendeley library (if user provides API key)
- University paper repository (if URL pattern provided)

**Tier 3 (post-MVP) — Public:**

- Semantic Scholar S2ORC abstracts (already cited in user's sessions only — limited scope)

### Indexing pipeline

```
For each document in KB:
1. Detect type (Google Doc, PDF, DOCX)
2. Extract text:
   - Google Docs API: structured text
   - PDF: PyMuPDF
   - DOCX: python-docx
3. Extract metadata:
   - Title (first line of Doc, PDF metadata, or filename)
   - Abstract (first 500 words after title, OR detected abstract section)
4. Chunk (only title + abstract, NOT full body):
   - Reasoning: most relevance signals live in title+abstract
   - Trade-off: faster indexing, less storage, slightly less recall
   - Future: full-body chunking option for power users
5. Embed (Gemma embeddings via Groq, OR local Sentence-BERT)
6. Store in pgvector:
   - One row per document
   - Columns: doc_id, source ("session" | "drive_pdf" | "drive_doc"), title, abstract, embedding (384 dim), indexed_at
```

**Storage estimate:** 10,000 docs × (500 words × 4 bytes + 384-dim float vector × 4 bytes) ≈ 30 MB Postgres. Comfortably free tier.

### Retrieval pipeline

When user asks a question (Path A or B):

```python
1. Embed the query (same model as indexing)
2. ANN search in pgvector: top 20 nearest by cosine similarity
3. Re-rank top 20 by combined score:
   final_rank = (
       0.6 * cosine_similarity +
       0.2 * recency_score (newer = higher) +
       0.2 * citation_count (papers user cited before = higher)
   )
4. Return top 10 with metadata + similarity score
5. UI: list with title, abstract preview, similarity %, last-touched date
```

### UI surface — relevant context panel

```
┌─ Second Brain — relevant from your KB ──────────────────┐
│ Query: "Effect of sleep on declarative memory"          │
│                                                          │
│ Found 7 relevant items in your knowledge base:          │
│                                                          │
│ 🔵 Past session (2026-03-12): "Memory consolidation"    │
│    Similarity: 87%                                      │
│    [Open Doc] [Show summary]                            │
│                                                          │
│ 📄 Walker_2004_sleep_dependent.pdf (Drive)              │
│    Similarity: 81%                                      │
│    Abstract: "We examined sleep-dependent..."           │
│    [Open PDF]                                           │
│                                                          │
│ 📄 Smith_1995_REM_memory.pdf (Drive)                    │
│    Similarity: 73%                                      │
│    [Open PDF]                                           │
│                                                          │
│ ... (4 more)                                            │
└──────────────────────────────────────────────────────────┘
```

### What Second Brain does NOT do

- ❌ Does not generate answers from retrieved content (would violate "support, never replace")
- ❌ Does not summarize papers it retrieves (user reads them themselves)
- ❌ Does not search the public web (only user's KB)
- ❌ Does not auto-cite retrieved papers in user's drafts

It only **finds and surfaces**. The user reads and decides.

### Cost & latency

- Indexing: one-time $0.0001 per doc (embedding cost) + recurring 24h refresh
- Retrieval: ~50ms (pgvector ANN) + $0 (embeddings cached)
- Total user cost: < $0.01 per query

---

## Cross-tool integration (how the kit composes)

The three tools share a backend, but their UI is independent. Power emerges when used together.

**Example combined workflow:**

```
1. User asks Elicit, ChatGPT, Perplexity each a question about sleep & memory
   (each tool gives different answers with different citations)

2. SECOND BRAIN auto-detects related queries → suggests grouping → user confirms
   → "Sleep-Memory Research" session created/joined

3. User clicks COLLECT
   → Tool 2 captures all 3 outputs
   → Tool 1 runs Verify on each claim (computed scores)
   → Generates Google Doc with high/medium/low confidence sections
   → Backend stores claims + embeddings in Postgres

4. SECOND BRAIN now has new content indexed
   → user's next research session can pull from this

5. User reads the Doc → sees Claim X has score 18/100
   → clicks score → sees verbatim 0%, fact_match 25% (cited paper says 86.4% not 99.2%)
   → user knows to remove or fix that claim

6. User clicks "Search my knowledge" with a new related question
   → Second Brain retrieves the past session + 3 relevant papers from Drive
   → user has connected context without manual searching
```

The kit's value compounds with use:

- More sessions → richer Second Brain
- More verified claims → more reliable references
- More patterns → better personalization (in future versions)

---

## Technical Architecture

### High-level

```
┌─────────────────────────────────────────────────────────────────┐
│ Chrome Extension (client)                                        │
│                                                                  │
│  Content scripts (per AI tool)                                   │
│   - Elicit, ChatGPT, Perplexity, Consensus, SciSpace, Gemini    │
│   - DOM parsing + conversation history extraction                │
│   - Query monitoring (for Second Brain auto-detect)              │
│                                                                  │
│  Panel UI (React + Tailwind)                                     │
│   - VerifyPanel (score breakdown + drill-down)                   │
│   - CollectPanel (capture + send to Docs)                        │
│   - SecondBrainPanel (KB search + suggestions)                   │
│                                                                  │
│  Local storage (chrome.storage.local)                            │
│   - User preferences                                             │
│   - Recent query embeddings (for Second Brain)                   │
│   - OAuth tokens (Google)                                        │
└────────────────────────────────────────┬────────────────────────┘
                                         │ HTTPS
                                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ FastAPI Backend                                                  │
│                                                                  │
│  API endpoints                                                   │
│   POST /verify        — Tool 1: compute scores                   │
│   POST /collect       — Tool 2: aggregate & write to Docs        │
│   POST /brain/index   — Tool 3: index a new doc                  │
│   POST /brain/search  — Tool 3: retrieve from KB                 │
│   POST /brain/detect  — Tool 3: cross-AI question linking        │
│                                                                  │
│  Service layer                                                   │
│   - paper_fetcher.py    (OA + arXiv + session forwarding)        │
│   - link_validator.py   (Tier 1 deterministic checks)            │
│   - claim_extractor.py  (Gemma via Groq)                         │
│   - verifier.py         (Tier 2 & 3 deterministic computations)  │
│   - embedder.py         (Gemma embeddings via Groq)              │
│   - aggregator.py       (cross-tool merge + summary)             │
│   - docs_writer.py      (Google Docs API)                        │
│   - kb_indexer.py       (Drive folder scan + embed)              │
│   - kb_retriever.py     (pgvector ANN search + rerank)           │
│                                                                  │
│  Agent layer                                                     │
│   - groq_client.py      (Gemma 4 — extraction, summary, embed)   │
│   - claude_client.py    (Sonnet — when reasoning quality matters)│
│   - prompt_cache.py     (Anthropic ephemeral caching)            │
└─────────────────┬──────────────────────────────────────────────┘
                  │
        ┌─────────┴─────────┬─────────────┬─────────────┐
        ▼                   ▼             ▼             ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ PostgreSQL + │  │ Redis        │  │ Cloudflare R2│  │ Google APIs  │
│ pgvector     │  │ (Upstash)    │  │ (object)     │  │              │
│ (Supabase)   │  │              │  │              │  │              │
│              │  │ Hot cache:   │  │ Cached PDFs  │  │ Drive API    │
│ - users      │  │ - verify     │  │ (TTL 7d)     │  │ Docs API     │
│ - sessions   │  │   results    │  │              │  │ OAuth        │
│ - claims     │  │ - rate limit │  │              │  │              │
│ - kb index   │  │ - sessions   │  │              │  │              │
│ - feedback   │  │              │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

### Tech stack details

| Concern                  | Choice                                  | Cost                    | Rationale                                   |
| ------------------------ | --------------------------------------- | ----------------------- | ------------------------------------------- |
| Heavy reasoning (rare)   | Claude Sonnet 4.6                       | $3/$15 per 1M tok       | When extraction/summary quality is critical |
| Routine ops (most calls) | **Gemma 4 via Groq**              | ~$0.10/1M tok           | 30-100x cheaper, fast inference             |
| Embeddings               | Gemma embeddings on Groq                | Near-free               | Same provider, batch-friendly               |
| Embeddings (fallback)    | all-MiniLM-L6-v2 local                  | Free                    | Self-host if Groq down                      |
| Vector store             | **pgvector** (Postgres extension) | Free with Supabase      | No separate vector DB service               |
| OLTP database            | PostgreSQL via Supabase                 | Free tier (500MB)       | Includes auth + Postgres + pgvector         |
| Cache                    | Redis via Upstash                       | Free tier (10K cmd/day) | Sub-second verify lookups                   |
| Object store             | Cloudflare R2                           | Free 10GB               | Cached PDFs                                 |
| Backend host             | Render Starter                          | $7/mo                   | Docker support                              |
| Extension build          | Vite + React + TS + Tailwind            | Free                    | Standard MV3 stack                          |
| Auth                     | Supabase Auth + Google OAuth            | Free tier               | Email + Drive integration                   |
| Payment                  | Paddle                                  | 5% + $0.50/tx           | MoR (handles global tax)                    |
| Analytics                | PostHog (cloud free tier)               | Free                    | Product analytics                           |

### Cost projection per active user / month

Assuming 50 verifies + 20 collects + 30 KB queries / month:

```
Tool 1 Verify:
  50 verifies × (claim extraction + 3 components)
  = 50 × $0.002 (Gemma claim) = $0.10
  + paper fetches (cached ~80% hit rate) = ~10 fetches × $0 = $0
  Total: $0.10

Tool 2 Collect:
  20 sessions × (Gemma summary + verify pass through)
  = 20 × $0.005 = $0.10
  Total: $0.10

Tool 3 Second Brain:
  30 queries × (embedding cached) = ~$0 (pgvector compute is free)
  + 100 KB docs × (embed once on index) = $0.01
  Total: ~$0.01

Aggregate: ~$0.21 per user / month

At 1000 active users: $210/mo LLM cost
At Pro $7/mo × 200 paid users: $1400 revenue
Net margin: $1190/mo

Sustainable solo founder economics.
```

### Why Groq + Gemma 4 specifically

- **Latency:** Groq runs Gemma at ~500 tokens/sec (vs ~50 for Anthropic Sonnet). User sees results faster.
- **Cost:** Gemma 4 on Groq is ~30-100x cheaper than Claude Sonnet for routine extraction/summary tasks.
- **Quality for our needs:** Verify metric does NOT require frontier reasoning. Gemma 4 is sufficient for:
  - Extracting structured facts from a sentence
  - Summarizing a session (1 paragraph)
  - Detecting topic of a research question
  - Generating embeddings
- **Fallback path:** If Gemma quality drops on a specific task, route to Sonnet via feature flag (per-task model selection).

---

## Data flow examples

### Example 1: User runs Verify on a paragraph

```
User → Extension panel → Click "Verify this paragraph"
  → Content script extracts paragraph text + citations
  → POST /verify {text: "...", citations: [...]}

Backend /verify:
  1. Parse text → sentences with associated citations
  2. For each unique citation:
     a. Check Redis cache → hit? skip fetch
     b. Miss? Run link_validator (Tier 1 deterministic)
     c. If link valid → fetch paper (R2 cache → Unpaywall → arxiv → session)
     d. Store result in Redis (TTL 1d) + Postgres (TTL 30d)
  3. For each sentence:
     a. Gemma 4: extract facts → JSON
     b. Compute verbatim_score (deterministic string match)
     c. Compute fact_match_rate (deterministic substring count)
     d. Compute semantic_score (cosine on Gemma embeddings)
     e. Combine → sentence_score
  4. Compute paragraph_score (deterministic formula)
  5. Return: {paragraph_score, sentence_scores, link_scores, components, formula}

Extension panel:
  - Render paragraph with inline scores
  - Click any score → drill down (formula + components)
```

### Example 2: User collects a session to Google Docs

```
User → Three tabs open (Elicit, ChatGPT, Perplexity) on related research
User → Click extension icon → Click "COLLECT"

Extension:
  - Run content scripts on each tab → extract claims + citations
  - Build payload {tools: [...], claims: [...], references: [...]}
  - POST /collect

Backend /collect:
  1. Detect topic (Gemma 4)
  2. Optional: run /verify on all claims (if user toggle is on)
  3. Group claims by score band (high/medium/low/N/A)
  4. Generate summary (Gemma 4, 1 paragraph)
  5. Generate Markdown for Google Doc
  6. Persist to Postgres (sessions, claims, refs tables)
  7. Embed claims → store in pgvector
  8. Call Google Docs API:
     - Find or create folder /Research Kit/
     - Create doc YYYY-MM-DD - [topic]
     - Convert MD → Doc structure
  9. Return {doc_id, doc_url, session_id}

Extension:
  - Show "Session saved to Google Docs" + link
  - Cache session_id in localStorage for Second Brain context
```

### Example 3: Second Brain auto-suggests session continuation

```
User opens ChatGPT, types: "How does sleep affect declarative memory?"
Content script intercepts query (only metadata, not content) BEFORE submission
  - Embed query (Gemma)
  - POST /brain/detect {embedding}

Backend /brain/detect:
  1. Search pgvector for sessions with avg_embedding cosine > 0.7
  2. If matches found → return {match: true, session: {...}, similarity: 0.85}
  3. Else → return {match: false}

Extension:
  - If match: show non-blocking notification:
    "This looks related to your 'Sleep & Memory' session from 2 weeks ago.
     [+ Add to session]   [Skip]"
  - If user clicks "Add" → flag this query in localStorage
  - When user later runs COLLECT → automatically merges into existing session

User submits query in ChatGPT (extension does NOT touch the query).
User reads ChatGPT response.
User clicks COLLECT → existing session is augmented.
```

---

## Risks & Mitigations

| Risk                                                 | Likelihood   | Impact | Mitigation                                                                            |
| ---------------------------------------------------- | ------------ | ------ | ------------------------------------------------------------------------------------- |
| Gemma 4 quality insufficient for fact extraction     | Medium       | High   | Per-task model fallback to Sonnet via feature flag; gold-standard test set runs daily |
| pgvector slow at scale (>100K docs)                  | Low (year 1) | Medium | Migrate to Pinecone/Weaviate when ANN latency >200ms                                  |
| Google Docs API rate limits                          | Low          | Low    | Backoff + queue; never block user UI                                                  |
| Drive folder scan misses files                       | Medium       | Medium | Re-scan every 24h + manual refresh button; log skipped files                          |
| Cookie forwarding for paywalled flagged by publisher | Low          | High   | Same pattern as Zotero (10+ years legal); user explicit consent                       |
| Verify scores misinterpreted as truth                | Medium       | High   | UI language discipline ("textual match" not "true"); footer disclaimer                |
| Second Brain surfaces irrelevant content             | Medium       | Medium | User feedback (👍/👎) → adjust rerank weights per user (post-v2)                     |
| Embeddings drift across model updates                | Low          | Medium | Lock embedding model version; re-index on planned upgrade                             |
| OAuth scope creep concerns                           | Medium       | Medium | Minimum scopes; in-app explanation of each scope                                      |
| Extension breaks when AI tools update DOM            | High         | Medium | Multiple selector fallbacks + telemetry alert + auto-issue creation                   |

---

## Out of Scope (now and forever in this product)

These are intentional non-goals. Including them would dilute the kit's identity.

- ❌ Generating research papers / drafts (replaces user's reasoning)
- ❌ Auto-citing retrieved papers (replaces user's judgment)
- ❌ Web search for new sources (we take, don't hunt)
- ❌ Replacing AI tools (we sit on top of them)
- ❌ Real-time AI tool query interception/modification
- ❌ Verifying claims that have no citation (we explicitly mark `score = N/A`)
- ❌ Chatbot interface (researchers use ChatGPT etc. for that)

---

## Future extensions (consider after MVP launches)

These are possibilities, not commitments. Mentioned so the spec acknowledges them but defers detail.

- **Per-domain verify weights** — medical research may weight `verbatim` higher; engineering may weight `fact_match` higher
- **Multi-language support** — verify Spanish/French/Chinese papers using translation pipeline
- **Citation graph visualization** — show how user's KB papers cite each other
- **Collaborative sessions** — share Research Kit sessions with co-authors
- **API for Zotero/Mendeley plugin authors** — third-party tools can call /verify
- **Browser-native PDF reader** — open papers inside extension with verify overlay
- **Claim provenance ledger** — every fact in user's writing tracked back to source automatically

---

## Success criteria (post-launch metrics)

Tracking these to know if the kit is working:

| Metric                                | Target (3 months post-launch)                          |
| ------------------------------------- | ------------------------------------------------------ |
| Tool 1 / Verify usage rate            | ≥ 60% of active users use at least monthly            |
| Tool 2 / Collect adoption             | ≥ 40% of users save ≥ 1 session to Google Docs       |
| Tool 3 / Second Brain queries         | ≥ 30% of users query KB at least weekly               |
| Verify formula clarity (NPS-like)     | ≥ 70% users say "I understand the score" in survey    |
| False high score rate (post-feedback) | < 5% of "supported" verdicts get user "wrong" feedback |
| Free → Pro conversion                | ≥ 5% within 30 days of install                        |
| Monthly churn (Pro tier)              | < 8%                                                   |

---

## Project structure (for implementation phase)

```
research-kit/
├── extension/                      # Chrome MV3
│   ├── manifest.json
│   ├── src/
│   │   ├── content/
│   │   │   ├── elicit.ts
│   │   │   ├── chatgpt.ts
│   │   │   ├── perplexity.ts
│   │   │   └── (more tools)
│   │   ├── panel/
│   │   │   ├── VerifyPanel.tsx
│   │   │   ├── CollectPanel.tsx
│   │   │   ├── SecondBrainPanel.tsx
│   │   │   └── components/
│   │   ├── background.ts
│   │   ├── stores/
│   │   │   ├── preferences.ts
│   │   │   ├── auth.ts            # Google OAuth
│   │   │   └── recent_queries.ts  # for Second Brain detect
│   │   └── api.ts                  # backend client
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                        # FastAPI
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── verify.py
│   │   │   ├── collect.py
│   │   │   └── brain.py
│   │   ├── services/
│   │   │   ├── link_validator.py   # Tier 1
│   │   │   ├── claim_extractor.py  # Gemma
│   │   │   ├── verifier.py         # Tier 2 & 3 deterministic
│   │   │   ├── paper_fetcher.py
│   │   │   ├── aggregator.py
│   │   │   ├── docs_writer.py      # Google Docs
│   │   │   ├── kb_indexer.py       # Drive scan + embed
│   │   │   └── kb_retriever.py     # pgvector ANN
│   │   ├── agents/
│   │   │   ├── groq_client.py      # Gemma 4
│   │   │   └── claude_client.py    # Sonnet (rarely)
│   │   ├── db/
│   │   │   ├── models.py           # SQLAlchemy
│   │   │   └── migrations/         # Alembic
│   │   ├── schemas.py              # Pydantic
│   │   ├── prompts/
│   │   │   ├── extract_claim_facts.md
│   │   │   ├── topic_detection.md
│   │   │   ├── session_summary.md
│   │   │   └── (more)
│   │   └── config.py
│   ├── tests/
│   │   ├── test_link_validator.py    # deterministic, easy
│   │   ├── test_verifier.py          # deterministic, gold dataset
│   │   ├── test_aggregator.py
│   │   └── test_kb_retriever.py
│   ├── Dockerfile
│   └── requirements.txt
│
├── landing/
│   ├── index.html
│   ├── pricing.html
│   └── docs/                        # how the kit works
│       ├── how-verify-works.md      # public, formula transparency
│       ├── privacy-policy.md
│       └── terms.md
│
└── README.md
```

### Reuse from ARAS (`d:\vin_product\A20-App-012\`)

| ARAS file                                                | Used in research-kit                                  |
| -------------------------------------------------------- | ----------------------------------------------------- |
| `src/agent.py`                                         | Pattern for agent layer (replace Anthropic with Groq) |
| `src/modules/m3_evidence_extractor/_verifier_agent.py` | Claim fact extraction prompt baseline                 |
| `src/modules/m1_document_parser/_pymupdf_fallback.py`  | PDF parsing for Drive folder                          |
| `src/shared/types.py`                                  | Pydantic patterns (adapt for new schemas)             |
| `Dockerfile`                                           | Backend Docker config                                 |
| `.claude/skills/verify-claim/SKILL.md`                 | Verify language and rules baseline                    |

---

## Open questions for implementation phase

These decisions can be made when writing the implementation plan, not now:

1. **Product name** — Research Kit, ResearchOS, Triangulate, or other
2. **Branding** — visual identity, logo
3. **First tool to ship** — Tool 1 (Verify) is most defensible; could ship standalone first
4. **Pricing tier specifics** — exact verify quotas per tier
5. **Soft launch order** — academic Twitter first, or Reddit first

---

## Approval gate

This spec is the comprehensive product vision. Before writing the implementation plan (which will split features into v1/v2/v3 milestones), this spec needs the user's review.

If the user approves: invoke writing-plans skill to create detailed task-by-task implementation plan.
