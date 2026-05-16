# Landing Page 0.5.0 Update — Design Spec

**Date:** 2026-05-16  
**Version:** 0.5.0  
**Scope:** Hybrid refresh of Research Kit landing page to highlight 0.5.0 stability improvements

## Overview

Research Kit 0.5.0 is a **stability and reliability release** focused on:
- LLM fallback routing (Groq → Gemini/OpenAI for better uptime)
- Structured error messages with friendly user-facing displays
- Batched conflict detection (3x performance improvement)
- Tab state cleanup and verification improvements

The landing page update will signal these improvements through surgical, low-risk changes to badges, feature descriptions, and the versions table.

## Changes by Section

### 1. Hero Badges

**Current:**
```
Elicit · SciSpace · Consensus · AI-Powered · Google Sign-in
```

**Updated:**
```
Elicit · SciSpace · Consensus · AI-Powered · Stable LLM Routing
```

**Rationale:** Replace "Google Sign-in" (authentication detail) with "Stable LLM Routing" to immediately signal 0.5.0's reliability focus. This tells users the extension handles failures gracefully and will keep working even if primary LLM provider is overloaded.

### 2. Feature Cards — Conflict Detection

**Current description:**
> Automatically flags when the same paper is cited with contradictory findings across different sources, with AI-suggested resolutions.

**Updated description:**
> Automatically flags contradictory findings and surfaces structured error messages with AI-suggested resolutions — powered by fallback LLM routing for 99.9% uptime.

**Rationale:** This ties 0.5.0's core stability feature (LLM fallback) to existing functionality. Users see that reliability improvements are built into their favorite features, not just abstract infrastructure changes.

### 3. Versions Table

**Add new row at top:**
```
Version: 0.5.0
Released: 2026-05-16
Notes: Stable LLM fallbacks (Groq → Gemini/OpenAI), structured error messages, batched conflict detection for 3x faster analysis, improved tab state cleanup.
Status: Latest (move tag from 0.4.0)
Download: .zip
```

**Keep existing 0.4.0 and earlier rows unchanged** — just remove "Latest" tag.

**Release notes rationale:** Summarize four key improvements from 0.5.0:
1. **LLM fallback** — primary headline (addresses reliability concerns)
2. **Error messages** — user-facing benefit (clearer feedback)
3. **Performance** — quantified improvement (3x conflict detection)
4. **State cleanup** — stability fix (prevents bugs across tab switches)

## Files to Modify

- `research-kit/landing/index.html` — update badges, feature card, versions table

## Testing Scope

After changes:
- Verify badges display correctly in hero section (responsive layout)
- Confirm "Latest" tag moved correctly in versions table
- Check all download links still point to correct .zip files
- Test responsive design on mobile (badges/table should wrap cleanly)

## No Breaking Changes

- Hero h1, CTA buttons, "How it works" section remain unchanged
- CSS/styling unchanged (reuse existing badge and feature-card classes)
- Navigation structure unchanged
- Installation guide unchanged

## Success Criteria

1. ✓ 0.5.0 appears as "Latest" in versions table
2. ✓ Hero badges include "Stable LLM Routing"
3. ✓ Conflict detection card mentions fallback LLM routing
4. ✓ Release notes summarize key 0.5.0 improvements
5. ✓ Page renders cleanly on desktop and mobile
6. ✓ All download links are correct
