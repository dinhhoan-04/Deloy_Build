# Chat RAG Design — Session-scoped BM25 Retrieval

**Date:** 2026-05-16  
**Branch:** new-idea-agent  
**Status:** Approved

## Overview

Enable users to chat with AI about extracted content from all visited sites. Instead of dumping all content into every query, use BM25 retrieval client-side to select relevant chunks, then send only the top-K to the backend LLM as context.

Data is session-scoped: persists while the browser is open, cleared automatically on browser close. No server-side persistence of raw page content.

## Architecture

```
Content script  → page text chunks  → chrome.storage.session
ChatTab sidebar → claim text chunks → chrome.storage.session
                                              ↓
User sends message → BM25 search → top-5 chunks → backend LLM (with context)
                                                          ↓
                                                  streaming response
```

## Data Model

All RAG data lives in `chrome.storage.session` under key `"rag:chunks"`.

```ts
interface RagChunk {
  id: string          // nanoid
  source: 'page' | 'claim'
  siteUrl: string
  pageTitle: string
  text: string        // 400-600 chars per chunk
}
```

**Constraints:**
- Max 500 chunks total (~250KB). When full, drop oldest (FIFO).
- Dedup key: `siteUrl + text.slice(0, 50)` — skip re-indexing same content.

## Ingestion Pipeline

### Source 1: Raw page text (content script)

- Trigger: `document.readyState === 'complete'`, only if user has used the extension on the page.
- Extract `document.body.innerText`, skip elements < 50 chars (nav, footer heuristic).
- Split into ~500 char chunks at sentence boundaries.
- Send `{ type: 'RAG_INGEST_CHUNKS', chunks }` message to background service worker.
- Background writes to `chrome.storage.session`.

### Source 2: Claims from backend (sidebar)

- Trigger: `ChatTab` mounts with a valid `projectId`.
- Call `listClaims(projectId)`.
- Format each claim: `"[Claim] {text} — Source: {paper_title}, {site}"`.
- Write directly to `chrome.storage.session` via `rag-store`.
- Skip claims already indexed (dedup check).

## BM25 Retrieval

Pure JS implementation, no external dependencies. Parameters: k1=1.5, b=0.75.

```ts
// src/shared/bm25.ts
export function bm25Search(query: string, chunks: RagChunk[], topK = 5): RagChunk[]
```

**Per-query flow:**
1. `getAllChunks()` from `chrome.storage.session` (~1ms)
2. Tokenize query: lowercase, split whitespace, strip punctuation
3. Build IDF table from corpus (~5ms for 500 chunks)
4. Score each chunk, return top-5

**If no chunks exist** (user hasn't browsed any pages): send message without context — chat still works normally.

## Chat Integration

### Frontend change (`ChatTab.tsx`)

Before calling `createRun`, retrieve context:

```ts
const chunks = await getAllChunks()
const context = chunks.length > 0
  ? buildContext(bm25Search(input, chunks))
  : undefined

await createRun({
  kind: 'chat',
  project_id: projectId,
  idempotency_key: idem,
  provider,
  input: {
    messages: newThread.map(m => ({ role: m.role, content: m.content })),
    ...(context && { context }),
  },
})
```

**Context format sent to backend:**

```
Relevant content:

[Page from https://example.com]
<chunk text>

---

[Claim from pubmed.ncbi.nlm.nih.gov]
<claim text>
```

### Backend change (`chat` run handler)

Accept optional `context` field in run input, inject into system prompt:

```python
system = "You are a research assistant."
if context := input.get("context"):
    system += f"\n\nUse the following extracted content to answer:\n\n{context}"
```

## Files Changed

| File | Change |
|------|--------|
| `src/shared/bm25.ts` | **New** — BM25 algorithm + tokenizer |
| `src/shared/rag-store.ts` | **New** — `ingestChunks`, `getAllChunks`, `clearChunks` wrappers for `chrome.storage.session` |
| `src/content.ts` | **Edit** — add page text extraction + `RAG_INGEST_CHUNKS` message |
| `src/shared/messages.ts` | **Edit** — add `RAG_INGEST_CHUNKS` message type |
| `src/background_minimal.ts` | **Edit** — handle `RAG_INGEST_CHUNKS`, write to session storage |
| `src/sidebar/components/tabs/ChatTab.tsx` | **Edit** — claim ingestion on mount, BM25 retrieval before send |
| `backend/app/...` (chat handler) | **Edit** — accept `context` in input, inject into system prompt |

## Out of Scope

- UI indicator showing "N sources indexed" (can be added later)
- Chunk deduplication across sessions
- Support for PDF or binary page content
- Per-project isolation of RAG chunks (all projects share the session index)
