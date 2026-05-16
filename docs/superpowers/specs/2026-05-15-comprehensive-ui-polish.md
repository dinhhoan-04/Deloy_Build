# ResearchKit — Comprehensive UI Polish

**Date:** 2026-05-15
**Prerequisite:** Spec `2026-05-14-shell-components-warm-modern.md` must be applied first (tokens + shell components already done)
**Scope:** Component fixes · Motion system · Typography audit
**Priority:** Clarity → Consistency → Delight

---

## Overview

Three areas of work, implemented in order:

1. **Component Fixes** — 6 components still unpolished (ConflictResolutionPanel, PaperGroup, StatusBadge, Toast, Checkbox, Empty States)
2. **Motion System** — Skeleton shimmer + stagger animation + hover lift + toast slide-in (CSS-only, zero new dependencies)
3. **Typography Audit** — Normalize font-size, font-weight, color across 5 files

---

## 1. tokens.css additions

**File:** `src/sidebar/styles/tokens.css`

Add these keyframes and utility classes (do not modify existing ones):

```css
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}
@keyframes staggerIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes toastSlide {
  from { opacity: 0; transform: translateY(-10px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}

.animate-shimmer   { animation: shimmer    1.4s ease-in-out infinite; }
.animate-staggerIn { animation: staggerIn  0.22s ease-out both; }
.animate-toastSlide{ animation: toastSlide 0.22s ease-out both; }
```

---

## 2. Checkbox.tsx (new atom)

**File:** `src/sidebar/components/atoms/Checkbox.tsx`

Custom checkbox replacing native `<input type="checkbox">` in DraftTab and PaperGroup.

```
Props: { checked: boolean; onChange: () => void; label?: string }
```

- Container: `<label>` with `display:flex; align-items:flex-start; gap:8px; cursor:pointer`
- Box: `16×16`, `border-radius:5px`
  - Unchecked: `border: 2px solid var(--rk-border-warm); background: white`
  - Checked: `background: var(--rk-brand-gradient); border: none` + SVG checkmark (10×10, white stroke, strokeWidth 2)
- Label text: `font-size:12px; color:var(--rk-text)` — bold (`color:var(--rk-text-brand); font-weight:600`) when checked

Replace `<input type="checkbox" ... className="mt-0.5 shrink-0">` in:
- `PaperGroup.tsx` — claim row checkbox
- `DraftTab.tsx` — claim selector checkbox

---

## 3. StatusBadge.tsx

**File:** `src/sidebar/components/atoms/StatusBadge.tsx`

Two fixes:

**`pending`:** Replace `--rk-blue` with brand purple + add icon prefix
```
background: rgba(124,58,237,0.10)
color: var(--rk-brand)
border: 1px solid rgba(124,58,237,0.25)
label: "⏳ Pending"   (literal emoji — no SVG needed here)
```

**`inaccessible`:** Replace hardcoded `orange-*` Tailwind classes + rename label
```
background: rgba(234,88,12,0.10)    /* warm orange subtle */
color: #c2410c
border: 1px solid rgba(234,88,12,0.25)
label: "🔒 Locked"   (renamed from "Inaccessible" — clearer for user)
```

All other statuses unchanged.

---

## 4. Toast.tsx

**File:** `src/sidebar/components/atoms/Toast.tsx`

### SVG icon per tone

Declare three inline SVG icon components at top of file (no import needed):

- **SuccessIcon:** circle + polyline checkmark (`stroke: currentColor`, 13×13)
- **WarningIcon:** triangle + vertical line (`stroke: currentColor`, 13×13)
- **ErrorIcon:** circle + X cross (`stroke: currentColor`, 13×13)

### Layout change
```
<div className="animate-toastSlide flex items-center gap-2 px-3 py-2 text-sm ..."
     style={{ borderRadius: 10, boxShadow: 'var(--rk-shadow-sm)' }}>
  <IconComponent />   {/* tone-specific icon */}
  <span className="flex-1">{message}</span>
  <button ...>✕</button>
</div>
```

`TONE_CLASS` stays the same — only layout and icon are added.

---

## 5. PaperGroup.tsx

**File:** `src/sidebar/components/atoms/PaperGroup.tsx`

### Header row
- `border: 1px solid var(--rk-border-warm)` (replaces `--rk-border`)
- `box-shadow: var(--rk-shadow-sm)`
- Add gradient folder icon left of title:
  - `28×28`, `border-radius:8px`, `background:var(--rk-brand-gradient)`, folder SVG (12×12, white stroke)
- Paper title: `font-size:12px; font-weight:600; color:var(--rk-text-brand)`
- Claim count: `font-size:10px; color:var(--rk-brand); font-weight:500`
- Replace emoji chevrons `▲`/`▼` with SVG ChevronUp / ChevronDown (14×14, `stroke:var(--rk-brand)`, strokeWidth 2.5)
- Hover background: `var(--rk-surface-warm)` (replaces `--rk-surface-2`)

### Claim rows (expanded)
- `divide-y divide-[var(--rk-border-warm)]` (replaces `--rk-border`)
- Replace native checkbox with `<Checkbox>` atom
- Remove button text from expand trigger (already using chevron icon)

---

## 6. ConflictResolutionPanel.tsx

**File:** `src/sidebar/components/atoms/ConflictResolutionPanel.tsx`

Full redesign — current component is completely unstyled.

### Card wrapper
```
border: 1px solid var(--rk-border-warm)
border-radius: 12px
box-shadow: var(--rk-shadow-sm)
overflow: hidden
```

### Card header
```
padding: 10px 12px
background: linear-gradient(135deg, rgba(124,58,237,0.06), rgba(37,99,235,0.06))
border-bottom: 1px solid var(--rk-border-warm)
display: flex; align-items: center; gap: 8px
```
- Conflict icon box: `22×22`, `border-radius:6px`, `background:var(--rk-brand-gradient)`, lightning SVG (11×11, white)
- Title: `font-size:12px; font-weight:700; color:var(--rk-text-brand)` — show `conflict.paper_title ?? conflict.group_key`

### Diff grid
- `display: grid; grid-template-columns: 1fr 1fr`
- Each side panel:
  - `padding: 10px`
  - Source label: `font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--rk-brand)` — show `s.label` (the site name)
  - Quote text: `font-size:11px; color:var(--rk-text); line-height:1.5`
  - Accept button: `font-size:10px; padding:3px 10px; background:var(--rk-brand-gradient); color:white; border-radius:99px; border:none; font-weight:600` — label "Accept →"
  - Right panel has `border-left: 1px solid var(--rk-border-warm)`

### AI suggestion footer
```
padding: 8px 12px
border-top: 1px solid var(--rk-border-warm)
background: var(--rk-surface-warm)
```
- When suggestion exists: show suggestion text in `font-size:11px; color:var(--rk-text-2)` prefixed by `font-weight:600; color:var(--rk-text-brand)` label "Suggestion:"
- When no suggestion: "✦ Get AI Suggestion" pill — `background:white; color:var(--rk-brand); border:1px solid var(--rk-border-warm); border-radius:99px; font-size:10px; font-weight:600; padding:4px 12px`
- `disabled` state: `opacity:0.5`

---

## 7. ClaimCard.tsx — hover lift + typography

**File:** `src/sidebar/components/atoms/ClaimCard.tsx`

### Hover lift
Add to outer `<div>`:
```css
transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease
```
On hover (via `onMouseEnter`/`onMouseLeave` or Tailwind group-hover):
```css
transform: translateY(-2px)
box-shadow: 0 6px 16px rgba(124,58,237,0.14)
border-color: #c4b5fd   /* lighter purple */
```

Use inline style + `useState<boolean>` for `hovered`:
```tsx
const [hovered, setHovered] = useState(false)
// onMouseEnter={() => setHovered(true)}
// onMouseLeave={() => setHovered(false)}
```

### Typography
- `claim.text`: `font-size:13px` (was `text-sm` = 14px)
- `claim.paperTitle`: `font-size:10px; font-weight:500` (was `fontSize:9px`)

---

## 8. VerifyTab.tsx — skeleton shimmer + stagger + empty state

**File:** `src/sidebar/components/tabs/VerifyTab.tsx`

### Skeleton shimmer (replaces spinner when `isDetecting`)

Replace:
```tsx
<span className="w-4 h-4 border-2 ..." />
<p className="text-sm ...">Detecting claims…</p>
```

With 3 skeleton cards:
```tsx
function SkeletonCard() {
  return (
    <div style={{ border:'1px solid var(--rk-border-warm)', borderRadius:10, padding:12 }}>
      <div className="animate-shimmer" style={{
        height:10, borderRadius:6, marginBottom:8, width:'100%',
        background:'linear-gradient(90deg,#f0e8ff 25%,#e9d5ff 50%,#f0e8ff 75%)',
        backgroundSize:'800px 100%'
      }} />
      <div className="animate-shimmer" style={{
        height:10, borderRadius:6, marginBottom:10, width:'60%',
        background:'linear-gradient(90deg,#f0e8ff 25%,#e9d5ff 50%,#f0e8ff 75%)',
        backgroundSize:'800px 100%'
      }} />
      <div style={{ display:'flex', gap:8 }}>
        <div className="animate-shimmer" style={{
          height:18, width:56, borderRadius:99,
          background:'linear-gradient(90deg,#f0e8ff 25%,#e9d5ff 50%,#f0e8ff 75%)',
          backgroundSize:'800px 100%'
        }} />
      </div>
    </div>
  )
}
```

Show `<SkeletonCard />` × 3 in a `flex flex-col gap-2 p-3` wrapper.

### Stagger animation on claim list

When rendering `filtered.map(claim, index)`, add `animationDelay: ${index * 60}ms` to each `<ClaimCard>` wrapper:
```tsx
<div
  key={claim.id}
  className="animate-staggerIn"
  style={{ animationDelay: `${index * 60}ms` }}
>
  <ClaimCard ... />
</div>
```

### Empty state redesign

Replace plain text with branded empty state:
```tsx
<div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
  <div style={{
    width:48, height:48, borderRadius:14,
    background:'linear-gradient(135deg,rgba(124,58,237,0.12),rgba(37,99,235,0.12))',
    display:'flex', alignItems:'center', justifyContent:'center',
  }}>
    <svg width="22" height="22" ...>  {/* verify checkmark icon */}
  </div>
  <p style={{ fontSize:13, fontWeight:600, color:'var(--rk-text-brand)' }}>No claims yet</p>
  <p style={{ fontSize:12, color:'var(--rk-text-3)', lineHeight:1.5 }}>
    Open Elicit, SciSpace or Consensus and run a search to start.
  </p>
</div>
```

---

## 9. InboxTab.tsx — empty state

**File:** `src/sidebar/components/tabs/InboxTab.tsx`

Replace plain text empty state with branded version using inbox SVG icon (same pattern as VerifyTab).

- Icon: inbox/tray SVG (22×22)
- Title: `"Inbox is empty"` — 13px/600/rk-text-brand
- Body: `"Verified claims will appear here for review."` — 12px/rk-text-3

---

## 10. ConflictsTab.tsx — empty state

**File:** `src/sidebar/components/tabs/ConflictsTab.tsx`

Replace plain text with branded empty state:
- Icon: lightning/bolt SVG (22×22) in gradient box
- Title: `"No conflicts"` — 13px/600/rk-text-brand
- Body: `"Conflicting claims from different sources will appear here."` — 12px/rk-text-3

---

## 11. DraftTab.tsx — empty state + Checkbox

**File:** `src/sidebar/components/tabs/DraftTab.tsx`

The existing empty draft output state already has a decent icon box. Minor updates:
- Replace `<input type="checkbox">` with `<Checkbox>` atom in claim selector list
- Empty output state icon: ensure color is `var(--rk-brand)` not hardcoded

---

## 12. TabBar.tsx — active label typography

**File:** `src/sidebar/components/shell/TabBar.tsx`

Active tab label: add `fontWeight: 700` to the label `<span>` when `isActive`:
```tsx
<span style={isActive ? { fontWeight: 700 } : undefined}>{tab.label}</span>
```

---

## Implementation Order

1. `tokens.css` — add shimmer/staggerIn/toastSlide keyframes + utility classes
2. `atoms/Checkbox.tsx` — new component
3. `atoms/StatusBadge.tsx` — pending/inaccessible color fix
4. `atoms/Toast.tsx` — icons + slide-in animation
5. `atoms/PaperGroup.tsx` — warm tokens + SVG chevrons + folder icon + Checkbox
6. `atoms/ConflictResolutionPanel.tsx` — full redesign
7. `atoms/ClaimCard.tsx` — hover lift + typography
8. `tabs/VerifyTab.tsx` — skeleton shimmer + stagger + empty state
9. `tabs/InboxTab.tsx` — empty state
10. `tabs/ConflictsTab.tsx` — empty state
11. `tabs/DraftTab.tsx` — Checkbox + empty state minor fix
12. `shell/TabBar.tsx` — active label font-weight

Run `npm run build` after all 12 steps to verify TypeScript clean.

---

## Out of Scope

- No layout changes to any tab (no split-pane, no new columns)
- No framer-motion or any animation library
- No changes to shell components (Header, Footer, ProgressBar — already done in previous spec)
- No changes to ChatTab or MessageBubble (already polished)
- No changes to HelpTab, ProjectPickerModal, ProjectCreateModal (already acceptable)
