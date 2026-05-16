# Handoff: ResearchKit Extension Sidebar

**Feature:** Browser extension side panel — full UI redesign  
**Fidelity:** High-fidelity  
**Date:** May 2026  
**Target codebase:** `research-kit/extension/src/sidebar/` (React + TypeScript + Vite + Tailwind)

---

## About the Design Files

The file `ResearchKit Extension.html` is a **high-fidelity interactive prototype** built in HTML/React. It is a design reference — not production code to copy directly. Your task is to **recreate these designs** inside the existing `extension/src/sidebar/` React+TypeScript codebase using its established patterns (Tailwind CSS, existing hooks, Chrome extension APIs).

The prototype uses inline styles for portability. In production, translate all inline style values to Tailwind utility classes or CSS modules as appropriate for the codebase.

---

## Design System (Tokens)

All colors, spacing, and typography used in the prototype. Translate to Tailwind config or CSS custom properties.

### Colors

| Token | Hex | Usage |
|---|---|---|
| `bg0` | `#060a14` | Page background, header/footer bars |
| `bg1` | `#0b1120` | Sidebar shell |
| `bg2` | `#101828` | Section backgrounds, sub-panels |
| `bg3` | `#162035` | Elevated cards, input backgrounds |
| `bg4` | `#1c2a42` | Hover states |
| `border` | `#1e2d47` | Default borders |
| `border2` | `#263654` | Active/selected borders |
| `text1` | `#e8edf5` | Primary text |
| `text2` | `#9baec8` | Secondary text |
| `text3` | `#5d7299` | Muted / labels / metadata |
| `amber` | `#f4a535` | Partial status, progress bar, accent |
| `amberDim` | `#7a4f10` | Partial border |
| `amberBg` | `#1a1005` | Partial card background |
| `green` | `#34d87a` | Verified status, success, done state |
| `greenDim` | `#1a5c38` | Verified border |
| `greenBg` | `#07130e` | Verified card background |
| `red` | `#f06c6c` | Not-found status, errors, conflicts |
| `redDim` | `#5c1e1e` | Not-found border |
| `redBg` | `#130707` | Not-found card background |
| `blue` | `#5b9cf6` | Primary action, links, Elicit site color |
| `blueDim` | `#1e3a6e` | Blue border |
| `blueBg` | `#060e1f` | Blue card background |
| `purple` | `#a78bfa` | Consensus site color, secondary accent |
| `purpleDim` | `#3d2a70` | Purple border |
| `purpleBg` | `#0e091f` | Purple card background |

### Typography

| Use | Font | Size | Weight |
|---|---|---|---|
| Body, labels | IBM Plex Sans | 11–13px | 400/500 |
| Headings (onboarding) | IBM Plex Sans | 14–16px | 600 |
| Badges, mono values | IBM Plex Mono | 9–10px | 400/600 |
| Section labels | IBM Plex Sans | 9–10px | 600, `letter-spacing: 0.08em`, uppercase |

### Border Radius

| Element | Radius |
|---|---|
| Cards, panels | 7px |
| Large panels (settings, onboarding) | 10px |
| Buttons | 4–5px |
| Badges (status) | 4px |
| Pill filters | 10px |
| Logo mark | 5px |
| Toggles | 8px |

### Spacing

Base unit: 4px. Common values: 4, 6, 8, 10, 12, 14, 16, 20px.

### Animations

| Name | Keyframe | Usage |
|---|---|---|
| `fadeSlideIn` | `opacity 0→1, translateY 6px→0` | Card appear, tab content, expanded sections |
| `slideInRight` | `translateX 100%→0` | Settings panel slide-in |
| `slideInDown` | `opacity 0→1, translateY -8px→0` | Action bars, prompts |
| `pulseDot` | `opacity 1→0.3→1` | Live indicator, streaming cursor |
| `badgePop` | `scale 0.6→1.15→1, opacity 0→1` | Status badge appear |
| `spinRing` | `rotate 360deg` | Loading spinner |
| `toastIn` | `opacity 0→1, translateY 12px→0, scale 0.95→1` | Toast notification |
| `conflictPulse` | `box-shadow 0→4px→0 red` | Unresolved conflict card |

---

## Screens & Views

### 1. Sidebar Shell

The outer container. In the extension this is the Chrome side panel (`chrome.sidePanel`).

- **Size:** 360–520px wide (user-configurable), full viewport height
- **Layout:** `flex-column`, 5 sections stacked: Header → ProgressBar → TabBar → TabContent → Footer
- **Background:** `bg1` (`#0b1120`)
- **Border:** `1px solid border` with `border-radius: 10px` (for the prototype preview; in extension = no border)
- **Shadow (prototype only):** `0 20px 60px rgba(0,0,0,0.7)`
- **Font:** IBM Plex Sans, system-ui

---

### 2. Header

**Height:** ~38px  
**Background:** `bg0`  
**Border-bottom:** `1px solid border`  
**Layout:** `flex row`, `align-items: center`, `gap: 8px`, `padding: 8px 12px`

**Elements (left → right):**

1. **Logo mark** — 22×22px, `border-radius: 5px`, `background: linear-gradient(135deg, #5b9cf6 0%, #a78bfa 100%)`, contains letter "R" in IBM Plex Mono 11px 700 white
2. **Brand name** — "ResearchKit", 12px, weight 600, `letter-spacing: 0.02em`, `text1`
3. **Site selector pills** — one per site (Elicit / SciSpace / Consensus). Each is a toggle button:
   - Active: `bg3` background, `1px solid {siteColor}55` border, site color text, opacity 1
   - Inactive: transparent background, `1px solid border`, `text3`, opacity 0.5
   - Font: 9px; `border-radius: 8px`; `padding: 1px 6px`
   - Prefix: colored `●` dot (opacity 0.4 when inactive)
   - Click: toggles site active/inactive globally
4. **Live indicator** — 6×6px circle (`border-radius: 3px`), animates `pulseDot 2s infinite` when ON+not-paused. Label 9px beside it.
5. **Toggle switch** — 30×16px, `border-radius: 8px`. ON: `greenDim` bg, green knob at `left: 14px`. OFF: `bg3` bg, `text3` knob at `left: 2px`. Knob is 10×10px, `border-radius: 5px`. Transition: `left 0.2s`.
6. **Settings gear ⚙** — 14px, `text3`, opens Settings panel on click.

---

### 3. Progress Bar

**Visible only when:** Auto-verify is ON  
**Background:** `bg2`  
**Border-bottom:** `1px solid border`  
**Padding:** `5px 12px`

**Row 1 (status + bar + controls):**
- Status label (10px, `text3`): `"Verifying N/M"` → `"Paused"` → `"✓ Done"` (green) when complete
- Thin bar: `flex:1`, height 3px, `bg3` track. Fill: `amber` (running), `text3` (paused), `green` (done). `transition: width 0.6s ease`
- Percentage (9px, IBM Plex Mono)
- Pause/resume link (9px, underline) — hidden when done

**Row 2 (per-site chips):**
- One chip per active site: `fontSize: 8px`, icon `▶` or `⏸`, site label
- Active: site color, `border: 1px solid {color}44`
- Paused: `text3`, opacity 0.5, `border: 1px solid border`
- `border-radius: 6px`, `padding: 2px 6px`

---

### 4. Tab Bar

**Background:** `bg0`  
**Border-bottom:** `1px solid border`  
**Layout:** `flex row`, each tab `flex: 1`

**6 tabs:** Verify (✓) · Inbox (↓) · Conflicts (⚡) · Chat (◉) · Draft (≡) · Help (?)

**Each tab button:**
- `padding: 6px 0`, `flex-column`, `align-items: center`, `gap: 1px`
- Icon: 11px; Label: 8px, weight 600 when active
- Active: `border-bottom: 2px solid {accent}`, color = accent
- Inactive: `2px solid transparent`, color = `text3`
- Conflicts tab uses `red` as accent color when active
- **Badge** (for Inbox count, Conflicts count): absolute, top-right, min-width 14px, height 14px, `border-radius: 7px`, 8px white text, weight 700

---

### 5. Footer

**Height:** ~24px  
**Background:** `bg0`  
**Border-top:** `1px solid border`  
**Padding:** `4px 12px`  
**Layout:** `flex row`, `justify-content: space-between`

- Left: 9px `text3` — shows `"{N}/{3} sites · {provider} · v0.2"` normally; `"✓ Verified {N} claims · {provider} · v0.2"` in green when done
- Right: "Settings" link — 9px `blue`, opens Settings panel

---

### 6. Verify Tab

**Layout:** `flex-column`, full height

**Sub-header (`bg2`, `border-bottom`):**
- Summary row: claim count left, status badge chips right (✓ N / ~ N / ✕ N)
- Status filter pills: `all` / `verified` / `partial` / `not found` — active pill gets `bg border2` background
- Site filter pills (shown when >1 site present): `all` + one per site in results. Active site pill uses that site's color with `{color}22` bg.

**Claim card:**
- Background tinted by status: `greenBg` / `amberBg` / `redBg`
- Border: status color dim (`greenDim` / `amberDim` / `redDim`)
- `border-radius: 7px`, `padding: 9px 10px`
- Row 1: StatusBadge (mini) + site label + expand arrow
- Row 2: Claim text — 11px, italic, `text1`
- Row 3: Paper title + page — 10px `text3`
- **Expanded state** (click to toggle):
  - ConfidenceBar: thin 3px bar colored by value (≥80% green, ≥50% amber, else red) + percentage in IBM Plex Mono
  - Verbatim quote block: `bg3`, `border-left: 2px solid {statusColor}`, IBM Plex Mono 10px
  - Warning text for partial/not_found
  - Action buttons: "+ Save to Inbox" (→ green when saved), "Upload PDF" (partial only)
- New cards animate in with `fadeSlideIn 0.35s`

---

### 7. Inbox Tab

**Sub-header (`bg2`):** Project selector `<select>` + "+ New" button  
**Action bar** (shown when items selected): slides in with `slideInDown`, blue bg, "N selected" + "Draft Review →" button  

**Inbox item card:**
- Background: `blueBg` when selected, `bg2` otherwise
- Border: `blueDim` when selected, `border` otherwise
- Layout: checkbox row → claim text (italic 11px) → paper title (10px `text3`) → quote block → "Export ↗" link
- **Checkbox:** 14×14px, `border-radius: 3px`. Checked: `blue` bg + white ✓. Unchecked: transparent + `border2`
- Multi-select: click items; "Draft Review →" CTA appears at top when ≥1 selected

---

### 8. Conflict Detector Tab

**Sub-header:** pulsing red dot + conflict count + explanatory text  

**Conflict card:**
- Unresolved: `border: 1px solid redDim`, `conflictPulse` animation
- Resolved: `border: 1px solid border`, no animation
- Header row: ⚡ CONFLICT badge (red) or ✓ RESOLVED badge (green) + timestamp + paper title + topic
- **Expanded (default open for first card):**
  - `display: grid; grid-template-columns: 1fr 1fr` — side by side
  - Each side: site color dot + site name chip + StatusBadge + claim text (italic) + ConfidenceBar + "Trust [site] →" button
  - Resolution banner: full-width green bg, "✓ Trusting {site}" + "Undo" link
  - DOI bar at bottom: `bg3`, `border-top`

---

### 9. Chat Tab

**Context badge strip:** `blueBg` bg, "CONTEXT · N verified claims · {project}"  

**Message thread:**
- User messages: right-aligned, `bg3` bubble, `border-radius: 8px 8px 2px 8px`
- Assistant messages: left-aligned, `bg2` bubble, `border-radius: 2px 8px 8px 8px`
- 11px text, `lineHeight: 1.7`, `whiteSpace: pre-line`
- **Streaming cursor:** inline 8×12px `blue` block with `pulseDot 0.7s infinite`
- **Thinking dots:** 3× 6px circles with staggered `pulseDot` delays (0s, 0.2s, 0.4s)

**Input area (`bg2`, `border-top`):**
- Full-width text input (`bg3` bg, `border`) + send button (`blue` bg, "↑")
- Send disabled/0.4 opacity when empty
- "Grounded in verified claims only" — 9px `text3` below

---

### 10. Draft Tab

**Claim selector panel (`bg2`, `border-bottom`):**
- "Select claims to include" label + count
- Each inbox item: 13×13px checkbox + paper title (10px `text2`)

**Controls bar:** Format pills (APA / MLA / Vancouver) + "Generate" button (blue, disabled when nothing selected or generating)

**Draft output area:**
- `bg3` card with 10px text, `lineHeight: 1.8`
- Streaming cursor while generating
- On complete: Copy (→ green when clicked) + Export RIS + Markdown buttons

---

### 11. Settings Panel

Full-height slide-over, `position: absolute; inset: 0`, `z-index: 200`, animates in with `slideInRight 0.22s`.

**Header:** ← back button + "Settings" title  

**Sections (with `1px solid border` dividers):**

1. **Active Sites** — explanatory text + 3 cards (one per site):
   - Layout: colored dot + site name/desc + Toggle switch
   - Card bg: `bg3` when active, `bg2` when not; border highlights accordingly
2. **AI Provider** — 3 radio-style cards: Claude (Anthropic) / GPT-4o (OpenAI) / Gemini 2.0 (Google)
   - Selected: `bg3` bg, `1px solid blueDim`, filled 12px circle
3. **Auto-verify** — "Run on page load" toggle card + "Verify delay" range slider (`0–10s`, accent `blue`)
4. **Data** — "Clear all sessions & inbox" danger button (`border: 1px solid redDim`, red text)

---

### 12. Onboarding Overlay

Full-height overlay, `position: absolute; inset: 0`, `z-index: 400`, `bg0` background.  
**Shown:** on first install. State persisted to `localStorage` key `rk_onboarding_done = '1'`.  
**Hidden:** after clicking final CTA or "Skip".

**Layout:**
- Top: Skip button (top-right, 10px `text3`)
- Step dots row: one per step. Active: width 20px, `blue`. Past: 8px wide, `greenDim`. Future: 8px, `border2`.
- Visual area: `bg2` card, `border-radius: 10px`, `padding: 16px 14px`, min-height 130px
- Text area: subtitle (9px blue uppercase) + title (16px weight 600 `text1`) + body (11px `text2`, lineHeight 1.7)
- Bottom bar: Back button + "N / total" counter + Next/CTA button

**5 steps:**

| Step | Title | Visual | CTA |
|---|---|---|---|
| 1 | Welcome to ResearchKit | Logo + 3 site chips | Get started → |
| 2 | Choose your tools | 3 site cards with toggle previews | Next → |
| 3 | How verification works | 3 status badge cards (✓/~/✕) | Next → |
| 4 | From claims to literature | Pipeline diagram: Verify → Inbox → Chat → Draft | Next → |
| 5 | You're all set! | Green check circle + 3 numbered tips | Start verifying → |

---

### 13. Help Tab

**Header:** "Help & Documentation" title + subtitle  
**Replay button:** full-width `bg3` card — ▷ icon + "Replay intro guide" + description + → arrow  
**Accordion:** 6 sections (Verify · Site Selector · Inbox · Conflicts · Chat · Draft)
- Section header: icon + title + ▼ chevron (rotates 180° when open)
- Items: `›` / `▼` bullet + question text; answer expands below with `fadeSlideIn`
- One section open at a time
**Version badge:** logo mark + "ResearchKit v0.2" + "Phase 1 MVP · Phase 2 coming soon"

---

## Floating Progress Indicator

A fixed pill in the bottom-right corner of the browser viewport (injected by content script, not the sidebar).

- `position: fixed; bottom: 24px; right: 24px`
- `background: bg2`, `border: 1px solid border`, `border-radius: 20px`, `padding: 5px 10px 5px 7px`
- Contains: spinning ring (18×18px amber, `spinRing 0.8s`), "Verifying N/M" text, 40px mini progress bar, percentage
- Clicking it should open the sidebar

---

## Interactions & Behavior

### Verify flow
1. Page loads → content script detects site → posts `VERIFY_START` message to background
2. Background calls verify API, posts `VERIFY_PROGRESS` with each result
3. Sidebar receives progress updates → appends claim cards with `fadeSlideIn`
4. When all done → progress bar turns green, label shows "✓ Done", pause button hidden

### Per-site pause
- `pausedSites: Set<SiteId>` in sidebar state
- When a site is in `pausedSites`: skip processing claims from that site, chip shows ⏸
- Global pause (`paused: boolean`) takes precedence — pauses all sites

### Claim save to Inbox
1. User expands claim card → clicks "+ Save to Inbox"
2. Button shows "✓ Saved" (green) for 2s then reverts (or stays if already in inbox)
3. Claim added to `inboxItems` state, claim marked `saved: true`
4. Toast "✓ Saved to Inbox" appears for 2.5s (bottom-center of sidebar)

### Conflict resolution
1. User clicks "Trust [site] →" on a conflict side
2. `conflict.resolution` set to that site's id
3. Side with trusted site gets `greenBg` background tint
4. Green banner appears at bottom of expanded card
5. "Undo" resets `resolution` to null

### Settings panel
- Opens with `slideInRight 0.22s` animation
- ← Back closes it
- Changes apply immediately (no "Save" button)

### Chat streaming
- On send: user message appended, `isThinking = true`, `streamText = ''`
- Simulate streaming with setInterval adding 3 chars every 22ms
- Streaming cursor: inline 8×12px blue block, `pulseDot 0.7s infinite`
- On complete: full message added to `messages`, `streamText` cleared

---

## State Management

### Sidebar-level state (in `App.tsx` / root sidebar component)

```typescript
// Verify
verifyOn: boolean               // global auto-verify toggle
paused: boolean                 // global pause
pausedSites: Set<SiteId>        // per-site pause
activeSites: Set<SiteId>        // which sites are enabled
claims: ClaimItem[]             // all verified claims on current page
progress: { total: number; completed: number }

// Inbox
inboxItems: InboxItem[]
project: string                 // current project name

// Conflicts
conflicts: ConflictItem[]       // cross-tool conflicts detected

// Settings
provider: 'anthropic' | 'openai' | 'gemini'
autoVerify: boolean
verifyDelay: number             // seconds

// UI
tab: TabId
settingsOpen: boolean
toast: string | null

// Onboarding
onboardingDone: boolean         // persisted to localStorage 'rk_onboarding_done'
```

### Types (from `shared/verify-types.ts` — extend these)

```typescript
export type VerifyStatus = 'verified' | 'partial' | 'not_found' | 'pending' | 'error'
export type SiteId = 'elicit' | 'scispace' | 'consensus'

export interface ClaimItem {
  id: string
  text: string          // the claim sentence (quoted)
  paperTitle: string | null
  doi: string | null
  page: string          // e.g. "p.142" or "abstract only"
  site: SiteId
  status: VerifyStatus
  confidence: number    // 0–1
  quote: string | null  // verbatim quote from paper
  saved: boolean        // whether saved to inbox
}

export interface InboxItem {
  id: string
  text: string
  paperTitle: string
  quote: string | null
  project: string
  savedAt: string
  status: VerifyStatus
  confidence: number
}

export interface ConflictItem {
  id: string
  paper: string
  doi: string | null
  topic: string
  flaggedAt: string
  sides: ConflictSide[]
  resolution: SiteId | null
}

export interface ConflictSide {
  site: SiteId
  claim: string
  confidence: number
  status: VerifyStatus
}
```

---

## File Mapping (design → codebase)

| Design component | Implement in |
|---|---|
| Sidebar shell + state | `src/sidebar/App.tsx` (replace current) |
| Header + site pills | `src/sidebar/Header.tsx` (new) |
| Progress bar | `src/sidebar/ProgressBar.tsx` (new) |
| Tab bar | `src/sidebar/TabBar.tsx` (new) |
| Verify tab | `src/sidebar/VerifyTab.tsx` (new) |
| ClaimCard | `src/sidebar/ClaimCard.tsx` (new) |
| StatusBadge | `src/sidebar/StatusBadge.tsx` (new) |
| ConfidenceBar | `src/sidebar/ConfidenceBar.tsx` (new) |
| Inbox tab | `src/sidebar/InboxTab.tsx` (new) |
| Conflict Detector | `src/sidebar/ConflictTab.tsx` (new) |
| Chat tab | `src/sidebar/ChatThread.tsx` (update existing) |
| Draft tab | `src/sidebar/DraftTab.tsx` (new) |
| Settings panel | `src/sidebar/SettingsPanel.tsx` (new) |
| Onboarding overlay | `src/sidebar/OnboardingOverlay.tsx` (new) |
| Help tab | `src/sidebar/HelpTab.tsx` (new) |
| Toggle switch | `src/sidebar/ui/Toggle.tsx` (new, shared) |
| Checkbox | `src/sidebar/ui/Checkbox.tsx` (new, shared) |
| Toast | `src/sidebar/ui/Toast.tsx` (new, shared) |
| Shared types | `src/shared/verify-types.ts` (extend existing) |

---

## Assets

- **Font:** IBM Plex Sans + IBM Plex Mono — load from Google Fonts or bundle locally
  - Weights needed: Sans 300/400/500/600 · Mono 400/500
- **Icons:** Text-based (✓, ~, ✕, ▶, ⏸, ⚡, etc.) — no icon library needed
- **Logo mark:** CSS gradient div with letter "R" — no image asset needed

---

## Implementation Notes

1. **Tailwind classes:** The existing codebase uses Tailwind. The prototype uses inline styles for portability — all values are exact and should be translated to Tailwind utilities or a `theme.extend` config.

2. **Chrome side panel:** The sidebar runs as `chrome.sidePanel` — full viewport height, fixed width. Remove the `border-radius` and `box-shadow` from the shell in production (those are prototype-only).

3. **Message passing:** The existing `src/shared/messages.ts` handles background ↔ sidebar communication. Extend with new message types for `VERIFY_PROGRESS`, `SITE_PAUSE`, `CONFLICT_DETECTED`.

4. **localStorage for onboarding:** Key `rk_onboarding_done = '1'`. Extension context can use `chrome.storage.local` instead for better isolation.

5. **Per-site progress:** The progress bar shows per-site chips. The total claim count should be broken down per site when reporting from the background worker.

6. **Streaming in Chat:** The prototype simulates streaming. In production, connect to the existing `useOpenClawAgent` hook which already supports streaming via the agent WebSocket.

7. **Conflict detection:** Currently mocked. The conflict detector should compare claims by `doi` + `site` — if two sites reference the same DOI with semantically different claims, flag a conflict. Consider running this in the background worker.
