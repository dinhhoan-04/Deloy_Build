# ResearchKit Phase 2 Foundation — Design Spec

**Date:** 2026-05-07
**Status:** Draft — pending implementation plan
**Scope:** Browser extension sidebar UX rebuild + Inbox + Project Sessions
**Predecessor:** `2026-05-07-researchkit-pipeline-design.md` (Phase 1 MVP)
**Successor (planned):** Phase 2.5 specs for Conflicts UI, Context-aware Chat, Draft generation, GoClaw backend migration

---

## 1. Goal & Scope

### 1.1 Goal

Build the complete UX shell of ResearchKit Phase 2 — a redesigned sidebar matching the high-fidelity prototype in `research-kit/design_handoff_researchkit/` — plus one new end-to-end value flow: **Verify → Save to Inbox**, organized per **Project Session**.

This is the foundation other Phase 2 features (Conflict Detector UI, context-aware Chat, Literature Drafter) will build on.

### 1.2 In Scope

1. **Sidebar shell** — Header with site pills + Live indicator + Verify toggle, 2-row Progress Bar with per-site chips, 6-tab navigation with badge counts, Footer.
2. **Verify tab** — full redesign reading from Phase 1 background queue via extended message protocol; status filters + site filters; expandable claim cards with confidence bar, verbatim quote, "Save to Inbox".
3. **Inbox tab** — paper-grouped UI, project switcher, multi-select with "Draft Review →" CTA (placeholder destination).
4. **Project Sessions** — `{ id, name }` model. Create / rename / delete (with cascade warning) / switch.
5. **Settings panel** (full) — Active Sites toggle (run-control), AI Provider radio (UI only, field passthrough), Auto-verify toggle + delay slider, Data clear danger button.
6. **Onboarding overlay** — 5 steps, replay-able from Help.
7. **Help tab** — accordion with 6 sections + replay intro button + version badge.
8. **Floating progress indicator** — fixed pill injected by content script (Shadow DOM), click opens sidebar.
9. **Toast system** + animations (`fadeSlideIn`, `slideInRight`, `slideInDown`, `pulseDot`, `badgePop`, `toastIn`, `spinRing`, `conflictPulse`).
10. **Conflicts / Chat / Draft tabs** — empty-state placeholders. Chat tab wraps existing `useOpenClawAgent` legacy chat with banner "Legacy v1 — context-aware coming in Phase 2.5".
11. **Background extensions** — per-site pause, conflict detection store-only, provider field passthrough, ClaimItem shape merge.

### 1.3 Out of Scope (Defer to later specs)

- **GoClaw backend migration** — separate spec after Foundation. Foundation backend remains Anthropic-direct.
- Conflicts tab UI content (resolution flow, side-by-side comparison) — Phase 2.5.
- Context-aware Chat — Phase 2.5.
- Draft generation `/draft` endpoint and UI logic — Phase 2.5.
- Stance/polarity analysis for paraphrase clustering — Phase 2.5.
- Cloud sync, multi-user, authentication — Phase 3.
- Cross-browser support, a11y audit, localization, storage quota stress.

### 1.4 Principles (preserved from Phase 1)

- **Suggest, don't force** — every automated behavior is user-controllable.
- **Verify is non-blocking** — background queue, never blocks browsing.
- **Every badge has explanation** — no DOI / abstract-only / not_found must surface reason.
- **`not_found` is honest** — never fabricate quotes.
- **Draft uses only verified data** (deferred to Phase 2.5 implementation).

---

## 2. Architecture & File Structure

### 2.1 Layer boundaries

```
[Browser Extension]
  ├─ content.ts          — DOM hybrid extract, badge inject, NEW: floating progress pill, activeSites gating
  ├─ background_minimal  — Verify queue, message router, NEW: per-site pause, conflict store, ClaimItem merge
  └─ sidebar/ (React)    — NEW: full UI rebuild (replaces current chat-only shell)
        ↓ (HTTP)
[FastAPI]                — /verify, /extract, /openalex (unchanged in Foundation; provider field added)
```

Foundation does **not** modify FastAPI verify/extract logic, the OpenAlex client, or the hybrid adapter algorithm.

### 2.2 New / changed files

#### Sidebar

```
src/sidebar/
├─ App.tsx                          REPLACE
├─ index.css                        UPDATE   — design tokens, animations
├─ index.html                       UPDATE   — IBM Plex font preconnect
├─ main.tsx                         UNCHANGED
│
├─ shell/
│  ├─ Header.tsx                    NEW
│  ├─ ProgressBar.tsx               NEW
│  ├─ TabBar.tsx                    NEW
│  └─ Footer.tsx                    NEW
│
├─ tabs/
│  ├─ VerifyTab.tsx                 NEW
│  ├─ InboxTab.tsx                  NEW
│  ├─ ConflictsTab.tsx              NEW   (placeholder)
│  ├─ ChatTab.tsx                   NEW   (wraps existing ChatThread + legacy banner)
│  ├─ DraftTab.tsx                  NEW   (placeholder)
│  └─ HelpTab.tsx                   NEW
│
├─ overlays/
│  ├─ SettingsPanel.tsx             NEW
│  └─ OnboardingOverlay.tsx         NEW
│
├─ components/
│  ├─ ClaimCard.tsx                 NEW
│  ├─ PaperGroup.tsx                NEW
│  ├─ StatusBadge.tsx               NEW
│  ├─ ConfidenceBar.tsx             NEW
│  ├─ Toggle.tsx                    NEW
│  ├─ Checkbox.tsx                  NEW
│  ├─ Toast.tsx                     NEW
│  └─ ProjectSelector.tsx           NEW
│
├─ state/
│  ├─ useStore.ts                   NEW   — Zustand root store, 3 slices
│  ├─ storage.ts                    NEW   — chrome.storage.local helpers
│  └─ migration.ts                  NEW   — schema bootstrap
│
├─ hooks/
│  ├─ useBackgroundMessages.ts      NEW
│  ├─ useChromeStorage.ts           NEW
│  └─ useOpenClawAgent.ts           UNCHANGED   (used by ChatTab legacy)
│
├─ ChatThread.tsx                   UNCHANGED   (used by ChatTab)
├─ ToolCallCard.tsx                 UNCHANGED
├─ ActiveContextStrip.tsx           UNCHANGED
└─ usePageModels.ts                 UNCHANGED
```

#### Content scripts

```
src/content/
├─ badge.ts                         UNCHANGED
└─ floating-progress.ts             NEW   — fixed pill with Shadow DOM
```

#### Shared / background

```
src/shared/
├─ verify-types.ts                  REPLACE   — merged ClaimItem, new types
└─ messages.ts                      EXTEND    — new message constants

src/background_minimal.ts           EXTEND    — per-site pause, conflict store, migration trigger
src/content.ts                      EXTEND    — activeSites gating, mount floating pill
```

**Total: 27 new files, 6 updated files.**

### 2.3 Why this layout

- `shell/` = always rendered chrome (Header / ProgressBar / TabBar / Footer).
- `tabs/` = mounted only when active (one tab content per file).
- `overlays/` = absolutely positioned (Settings panel, Onboarding).
- `components/` = atomic UI reused across tabs.
- `state/` = single source of truth + chrome.storage helpers + migration.
- `hooks/` = side-effect hooks (subscribe to chrome APIs).

Each file targets <200 lines; testable in isolation.

---

## 3. Data Model & State

### 3.1 Persistent storage schema (`chrome.storage.local`)

```typescript
interface StorageSchema {
  schemaVersion: 2

  // Projects
  projects: Project[]
  currentProjectId: string

  // Inbox + conflicts (cross-project storage)
  inboxItems: InboxItem[]
  conflicts: ConflictItem[]

  // Site control (run-control semantics — D1)
  activeSites: SiteId[]
  pausedSites: SiteId[]
  globalPaused: boolean

  // Settings
  provider: 'anthropic' | 'openai' | 'gemini'
  autoVerify: boolean
  verifyDelay: number

  // Onboarding
  onboardingDone: boolean

  // Phase 1 carry-over
  verifyEnabled: boolean
}
```

### 3.2 Type definitions (`src/shared/verify-types.ts`)

```typescript
export type SiteId = 'elicit' | 'scispace' | 'consensus'
export type VerifyStatus = 'verified' | 'partial' | 'not_found' | 'pending' | 'error'
export type Provider = 'anthropic' | 'openai' | 'gemini'

export interface Project {
  id: string                         // 'p_<random8>' or 'p_default'
  name: string
}

// Merged ClaimItem (replaces Phase 1 split between ClaimItem and VerifyResult)
export interface ClaimItem {
  id: string
  text: string                       // renamed from `claim`
  paperTitle: string | null
  doi: string | null
  paperUrl: string | null
  page: string                       // "p.142" | "abstract only" | "full-text checked" | "DOI unknown"
  site: SiteId                       // typed; replaces sourceToolSite
  status: VerifyStatus
  confidence: number                 // 0..1
  quote: string | null
  reason: string                     // human-readable explanation
  saved: boolean                     // true if saved to inbox in current project
  domAnchor: string
  tabId: number
  pageUrl: string
  extractedAt: number
}

export interface InboxItem {
  id: string                         // 'inb_<random8>'
  claimId: string
  text: string
  paperTitle: string | null
  doi: string | null
  paperUrl: string | null
  page: string
  site: SiteId
  status: VerifyStatus
  confidence: number
  quote: string | null
  reason: string
  projectId: string
  savedAtMs: number
}

export interface ConflictItem {
  id: string                         // 'cf_<random8>'
  doi: string | null
  groupKey: string                   // doi || normalizedTitle
  paperTitle: string
  flaggedAtMs: number
  sides: ConflictSide[]
  resolution: SiteId | null
  projectId: string
}

export interface ConflictSide {
  site: SiteId
  claimId: string
  text: string
  confidence: number
  status: VerifyStatus
}

export interface VerifyProgress {
  tabId: number
  total: number
  completed: number
  running: number
  paused: boolean
  pausedSites: SiteId[]
  perSite: Record<SiteId, { total: number; completed: number; running: number }>
}
```

### 3.3 Sidebar runtime state (Zustand, single store with slices)

```typescript
interface UIState {
  tab: TabId
  settingsOpen: boolean
  toast: { id: string; message: string; tone: 'success' | 'warning' | 'error' } | null
  expandedClaimIds: Set<string>
  inboxSelectedIds: Set<string>
  inboxExpandedGroups: Set<string>
}

interface DataState {
  // Synced from chrome.storage
  projects: Project[]
  currentProjectId: string
  inboxItems: InboxItem[]
  conflicts: ConflictItem[]
  activeSites: Set<SiteId>
  pausedSites: Set<SiteId>
  globalPaused: boolean
  provider: Provider
  autoVerify: boolean
  verifyDelay: number
  onboardingDone: boolean
  verifyEnabled: boolean

  // In-memory (from background messages)
  currentTabId: number | null
  currentTabUrl: string | null
  claimsByTab: Map<number, ClaimItem[]>
  progressByTab: Map<number, VerifyProgress>
}

interface Actions {
  // UI
  setTab(t: TabId): void
  openSettings(): void
  closeSettings(): void
  showToast(message: string, tone?: Tone): void
  toggleClaimExpand(claimId: string): void
  toggleInboxSelect(itemId: string): void
  toggleGroupExpand(groupKey: string): void

  // Data — write to chrome.storage + dispatch to background
  setActiveSite(site: SiteId, active: boolean): Promise<void>
  setPausedSite(site: SiteId, paused: boolean): Promise<void>
  setGlobalPaused(paused: boolean): Promise<void>
  setVerifyEnabled(enabled: boolean): Promise<void>
  setProvider(p: Provider): Promise<void>
  setAutoVerify(v: boolean): Promise<void>
  setVerifyDelay(s: number): Promise<void>
  setOnboardingDone(d: boolean): Promise<void>

  createProject(name: string): Promise<Project>
  renameProject(id: string, name: string): Promise<void>
  deleteProject(id: string): Promise<void>
  switchProject(id: string): Promise<void>

  saveToInbox(claim: ClaimItem): Promise<{ added: boolean; reason?: string }>
  removeFromInbox(itemId: string): Promise<void>
  clearAllData(): Promise<void>
}
```

### 3.4 Storage ↔ State sync

- Single source of truth = `chrome.storage.local`.
- On sidebar mount: read all keys → seed Zustand DataState.
- Action call: write chrome.storage → `chrome.storage.onChanged` listener → Zustand updates → re-render.
- Background also writes (e.g., conflict detected → append `conflicts`).
- Cross-window sync via `chrome.storage.onChanged`.
- Race policy: **last-write-wins**. Foundation does not implement CRDT or locking.

### 3.5 Inbox grouping (computed selector)

```typescript
function groupInboxByPaper(items: InboxItem[]): PaperGroup[]
```

Group key (priority): `doi` → `normalize(paperTitle)` → `untitled_${item.id}` (each ungrouped).
Output: `{ groupKey, paperTitle, doi, claims, hasUnknownDoi, hasAbstractOnly }`.
Sort: groups by most recent `savedAtMs` DESC; claims within group DESC.

### 3.6 Per-tab verify state

`claimsByTab` and `progressByTab` are in-memory only (background + sidebar Zustand). On `chrome.tabs.onRemoved` the entry is purged.

Verify results do **not** persist across browser restart. Inbox does. Re-visiting a page re-extracts; backend DOI cache will hit.

### 3.7 Inbox dedup (G hybrid)

**Storage tier — exact match unique key:**
`(projectId, doi || normalize(paperTitle), exact_text)` is unique. Saving the same exact text twice → no-op + toast "Already in this project's inbox".
Different text under same DOI → 2 separate items (could be paraphrase OR conflict; preserved).

**UI tier — paper grouping:**
Inbox renders one `PaperGroup` per (DOI || normalized title). Multiple claims appear as children inside the expandable group. Visually compact even when storage holds many claims.

**Phase 2.5 tier (deferred):**
Stance/polarity analysis groups paraphrase clusters vs opposing claims. Foundation never auto-merges based on text similarity (avoids polarity-flip mistakes).

### 3.8 Surfacing uncertainty

- **No DOI** → `status: 'not_found'` (or `'partial'` if a title was matched but no DOI), `page: "DOI unknown"`, `reason: "OpenAlex couldn't match this paper"`. Inbox group header shows `⚠ DOI unknown` chip.
- **Abstract only** → `status: 'partial'`, `page: "abstract only"`, `reason: "Full text behind paywall"`. Group header shows `⚠ N abstract only`.
- Users may still save these to Inbox (with a confirm dialog for `not_found + no DOI`).

---

## 4. UI Components & Behaviors

Visual specs (colors, sizes, animations) follow `research-kit/design_handoff_researchkit/README.md` and `COMPONENTS.md` verbatim. This section specifies behaviors only.

### 4.1 Header

- **Site pills** click → toggle `activeSites` (run-control). Toast on change.
- **Live indicator** pulses only when `verifyEnabled && !globalPaused` and at least one active site exists.
- **Verify toggle** OFF → clear queue + clear in-flight tracking. ON → resume.
- **Settings gear** opens `SettingsPanel` (z-index 200, slide-over).

### 4.2 ProgressBar

- Hidden when `progress.total === 0` or `!verifyEnabled`.
- Status label: "Verifying N/M" → "Paused" → "✓ Done" (auto-hide after 3s).
- Pause link toggles `globalPaused`.
- Per-site chips render only for sites with claims this page; click toggles `pausedSites` for that site.

### 4.3 TabBar

- 6 tabs; Conflicts uses red accent.
- Badge counts (current project only):
  - Inbox: count of `inboxItems` filtered by `currentProjectId`.
  - Conflicts: unresolved count.
- Hide badge when 0.
- Tab resets to `verify` on sidebar reload.

### 4.4 VerifyTab

- Data: `claimsByTab.get(currentTabId)`.
- Sub-header: status filter pills (`all | verified | partial | not_found`) + site filter pills (only when >1 site present).
- Empty states:
  - Detecting: "Detecting claims on this page..."
  - Site disabled: "Elicit is disabled in Settings." + button → open Settings.
  - Not on supported site: prompt to open one.
- ClaimCard interactions:
  - Click body → toggle expanded.
  - "+ Save to Inbox" → state machine: default → "✓ Saved" (2s) → "✓ In Inbox".
  - On `not_found && !doi` save attempt: confirm dialog "Save unverified claim?".
  - "Upload PDF" (partial only): disabled with tooltip "Coming in Phase 2.5".

### 4.5 InboxTab

- **Project switcher**: `<select>` + "+ New project" + "Manage projects" link (mini-modal for rename/delete).
- **Delete project**: typed-confirm "delete" required when items exist; cascade-deletes those items.
- **Action bar**: appears when ≥1 selected; "Draft Review →" navigates to DraftTab with selected IDs.
- **PaperGroup**: header shows title + DOI / "DOI unknown" + claim count + warning chips. First group expanded by default. Sort DESC by recent.
- **Empty state**: prompt to save claims from Verify tab.

### 4.6 ConflictsTab (placeholder)

- Sub-header: status indicator (red pulsing if unresolved, green if none).
- Body: "Conflict detection runs in the background. UI for review and resolution coming in Phase 2.5." + count.

### 4.7 ChatTab (legacy)

- Top banner: amber bg, "Legacy chat — context-aware version coming in Phase 2.5."
- Below: existing `<ChatThread>` from `useOpenClawAgent`. Behavior unchanged.

### 4.8 DraftTab (placeholder)

- Empty state. If navigated from Inbox with selection: show "{N} claims selected" + disabled controls + "Draft generation coming in Phase 2.5".

### 4.9 HelpTab

- "Replay intro guide" button → set `onboardingDone = false` → onboarding re-renders.
- Accordion: 6 sections (Verify / Site Selector / Inbox / Conflicts / Chat / Draft). Static Q&A content. One open at a time.
- Version badge: "ResearchKit v0.2 · Phase 1 MVP + Phase 2 Foundation".

### 4.10 SettingsPanel

- Slide-over `slideInRight 0.22s`. ← Back closes (no Save button — apply immediately).
- Sections:
  1. Active Sites — 3 toggle cards (run-control).
  2. AI Provider — radio Claude/GPT-4o/Gemini. Banner: "Provider switching activates with GoClaw integration in Phase 2.5."
  3. Auto-verify — toggle + delay slider (0–10s, step 0.5).
  4. Data — typed-confirm danger button "Clear all sessions & inbox".

### 4.11 OnboardingOverlay

- Mounted when `!onboardingDone`. Z-index 400.
- 5 steps verbatim from `design_handoff_researchkit/README.md` (Welcome / Choose tools / How verify works / Pipeline / All set).
- Step 2 toggles are visual only, do not write `activeSites`.
- Final CTA / Skip → `onboardingDone = true`.

### 4.12 Floating Progress Indicator

- Injected by `content.ts` via `floating-progress.ts`.
- Shadow DOM (avoid CSS leakage).
- Visible when `progress.total > 0 && !globalPaused && verifyEnabled`.
- `position: fixed; bottom: 24px; right: 24px; z-index: 2147483647`.
- Click → `MSG_OPEN_SIDEBAR` → background opens side panel.
- Auto-hide 3s after done.

### 4.13 Toast

- Single toast at App level. New toast replaces. Auto-dismiss 2500ms.

### 4.14 Animations

`fadeSlideIn` · `slideInRight` · `slideInDown` · `pulseDot` · `badgePop` · `toastIn` · `spinRing` · `conflictPulse` (defined in Foundation, used by Phase 2.5 Conflicts UI).

---

## 5. Background & Storage Changes

### 5.1 Message protocol (`src/shared/messages.ts`)

```typescript
// Sidebar ← Background
MSG_CLAIM_RESULT          // ClaimItem (merged shape)
MSG_CONFLICT_DETECTED     // ConflictItem
MSG_VERIFY_DONE           // { tabId, total }
MSG_TAB_CHANGED           // { tabId }
MSG_VERIFY_PROGRESS       // VerifyProgress (extended with perSite)

// Sidebar → Background
MSG_SET_SITE_ACTIVE       // { site, active }
MSG_SET_SITE_PAUSED       // { site, paused }
MSG_SET_GLOBAL_PAUSED     // { paused }
MSG_SET_PROVIDER          // { provider }
MSG_OPEN_SIDEBAR          // (no payload)
MSG_REQUEST_RE_EXTRACT    // (no payload)

// Content ← Background
MSG_ACTIVE_SITES_CHANGED  // { activeSites }
```

Phase 1 `MSG_VERIFY_RESULT` retained for backward compat with existing `badge.ts`. Background dispatches both legacy and new shapes during verify.

### 5.2 Background extensions

- **Per-site pause in `pump()`**: select next claim where `!pausedSites.has(c.site)`. In-flight items continue; pause skips future work.
- **Per-site progress aggregation**: extend `VerifyProgress.perSite[site]` totals on enqueue/complete.
- **ClaimItem merge** in `verifyOne()` resolution: combine extracted ClaimItem with verify result + `deriveReason()` + `derivePage()` helpers (deterministic, unit-tested).
- **Conflict detection (store-only)**: on `MSG_CLAIM_RESULT` with verified status + DOI, scan inbox for same-DOI peers from different sites; flag if `|Δconfidence| > 0.25`. Store to `conflicts`. Foundation does not render in Conflicts tab. Algorithm interface is pluggable (`type ConflictDetector`) so Phase 2.5 can swap to stance analysis.
- **Tab tracking**: `chrome.tabs.onActivated` → `MSG_TAB_CHANGED`. `chrome.tabs.onRemoved` → purge in-memory entries.
- **Settings sync to content scripts**: when `activeSites` changes, broadcast `MSG_ACTIVE_SITES_CHANGED` to all tabs.

### 5.3 Content script extensions

- `shouldExtract()` reads `activeSites` before running hybrid adapter. Inactive site → no extraction.
- Listens for `MSG_ACTIVE_SITES_CHANGED`. Site newly enabled → run extraction. Site newly disabled → call `clearAllBadges()`.
- Mounts floating progress pill when first claim enqueued; unmounts after done auto-hide.

### 5.4 Floating progress pill (`floating-progress.ts`)

- Closed Shadow DOM root attached to a host `<div id="rk-floating-progress">`.
- Subscribes to `MSG_VERIFY_PROGRESS`; updates label + percentage.
- Click handler: `chrome.runtime.sendMessage({ type: MSG_OPEN_SIDEBAR })`.
- Auto-fade out 3s after `MSG_VERIFY_DONE`.

### 5.5 Storage helpers (`src/sidebar/state/storage.ts`)

```typescript
readStorage<K>(key: K): Promise<StorageSchema[K]>
writeStorage<K>(key: K, value: StorageSchema[K]): Promise<void>
appendStorage<K>(key: K, item: any): Promise<void>          // read-modify-write
subscribeStorage(cb: (changes) => void): () => void
```

Used by both background and sidebar. Single helper module reduces schema drift risk.

### 5.6 Backend (FastAPI) — minimal change

Add optional `provider: Literal['anthropic', 'openai', 'gemini'] = 'anthropic'` to `VerifyRequest` and `ExtractRequest` Pydantic models. Log it. Do not route on it (Anthropic SDK direct unchanged).

When GoClaw migration ships, provider routing replaces the direct call without breaking the contract.

---

## 6. Migration & Defaults

### 6.1 Schema versioning

`schemaVersion` key in chrome.storage.local: `2` for Foundation. Foundation handles `undefined → 2` (fresh install) and `1 → 2` (Phase 1 upgrade) with the same code path. No downgrade support.

> Note: at time of writing there are no existing users, so `1 → 2` is not exercised in practice. Migration code is kept generic but only fresh-install path is tested.

### 6.2 Migration logic

```typescript
const DEFAULT_PROJECT: Project = { id: 'p_default', name: 'Default Project' }

export async function runMigration(): Promise<void> {
  const all = await chrome.storage.local.get(null)
  const v = all.schemaVersion ?? (all.verifyEnabled !== undefined ? 1 : undefined)
  if (v === 2) return

  await chrome.storage.local.set({
    schemaVersion: 2,
    verifyEnabled: all.verifyEnabled ?? true,
    projects: [DEFAULT_PROJECT],
    currentProjectId: DEFAULT_PROJECT.id,
    inboxItems: [],
    conflicts: [],
    activeSites: ['elicit', 'scispace', 'consensus'],
    pausedSites: [],
    globalPaused: false,
    provider: 'anthropic',
    autoVerify: true,
    verifyDelay: 1.5,
    onboardingDone: v === 1 ? true : false,
  })
}
```

Trigger: `chrome.runtime.onInstalled` for `'install'` and `'update'`. Sidebar mount also runs `runMigration()` defensively (idempotent).

### 6.3 Defaults

| Setting | Default | Rationale |
|---|---|---|
| `verifyEnabled` | `true` | Phase 1 default kept |
| `activeSites` | All 3 | Maximize discovery |
| `pausedSites` | `[]` | None paused |
| `globalPaused` | `false` | Verify runs immediately |
| `provider` | `'anthropic'` | Phase 1 default |
| `autoVerify` | `true` | Match "Suggest, don't force" — opt-out |
| `verifyDelay` | `1.5` seconds | Configurable now |
| `onboardingDone` | `false` (fresh) / `true` (upgrade) | Don't re-prompt existing users |
| `currentProjectId` | `'p_default'` | Auto-created |

### 6.4 ID generation

```typescript
function genId(prefix: 'p' | 'inb' | 'cf'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}
```

Default project keeps fixed `'p_default'` for migration consistency.

### 6.5 Data clear (Settings → Data)

Wipes `projects` (back to default), `currentProjectId`, `inboxItems`, `conflicts`. Preserves `verifyEnabled`, `activeSites`, `provider`, `autoVerify`, `verifyDelay`, `onboardingDone`. Typed confirm "delete" required.

### 6.6 Edge cases

- **Backend backward compat**: provider field is optional. Pydantic v2 ignores unknown fields by default; extension Foundation can ship before backend update.
- **Storage quota** (10MB): inbox at 5KB × 1000 items = 5MB acceptable for Foundation. Lifecycle handled in Phase 3.
- **Concurrent writes** (2 sidebars open): last-write-wins; `chrome.storage.onChanged` re-syncs. No CRDT.
- **Default project deletion**: allowed; if no projects remain, auto-create new "Default Project".
- **Project rename**: name updates everywhere by reference (inbox items use `projectId`, never `projectName`).

---

## 7. Testing Strategy & Definition of Done

### 7.1 Pyramid

- **Unit** (Vitest): pure functions, helpers, store actions.
- **Component** (React Testing Library): components with non-trivial logic.
- **Integration**: Zustand × chrome.storage mock.
- **Manual smoke**: Chrome unpacked, click through flows.

No E2E automation in Foundation (Playwright extension setup ROI low).

### 7.2 Unit tests

| File / area | Cases |
|---|---|
| `state/migration.ts` | fresh install seeds defaults; idempotent; partial state fills missing keys |
| `state/storage.ts` | read returns defaults if missing; appendStorage no-id-collision; subscribe fires on change |
| `state/useStore.ts` actions | `saveToInbox` exact-text dedup; `createProject` unique id; `deleteProject` cascade + confirm gate; `clearAllData` preserves whitelist |
| `background_minimal.ts` helpers | `deriveReason` covers all status combos; `derivePage` returns expected strings; `detectAndStoreConflict` only fires on confidence delta + same DOI + cross-site |
| Inbox grouping selector | groups by DOI then title fallback; sort DESC by recent; warning flags accurate |
| `content.ts` activeSites gating | `shouldExtract` honors disabled site; re-init on `MSG_ACTIVE_SITES_CHANGED` re-enable |

Target: ~25–35 tests.

### 7.3 Component tests

| Component | Cases |
|---|---|
| `ClaimCard` | expand/collapse; Save state machine; status-tinted bg; reason text |
| `PaperGroup` | header collapse; warning chip when `hasUnknownDoi`; claim count |
| `ProjectSelector` | switch dispatches action; "+ New" prompts modal; delete with items confirm |
| `OnboardingOverlay` | step nav; final CTA sets done; skip works; dot click jump |
| `SettingsPanel` | toggle dispatches MSG_SET_SITE_ACTIVE; clear data confirm gate |
| `TabBar` | badge counts derived correctly; active highlight |

Target: ~15–20 tests.

### 7.4 Integration tests

1. **Verify → Save to Inbox → Switch project → Verify same claim → Save again** — composite key dedup across sessions.
2. **Toggle site OFF in Settings → content.ts on that site stops** — message propagation end-to-end (mock chrome APIs).
3. **First install → Onboarding shows → Complete → reload → Onboarding hidden**.

Target: 3–5 tests.

### 7.5 Manual smoke checklist

- [ ] Fresh install → onboarding overlay visible; complete 5 steps.
- [ ] Visit Elicit → claims extracted → inline badges → Verify tab populated.
- [ ] Click claim → expanded → see verbatim quote.
- [ ] Save to Inbox → toast → claim shown grouped by paper in Inbox tab.
- [ ] Multi-select inbox → "Draft Review →" → DraftTab placeholder shows count.
- [ ] Settings → toggle Elicit OFF → reload Elicit page → no extraction.
- [ ] Settings → switch provider → no error, value persists.
- [ ] Chat tab → legacy chat works (no regression in `useOpenClawAgent`).
- [ ] Help tab → "Replay intro guide" → onboarding re-shows.
- [ ] Floating pill appears during verify, click → side panel opens.
- [ ] Clear all data → projects reset to one default, inbox empty.

### 7.6 Definition of Done

- [ ] All 27 new + 6 updated files implemented
- [ ] Unit tests pass (~25–35)
- [ ] Component tests pass (~15–20)
- [ ] Integration tests pass (3–5)
- [ ] TypeScript compiles 0 errors in `extension/`
- [ ] Backend Phase 1 tests still pass
- [ ] Backend `provider` field accepted (1 small test added)
- [ ] Manual smoke 11/11 items passed
- [ ] Visual match `design_handoff_researchkit/ResearchKit Extension.html` for Verify / Inbox / Settings / Onboarding / Help
- [ ] No console errors in normal operation
- [ ] Schema migration runs on install
- [ ] All animations work
- [ ] Floating pill mounted via Shadow DOM, no CSS leak

### 7.7 Performance targets

| Metric | Target |
|---|---|
| Sidebar mount → first paint | < 200ms |
| Tab switch | < 50ms |
| Inbox with 500 items | < 100ms render |
| Storage read on mount | < 30ms |
| Floating pill mount | < 50ms |

Flag if >2× target.

### 7.8 Out of testing scope

Cross-browser, a11y, localization, storage quota stress, provider routing backend behavior.

---

## 8. Open Questions (To Resolve Before Phase 2.5 Specs)

- Help Q&A content — write during implementation; reviewer can adjust copy.
- Conflict detection algorithm — Foundation uses confidence-delta heuristic; Phase 2.5 will replace with stance/polarity analysis.
- "Upload PDF" button on partial claims — Foundation renders disabled with tooltip; functional behavior deferred.
- Provider radio in Settings — Foundation stores + sends field; backend ignores until GoClaw migration.

---

## 9. References

- Predecessor spec: `docs/superpowers/specs/2026-05-07-researchkit-pipeline-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-05-07-researchkit-phase1-mvp.md`
- Brainstorming artifacts: `docs/BRAINSTORMING_ARTIFACTS.md`
- Phase 1 design reference: `docs/DESIGN_REFERENCE_V1.md`
- High-fidelity prototype: `research-kit/design_handoff_researchkit/ResearchKit Extension.html`
- Component specs: `research-kit/design_handoff_researchkit/COMPONENTS.md`
- API contract reference: `research-kit/design_handoff_researchkit/API_CONTRACT.md`
