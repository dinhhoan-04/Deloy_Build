# ResearchKit UX/UI — Warm & Modern Redesign

**Date:** 2026-05-14  
**Approach:** Hybrid — new tokens alongside existing ones, then component-by-component upgrades  
**Style:** Warm & Modern (purple/violet gradient, rounded corners, subtle shadows)  
**Scope:** 4 areas — Design Tokens, TabBar, ChatTab, ClaimCard + Modal polish

---

## 1. Design Tokens (`tokens.css`)

Add the following tokens alongside existing ones. Do **not** remove or rename existing `--rk-*` tokens.

```css
/* Warm & Modern brand extensions */
--rk-brand: #7c3aed;
--rk-brand-hover: #6d28d9;
--rk-brand-gradient: linear-gradient(135deg, #7c3aed, #2563eb);
--rk-brand-subtle: rgba(124, 58, 237, 0.10);
--rk-surface-warm: #faf5ff;
--rk-border-warm: #e9d5ff;
--rk-text-brand: #3b0764;

/* Shadows */
--rk-shadow-sm: 0 2px 8px rgba(124, 58, 237, 0.06);
--rk-shadow-md: 0 4px 16px rgba(124, 58, 237, 0.12);
--rk-shadow-modal: 0 8px 32px rgba(124, 58, 237, 0.18);
```

**Files changed:** `src/sidebar/styles/tokens.css`

---

## 2. TabBar — SVG Icons

**Problem:** Emoji icons (✓ ⬇ ⚡ 💬 ✏ ?) look inconsistent and unprofessional.

**Solution:**
- Replace all 6 emoji with inline SVG icons (Lucide-style, `stroke-width="2"`, 16×16)
- Icon set: Verify=checkmark, Inbox=inbox tray, Conflicts=lightning bolt, Chat=message bubble, Draft=edit pen, Help=circle question mark
- Active tab background: `linear-gradient(135deg, rgba(124,58,237,0.12), rgba(37,99,235,0.12))` — subtle tinted gradient, not full opaque
- Active tab text+icon color: `var(--rk-brand)`
- Badge pill: `background: var(--rk-brand-gradient)` (full gradient) replacing flat blue

**Files changed:** `src/sidebar/components/shell/TabBar.tsx`

---

## 3. ChatTab — Modern Chat UI

**Problem:** MessageBubble uses raw Tailwind `bg-blue-100`/`bg-gray-100`, textarea has no visual polish, no context header.

### 3a. ChatTab layout

Add a header strip at top of chat:
- Avatar circle with gradient + chat icon (SVG)
- Label "AI Research Assistant"
- Online badge (green dot)

Input area redesign:
- Background: `var(--rk-surface-warm)`, border: `1.5px solid var(--rk-border-warm)`
- Border-radius: `12px`
- Focus: border-color switches to `var(--rk-brand)`
- Send button: circular 32×32, `background: var(--rk-brand-gradient)`, send icon SVG, `box-shadow: var(--rk-shadow-sm)`
- Cancel (while streaming): red square button replacing Send

**Files changed:** `src/sidebar/components/tabs/ChatTab.tsx`

### 3b. MessageBubble

Replace raw Tailwind color classes with token-based styles:

| Role | Background | Text | Border-radius | Shadow |
|------|-----------|------|---------------|--------|
| `user` | `var(--rk-brand-gradient)` | white | `14px 14px 3px 14px` | `var(--rk-shadow-sm)` |
| `assistant` | white | `var(--rk-text)` | `14px 14px 14px 3px` | `var(--rk-shadow-sm)` |

Assistant bubble adds: `border: 1px solid var(--rk-border-warm)`, small avatar (20×20 gradient circle).

Add typing indicator: 3 dots with staggered `pulse` CSS animation (opacity + scale, delays 0s / 0.2s / 0.4s), rendered inside the assistant bubble when `content === ''` and `runId` matches the active run (i.e., streaming has started but no tokens yet). Once tokens arrive, dots disappear and tokens render normally.

**Files changed:** `src/sidebar/components/atoms/MessageBubble.tsx`

---

## 4. ClaimCard — Visual Hierarchy

**Problem:** Expand uses `▲`/`▼` text, status is visually flat, confidence bar single-color, live step indicator is 10px text only.

### Changes:

**Left border accent** — driven by `claim.status` (takes priority over `liveStep`):
- `verified` → `border-left: 3px solid var(--rk-green)`
- `partial` → `border-left: 3px solid var(--rk-yellow)`
- `not_found` / `inaccessible` → `border-left: 3px solid var(--rk-red)`  ← use `--rk-red` not subtle variant (needs visible contrast)
- `pending` (liveStep is `queued`/`verifying`/`retrying`) → `border-left: 3px solid var(--rk-brand)`
- default (no status yet) → `border-left: 3px solid var(--rk-border-warm)`

**Expand toggle:** Replace `▲`/`▼` with chevron-down/chevron-up SVG (14×14, `stroke-width="2.5"`, color `var(--rk-brand)`)

**Paper title:** color `var(--rk-brand)` at 9px instead of `var(--rk-text-3)`

**Confidence bar:** gradient `linear-gradient(90deg, var(--rk-brand), <status-color>)` instead of flat color; track background `var(--rk-brand-subtle)`

**Live step indicator:** inline spinner SVG (8×8, `border-top-color:transparent`) + "Verifying…" text in brand color instead of bare `text-[10px]`

**Save button:** `background: var(--rk-brand-subtle)`, `border: 1px solid var(--rk-border-warm)`, `color: var(--rk-brand)`, text "Save to Inbox →"

**Card overall:** `border-color: var(--rk-border-warm)`, `box-shadow: var(--rk-shadow-sm)`, `border-radius: var(--rk-r-md)` (12px)

**Files changed:** `src/sidebar/components/atoms/ClaimCard.tsx`

---

## 5. Modal Polish — "Add to Project"

**Problem:** Inline JSX in `App.tsx` with no token usage, plain `bg-white p-4 rounded w-72`.

**Solution:** Extract to `ProjectPickerModal` component.

Layout:
- Backdrop: `background: rgba(124,58,237,0.15)`, `backdrop-filter: blur(4px)`
- Card: `border-radius: 14px`, `border: 1px solid var(--rk-border-warm)`, `box-shadow: var(--rk-shadow-modal)`, width `240px`
- Header: gradient strip (`var(--rk-surface-warm)` → `#eff6ff`), title + selected count subtitle
- Project rows: folder SVG icon in 24×24 gradient pill, hover `background: var(--rk-surface-warm)`
- Footer: Cancel button right-aligned, `color: var(--rk-brand)`

**Files changed:** New `src/sidebar/components/atoms/ProjectPickerModal.tsx`, update `App.tsx` to use it

---

## 6. Body background warm tint

Update `body` background in `index.css` to blend warm purple into the existing blue radial gradients:

```css
body {
  background:
    radial-gradient(120% 60% at 0% 0%, #ede9fe 0%, transparent 55%),
    radial-gradient(120% 60% at 100% 100%, #dbeafe 0%, transparent 60%),
    var(--rk-bg);
}
```

**Files changed:** `src/sidebar/index.css`

---

## Implementation Order

1. `tokens.css` — add new tokens (no breaking changes)
2. `index.css` — warm background gradient
3. `TabBar.tsx` — SVG icons + gradient active state
4. `MessageBubble.tsx` — token-based bubbles + typing indicator
5. `ChatTab.tsx` — header strip + new input area
6. `ClaimCard.tsx` — left accent, chevron, confidence gradient, live step
7. `ProjectPickerModal.tsx` (new) + update `App.tsx`

---

## Out of Scope

- Dark mode
- InboxTab / ConflictsTab / DraftTab / HelpTab visual changes
- ProgressBar, Header, SettingsPanel, OnboardingOverlay
- Animations beyond existing `tokens.css` keyframes
