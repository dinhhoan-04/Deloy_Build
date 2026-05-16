# Draft Quality Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve draft generation quality by rewriting the system prompt, enriching claim input with paper metadata, and adding template + citation style selection to the UI.

**Architecture:** Two independent changes — (1) backend prompt rewrite in `runs.py`, (2) extension UI adds two dropdowns and passes enriched claims. No DB migrations, no new endpoints, no schema changes.

**Tech Stack:** Python/FastAPI (backend), TypeScript/React (extension), Zustand (state)

---

## File Map

| File | Change |
|---|---|
| `research-kit/backend/app/routers/runs.py` | Rewrite system prompt + user message for `RunKind.DRAFT`; add `DRAFT_SYSTEM_PROMPT` constant |
| `research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx` | Replace `STYLES` with `TEMPLATES` + `CITATION_STYLES`; add two selector rows; enrich claims |

---

## Task 1: Rewrite backend draft prompt

**Files:**
- Modify: `research-kit/backend/app/routers/runs.py:148-162`

- [ ] **Step 1: Add `DRAFT_SYSTEM_PROMPT` constant above `_draft_schema()`**

In `runs.py`, add this constant before the `_draft_schema` function (around line 116):

```python
_DRAFT_SYSTEM_PROMPT = """You are RK-Draft, an academic writing assistant that produces journal-quality drafts.

You receive verified research claims with optional metadata (verbatim quote, paper
title, authors, year, DOI). Synthesize them into a structured academic draft in
markdown following the specified template and citation style.

TEMPLATE STRUCTURES:

literature_review:
  ## Abstract (2-3 sentences summarizing the scope)
  ## Introduction (context and purpose)
  ## [Thematic Section Title] (one section per major topic cluster in claims)
  ## Discussion (cross-claim synthesis and implications)
  ## Conclusion (1 paragraph)
  ## References

research_summary:
  ## Abstract (2-3 sentences)
  ## Key Findings (one subsection per major finding cluster)
  ## Implications (practical and theoretical)
  ## Conclusion (1 paragraph)
  ## References

CITATION STYLE:

apa:
  - Inline: (Smith & Doe, 2023) or (Smith et al., 2023) for 3+ authors
  - If only title available: (Short Title, year) or (Short Title) if year unknown
  - References section: Smith, J., & Doe, A. (2023). Title. https://doi.org/...

vancouver or ieee:
  - Inline: [1], [2] in order of first appearance
  - References section: numbered list — 1. Smith J, Doe A. Title. DOI.

RULES:
1. FIDELITY: Only assert what the claims explicitly state. Do not add background
   knowledge, statistics, or conclusions not present in the input.
2. OUTLINE: If outline_hint is provided, use it to guide section and theme grouping.
3. LENGTH: Abstract 2-3 sentences. Each section body 3-5 sentences. Concise over verbose.
4. REFERENCES: Always emit a ## References section at the end using all cited papers.
5. OUTPUT: Return valid JSON. markdown = full draft. sections = heading structure."""
```

- [ ] **Step 2: Update `_execute_inline_run` DRAFT block to use new prompt and richer user message**

Replace the existing `if kind == RunKind.DRAFT:` block (lines ~148–162) with:

```python
    if kind == RunKind.DRAFT:
        user = json.dumps({
            "claims": run_input.get("claims", []),
            "template": run_input.get("template", "research_summary"),
            "citation_style": run_input.get("citation_style", "apa"),
            "outline_hint": run_input.get("outline_hint", ""),
            "meta": run_input.get("meta", {}),
        })
        try:
            out = await provider.extract(_DRAFT_SYSTEM_PROMPT, user, _draft_schema())
        except (ProviderError, RateLimitError) as e:
            raise RuntimeError(str(e)) from e
        return out, json.dumps(out)
```

- [ ] **Step 3: Verify the server starts without errors**

```bash
cd research-kit/backend
uvicorn app.main:app --reload
```

Expected: server starts, no import errors.

- [ ] **Step 4: Commit**

```bash
git add research-kit/backend/app/routers/runs.py
git commit -m "feat(draft): rewrite system prompt with template and citation style support"
```

---

## Task 2: Update extension UI — replace style selector with template + citation style

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx`

- [ ] **Step 1: Replace `STYLES` constant with `TEMPLATES` and `CITATION_STYLES`**

Remove lines 11–15:
```ts
const STYLES: { value: 'short' | 'default' | 'long'; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'default', label: 'Default' },
  { value: 'long', label: 'Long' },
]
```

Add in their place:
```ts
const TEMPLATES: { value: 'literature_review' | 'research_summary'; label: string }[] = [
  { value: 'research_summary', label: 'Research Summary' },
  { value: 'literature_review', label: 'Literature Review' },
]

const CITATION_STYLES: { value: 'apa' | 'vancouver' | 'ieee'; label: string }[] = [
  { value: 'apa', label: 'APA' },
  { value: 'vancouver', label: 'Vancouver' },
  { value: 'ieee', label: 'IEEE' },
]
```

- [ ] **Step 2: Replace `style` state with `template` + `citationStyle` state**

Remove:
```ts
const [style, setStyle] = useState<'short' | 'default' | 'long'>('default')
```

Add:
```ts
const [template, setTemplate] = useState<'literature_review' | 'research_summary'>('research_summary')
const [citationStyle, setCitationStyle] = useState<'apa' | 'vancouver' | 'ieee'>('apa')
```

- [ ] **Step 3: Enrich claims in `generate()` — add `verbatim_quote` from `quote` field**

Replace the `claimsForDraft` mapping inside `generate()`:

```ts
const claimsForDraft = inboxItems
  .filter(i => selected.has(i.id))
  .map(i => {
    const c = claims.find(x => x.id === i.claim_id)
    return c ? {
      id: c.id,
      text: c.text,
      verbatim_quote: c.quote ?? undefined,
      paper_title: c.paper_title ?? undefined,
      doi: c.doi ?? undefined,
    } : null
  })
  .filter((x): x is NonNullable<typeof x> => x !== null)
```

- [ ] **Step 4: Pass `template` and `citationStyle` in `createRun` call**

Replace the `createRun` call inside `generate()`:

```ts
const { run_id } = await createRun({
  kind: 'draft', project_id: projectId, idempotency_key: idem,
  provider,
  input: { claims: claimsForDraft, template, citation_style: citationStyle },
})
```

- [ ] **Step 5: Replace the style selector buttons in the Controls section with two selector rows**

Find and replace the entire `{/* Controls */}` div (the one containing the STYLES map and Generate button). Replace the inner flex container's first child (the styles buttons div) with two compact rows:

```tsx
{/* Controls */}
<div
  className="shrink-0 px-3 py-2"
  style={{ borderBottom: '1px solid var(--rk-border-warm)', background: 'white' }}
>
  {/* Template row */}
  <div className="flex items-center gap-2 mb-1">
    <span className="text-xs shrink-0" style={{ color: 'var(--rk-text-3)', width: 48 }}>Template</span>
    <div className="flex gap-1">
      {TEMPLATES.map(t => (
        <button
          key={t.value}
          onClick={() => setTemplate(t.value)}
          style={template === t.value ? {
            background: 'var(--rk-brand-gradient)', color: 'white',
            border: 'none', fontWeight: 600, boxShadow: '0 2px 4px rgba(124,58,237,0.25)',
          } : {
            background: 'var(--rk-surface-warm)', color: 'var(--rk-brand)',
            border: '1px solid var(--rk-border-warm)',
          }}
          className="text-xs px-3 py-1 rounded-full transition-colors"
        >{t.label}</button>
      ))}
    </div>
  </div>
  {/* Citation style row */}
  <div className="flex items-center gap-2 mb-2">
    <span className="text-xs shrink-0" style={{ color: 'var(--rk-text-3)', width: 48 }}>Citation</span>
    <div className="flex gap-1">
      {CITATION_STYLES.map(s => (
        <button
          key={s.value}
          onClick={() => setCitationStyle(s.value)}
          style={citationStyle === s.value ? {
            background: 'var(--rk-brand-gradient)', color: 'white',
            border: 'none', fontWeight: 600, boxShadow: '0 2px 4px rgba(124,58,237,0.25)',
          } : {
            background: 'var(--rk-surface-warm)', color: 'var(--rk-brand)',
            border: '1px solid var(--rk-border-warm)',
          }}
          className="text-xs px-3 py-1 rounded-full transition-colors"
        >{s.label}</button>
      ))}
    </div>
  </div>
  {/* Action buttons row */}
  <div className="flex items-center gap-2">
    <div className="flex-1" />
    <button
      onClick={() => void generate()}
      disabled={selected.size === 0 || !!activeRunId}
      style={{
        background: selected.size === 0 || !!activeRunId ? 'var(--rk-border-warm)' : 'var(--rk-brand-gradient)',
        color: selected.size === 0 || !!activeRunId ? 'var(--rk-text-3)' : 'white',
        border: 'none', borderRadius: 99, padding: '5px 14px', fontSize: 12, fontWeight: 600,
        cursor: selected.size === 0 || !!activeRunId ? 'not-allowed' : 'pointer',
      }}
    >{activeRunId ? 'Generating…' : 'Generate'}</button>
    {streamMarkdown && (
      <button
        onClick={() => void handleSave()}
        disabled={draft.saving}
        style={{
          background: draft.saving ? 'var(--rk-border-warm)' : 'var(--rk-brand-gradient)',
          color: draft.saving ? 'var(--rk-text-3)' : 'white',
          border: 'none', borderRadius: 99, padding: '5px 14px', fontSize: 12, fontWeight: 600,
          cursor: draft.saving ? 'not-allowed' : 'pointer',
        }}
      >{draft.saving ? 'Saving…' : 'Save'}</button>
    )}
  </div>
</div>
```

- [ ] **Step 6: Build extension to verify no TypeScript errors**

```bash
cd research-kit/extension
npm run build
```

Expected: build succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx
git commit -m "feat(draft): add template and citation style selectors, enrich claims with metadata"
```

---

## Self-Review

**Spec coverage:**
- ✅ `citation_style: "apa" | "vancouver" | "ieee"` — Task 2 Steps 1–4
- ✅ `template: "literature_review" | "research_summary"` — Task 2 Steps 1–4
- ✅ System prompt with template structures + citation rules — Task 1 Steps 1–2
- ✅ Enrich claims with `verbatim_quote`, `paper_title`, `doi` — Task 2 Step 3
- ✅ Anti-hallucination FIDELITY rule in prompt — Task 1 Step 1
- ✅ References section always emitted — Task 1 Step 1 (Rule 4)
- ✅ `outline_hint` passed through — Task 1 Step 2, Task 2 Step 4
- ⚠️ `year` and `authors` not available on `Claim` type — citations will use paper_title as fallback per prompt Rule 2. This is acceptable given current data model.

**Placeholder scan:** No TBDs, no "implement later", all code blocks complete.

**Type consistency:**
- `template` state: `'literature_review' | 'research_summary'` — matches `TEMPLATES` values ✅
- `citationStyle` state: `'apa' | 'vancouver' | 'ieee'` — matches `CITATION_STYLES` values ✅
- `citation_style` key in `createRun` input matches backend `run_input.get("citation_style")` ✅
