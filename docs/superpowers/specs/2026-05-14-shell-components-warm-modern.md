# ResearchKit Shell Components — Warm & Modern Polish

**Date:** 2026-05-14
**Prerequisite:** Spec `2026-05-14-ux-ui-warm-modern-design.md` must be applied first (tokens already available)
**Scope:** Header · ProgressBar · Footer/ProjectSelector · SettingsPanel · OnboardingOverlay · LoginGate

---

## 1. Header

**File:** `src/sidebar/components/shell/Header.tsx`

### Changes

**Logo mark:** Add a 26×26 gradient pill left of the "ResearchKit" title:
- `border-radius: 7px`, `background: var(--rk-brand-gradient)`, `box-shadow: 0 2px 6px rgba(124,58,237,0.30)`
- Contains a checkmark SVG (16×16, white stroke, `stroke-width="2.5"`)

**Title:** `font-weight: 700`, `color: var(--rk-text-brand)`, `letter-spacing: -0.2px`

**Divider:** 1px vertical separator (`background: var(--rk-border-warm)`, `height: 16px`) between title and site pills

**Site pills:**
- Active: `background: linear-gradient(135deg, rgba(124,58,237,0.10), rgba(37,99,235,0.10))`, `color: var(--rk-brand)`, `border: 1px solid var(--rk-border-warm)`, `font-weight: 600`
- Inactive: `background: rgba(124,58,237,0.04)`, `color: var(--rk-text-3)`, `border: 1px solid var(--rk-border-warm)` — visually dimmed to show which sites are off

**Settings button:** Replace `⚙` emoji with inline gear SVG (16×16, Lucide `settings` icon). Button: `width: 32px; height: 32px; border-radius: 8px`. Hover: `background: var(--rk-surface-warm)`. Color: `var(--rk-brand)` (not `--rk-text-3`).

**Header border:** Change `border-[var(--rk-border)]` → `border-[var(--rk-border-warm)]`

---

## 2. ProgressBar

**File:** `src/sidebar/components/shell/ProgressBar.tsx`

### Changes

**Fill bar:**
- Track: `background: var(--rk-brand-subtle)` (replaces `--rk-surface-2`)
- Fill: `background: var(--rk-brand-gradient)` + `box-shadow: 0 0 6px rgba(124,58,237,0.40)` for glow
- Height: `6px` (down from `8px`, cleaner)

**Fraction text:** `color: var(--rk-brand)`, `font-weight: 600`

**Pause/Resume button:**
- Replace emoji `⏸`/`▶` with SVG icons:
  - Pause: two rectangles SVG (filled, `fill: currentColor`)
  - Resume: triangle SVG (filled, `fill: currentColor`)
- Style: `background: var(--rk-surface-warm)`, `border: 1px solid var(--rk-border-warm)`, `color: var(--rk-brand)`, `border-radius: 99px`, `font-size: 10px`, `font-weight: 500`
- Icon size: 9×9

**Step message row:** Add a 6px dot before the step text. When running: `background: var(--rk-brand)` + `animate-pulseDot` class (from tokens.css). When `done === true`: `background: var(--rk-green)`, no animation. Text color: `var(--rk-brand)`, `font-weight: 500`.

**Per-site chips:** Active: `border-color: var(--rk-border-warm)`, `color: var(--rk-brand)`, `background: var(--rk-brand-subtle)` (replaces flat blue)

---

## 3. Footer & ProjectSelector

### 3a. ProjectSelector

**File:** `src/sidebar/components/atoms/ProjectSelector.tsx`

Replace native `<select>` with a custom pill button that opens a dropdown:

**Collapsed state (pill):**
```
[folder-icon] Project Name  ⌄
```
- Container: `background: var(--rk-surface-warm)`, `border: 1px solid var(--rk-border-warm)`, `border-radius: 99px`, `padding: 4px 10px 4px 8px`
- Folder icon: 18×18 gradient pill (`var(--rk-brand-gradient)`) with folder SVG (white, 9×9)
- Name: `font-size: 11px`, `font-weight: 600`, `color: var(--rk-text-brand)`, max-width 100px truncated
- Chevron: 10×10 SVG, `color: var(--rk-brand)`

**Dropdown (when open):** Use `useState<boolean>` for `isOpen`. Position: `position: absolute; bottom: 100%; left: 0; margin-bottom: 4px` relative to the pill container (wrapper needs `position: relative`). `border-radius: 10px`, `border: 1px solid var(--rk-border-warm)`, `box-shadow: var(--rk-shadow-md)`, `background: white`, `min-width: 180px`, `z-index: 10`. Close on outside click via `useEffect` + `document.addEventListener('mousedown', ...)` cleanup.
- Each project row: `padding: 7px 10px`, hover `background: var(--rk-surface-warm)`
- Active project: `color: var(--rk-brand)`, `font-weight: 600`
- "+ New project" row at bottom, `color: var(--rk-brand)`

**New project button (`+`):**
- `width: 28px; height: 28px; border-radius: 8px`
- `background: var(--rk-surface-warm)`, `border: 1px solid var(--rk-border-warm)`, `color: var(--rk-brand)`
- Font-size: 18px (the `+` itself)

### 3b. Footer

**File:** `src/sidebar/components/shell/Footer.tsx`

- Border: `border-[var(--rk-border-warm)]`
- Demo button: `border-radius: 99px`, `background: var(--rk-surface-warm)`, `border: 1px solid var(--rk-border-warm)`, `color: var(--rk-brand)`, `font-weight: 500`

---

## 4. SettingsPanel

**File:** `src/sidebar/components/overlays/SettingsPanel.tsx`

### Changes

**Backdrop:** `bg-black/40` → `background: rgba(124,58,237,0.15)` + `backdrop-filter: blur(4px)`

**Sheet container:** `border-radius: 14px 14px 0 0` (larger), `border-top: 1px solid var(--rk-border-warm)`

**Drag handle:** Add at top center: `width: 32px; height: 4px; background: var(--rk-border-warm); border-radius: 99px; margin: 10px auto 0`

**Header:** Title `font-weight: 700`, `color: var(--rk-text-brand)`. Close button: 26×26 rounded square (`border-radius: 7px`), `background: var(--rk-surface-warm)`, `border: 1px solid var(--rk-border-warm)`, `color: var(--rk-brand)`.

**Section labels:** `color: var(--rk-brand)` (replaces `--rk-text-3`)

**Provider selector:** Replace `<select>` with pill button group:
- 3 pills (OpenAI / Groq / Gemini) in a flex row
- Active: `background: var(--rk-brand-gradient)`, `color: white`, `box-shadow: 0 2px 6px rgba(124,58,237,0.30)`
- Inactive: `background: var(--rk-surface-warm)`, `color: var(--rk-brand)`, `border: 1px solid var(--rk-border-warm)`
- All: `border-radius: 99px`, `padding: 5px 12px`, `font-size: 11px`, `font-weight: 600`

**Toggle:** Color when active: use `var(--rk-brand-gradient)` background instead of `--rk-blue`. File: `src/sidebar/components/atoms/Toggle.tsx`

**Site description text:** `color: var(--rk-brand)` at 10px (lighter purple, not grey)

**Sign out button:** Remove `bg-red-600`. Replace with:
- `display: flex; align-items: center; gap: 6px`
- `background: #fff1f2`, `color: #e11d48`, `border: 1px solid #fecdd3`, `border-radius: 99px`, `font-size: 11px`, `font-weight: 600`
- Add logout SVG icon (10×10)

---

## 5. OnboardingOverlay

**File:** `src/sidebar/components/overlays/OnboardingOverlay.tsx`

### Changes

**Backdrop:** `bg-black/50` → `background: rgba(124,58,237,0.20)` + `backdrop-filter: blur(6px)`

**Card:** `border-radius: 16px`, `border: 1px solid var(--rk-border-warm)`, `box-shadow: var(--rk-shadow-modal)`

**Step icon:** Replace emoji with SVG icon in gradient box:
- Container: 56×56, `border-radius: 16px`, `background: var(--rk-brand-gradient)`, `box-shadow: 0 4px 12px rgba(124,58,237,0.35)`, `margin: 0 auto 12px`
- Step 1 (Extract): document SVG
- Step 2 (Verify): checkmark circle SVG
- Step 3 (Organize): layers/stack SVG
- Icon: white stroke, 26×26

**Step label:** Replace "1 of 3" with `STEP 1 OF 3` — `font-size: 11px`, `font-weight: 700`, `color: var(--rk-brand)`, `text-transform: uppercase`, `letter-spacing: 0.06em`

**"Welcome" line:** Only render on `step === 0` as a subtitle (`font-size: 11px`, `color: var(--rk-text-3)`) below the icon, before the step title. Do not render on steps 1 and 2.

**Step title:** `font-size: 15px`, `font-weight: 700`, `color: var(--rk-text-brand)`

**Progress dots:**
- Active: `width: 20px`, `background: var(--rk-brand-gradient)`
- Inactive: `width: 6px`, `background: var(--rk-border-warm)`

**Buttons:**
- Next/Finish: `background: var(--rk-brand-gradient)`, `border-radius: 10px`, `font-weight: 600`, `box-shadow: 0 3px 10px rgba(124,58,237,0.35)`, text "Next →" / "Get Started →"
- Back: `border: 1px solid var(--rk-border-warm)`, `color: var(--rk-brand)`, `background: var(--rk-surface-warm)`

---

## 6. LoginGate

**File:** `src/sidebar/components/atoms/LoginGate.tsx`

### Changes

**Background:** Full-screen gradient: `background: linear-gradient(160deg, #ede9fe 0%, #dbeafe 100%)`

**Logo block (centered):**
- 48×48 gradient box (`border-radius: 14px`, `var(--rk-brand-gradient)`, `box-shadow: 0 4px 16px rgba(124,58,237,0.35)`) with checkmark SVG (24×24, white)
- App name: `font-size: 17px`, `font-weight: 800`, `color: var(--rk-text-brand)`, `letter-spacing: -0.3px`
- Tagline: `font-size: 11px`, `color: var(--rk-brand)` — "Verify research claims in seconds"

**Sign in button:**
- `background: white`, `color: var(--rk-text-brand)`, `border: 1px solid var(--rk-border-warm)`
- `border-radius: 10px`, `padding: 9px 20px`, `font-size: 12px`, `font-weight: 600`
- `box-shadow: 0 2px 8px rgba(124,58,237,0.10)`
- Contains Google logo SVG (14×14, multicolor) + text "Sign in with Google"
- Replace raw `bg-blue-600` with above

**Error text:** `color: var(--rk-red)` (replaces `text-red-600`)

---

## Implementation Order

1. `Toggle.tsx` — brand gradient active color (used by SettingsPanel, minimal change)
2. `Header.tsx` — logo mark + SVG settings icon + pill styles
3. `ProgressBar.tsx` — gradient fill + SVG icons + animated dot
4. `ProjectSelector.tsx` — custom pill dropdown (largest change in this batch)
5. `Footer.tsx` — border + demo button style
6. `SettingsPanel.tsx` — backdrop + drag handle + provider pills + sign out
7. `OnboardingOverlay.tsx` — SVG icons + gradient buttons
8. `LoginGate.tsx` — branded login screen

---

## Out of Scope

- Dropdown animation for ProjectSelector (CSS transition is fine, no framer-motion)
- ProgressBar per-site chips (keep as-is, only color tokens updated)
- Any changes to tab content components (covered in spec 1)
