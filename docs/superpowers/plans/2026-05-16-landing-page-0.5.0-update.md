# Landing Page 0.5.0 Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update Research Kit landing page to highlight 0.5.0 stability improvements through badge changes, feature description updates, and versions table refresh.

**Architecture:** Single-file HTML update (no build/compile step needed). Changes are surgical edits to existing elements: replace one badge text, expand one feature card description, and insert new version row in table.

**Tech Stack:** Static HTML (no framework, no build tools)

---

## File Structure

- Modify: `research-kit/landing/index.html` — three surgical edits to hero badges, feature card, and versions table

---

### Task 1: Update Hero Badges

**Files:**
- Modify: `research-kit/landing/index.html:386-391`

- [ ] **Step 1: Locate hero badges in HTML**

Open `research-kit/landing/index.html` and find the `<div class="hero-badges">` section (around line 386). Current content:
```html
<div class="hero-badges">
  <span class="badge">Elicit</span>
  <span class="badge">SciSpace</span>
  <span class="badge">Consensus</span>
  <span class="badge">AI-Powered</span>
  <span class="badge">Google Sign-in</span>
</div>
```

- [ ] **Step 2: Replace "Google Sign-in" badge with "Stable LLM Routing"**

Edit the last badge from:
```html
<span class="badge">Google Sign-in</span>
```

To:
```html
<span class="badge">Stable LLM Routing</span>
```

- [ ] **Step 3: Verify badges section looks correct**

Confirm the updated `<div class="hero-badges">` now reads:
```html
<div class="hero-badges">
  <span class="badge">Elicit</span>
  <span class="badge">SciSpace</span>
  <span class="badge">Consensus</span>
  <span class="badge">AI-Powered</span>
  <span class="badge">Stable LLM Routing</span>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add research-kit/landing/index.html
git commit -m "feat(landing): update hero badge to highlight stable LLM routing"
```

---

### Task 2: Update Conflict Detection Feature Card

**Files:**
- Modify: `research-kit/landing/index.html:459-465`

- [ ] **Step 1: Locate conflict detection feature card**

Find the feature card with title "Conflict detection" (around line 459-465). Current description:
```html
<div class="feature-card">
  <div class="feature-icon">
    <svg>...</svg>
  </div>
  <h3>Conflict detection</h3>
  <p>Automatically flags when the same paper is cited with contradictory findings across different sources, with AI-suggested resolutions.</p>
</div>
```

- [ ] **Step 2: Replace feature description**

Update the `<p>` tag from:
```html
<p>Automatically flags when the same paper is cited with contradictory findings across different sources, with AI-suggested resolutions.</p>
```

To:
```html
<p>Automatically flags contradictory findings and surfaces structured error messages with AI-suggested resolutions — powered by fallback LLM routing for 99.9% uptime.</p>
```

- [ ] **Step 3: Verify the card looks correct**

Confirm the conflict detection card now shows the updated description that mentions fallback LLM routing and uptime.

- [ ] **Step 4: Commit**

```bash
git add research-kit/landing/index.html
git commit -m "feat(landing): highlight LLM fallback reliability in conflict detection card"
```

---

### Task 3: Add 0.5.0 Version to Table and Update Latest Tag

**Files:**
- Modify: `research-kit/landing/index.html:497-511`

- [ ] **Step 1: Locate versions table**

Find the versions table (around line 497-511). Current first row:
```html
<tr>
  <td>
    <strong>0.4.0</strong>
    <span class="tag-latest">Latest</span>
  </td>
  <td>2026-05-15</td>
  <td class="notes">Conflict detection overhaul (auto-detect, radio-select, confirm flow), inbox bulk archive &amp; auto-archive after Add to project, draft date metadata in <code>.md</code>/<code>.docx</code> export, structured verify error messages.</td>
  <td>
    <a href="releases/research-kit-0.4.0.zip" class="btn btn-primary" style="font-size:0.82rem;padding:0.4rem 0.9rem;">
      <svg>...</svg>
      .zip
    </a>
  </td>
</tr>
```

- [ ] **Step 2: Insert new 0.5.0 row at top of table body**

Insert this new row immediately after `<tbody>` and before the 0.4.0 row:
```html
<tr>
  <td>
    <strong>0.5.0</strong>
    <span class="tag-latest">Latest</span>
  </td>
  <td>2026-05-16</td>
  <td class="notes">Stable LLM fallbacks (Groq → Gemini/OpenAI), structured error messages, batched conflict detection for 3x faster analysis, improved tab state cleanup.</td>
  <td>
    <a href="releases/research-kit-0.5.0.zip" class="btn btn-primary" style="font-size:0.82rem;padding:0.4rem 0.9rem;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      .zip
    </a>
  </td>
</tr>
```

- [ ] **Step 3: Remove "Latest" tag from 0.4.0 row**

In the 0.4.0 row, change:
```html
<td>
  <strong>0.4.0</strong>
  <span class="tag-latest">Latest</span>
</td>
```

To:
```html
<td>
  <strong>0.4.0</strong>
</td>
```

- [ ] **Step 4: Verify table structure**

Confirm the table now shows:
- Row 1: 0.5.0 with "Latest" tag, released 2026-05-16, release notes about fallback LLM, .zip download
- Row 2: 0.4.0 without "Latest" tag, released 2026-05-15, old notes, .zip download
- Row 3+: Earlier versions unchanged

- [ ] **Step 5: Commit**

```bash
git add research-kit/landing/index.html
git commit -m "feat(landing): add 0.5.0 version to releases table, mark as latest"
```

---

### Task 4: Visual Verification

**Files:**
- Test: `research-kit/landing/index.html` (visual inspection in browser)

- [ ] **Step 1: Open landing page in browser**

Navigate to `file:///d:/vin_product/A20-App-012/research-kit/landing/index.html` in Chrome or your preferred browser.

- [ ] **Step 2: Verify hero section**

- Scroll to top
- Confirm badges now read: "Elicit · SciSpace · Consensus · AI-Powered · Stable LLM Routing"
- Confirm badge text displays correctly and doesn't overflow on desktop or mobile

- [ ] **Step 3: Verify features section**

- Scroll to Features section
- Find "Conflict detection" card
- Confirm description now mentions "fallback LLM routing" and "99.9% uptime"
- Verify card layout is not broken

- [ ] **Step 4: Verify versions table**

- Scroll to Versions section
- Confirm 0.5.0 appears at the top with "Latest" tag
- Confirm release date shows 2026-05-16
- Confirm release notes mention: "Stable LLM fallbacks", "structured error messages", "batched conflict detection for 3x faster analysis", "improved tab state cleanup"
- Confirm 0.4.0 no longer has "Latest" tag
- Confirm all download links are present (.zip buttons)
- Test on mobile viewport (resize browser to ~375px width) — confirm table doesn't break, badges wrap cleanly

- [ ] **Step 5: Final commit with verification note**

```bash
git add research-kit/landing/index.html
git commit -m "test(landing): visual verification complete — 0.5.0 release page ready"
```

---

## Summary

This plan updates the landing page with three surgical edits:
1. Hero badge (one text replacement)
2. Feature card description (one paragraph update)
3. Versions table (one new row insertion, one tag removal)

All changes are HTML-only, no CSS/JavaScript changes needed. The page is static and requires visual verification in a browser.
