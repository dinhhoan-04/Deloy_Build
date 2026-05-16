# Component Specifications

All measurements in pixels unless stated. Translate inline styles to Tailwind or CSS modules.

---

## StatusBadge

Two variants: `mini` (inline, card header) and `full` (expanded view).

```tsx
interface StatusBadgeProps {
  status: 'verified' | 'partial' | 'not_found' | 'pending' | 'error'
  mini?: boolean
}
```

| Status | Icon | Color | Background | Border |
|---|---|---|---|---|
| verified | ✓ | `#34d87a` | `#07130e` | `#1a5c38` |
| partial | ~ | `#f4a535` | `#1a1005` | `#7a4f10` |
| not_found | ✕ | `#f06c6c` | `#130707` | `#5c1e1e` |
| pending | … | `#5d7299` | `#101828` | `#1e2d47` |
| error | ! | `#f06c6c` | `#130707` | `#5c1e1e` |

**Mini:** `padding: 1px 5px`, `border-radius: 4px`, `font-size: 10px`, `font-weight: 600`, IBM Plex Mono, letter-spacing 0.03em. Animate with `badgePop 0.3s ease` on mount.

**Full:** `padding: 2px 7px`, same font. No animation.

---

## ConfidenceBar

```tsx
interface ConfidenceBarProps {
  value: number  // 0–1
}
```

- Container: `flex row`, `gap: 6px`, `align-items: center`
- Track: `flex: 1`, height 3px, `bg3` background, `border-radius: 2px`, `overflow: hidden`
- Fill: width = `${value * 100}%`. Color: ≥0.8 → `green`, ≥0.5 → `amber`, <0.5 → `red`. `transition: width 0.4s ease`
- Label: `${Math.round(value * 100)}%`, 10px IBM Plex Mono, `text3`, `min-width: 28px`

---

## Toggle

```tsx
interface ToggleProps {
  value: boolean
  onChange: (v: boolean) => void
}
```

- Track: 30×16px, `border-radius: 8px`
- ON: background `#1a5c38`, border `#1a5c38`
- OFF: background `#162035`, border `#1e2d47`
- Knob: 10×10px, `border-radius: 5px`, `position: absolute`, `top: 2px`
- ON: `left: 14px`, color `#34d87a`
- OFF: `left: 2px`, color `#5d7299`
- `transition: left 0.2s, background 0.2s`

---

## Checkbox

```tsx
interface CheckboxProps {
  checked: boolean
  onChange: () => void
  size?: number  // default 14
}
```

- Container: `{size}×{size}px`, `border-radius: 3px`
- Unchecked: transparent bg, `border: 1px solid #263654`
- Checked: `#5b9cf6` bg, `border: 1px solid #5b9cf6`, white ✓ at `font-size: size * 0.65`
- `transition: all 0.15s`

---

## ClaimCard

```tsx
interface ClaimCardProps {
  claim: ClaimItem
  onSave: (id: string) => void
  isNew?: boolean  // triggers fadeSlideIn animation
}
```

**States:** collapsed (default) / expanded (click to toggle)

**Collapsed:**
```
┌─────────────────────────────────────────┐  ← bg by status, border by status
│ [StatusBadge mini]           [site] [▼] │  ← row 1
│ "Claim text in italic, 11px text1"      │  ← row 2, line-height 1.5
│ Paper Title · p.XX                      │  ← row 3, 10px text3
└─────────────────────────────────────────┘
```

**Expanded (adds below row 3):**
```
│ [ConfidenceBar]                         │
│ ┌──────────────────────────────────┐    │  ← quote block (if quote exists)
│ │ VERBATIM QUOTE                   │    │  ← 9px text3 label
│ │ "actual quote text in mono"      │    │  ← 10px IBM Plex Mono text2
│ └──────────────────────────────────┘    │  ← bg3, border-left 2px statusColor
│ ⚠ Warning text (partial/not_found)     │
│ [+ Save to Inbox]  [Upload PDF]         │  ← action buttons
```

**Save button states:**
- Default: `bg3` bg, `border` border, `text2` color
- Just saved: `greenDim` bg+border, `green` color, "✓ Saved" — revert after 2s
- Already in inbox: shows "✓ In Inbox" text (no button)

---

## Toast

```tsx
interface ToastProps {
  message: string
  onDone: () => void  // called after 2500ms
}
```

- `position: absolute; bottom: 50px; left: 50%; transform: translateX(-50%)`
- `background: bg3`, `border: 1px solid greenDim`, `border-radius: 6px`
- `padding: 6px 14px`, `font-size: 10px`, `color: green`, `font-weight: 600`
- `white-space: nowrap`, `z-index: 300`
- Animate in with `toastIn 0.25s ease`
- Auto-dismiss after 2500ms via `setTimeout`

---

## OnboardingOverlay

**Step dot row:**
- Active: `width: 20px`, `background: blue`
- Past: `width: 8px`, `background: greenDim`
- Future: `width: 8px`, `background: border2`
- All: `height: 3px`, `border-radius: 2px`, `cursor: pointer`
- `transition: width 0.25s, background 0.25s`

**Bottom nav bar:**
- Back button: visible but `opacity: 0.3` + `cursor: not-allowed` on step 0
- Counter: `"{step+1} / {total}"`, 9px `text3`
- CTA button: steps 1–4 = `blue` bg, white text. Step 5 = `green` bg, `bg0` text.

**Visual area:** each step has a custom visual component (see README.md Step 1–5 descriptions).

---

## SettingsPanel (slide-over)

Mount with `position: absolute; inset: 0; z-index: 200`. Render only when `open === true`.

Entry animation: `slideInRight 0.22s ease`.

**Range slider (Verify delay):**
- Native `<input type="range">`, `accent-color: #5b9cf6`
- Min 0, Max 10, Step 0.5
- Labels: "Instant" (left) / "10s" (right), 9px `text3`
- Live value label: `blue`, IBM Plex Mono, 10px — updates on change

**Provider radio cards:** selecting one sets `provider` state and updates card border to `blueDim`, bg to `bg3`.

---

## HelpTab Accordion

**Section open/close:**
- One section open at a time (clicking open section closes it)
- Chevron `▼` rotates 180° when section is open via `transition: transform 0.2s`

**Q&A items:**
- `›` bullet → `▼` when open
- Answer text: 10px `text3`, `line-height: 1.65`
- Animate in with `fadeSlideIn 0.15s ease`
- Items within a section separated by `1px solid border`
