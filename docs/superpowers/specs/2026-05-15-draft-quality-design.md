# Draft Quality Improvement — Design Spec

**Date:** 2026-05-15  
**Approach:** Hướng 2 — Prompt Engineering + Input Enrichment

---

## Problem

The current draft feature uses a one-line system prompt and sends raw claim IDs
as citations. Output lacks academic structure, citations are meaningless
(`[c1]`, `[c2]`), and the LLM has no anti-hallucination guardrails.

---

## Goals

1. Output is readable enough to export and use directly (docx/md)
2. Output has clear structure for the user to edit further
3. Citations are traceable back to original papers
4. User can choose citation style (APA, Vancouver, IEEE)
5. User can choose document template (Literature Review, Research Summary)

---

## Architecture

No new endpoints, no DB migrations. Changes are confined to:

- `research-kit/backend/app/routers/runs.py` — system prompt + user message for `RunKind.DRAFT`
- `research-kit/extension/src/` — enrich claim objects and expose template/citation_style options in UI

---

## Input Schema (extension → backend)

```json
{
  "claims": [
    {
      "id": "c1",
      "text": "Exercise reduces depression symptoms",
      "verbatim_quote": "Participants showed 42% reduction...",
      "paper_title": "Exercise and Mental Health",
      "doi": "10.1234/emh.2023",
      "year": 2023,
      "authors": ["Smith J", "Doe A"]
    }
  ],
  "template": "literature_review",
  "citation_style": "apa",
  "outline_hint": "Focus on mechanisms and practical implications"
}
```

- `template`: `"literature_review"` | `"research_summary"` — controls section structure
- `citation_style`: `"apa"` | `"vancouver"` | `"ieee"` — controls inline citation format and reference list
- `outline_hint`: optional free-text to guide section organization
- All claim fields except `id` and `text` are optional — citations degrade gracefully if absent

---

## Templates

### literature_review
Sections: Abstract → Introduction → Thematic Sections (grouped by topic) → Discussion → Conclusion → References

### research_summary
Sections: Abstract → Key Findings → Implications → Conclusion → References

---

## Citation Style Rules

### APA
- Inline: `(Smith & Doe, 2023)` or `(Smith et al., 2023)` for 3+ authors
- References section: `Smith, J., & Doe, A. (2023). Title. DOI`

### Vancouver / IEEE
- Inline: `[1]`, `[2]` — numbered in order of appearance
- References section: numbered list `1. Smith J, Doe A. Title. DOI`

---

## System Prompt (new)

```
You are RK-Draft, an academic writing assistant that produces journal-quality drafts.

You receive verified research claims with optional metadata (verbatim quote, paper
title, authors, year, DOI). Synthesize them into a structured academic draft in
markdown following the specified template and citation style.

TEMPLATE STRUCTURES:

literature_review:
  ## Abstract (2–3 sentences summarizing the scope)
  ## Introduction (context and purpose)
  ## [Thematic Section Title] (one section per major topic cluster in claims)
  ## Discussion (cross-claim synthesis and implications)
  ## Conclusion (1 paragraph)
  ## References

research_summary:
  ## Abstract (2–3 sentences)
  ## Key Findings (one subsection per major finding cluster)
  ## Implications (practical and theoretical)
  ## Conclusion (1 paragraph)
  ## References

CITATION STYLE:

apa:
  - Inline: (Smith & Doe, 2023) or (Smith et al., 2023) for 3+ authors
  - If only title available: (Short Title, year)
  - References section: Smith, J., & Doe, A. (2023). Title. https://doi.org/...

vancouver or ieee:
  - Inline: [1], [2] in order of first appearance
  - References section: numbered list — 1. Smith J, Doe A. Title. DOI.

RULES:
1. FIDELITY: Only assert what the claims explicitly state. Do not add background
   knowledge, statistics, or conclusions not present in the input.
2. OUTLINE: If outline_hint is provided, use it to guide section and theme grouping.
3. LENGTH: Abstract 2–3 sentences. Each section body 3–5 sentences. Concise over verbose.
4. REFERENCES: Always emit a ## References section at the end using all cited papers.
5. OUTPUT: Return valid JSON. markdown = full draft. sections = heading structure.
```

---

## User Message

```python
user = json.dumps({
    "claims": run_input.get("claims", []),
    "template": run_input.get("template", "research_summary"),
    "citation_style": run_input.get("citation_style", "apa"),
    "outline_hint": run_input.get("outline_hint", ""),
    "meta": run_input.get("meta", {}),
})
```

---

## Output Schema (unchanged)

```json
{
  "markdown": "## Abstract\n\n...\n\n## References\n\n...",
  "sections": [
    { "title": "Abstract", "claim_refs": [] },
    { "title": "Key Findings", "claim_refs": ["c1", "c2"] },
    { "title": "References", "claim_refs": [] }
  ]
}
```

`_draft_schema()` in `runs.py` requires no changes.

---

## Extension Changes

### 1. Enrich claims in createRun call

```ts
const enrichedClaims = verifiedClaims.map(c => ({
  id: c.id,
  text: c.text,
  verbatim_quote: c.verbatim_quote ?? undefined,
  paper_title: c.paper_title ?? undefined,
  doi: c.doi ?? undefined,
  year: c.year ?? undefined,
  authors: c.authors ?? undefined,
}))
```

### 2. Expose options in Draft UI (before generate)

Two dropdowns / toggles before the user hits "Generate Draft":
- **Template:** Literature Review | Research Summary
- **Citation Style:** APA | Vancouver | IEEE

These values are passed as `template` and `citation_style` in the run input.

---

## What Does NOT Change

- `_draft_schema()` — output schema is unchanged
- DB models / migrations — no changes
- `/v1/runs` endpoint contract — no changes
- Caching logic — no changes

---

## Success Criteria

- Citations in output use correct format for chosen style (APA vs numbered)
- References section always present and populated
- Output structure matches chosen template (correct section headings and order)
- No sentences asserting facts absent from the input claims
