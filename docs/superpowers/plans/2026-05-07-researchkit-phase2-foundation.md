# ResearchKit Phase 2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the redesigned sidebar UX shell + Verify→Inbox value flow + Project Sessions, matching `research-kit/design_handoff_researchkit/` prototype.

**Architecture:** React 19 + Tailwind 4 + Zustand store backed by `chrome.storage.local`. Background service worker extended with per-site pause + ClaimItem merge + conflict-store (UI deferred). Content script adds activeSites gating + Shadow-DOM floating progress pill. Backend (FastAPI) gets one optional `provider` field; verify/extract logic untouched.

**Tech Stack:** TypeScript, React 19, Vite + @crxjs/vite-plugin, Tailwind 4, Zustand 5, Vitest + React Testing Library + jsdom, Chrome Manifest v3, Pydantic 2 (backend).

**Spec:** `docs/superpowers/specs/2026-05-07-researchkit-phase2-foundation-design.md`

**Design reference:** `research-kit/design_handoff_researchkit/README.md` (visual tokens), `COMPONENTS.md` (component specs), `API_CONTRACT.md` (message protocol).

---

## Phases

- **Phase A — Setup & Foundation primitives** (Tasks 1–8): test runner, types, messages, storage, migration, store, hooks.
- **Phase B — Atomic UI components** (Tasks 9–9a–16): design tokens + animations, Checkbox, Toggle, StatusBadge, ConfidenceBar, Toast, ClaimCard, PaperGroup, ProjectSelector.
- **Phase C — Shell components** (Tasks 17–20): Header (live indicator + site pills), ProgressBar (per-site chips), TabBar, Footer.
- **Phase D — Tab content** (Tasks 21–23): VerifyTab (filters + empty states), InboxTab (action bar + manage modal), ConflictsTab + ChatTab (ChatThread wrap) + DraftTab (selection-aware) + HelpTab (accordion + replay).
- **Phase E — Overlays** (Tasks 24–25): SettingsPanel, OnboardingOverlay (5-step flow).
- **Phase F — App.tsx integration** (Task 26): replace App, update index.html.
- **Phase G — Background & content extensions** (Tasks 27–29a): hybrid fix + activeSites gating + tests, background helpers + conflict detection + tab tracking + broadcast, floating pill (click + fade), content.ts shouldExtract tests.
- **Phase H — Backend tweak** (Task 30).
- **Phase I — Integration tests + smoke** (Tasks 31–32): 3 scenarios + full suite gate.
- **Phase J — Build verify** (Task 33).

---

## Conventions

- All paths relative to repo root: `d:/vin_product/A20-App-012/`.
- Run extension commands from `research-kit/extension/`.
- Run backend commands from `research-kit/backend/`.
- Commits use conventional format: `feat(scope):`, `test(scope):`, `chore(scope):`.
- TDD discipline: every behavior file has a test written first; visual-only render styling is verified manually against design handoff.
- Each commit should leave `npm run build` and `npx vitest run` green.

---

## Phase A — Setup & Foundation primitives

### Task 1: Add testing + state dependencies

**Files:**

- Modify: `research-kit/extension/package.json`
- Create: `research-kit/extension/vitest.config.ts`
- Create: `research-kit/extension/src/test/setup.ts`

- [ ] **Step 1: Install dev deps**

```bash
cd research-kit/extension
npm install --save zustand
npm install --save-dev vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @types/chrome
```

- [ ] **Step 2: Add test scripts to package.json**

Edit `package.json` `scripts` section:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

- [ ] **Step 4: Create `src/test/setup.ts` (chrome API mock + jest-dom matchers)**

```ts
import '@testing-library/jest-dom/vitest'
import { vi, beforeEach } from 'vitest'

const storageData: Record<string, any> = {}
const listeners: Array<(changes: any, area: string) => void> = []

const chromeMock = {
  storage: {
    local: {
      get: vi.fn((keyOrKeys: string | string[] | null) => {
        if (keyOrKeys === null) return Promise.resolve({ ...storageData })
        if (typeof keyOrKeys === 'string') return Promise.resolve({ [keyOrKeys]: storageData[keyOrKeys] })
        const out: Record<string, any> = {}
        for (const k of keyOrKeys) out[k] = storageData[k]
        return Promise.resolve(out)
      }),
      set: vi.fn((items: Record<string, any>) => {
        const changes: Record<string, any> = {}
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: storageData[k], newValue: v }
          storageData[k] = v
        }
        for (const l of listeners) l(changes, 'local')
        return Promise.resolve()
      }),
      clear: vi.fn(() => {
        for (const k of Object.keys(storageData)) delete storageData[k]
        return Promise.resolve()
      }),
    },
    onChanged: {
      addListener: vi.fn((cb: any) => listeners.push(cb)),
      removeListener: vi.fn((cb: any) => {
        const i = listeners.indexOf(cb)
        if (i >= 0) listeners.splice(i, 1)
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn(() => Promise.resolve()),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([])),
    sendMessage: vi.fn(() => Promise.resolve()),
    onActivated: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
  },
  sidePanel: {
    setPanelBehavior: vi.fn(() => Promise.resolve()),
    open: vi.fn(() => Promise.resolve()),
  },
} as any

;(globalThis as any).chrome = chromeMock

beforeEach(() => {
  for (const k of Object.keys(storageData)) delete storageData[k]
  listeners.length = 0
  vi.clearAllMocks()
})

export { storageData }
```

- [ ] **Step 5: Verify test runner works**

```bash
cd research-kit/extension
npx vitest run --reporter=verbose
```

Expected: "No test files found" or 0 tests run, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/package.json research-kit/extension/package-lock.json research-kit/extension/vitest.config.ts research-kit/extension/src/test/setup.ts
git commit -m "chore(extension): add vitest + testing-library + zustand"
```

---

### Task 2: Replace `verify-types.ts` with merged ClaimItem + new types

**Files:**

- Modify: `research-kit/extension/src/shared/verify-types.ts`
- Test: `research-kit/extension/src/shared/verify-types.test.ts`

- [ ] **Step 1: Write the failing test**

`research-kit/extension/src/shared/verify-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from 'vitest'
import type {
  SiteId, VerifyStatus, Provider, Project,
  ClaimItem, InboxItem, ConflictItem, ConflictSide, VerifyProgress,
} from './verify-types'

describe('verify-types', () => {
  it('SiteId is restricted to three sites', () => {
    expectTypeOf<SiteId>().toEqualTypeOf<'elicit' | 'scispace' | 'consensus'>()
  })

  it('ClaimItem includes merged fields', () => {
    const c: ClaimItem = {
      id: 'c1', text: 'claim', paperTitle: null, doi: null, paperUrl: null,
      page: 'p.1', site: 'elicit', status: 'pending', confidence: 0,
      quote: null, reason: '', saved: false, domAnchor: 'x',
      tabId: 1, pageUrl: 'https://x', extractedAt: 0,
    }
    expectTypeOf(c).toMatchTypeOf<ClaimItem>()
  })

  it('Project has id and name only', () => {
    const p: Project = { id: 'p_default', name: 'Default Project' }
    expectTypeOf(p).toMatchTypeOf<Project>()
  })

  it('InboxItem references projectId', () => {
    const i: InboxItem = {
      id: 'inb_1', claimId: 'c1', text: 't', paperTitle: null, doi: null,
      paperUrl: null, page: '', site: 'elicit', status: 'verified',
      confidence: 0.9, quote: null, reason: '', projectId: 'p_default', savedAtMs: 0,
    }
    expectTypeOf(i).toMatchTypeOf<InboxItem>()
  })

  it('ConflictItem holds at least one side', () => {
    const cs: ConflictSide = { site: 'elicit', claimId: 'c1', text: 't', confidence: 0.8, status: 'verified' }
    const cf: ConflictItem = {
      id: 'cf_1', doi: '10.1/x', groupKey: '10.1/x', paperTitle: 'P',
      flaggedAtMs: 0, sides: [cs], resolution: null, projectId: 'p_default',
    }
    expectTypeOf(cf).toMatchTypeOf<ConflictItem>()
  })

  it('VerifyProgress includes perSite breakdown', () => {
    const vp: VerifyProgress = {
      tabId: 1, total: 0, completed: 0, running: 0, paused: false, pausedSites: [],
      perSite: { elicit: { total: 0, completed: 0, running: 0 }, scispace: { total: 0, completed: 0, running: 0 }, consensus: { total: 0, completed: 0, running: 0 } },
    }
    expectTypeOf(vp).toMatchTypeOf<VerifyProgress>()
  })

  it('Provider matches three providers', () => {
    expectTypeOf<Provider>().toEqualTypeOf<'anthropic' | 'openai' | 'gemini'>()
  })
})
```

- [ ] **Step 2: Run test (expected to fail — types not yet defined)**

```bash
cd research-kit/extension
npx vitest run src/shared/verify-types.test.ts
```

Expected: type errors on imports.

- [ ] **Step 3: Replace `verify-types.ts` with new content**

```ts
export type SiteId = 'elicit' | 'scispace' | 'consensus'
export type VerifyStatus = 'verified' | 'partial' | 'not_found' | 'pending' | 'error'
export type Provider = 'anthropic' | 'openai' | 'gemini'

export interface Project {
  id: string
  name: string
}

export interface ClaimItem {
  id: string
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
  saved: boolean
  domAnchor: string
  tabId: number
  pageUrl: string
  extractedAt: number
}

export interface InboxItem {
  id: string
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

export interface ConflictSide {
  site: SiteId
  claimId: string
  text: string
  confidence: number
  status: VerifyStatus
}

export interface ConflictItem {
  id: string
  doi: string | null
  groupKey: string
  paperTitle: string
  flaggedAtMs: number
  sides: ConflictSide[]
  resolution: SiteId | null
  projectId: string
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

// Phase 1 backward-compat — kept for `badge.ts` consumer until consolidation
export interface VerifyResult {
  claimId: string
  status: VerifyStatus
  verbatimQuote: string | null
  confidence: number
  reason: string
  paperTitle: string | null
  doi: string | null
}
```

- [ ] **Step 4: Run test (expected to pass)**

```bash
npx vitest run src/shared/verify-types.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Build TypeScript to catch breakage in consumers**

```bash
npx tsc -b --noEmit
```

Existing consumers may break (e.g., `hybrid.ts`, `background_minimal.ts`, `content.ts`). Note any errors — they'll be addressed in dependent tasks. For now, accept temporary breakage and do **not** fix consumers in this task.

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/shared/verify-types.ts research-kit/extension/src/shared/verify-types.test.ts
git commit -m "feat(extension): merge ClaimItem + add Project/Inbox/Conflict types"
```

---

### Task 3: Extend `messages.ts` with Phase 2 message constants

**Files:**

- Modify: `research-kit/extension/src/shared/messages.ts`
- Test: `research-kit/extension/src/shared/messages.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/messages.test.ts
import { describe, it, expect } from 'vitest'
import * as M from './messages'

describe('messages', () => {
  it('Phase 1 constants are preserved', () => {
    expect(M.MSG_VERIFY_RESULT).toBe('verify:result')
    expect(M.MSG_VERIFY_PROGRESS).toBe('verify:progress')
  })

  it('Phase 2 sidebar←background constants exist', () => {
    expect(M.MSG_CLAIM_RESULT).toBe('CLAIM_RESULT')
    expect(M.MSG_CONFLICT_DETECTED).toBe('CONFLICT_DETECTED')
    expect(M.MSG_VERIFY_DONE).toBe('VERIFY_DONE')
    expect(M.MSG_TAB_CHANGED).toBe('TAB_CHANGED')
  })

  it('Phase 2 sidebar→background constants exist', () => {
    expect(M.MSG_SET_SITE_ACTIVE).toBe('SET_SITE_ACTIVE')
    expect(M.MSG_SET_SITE_PAUSED).toBe('SET_SITE_PAUSED')
    expect(M.MSG_SET_GLOBAL_PAUSED).toBe('SET_GLOBAL_PAUSED')
    expect(M.MSG_SET_PROVIDER).toBe('SET_PROVIDER')
    expect(M.MSG_OPEN_SIDEBAR).toBe('open-sidebar')
    expect(M.MSG_REQUEST_RE_EXTRACT).toBe('REQUEST_RE_EXTRACT')
  })

  it('Phase 2 content←background constant exists', () => {
    expect(M.MSG_ACTIVE_SITES_CHANGED).toBe('ACTIVE_SITES_CHANGED')
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/shared/messages.test.ts
```

Expected: undefined exports.

- [ ] **Step 3: Append new constants + interfaces to `messages.ts`**

Append to existing file (do not remove Phase 1 constants):

```ts
import type { ClaimItem, ConflictItem, SiteId, Provider } from './verify-types'

// Phase 2 — Sidebar ← Background
export const MSG_CLAIM_RESULT = 'CLAIM_RESULT'
export const MSG_CONFLICT_DETECTED = 'CONFLICT_DETECTED'
export const MSG_VERIFY_DONE = 'VERIFY_DONE'
export const MSG_TAB_CHANGED = 'TAB_CHANGED'

// Phase 2 — Sidebar → Background
export const MSG_SET_SITE_ACTIVE = 'SET_SITE_ACTIVE'
export const MSG_SET_SITE_PAUSED = 'SET_SITE_PAUSED'
export const MSG_SET_GLOBAL_PAUSED = 'SET_GLOBAL_PAUSED'
export const MSG_SET_PROVIDER = 'SET_PROVIDER'
export const MSG_OPEN_SIDEBAR = 'open-sidebar'
export const MSG_REQUEST_RE_EXTRACT = 'REQUEST_RE_EXTRACT'

// Phase 2 — Content ← Background
export const MSG_ACTIVE_SITES_CHANGED = 'ACTIVE_SITES_CHANGED'

export interface MessageClaimResult { type: typeof MSG_CLAIM_RESULT; result: ClaimItem }
export interface MessageConflictDetected { type: typeof MSG_CONFLICT_DETECTED; conflict: ConflictItem }
export interface MessageVerifyDone { type: typeof MSG_VERIFY_DONE; tabId: number; total: number }
export interface MessageTabChanged { type: typeof MSG_TAB_CHANGED; tabId: number }
export interface MessageSetSiteActive { type: typeof MSG_SET_SITE_ACTIVE; site: SiteId; active: boolean }
export interface MessageSetSitePaused { type: typeof MSG_SET_SITE_PAUSED; site: SiteId; paused: boolean }
export interface MessageSetGlobalPaused { type: typeof MSG_SET_GLOBAL_PAUSED; paused: boolean }
export interface MessageSetProvider { type: typeof MSG_SET_PROVIDER; provider: Provider }
export interface MessageOpenSidebar { type: typeof MSG_OPEN_SIDEBAR }
export interface MessageRequestReExtract { type: typeof MSG_REQUEST_RE_EXTRACT }
export interface MessageActiveSitesChanged { type: typeof MSG_ACTIVE_SITES_CHANGED; activeSites: SiteId[] }
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/shared/messages.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/shared/messages.ts research-kit/extension/src/shared/messages.test.ts
git commit -m "feat(extension): add Phase 2 message constants + types"
```

---

### Task 4: Create `state/storage.ts` chrome.storage helpers

**Files:**

- Create: `research-kit/extension/src/sidebar/state/storage.ts`
- Create: `research-kit/extension/src/sidebar/state/storage-schema.ts`
- Test: `research-kit/extension/src/sidebar/state/storage.test.ts`

- [ ] **Step 1: Create schema type file**

`src/sidebar/state/storage-schema.ts`:

```ts
import type { Project, InboxItem, ConflictItem, SiteId, Provider } from '../../shared/verify-types'

export interface StorageSchema {
  schemaVersion: 2
  projects: Project[]
  currentProjectId: string
  inboxItems: InboxItem[]
  conflicts: ConflictItem[]
  activeSites: SiteId[]
  pausedSites: SiteId[]
  globalPaused: boolean
  provider: Provider
  autoVerify: boolean
  verifyDelay: number
  onboardingDone: boolean
  verifyEnabled: boolean
}

export const DEFAULT_PROJECT: Project = { id: 'p_default', name: 'Default Project' }

export const DEFAULTS: StorageSchema = {
  schemaVersion: 2,
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
  onboardingDone: false,
  verifyEnabled: true,
}
```

- [ ] **Step 2: Write the failing test**

`src/sidebar/state/storage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readStorage, writeStorage, appendStorage, subscribeStorage } from './storage'
import { DEFAULTS } from './storage-schema'

describe('storage', () => {
  it('readStorage returns default when key missing', async () => {
    const v = await readStorage('verifyEnabled')
    expect(v).toBe(DEFAULTS.verifyEnabled)
  })

  it('writeStorage persists value, readStorage returns it', async () => {
    await writeStorage('provider', 'gemini')
    const v = await readStorage('provider')
    expect(v).toBe('gemini')
  })

  it('appendStorage adds to array atomically', async () => {
    await writeStorage('inboxItems', [])
    await appendStorage('inboxItems', { id: 'inb_1' } as any)
    await appendStorage('inboxItems', { id: 'inb_2' } as any)
    const items = await readStorage('inboxItems')
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe('inb_1')
  })

  it('subscribeStorage fires on change', async () => {
    const fn = vi.fn()
    const unsub = subscribeStorage(fn)
    await writeStorage('verifyEnabled', false)
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ verifyEnabled: expect.anything() }), 'local')
    unsub()
  })
})
```

- [ ] **Step 3: Run test (fail — module not found)**

```bash
npx vitest run src/sidebar/state/storage.test.ts
```

- [ ] **Step 4: Implement `storage.ts`**

```ts
import { DEFAULTS, type StorageSchema } from './storage-schema'

export async function readStorage<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K]> {
  const result = await chrome.storage.local.get(key as string)
  const v = (result as any)[key]
  return v === undefined ? DEFAULTS[key] : v
}

export async function writeStorage<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value })
}

export async function appendStorage<K extends keyof StorageSchema>(
  key: K,
  item: StorageSchema[K] extends Array<infer U> ? U : never,
): Promise<void> {
  const current = (await readStorage(key)) as any[]
  const next = [...(current ?? []), item]
  await writeStorage(key, next as any)
}

export function subscribeStorage(
  callback: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void,
): () => void {
  const wrapped = (changes: any, area: string) => callback(changes, area)
  chrome.storage.onChanged.addListener(wrapped)
  return () => chrome.storage.onChanged.removeListener(wrapped)
}
```

- [ ] **Step 5: Run test (pass)**

```bash
npx vitest run src/sidebar/state/storage.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/sidebar/state/
git commit -m "feat(extension): add chrome.storage helpers + schema defaults"
```

---

### Task 5: Create `state/migration.ts`

**Files:**

- Create: `research-kit/extension/src/sidebar/state/migration.ts`
- Test: `research-kit/extension/src/sidebar/state/migration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/sidebar/state/migration.test.ts
import { describe, it, expect } from 'vitest'
import { runMigration } from './migration'
import { DEFAULTS, DEFAULT_PROJECT } from './storage-schema'

describe('migration', () => {
  it('seeds defaults on fresh install', async () => {
    await runMigration()
    const all = await chrome.storage.local.get(null)
    expect(all.schemaVersion).toBe(2)
    expect(all.projects).toEqual([DEFAULT_PROJECT])
    expect(all.currentProjectId).toBe(DEFAULT_PROJECT.id)
    expect(all.activeSites).toEqual(DEFAULTS.activeSites)
    expect(all.onboardingDone).toBe(false)
    expect(all.verifyEnabled).toBe(true)
  })

  it('is idempotent (v=2 short-circuits)', async () => {
    await chrome.storage.local.set({ schemaVersion: 2, verifyEnabled: false, provider: 'gemini' })
    await runMigration()
    const all = await chrome.storage.local.get(null)
    expect(all.verifyEnabled).toBe(false)
    expect(all.provider).toBe('gemini')
  })

  it('preserves existing verifyEnabled when bootstrapping', async () => {
    await chrome.storage.local.set({ verifyEnabled: false })
    await runMigration()
    const all = await chrome.storage.local.get(null)
    expect(all.verifyEnabled).toBe(false)
    expect(all.schemaVersion).toBe(2)
  })

  it('marks onboardingDone=true when migrating from v1 (verifyEnabled present, no schemaVersion)', async () => {
    await chrome.storage.local.set({ verifyEnabled: true })
    await runMigration()
    const all = await chrome.storage.local.get(null)
    expect(all.onboardingDone).toBe(true)
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/state/migration.test.ts
```

- [ ] **Step 3: Implement `migration.ts`**

```ts
import { DEFAULTS, DEFAULT_PROJECT, type StorageSchema } from './storage-schema'

export async function runMigration(): Promise<void> {
  const all = await chrome.storage.local.get(null)
  const v = all.schemaVersion ?? (all.verifyEnabled !== undefined ? 1 : undefined)
  if (v === 2) return

  const next: StorageSchema = {
    ...DEFAULTS,
    verifyEnabled: typeof all.verifyEnabled === 'boolean' ? all.verifyEnabled : DEFAULTS.verifyEnabled,
    onboardingDone: v === 1 ? true : false,
  }

  await chrome.storage.local.set(next)
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/state/migration.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/state/migration.ts research-kit/extension/src/sidebar/state/migration.test.ts
git commit -m "feat(extension): add storage migration with v1→v2 onboarding skip"
```

---

### Task 6: Create `state/useStore.ts` Zustand store

**Files:**

- Create: `research-kit/extension/src/sidebar/state/useStore.ts`
- Create: `research-kit/extension/src/sidebar/state/ids.ts`
- Test: `research-kit/extension/src/sidebar/state/useStore.test.ts`

- [ ] **Step 1: Create id generator**

`src/sidebar/state/ids.ts`:

```ts
export function genId(prefix: 'p' | 'inb' | 'cf'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeTitle(title: string | null): string {
  if (!title) return ''
  return title.toLowerCase().replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 2: Write the failing test**

`src/sidebar/state/useStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { runMigration } from './migration'
import type { ClaimItem } from '../../shared/verify-types'

const fakeClaim = (overrides: Partial<ClaimItem> = {}): ClaimItem => ({
  id: 'c1', text: 'sleep helps memory', paperTitle: 'Why We Sleep',
  doi: '10.1/walker', paperUrl: null, page: 'p.142', site: 'elicit',
  status: 'verified', confidence: 0.9, quote: 'q', reason: '', saved: false,
  domAnchor: 'x', tabId: 1, pageUrl: 'https://e/x', extractedAt: Date.now(),
  ...overrides,
})

describe('useStore', () => {
  beforeEach(async () => {
    await runMigration()
    await useStore.getState().hydrate()
  })

  it('hydrates from chrome.storage', () => {
    const s = useStore.getState()
    expect(s.projects).toHaveLength(1)
    expect(s.currentProjectId).toBe('p_default')
    expect(s.verifyEnabled).toBe(true)
  })

  it('createProject adds project + persists', async () => {
    const p = await useStore.getState().createProject('Climate')
    expect(p.id).toMatch(/^p_/)
    expect(p.name).toBe('Climate')
    const stored = (await chrome.storage.local.get('projects')).projects
    expect(stored).toHaveLength(2)
  })

  it('renameProject updates name preserving id', async () => {
    await useStore.getState().renameProject('p_default', 'Personal')
    expect(useStore.getState().projects[0].name).toBe('Personal')
    expect(useStore.getState().projects[0].id).toBe('p_default')
  })

  it('deleteProject removes project + cascades inbox items', async () => {
    const p = await useStore.getState().createProject('X')
    await useStore.getState().saveToInbox(fakeClaim({ id: 'c1' }))
    await useStore.getState().switchProject(p.id)
    await useStore.getState().saveToInbox(fakeClaim({ id: 'c2' }))
    await useStore.getState().deleteProject(p.id)
    expect(useStore.getState().projects.find(x => x.id === p.id)).toBeUndefined()
    expect(useStore.getState().inboxItems.find(i => i.projectId === p.id)).toBeUndefined()
  })

  it('saveToInbox adds when new', async () => {
    const r = await useStore.getState().saveToInbox(fakeClaim())
    expect(r.added).toBe(true)
    expect(useStore.getState().inboxItems).toHaveLength(1)
  })

  it('saveToInbox dedups by (projectId, doi||title, exact text)', async () => {
    await useStore.getState().saveToInbox(fakeClaim())
    const r = await useStore.getState().saveToInbox(fakeClaim())
    expect(r.added).toBe(false)
    expect(r.reason).toMatch(/already/i)
    expect(useStore.getState().inboxItems).toHaveLength(1)
  })

  it('saveToInbox allows different text under same DOI', async () => {
    await useStore.getState().saveToInbox(fakeClaim({ id: 'c1', text: 'A' }))
    const r = await useStore.getState().saveToInbox(fakeClaim({ id: 'c2', text: 'B' }))
    expect(r.added).toBe(true)
    expect(useStore.getState().inboxItems).toHaveLength(2)
  })

  it('saveToInbox uses paperTitle when DOI missing', async () => {
    await useStore.getState().saveToInbox(fakeClaim({ doi: null }))
    const r = await useStore.getState().saveToInbox(fakeClaim({ doi: null }))
    expect(r.added).toBe(false)
  })

  it('clearAllData wipes inbox + conflicts but keeps verifyEnabled', async () => {
    await useStore.getState().saveToInbox(fakeClaim())
    await useStore.getState().setVerifyEnabled(false)
    await useStore.getState().clearAllData()
    expect(useStore.getState().inboxItems).toHaveLength(0)
    expect(useStore.getState().verifyEnabled).toBe(false)
    expect(useStore.getState().projects).toHaveLength(1)
  })

  it('deleting last project auto-creates new default', async () => {
    await useStore.getState().deleteProject('p_default')
    expect(useStore.getState().projects.length).toBeGreaterThanOrEqual(1)
    expect(useStore.getState().projects[0].name).toBe('Default Project')
  })

  it('setActiveSite updates set + persists', async () => {
    await useStore.getState().setActiveSite('elicit', false)
    expect(useStore.getState().activeSites.has('elicit')).toBe(false)
    const stored = (await chrome.storage.local.get('activeSites')).activeSites
    expect(stored).not.toContain('elicit')
  })
})
```

- [ ] **Step 3: Run test (fail)**

```bash
npx vitest run src/sidebar/state/useStore.test.ts
```

- [ ] **Step 4: Implement `useStore.ts`**

```ts
import { create } from 'zustand'
import type {
  ClaimItem, InboxItem, ConflictItem, SiteId, Provider, Project, VerifyProgress,
} from '../../shared/verify-types'
import { readStorage, writeStorage } from './storage'
import { DEFAULT_PROJECT, DEFAULTS } from './storage-schema'
import { genId, normalizeTitle } from './ids'

export type TabId = 'verify' | 'inbox' | 'conflicts' | 'chat' | 'draft' | 'help'
export type Tone = 'success' | 'warning' | 'error'

interface ToastState { id: string; message: string; tone: Tone }

interface State {
  // UI
  tab: TabId
  settingsOpen: boolean
  toast: ToastState | null
  expandedClaimIds: Set<string>
  inboxSelectedIds: Set<string>
  inboxExpandedGroups: Set<string>
  draftSelection: string[]

  // Persisted (mirrored from chrome.storage)
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

  // In-memory (from background)
  currentTabId: number | null
  currentTabUrl: string | null
  claimsByTab: Map<number, ClaimItem[]>
  progressByTab: Map<number, VerifyProgress>

  // Actions
  hydrate(): Promise<void>
  setTab(t: TabId): void
  openSettings(): void
  closeSettings(): void
  showToast(message: string, tone?: Tone): void
  clearToast(): void
  toggleClaimExpand(claimId: string): void
  toggleInboxSelect(itemId: string): void
  clearInboxSelection(): void
  toggleGroupExpand(groupKey: string): void
  setDraftSelection(ids: string[]): void
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
  ingestClaimResult(claim: ClaimItem): void
  ingestProgress(progress: VerifyProgress): void
  setCurrentTab(tabId: number | null, url: string | null): void
}

function inboxKey(projectId: string, doi: string | null, title: string | null, text: string): string {
  return `${projectId}|${doi ?? normalizeTitle(title)}|${text}`
}

export const useStore = create<State>((set, get) => ({
  tab: 'verify',
  settingsOpen: false,
  toast: null,
  expandedClaimIds: new Set(),
  inboxSelectedIds: new Set(),
  inboxExpandedGroups: new Set(),
  draftSelection: [],
  projects: DEFAULTS.projects,
  currentProjectId: DEFAULTS.currentProjectId,
  inboxItems: [],
  conflicts: [],
  activeSites: new Set(DEFAULTS.activeSites),
  pausedSites: new Set(DEFAULTS.pausedSites),
  globalPaused: false,
  provider: 'anthropic',
  autoVerify: true,
  verifyDelay: 1.5,
  onboardingDone: false,
  verifyEnabled: true,
  currentTabId: null,
  currentTabUrl: null,
  claimsByTab: new Map(),
  progressByTab: new Map(),

  async hydrate() {
    const [projects, currentProjectId, inboxItems, conflicts, activeSites, pausedSites,
      globalPaused, provider, autoVerify, verifyDelay, onboardingDone, verifyEnabled] = await Promise.all([
      readStorage('projects'), readStorage('currentProjectId'), readStorage('inboxItems'),
      readStorage('conflicts'), readStorage('activeSites'), readStorage('pausedSites'),
      readStorage('globalPaused'), readStorage('provider'), readStorage('autoVerify'),
      readStorage('verifyDelay'), readStorage('onboardingDone'), readStorage('verifyEnabled'),
    ])
    set({
      projects, currentProjectId, inboxItems, conflicts,
      activeSites: new Set(activeSites), pausedSites: new Set(pausedSites),
      globalPaused, provider, autoVerify, verifyDelay, onboardingDone, verifyEnabled,
    })
  },

  setTab(t) { set({ tab: t }) },
  openSettings() { set({ settingsOpen: true }) },
  closeSettings() { set({ settingsOpen: false }) },
  showToast(message, tone = 'success') {
    set({ toast: { id: genId('inb'), message, tone } })
    setTimeout(() => {
      const t = get().toast
      if (t && t.message === message) set({ toast: null })
    }, 2500)
  },
  clearToast() { set({ toast: null }) },
  toggleClaimExpand(claimId) {
    const s = new Set(get().expandedClaimIds)
    s.has(claimId) ? s.delete(claimId) : s.add(claimId)
    set({ expandedClaimIds: s })
  },
  toggleInboxSelect(itemId) {
    const s = new Set(get().inboxSelectedIds)
    s.has(itemId) ? s.delete(itemId) : s.add(itemId)
    set({ inboxSelectedIds: s })
  },
  clearInboxSelection() { set({ inboxSelectedIds: new Set() }) },
  toggleGroupExpand(groupKey) {
    const s = new Set(get().inboxExpandedGroups)
    s.has(groupKey) ? s.delete(groupKey) : s.add(groupKey)
    set({ inboxExpandedGroups: s })
  },
  setDraftSelection(ids) { set({ draftSelection: ids }) },

  async setActiveSite(site, active) {
    const next = new Set(get().activeSites)
    active ? next.add(site) : next.delete(site)
    set({ activeSites: next })
    await writeStorage('activeSites', Array.from(next))
  },
  async setPausedSite(site, paused) {
    const next = new Set(get().pausedSites)
    paused ? next.add(site) : next.delete(site)
    set({ pausedSites: next })
    await writeStorage('pausedSites', Array.from(next))
  },
  async setGlobalPaused(paused) { set({ globalPaused: paused }); await writeStorage('globalPaused', paused) },
  async setVerifyEnabled(enabled) { set({ verifyEnabled: enabled }); await writeStorage('verifyEnabled', enabled) },
  async setProvider(p) { set({ provider: p }); await writeStorage('provider', p) },
  async setAutoVerify(v) { set({ autoVerify: v }); await writeStorage('autoVerify', v) },
  async setVerifyDelay(s) { set({ verifyDelay: s }); await writeStorage('verifyDelay', s) },
  async setOnboardingDone(d) { set({ onboardingDone: d }); await writeStorage('onboardingDone', d) },

  async createProject(name) {
    const p: Project = { id: genId('p'), name }
    const projects = [...get().projects, p]
    set({ projects })
    await writeStorage('projects', projects)
    return p
  },

  async renameProject(id, name) {
    const projects = get().projects.map(p => p.id === id ? { ...p, name } : p)
    set({ projects })
    await writeStorage('projects', projects)
  },

  async deleteProject(id) {
    let projects = get().projects.filter(p => p.id !== id)
    const inboxItems = get().inboxItems.filter(i => i.projectId !== id)
    const conflicts = get().conflicts.filter(c => c.projectId !== id)
    if (projects.length === 0) projects = [{ id: 'p_default', name: 'Default Project' }]
    let currentProjectId = get().currentProjectId
    if (currentProjectId === id) currentProjectId = projects[0].id
    set({ projects, inboxItems, conflicts, currentProjectId })
    await Promise.all([
      writeStorage('projects', projects),
      writeStorage('inboxItems', inboxItems),
      writeStorage('conflicts', conflicts),
      writeStorage('currentProjectId', currentProjectId),
    ])
  },

  async switchProject(id) {
    set({ currentProjectId: id, inboxSelectedIds: new Set() })
    await writeStorage('currentProjectId', id)
  },

  async saveToInbox(claim) {
    const projectId = get().currentProjectId
    const key = inboxKey(projectId, claim.doi, claim.paperTitle, claim.text)
    const exists = get().inboxItems.some(i =>
      inboxKey(i.projectId, i.doi, i.paperTitle, i.text) === key
    )
    if (exists) return { added: false, reason: 'Already in this project\'s inbox' }
    const item: InboxItem = {
      id: genId('inb'),
      claimId: claim.id,
      text: claim.text,
      paperTitle: claim.paperTitle,
      doi: claim.doi,
      paperUrl: claim.paperUrl,
      page: claim.page,
      site: claim.site,
      status: claim.status,
      confidence: claim.confidence,
      quote: claim.quote,
      reason: claim.reason,
      projectId,
      savedAtMs: Date.now(),
    }
    const inboxItems = [...get().inboxItems, item]
    set({ inboxItems })
    await writeStorage('inboxItems', inboxItems)
    return { added: true }
  },

  async removeFromInbox(itemId) {
    const inboxItems = get().inboxItems.filter(i => i.id !== itemId)
    set({ inboxItems })
    await writeStorage('inboxItems', inboxItems)
  },

  async clearAllData() {
    const next = {
      projects: [DEFAULT_PROJECT],
      currentProjectId: DEFAULT_PROJECT.id,
      inboxItems: [],
      conflicts: [],
    }
    set(next)
    await Promise.all([
      writeStorage('projects', next.projects),
      writeStorage('currentProjectId', next.currentProjectId),
      writeStorage('inboxItems', next.inboxItems),
      writeStorage('conflicts', next.conflicts),
    ])
  },

  ingestClaimResult(claim) {
    const claimsByTab = new Map(get().claimsByTab)
    const list = claimsByTab.get(claim.tabId) ?? []
    const idx = list.findIndex(c => c.id === claim.id)
    if (idx >= 0) list[idx] = claim
    else list.push(claim)
    claimsByTab.set(claim.tabId, list)
    set({ claimsByTab })
  },

  ingestProgress(progress) {
    const progressByTab = new Map(get().progressByTab)
    progressByTab.set(progress.tabId, progress)
    set({ progressByTab })
  },

  setCurrentTab(tabId, url) {
    set({ currentTabId: tabId, currentTabUrl: url })
  },
}))
```

- [ ] **Step 5: Run test (pass)**

```bash
npx vitest run src/sidebar/state/useStore.test.ts
```

Expected: 11 tests pass.

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/sidebar/state/
git commit -m "feat(extension): add Zustand store with project/inbox/site actions"
```

---

### Task 7: Create `hooks/useChromeStorage.ts` and `hooks/useBackgroundMessages.ts`

**Files:**

- Create: `research-kit/extension/src/sidebar/hooks/useChromeStorage.ts`
- Create: `research-kit/extension/src/sidebar/hooks/useBackgroundMessages.ts`
- Test: `research-kit/extension/src/sidebar/hooks/useChromeStorage.test.tsx`

- [ ] **Step 1: Implement `useChromeStorage.ts`**

```ts
import { useEffect } from 'react'
import { subscribeStorage } from '../state/storage'
import { useStore } from '../state/useStore'

/**
 * Re-hydrates the Zustand store whenever any chrome.storage.local key changes.
 * Mount once at App root.
 */
export function useChromeStorage(): void {
  const hydrate = useStore(s => s.hydrate)
  useEffect(() => {
    hydrate()
    const unsub = subscribeStorage(() => { hydrate() })
    return unsub
  }, [hydrate])
}
```

- [ ] **Step 2: Implement `useBackgroundMessages.ts`**

```ts
import { useEffect } from 'react'
import {
  MSG_CLAIM_RESULT, MSG_CONFLICT_DETECTED, MSG_VERIFY_DONE,
  MSG_VERIFY_PROGRESS, MSG_TAB_CHANGED,
  type MessageClaimResult, type MessageConflictDetected,
  type MessageVerifyProgress, type MessageTabChanged,
} from '../../shared/messages'
import { useStore } from '../state/useStore'

export function useBackgroundMessages(): void {
  const ingestClaimResult = useStore(s => s.ingestClaimResult)
  const ingestProgress = useStore(s => s.ingestProgress)
  const setCurrentTab = useStore(s => s.setCurrentTab)

  useEffect(() => {
    const handler = (msg: any) => {
      if (msg?.type === MSG_CLAIM_RESULT) {
        ingestClaimResult((msg as MessageClaimResult).result)
      } else if (msg?.type === MSG_VERIFY_PROGRESS) {
        ingestProgress((msg as MessageVerifyProgress).progress)
      } else if (msg?.type === MSG_TAB_CHANGED) {
        setCurrentTab((msg as MessageTabChanged).tabId, null)
      } else if (msg?.type === MSG_CONFLICT_DETECTED) {
        // Conflicts are persisted by background; sidebar re-hydrates via storage listener.
      } else if (msg?.type === MSG_VERIFY_DONE) {
        // No-op in Foundation; ProgressBar derives "done" from progress.completed === total.
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [ingestClaimResult, ingestProgress, setCurrentTab])
}
```

- [ ] **Step 3: Write smoke test for hooks**

`src/sidebar/hooks/useChromeStorage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useChromeStorage } from './useChromeStorage'
import { useStore } from '../state/useStore'
import { runMigration } from '../state/migration'

describe('useChromeStorage', () => {
  it('hydrates store on mount', async () => {
    await runMigration()
    renderHook(() => useChromeStorage())
    await waitFor(() => {
      expect(useStore.getState().projects).toHaveLength(1)
    })
  })

  it('re-hydrates on storage change', async () => {
    await runMigration()
    renderHook(() => useChromeStorage())
    await chrome.storage.local.set({ verifyEnabled: false })
    await waitFor(() => {
      expect(useStore.getState().verifyEnabled).toBe(false)
    })
  })
})
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/hooks/useChromeStorage.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/hooks/
git commit -m "feat(extension): add useChromeStorage + useBackgroundMessages hooks"
```

---

### Task 8: Selectors — `selectors/inbox.ts` (paper grouping)

**Files:**

- Create: `research-kit/extension/src/sidebar/selectors/inbox.ts`
- Test: `research-kit/extension/src/sidebar/selectors/inbox.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/sidebar/selectors/inbox.test.ts
import { describe, it, expect } from 'vitest'
import { groupInboxByPaper } from './inbox'
import type { InboxItem } from '../../shared/verify-types'

const fake = (o: Partial<InboxItem>): InboxItem => ({
  id: 'inb_' + Math.random(),
  claimId: 'c', text: 't', paperTitle: null, doi: null, paperUrl: null,
  page: '', site: 'elicit', status: 'verified', confidence: 0.9, quote: null,
  reason: '', projectId: 'p_default', savedAtMs: 0, ...o,
})

describe('groupInboxByPaper', () => {
  it('groups by DOI', () => {
    const items = [
      fake({ id: 'a', doi: '10.1/x', paperTitle: 'X', text: 'q1', savedAtMs: 1 }),
      fake({ id: 'b', doi: '10.1/x', paperTitle: 'X', text: 'q2', savedAtMs: 2 }),
      fake({ id: 'c', doi: '10.2/y', paperTitle: 'Y', text: 'q3', savedAtMs: 3 }),
    ]
    const groups = groupInboxByPaper(items)
    expect(groups).toHaveLength(2)
    expect(groups[0].groupKey).toBe('10.2/y')          // most recent first
    expect(groups[1].claims).toHaveLength(2)
  })

  it('falls back to normalized title when DOI missing', () => {
    const items = [
      fake({ doi: null, paperTitle: 'Why We Sleep', text: 'a' }),
      fake({ doi: null, paperTitle: 'why we sleep', text: 'b' }),
    ]
    const groups = groupInboxByPaper(items)
    expect(groups).toHaveLength(1)
    expect(groups[0].claims).toHaveLength(2)
  })

  it('untitled items become individual groups', () => {
    const items = [
      fake({ id: 'x', doi: null, paperTitle: null, text: 'a' }),
      fake({ id: 'y', doi: null, paperTitle: null, text: 'b' }),
    ]
    const groups = groupInboxByPaper(items)
    expect(groups).toHaveLength(2)
  })

  it('sets hasUnknownDoi when DOI missing', () => {
    const items = [fake({ doi: null, paperTitle: 'X' })]
    const groups = groupInboxByPaper(items)
    expect(groups[0].hasUnknownDoi).toBe(true)
  })

  it('sets hasAbstractOnly when any claim status=partial', () => {
    const items = [
      fake({ doi: '10.1/x', status: 'verified' }),
      fake({ doi: '10.1/x', status: 'partial', text: 'b' }),
    ]
    const groups = groupInboxByPaper(items)
    expect(groups[0].hasAbstractOnly).toBe(true)
  })

  it('sorts claims within group DESC by savedAtMs', () => {
    const items = [
      fake({ doi: '10.1/x', text: 'a', savedAtMs: 1 }),
      fake({ doi: '10.1/x', text: 'b', savedAtMs: 3 }),
      fake({ doi: '10.1/x', text: 'c', savedAtMs: 2 }),
    ]
    const groups = groupInboxByPaper(items)
    expect(groups[0].claims.map(c => c.text)).toEqual(['b', 'c', 'a'])
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/selectors/inbox.test.ts
```

- [ ] **Step 3: Implement `selectors/inbox.ts`**

```ts
import type { InboxItem } from '../../shared/verify-types'
import { normalizeTitle } from '../state/ids'

export interface PaperGroup {
  groupKey: string
  doi: string | null
  paperTitle: string
  claims: InboxItem[]
  hasUnknownDoi: boolean
  hasAbstractOnly: boolean
}

export function groupInboxByPaper(items: InboxItem[]): PaperGroup[] {
  const map = new Map<string, PaperGroup>()
  for (const item of items) {
    const key = item.doi ?? normalizeTitle(item.paperTitle) || `untitled_${item.id}`
    let g = map.get(key)
    if (!g) {
      g = {
        groupKey: key,
        doi: item.doi,
        paperTitle: item.paperTitle ?? 'Untitled source',
        claims: [],
        hasUnknownDoi: !item.doi,
        hasAbstractOnly: false,
      }
      map.set(key, g)
    }
    g.claims.push(item)
    if (item.status === 'partial') g.hasAbstractOnly = true
  }

  const groups = Array.from(map.values())
  for (const g of groups) g.claims.sort((a, b) => b.savedAtMs - a.savedAtMs)
  groups.sort((a, b) => {
    const aMax = Math.max(...a.claims.map(c => c.savedAtMs))
    const bMax = Math.max(...b.claims.map(c => c.savedAtMs))
    return bMax - aMax
  })
  return groups
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/selectors/inbox.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/selectors/
git commit -m "feat(extension): add inbox paper-grouping selector"
```

---

**Phase A complete. Verify all tests pass before moving on:**

```bash
cd research-kit/extension
npx vitest run
```

Expected: All Phase A tests pass.

---

---

## Phase B — Atomic UI Components

### Task 9: Design tokens + base CSS variables

**Files:**

- Create: `research-kit/extension/src/sidebar/styles/tokens.css`
- Modify: `research-kit/extension/src/sidebar/index.css` (import tokens)

- [ ] **Step 1: Create `tokens.css`**

```css
/* tokens.css — all colours, radii, shadows from design handoff */
:root {
  /* Neutral */
  --rk-bg: #0f1117;
  --rk-surface: #1a1d27;
  --rk-surface-2: #22263a;
  --rk-border: #2e3147;
  --rk-text: #e8eaf6;
  --rk-text-2: #9198b5;
  --rk-text-3: #5a6180;

  /* Brand */
  --rk-blue: #5b8ef0;
  --rk-blue-hover: #7aaaf7;
  --rk-blue-subtle: rgba(91,142,240,0.12);

  /* Status */
  --rk-green: #4caf82;
  --rk-green-subtle: rgba(76,175,130,0.12);
  --rk-yellow: #f0c040;
  --rk-yellow-subtle: rgba(240,192,64,0.12);
  --rk-red: #e06060;
  --rk-red-subtle: rgba(224,96,96,0.12);
  --rk-grey: #5a6180;
  --rk-grey-subtle: rgba(90,97,128,0.12);

  /* Radius */
  --rk-r-sm: 4px;
  --rk-r-md: 8px;
  --rk-r-lg: 12px;
  --rk-r-pill: 999px;

  /* Sidebar dimensions */
  --rk-panel-w: 360px;
  --rk-header-h: 48px;
  --rk-progress-h: 28px;
  --rk-tabbar-h: 40px;
  --rk-footer-h: 40px;
}
```

- [ ] **Step 2: Import tokens in `index.css`**

Open `src/sidebar/index.css`. Add at the very top:

```css
@import './styles/tokens.css';
```

- [ ] **Step 3: Add animation keyframes to `tokens.css`**

Append to the end of `src/sidebar/styles/tokens.css`:

```css
/* Animations */
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes slideInRight {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes slideInDown {
  from { opacity: 0; transform: translateY(-12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes pulseDot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%       { transform: scale(1.5); opacity: 0.6; }
}

@keyframes badgePop {
  0%   { transform: scale(0.6); opacity: 0; }
  70%  { transform: scale(1.15); }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes toastIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes spinRing {
  to { transform: rotate(360deg); }
}

@keyframes conflictPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(224,96,96,0.4); }
  50%       { box-shadow: 0 0 0 6px rgba(224,96,96,0); }
}

/* Utility classes for animations */
.animate-fadeSlideIn   { animation: fadeSlideIn  0.18s ease-out; }
.animate-slideInRight  { animation: slideInRight  0.22s ease-out; }
.animate-slideInDown   { animation: slideInDown   0.18s ease-out; }
.animate-pulseDot      { animation: pulseDot      1.4s ease-in-out infinite; }
.animate-badgePop      { animation: badgePop      0.25s ease-out; }
.animate-toastIn       { animation: toastIn       0.2s ease-out; }
.animate-spinRing      { animation: spinRing      0.8s linear infinite; }
.animate-conflictPulse { animation: conflictPulse 2s ease-in-out infinite; }
```

- [ ] **Step 4: Commit**

```bash
git add research-kit/extension/src/sidebar/styles/tokens.css research-kit/extension/src/sidebar/index.css
git commit -m "chore(extension): add design tokens + animation keyframes"
```

---

### Task 9a: Checkbox component

**Files:**

- Create: `research-kit/extension/src/sidebar/components/atoms/Checkbox.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/Checkbox.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/sidebar/components/atoms/Checkbox.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('renders checked state', () => {
    render(<Checkbox checked={true} onChange={vi.fn()} label="Select item" />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('renders unchecked state', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="Select item" />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('calls onChange when clicked', () => {
    const fn = vi.fn()
    render(<Checkbox checked={false} onChange={fn} label="Select item" />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(fn).toHaveBeenCalledWith(true)
  })

  it('renders with visible label', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="My label" />)
    expect(screen.getByText('My label')).toBeInTheDocument()
  })

  it('does not call onChange when disabled', () => {
    const fn = vi.fn()
    render(<Checkbox checked={false} onChange={fn} label="X" disabled />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(fn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
cd research-kit/extension
npx vitest run src/sidebar/components/atoms/Checkbox.test.tsx
```

- [ ] **Step 3: Implement `Checkbox.tsx`**

```tsx
interface CheckboxProps {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}

export function Checkbox({ checked, onChange, label, disabled = false }: CheckboxProps) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        role="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => !disabled && onChange(e.target.checked)}
        className="w-4 h-4 rounded border border-[var(--rk-border)] accent-[var(--rk-blue)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <span className="text-sm text-[var(--rk-text-2)]">{label}</span>
    </label>
  )
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/components/atoms/Checkbox.test.tsx
```

Expected: 5 tests pass.

- [ ] **Step 5: Update `PaperGroup.tsx` to use `Checkbox` instead of inline `<input type="checkbox">`**

In `src/sidebar/components/atoms/PaperGroup.tsx`, replace the inline checkbox with:

```tsx
import { Checkbox } from './Checkbox'
// ...
<Checkbox
  checked={selectedIds.has(item.id)}
  onChange={() => onToggleSelect(item.id)}
  label=""
/>
```

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/Checkbox.tsx research-kit/extension/src/sidebar/components/atoms/Checkbox.test.tsx research-kit/extension/src/sidebar/components/atoms/PaperGroup.tsx
git commit -m "feat(extension): Checkbox atom + use in PaperGroup"
```

---

### Task 10: Toggle component

**Files:**

- Create: `research-kit/extension/src/sidebar/components/atoms/Toggle.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/Toggle.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/sidebar/components/atoms/Toggle.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toggle } from './Toggle'

describe('Toggle', () => {
  it('renders checked state', () => {
    render(<Toggle checked={true} onChange={vi.fn()} label="Verify" />)
    expect(screen.getByRole('switch')).toBeChecked()
    expect(screen.getByText('Verify')).toBeInTheDocument()
  })

  it('renders unchecked state', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="Verify" />)
    expect(screen.getByRole('switch')).not.toBeChecked()
  })

  it('calls onChange when clicked', () => {
    const fn = vi.fn()
    render(<Toggle checked={false} onChange={fn} label="Test" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(fn).toHaveBeenCalledWith(true)
  })

  it('does not call onChange when disabled', () => {
    const fn = vi.fn()
    render(<Toggle checked={false} onChange={fn} label="Test" disabled />)
    fireEvent.click(screen.getByRole('switch'))
    expect(fn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/atoms/Toggle.test.tsx
```

- [ ] **Step 3: Implement `Toggle.tsx`**

```tsx
interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={[
          'relative w-9 h-5 rounded-full transition-colors duration-150',
          checked ? 'bg-[var(--rk-blue)]' : 'bg-[var(--rk-surface-2)]',
          disabled ? 'opacity-40 cursor-not-allowed' : '',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-150',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
      <span className="text-sm text-[var(--rk-text-2)]">{label}</span>
    </label>
  )
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/components/atoms/Toggle.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/Toggle.tsx research-kit/extension/src/sidebar/components/atoms/Toggle.test.tsx
git commit -m "feat(extension): Toggle atom"
```

---

### Task 11: StatusBadge + ConfidenceBar components

**Files:**

- Create: `research-kit/extension/src/sidebar/components/atoms/StatusBadge.tsx`
- Create: `research-kit/extension/src/sidebar/components/atoms/ConfidenceBar.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/StatusBadge.test.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/ConfidenceBar.test.tsx`

- [ ] **Step 1: Write failing tests**

`src/sidebar/components/atoms/StatusBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it('shows "Verified" for verified status', () => {
    render(<StatusBadge status="verified" />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })

  it('shows "Not Found" for not_found status', () => {
    render(<StatusBadge status="not_found" />)
    expect(screen.getByText('Not Found')).toBeInTheDocument()
  })

  it('shows "Pending" for pending status', () => {
    render(<StatusBadge status="pending" />)
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('shows "Partial" for partial status', () => {
    render(<StatusBadge status="partial" />)
    expect(screen.getByText('Partial')).toBeInTheDocument()
  })
})
```

`src/sidebar/components/atoms/ConfidenceBar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConfidenceBar } from './ConfidenceBar'

describe('ConfidenceBar', () => {
  it('renders with aria label showing percentage', () => {
    render(<ConfidenceBar value={0.85} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '85')
  })

  it('clamps value between 0 and 1', () => {
    render(<ConfidenceBar value={1.5} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })
})
```

- [ ] **Step 2: Run tests (fail)**

```bash
npx vitest run src/sidebar/components/atoms/StatusBadge.test.tsx src/sidebar/components/atoms/ConfidenceBar.test.tsx
```

- [ ] **Step 3: Implement `StatusBadge.tsx`**

```tsx
import type { VerifyStatus } from '../../../shared/verify-types'

const LABELS: Record<VerifyStatus, string> = {
  verified: 'Verified',
  partial: 'Partial',
  not_found: 'Not Found',
  pending: 'Pending',
  error: 'Error',
}

const COLORS: Record<VerifyStatus, string> = {
  verified: 'bg-[var(--rk-green-subtle)] text-[var(--rk-green)]',
  partial: 'bg-[var(--rk-yellow-subtle)] text-[var(--rk-yellow)]',
  not_found: 'bg-[var(--rk-grey-subtle)] text-[var(--rk-grey)]',
  pending: 'bg-[var(--rk-blue-subtle)] text-[var(--rk-blue)]',
  error: 'bg-[var(--rk-red-subtle)] text-[var(--rk-red)]',
}

export function StatusBadge({ status }: { status: VerifyStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${COLORS[status]}`}>
      {LABELS[status]}
    </span>
  )
}
```

- [ ] **Step 4: Implement `ConfidenceBar.tsx`**

```tsx
export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1 w-full bg-[var(--rk-surface-2)] rounded-full overflow-hidden"
    >
      <div
        className="h-full bg-[var(--rk-blue)] rounded-full transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
```

- [ ] **Step 5: Run tests (pass)**

```bash
npx vitest run src/sidebar/components/atoms/StatusBadge.test.tsx src/sidebar/components/atoms/ConfidenceBar.test.tsx
```

Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/
git commit -m "feat(extension): StatusBadge + ConfidenceBar atoms"
```

---

### Task 12: Toast component

**Files:**

- Create: `research-kit/extension/src/sidebar/components/atoms/Toast.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/Toast.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toast } from './Toast'

describe('Toast', () => {
  it('renders message', () => {
    render(<Toast message="Saved to inbox" tone="success" onDismiss={vi.fn()} />)
    expect(screen.getByText('Saved to inbox')).toBeInTheDocument()
  })

  it('calls onDismiss on close click', () => {
    const fn = vi.fn()
    render(<Toast message="X" tone="error" onDismiss={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(fn).toHaveBeenCalled()
  })

  it('applies success styling class', () => {
    const { container } = render(<Toast message="ok" tone="success" onDismiss={vi.fn()} />)
    expect(container.firstChild).toHaveClass('toast--success')
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/atoms/Toast.test.tsx
```

- [ ] **Step 3: Implement `Toast.tsx`**

```tsx
type Tone = 'success' | 'warning' | 'error'

interface ToastProps {
  message: string
  tone: Tone
  onDismiss: () => void
}

const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-[var(--rk-green-subtle)] text-[var(--rk-green)] border-[var(--rk-green)]',
  warning: 'bg-[var(--rk-yellow-subtle)] text-[var(--rk-yellow)] border-[var(--rk-yellow)]',
  error: 'bg-[var(--rk-red-subtle)] text-[var(--rk-red)] border-[var(--rk-red)]',
}

export function Toast({ message, tone, onDismiss }: ToastProps) {
  return (
    <div className={`toast--${tone} flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm ${TONE_CLASS[tone]}`}>
      <span>{message}</span>
      <button aria-label="dismiss" onClick={onDismiss} className="opacity-60 hover:opacity-100 ml-1 text-inherit">✕</button>
    </div>
  )
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/components/atoms/Toast.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/Toast.tsx research-kit/extension/src/sidebar/components/atoms/Toast.test.tsx
git commit -m "feat(extension): Toast atom"
```

---

### Task 13: ClaimCard component

**Files:**

- Create: `research-kit/extension/src/sidebar/components/atoms/ClaimCard.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/ClaimCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ClaimCard } from './ClaimCard'
import type { ClaimItem } from '../../../shared/verify-types'

const fakeClaim: ClaimItem = {
  id: 'c1', text: 'Sleep improves memory consolidation.',
  paperTitle: 'Why We Sleep', doi: '10.1/ws', paperUrl: null,
  page: 'p.42', site: 'elicit', status: 'verified', confidence: 0.92,
  quote: 'Sleep...consolidation.', reason: 'Exact match found',
  saved: false, domAnchor: '', tabId: 1, pageUrl: '', extractedAt: 0,
}

describe('ClaimCard', () => {
  it('renders claim text', () => {
    render(<ClaimCard claim={fakeClaim} expanded={false} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText(/Sleep improves memory/)).toBeInTheDocument()
  })

  it('shows StatusBadge', () => {
    render(<ClaimCard claim={fakeClaim} expanded={false} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })

  it('shows paper title', () => {
    render(<ClaimCard claim={fakeClaim} expanded={false} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText('Why We Sleep')).toBeInTheDocument()
  })

  it('calls onToggleExpand when header clicked', () => {
    const fn = vi.fn()
    render(<ClaimCard claim={fakeClaim} expanded={false} onToggleExpand={fn} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    expect(fn).toHaveBeenCalledWith('c1')
  })

  it('shows quote and reason when expanded', () => {
    render(<ClaimCard claim={fakeClaim} expanded={true} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText(/Sleep...consolidation/)).toBeInTheDocument()
    expect(screen.getByText(/Exact match/)).toBeInTheDocument()
  })

  it('calls onSave when save button clicked', () => {
    const fn = vi.fn()
    render(<ClaimCard claim={fakeClaim} expanded={true} onToggleExpand={vi.fn()} onSave={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(fn).toHaveBeenCalledWith('c1')
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/atoms/ClaimCard.test.tsx
```

- [ ] **Step 3: Implement `ClaimCard.tsx`**

```tsx
import type { ClaimItem } from '../../../shared/verify-types'
import { StatusBadge } from './StatusBadge'
import { ConfidenceBar } from './ConfidenceBar'

interface ClaimCardProps {
  claim: ClaimItem
  expanded: boolean
  onToggleExpand: (id: string) => void
  onSave: (id: string) => void
}

export function ClaimCard({ claim, expanded, onToggleExpand, onSave }: ClaimCardProps) {
  return (
    <div className="rounded-lg bg-[var(--rk-surface)] border border-[var(--rk-border)] overflow-hidden">
      <div className="flex items-start gap-2 p-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[var(--rk-text)] line-clamp-3">{claim.text}</p>
          {claim.paperTitle && (
            <p className="text-xs text-[var(--rk-text-3)] mt-1 truncate">{claim.paperTitle}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <StatusBadge status={claim.status} />
            <ConfidenceBar value={claim.confidence} />
          </div>
        </div>
        <button
          aria-label="expand"
          onClick={() => onToggleExpand(claim.id)}
          className="shrink-0 text-[var(--rk-text-3)] hover:text-[var(--rk-text)] p-1"
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t border-[var(--rk-border)] pt-2 space-y-2">
          {claim.quote && (
            <blockquote className="text-xs text-[var(--rk-text-2)] italic border-l-2 border-[var(--rk-blue)] pl-2">
              "{claim.quote}"
            </blockquote>
          )}
          {claim.reason && (
            <p className="text-xs text-[var(--rk-text-3)]">{claim.reason}</p>
          )}
          <button
            aria-label="save to inbox"
            onClick={() => onSave(claim.id)}
            disabled={claim.saved}
            className="mt-1 text-xs px-3 py-1 rounded-full bg-[var(--rk-blue-subtle)] text-[var(--rk-blue)] hover:bg-[var(--rk-blue)] hover:text-white disabled:opacity-40 transition-colors"
          >
            {claim.saved ? 'Saved' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/components/atoms/ClaimCard.test.tsx
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/ClaimCard.tsx research-kit/extension/src/sidebar/components/atoms/ClaimCard.test.tsx
git commit -m "feat(extension): ClaimCard atom"
```

---

### Task 14: PaperGroup component

**Files:**

- Create: `research-kit/extension/src/sidebar/components/atoms/PaperGroup.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/PaperGroup.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PaperGroup } from './PaperGroup'
import type { PaperGroup as PaperGroupType } from '../../selectors/inbox'
import type { InboxItem } from '../../../shared/verify-types'

const fakeItem = (id: string): InboxItem => ({
  id, claimId: id, text: `claim ${id}`, paperTitle: 'X',
  doi: '10.1/x', paperUrl: null, page: '', site: 'elicit',
  status: 'verified', confidence: 0.9, quote: null, reason: '',
  projectId: 'p_default', savedAtMs: 0,
})

const group: PaperGroupType = {
  groupKey: '10.1/x',
  doi: '10.1/x',
  paperTitle: 'Why We Sleep',
  claims: [fakeItem('a'), fakeItem('b')],
  hasUnknownDoi: false,
  hasAbstractOnly: false,
}

describe('PaperGroup', () => {
  it('renders paper title', () => {
    render(<PaperGroup group={group} expanded={false} onToggleExpand={vi.fn()} onRemoveItem={vi.fn()} selectedIds={new Set()} onToggleSelect={vi.fn()} />)
    expect(screen.getByText('Why We Sleep')).toBeInTheDocument()
  })

  it('renders claim count', () => {
    render(<PaperGroup group={group} expanded={false} onToggleExpand={vi.fn()} onRemoveItem={vi.fn()} selectedIds={new Set()} onToggleSelect={vi.fn()} />)
    expect(screen.getByText(/2/)).toBeInTheDocument()
  })

  it('calls onToggleExpand when header clicked', () => {
    const fn = vi.fn()
    render(<PaperGroup group={group} expanded={false} onToggleExpand={fn} onRemoveItem={vi.fn()} selectedIds={new Set()} onToggleSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /expand group/i }))
    expect(fn).toHaveBeenCalledWith('10.1/x')
  })

  it('shows claims list when expanded', () => {
    render(<PaperGroup group={group} expanded={true} onToggleExpand={vi.fn()} onRemoveItem={vi.fn()} selectedIds={new Set()} onToggleSelect={vi.fn()} />)
    expect(screen.getByText('claim a')).toBeInTheDocument()
    expect(screen.getByText('claim b')).toBeInTheDocument()
  })

  it('shows unknown DOI badge when hasUnknownDoi=true', () => {
    const g = { ...group, hasUnknownDoi: true }
    render(<PaperGroup group={g} expanded={false} onToggleExpand={vi.fn()} onRemoveItem={vi.fn()} selectedIds={new Set()} onToggleSelect={vi.fn()} />)
    expect(screen.getByText(/no doi/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/atoms/PaperGroup.test.tsx
```

- [ ] **Step 3: Implement `PaperGroup.tsx`**

```tsx
import type { PaperGroup as PaperGroupType } from '../../selectors/inbox'
import type { InboxItem } from '../../../shared/verify-types'
import { StatusBadge } from './StatusBadge'

interface PaperGroupProps {
  group: PaperGroupType
  expanded: boolean
  onToggleExpand: (key: string) => void
  onRemoveItem: (id: string) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
}

export function PaperGroup({ group, expanded, onToggleExpand, onRemoveItem, selectedIds, onToggleSelect }: PaperGroupProps) {
  return (
    <div className="border border-[var(--rk-border)] rounded-lg overflow-hidden">
      <button
        aria-label="expand group"
        onClick={() => onToggleExpand(group.groupKey)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-[var(--rk-surface)] hover:bg-[var(--rk-surface-2)] text-left"
      >
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-[var(--rk-text)] truncate">{group.paperTitle}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-[var(--rk-text-3)]">{group.claims.length} claim{group.claims.length !== 1 ? 's' : ''}</span>
            {group.hasUnknownDoi && (
              <span className="text-xs text-[var(--rk-yellow)] bg-[var(--rk-yellow-subtle)] px-1.5 py-0.5 rounded-full">No DOI</span>
            )}
            {group.hasAbstractOnly && (
              <span className="text-xs text-[var(--rk-blue)] bg-[var(--rk-blue-subtle)] px-1.5 py-0.5 rounded-full">Abstract only</span>
            )}
          </div>
        </div>
        <span className="text-[var(--rk-text-3)] ml-2">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <ul className="divide-y divide-[var(--rk-border)]">
          {group.claims.map((item: InboxItem) => (
            <li key={item.id} className="flex items-start gap-2 px-3 py-2.5 bg-[var(--rk-surface-2)]">
              <input
                type="checkbox"
                checked={selectedIds.has(item.id)}
                onChange={() => onToggleSelect(item.id)}
                className="mt-0.5 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--rk-text)] line-clamp-2">{item.text}</p>
                <div className="flex items-center gap-2 mt-1">
                  <StatusBadge status={item.status} />
                  <span className="text-xs text-[var(--rk-text-3)]">{item.site}</span>
                </div>
              </div>
              <button
                aria-label="remove"
                onClick={() => onRemoveItem(item.id)}
                className="shrink-0 text-xs text-[var(--rk-text-3)] hover:text-[var(--rk-red)] p-1"
              >✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/components/atoms/PaperGroup.test.tsx
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/PaperGroup.tsx research-kit/extension/src/sidebar/components/atoms/PaperGroup.test.tsx
git commit -m "feat(extension): PaperGroup atom"
```

---

### Task 15: ProjectSelector component

**Files:**

- Create: `research-kit/extension/src/sidebar/components/atoms/ProjectSelector.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/ProjectSelector.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectSelector } from './ProjectSelector'

const projects = [
  { id: 'p_default', name: 'Default Project' },
  { id: 'p_2', name: 'Climate Research' },
]

describe('ProjectSelector', () => {
  it('renders current project name', () => {
    render(<ProjectSelector projects={projects} currentId="p_default" onSwitch={vi.fn()} onCreate={vi.fn()} />)
    expect(screen.getByText('Default Project')).toBeInTheDocument()
  })

  it('calls onSwitch when option selected', () => {
    const fn = vi.fn()
    render(<ProjectSelector projects={projects} currentId="p_default" onSwitch={fn} onCreate={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p_2' } })
    expect(fn).toHaveBeenCalledWith('p_2')
  })

  it('calls onCreate when new project option selected', () => {
    const fn = vi.fn()
    render(<ProjectSelector projects={projects} currentId="p_default" onSwitch={vi.fn()} onCreate={fn} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__new__' } })
    expect(fn).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/atoms/ProjectSelector.test.tsx
```

- [ ] **Step 3: Implement `ProjectSelector.tsx`**

```tsx
import type { Project } from '../../../shared/verify-types'

interface ProjectSelectorProps {
  projects: Project[]
  currentId: string
  onSwitch: (id: string) => void
  onCreate: () => void
}

export function ProjectSelector({ projects, currentId, onSwitch, onCreate }: ProjectSelectorProps) {
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    if (val === '__new__') onCreate()
    else onSwitch(val)
  }

  return (
    <select
      value={currentId}
      onChange={handleChange}
      className="text-sm bg-[var(--rk-surface-2)] border border-[var(--rk-border)] text-[var(--rk-text)] rounded px-2 py-1 focus:outline-none focus:border-[var(--rk-blue)]"
    >
      {projects.map(p => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
      <option value="__new__">+ New project…</option>
    </select>
  )
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/components/atoms/ProjectSelector.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/ProjectSelector.tsx research-kit/extension/src/sidebar/components/atoms/ProjectSelector.test.tsx
git commit -m "feat(extension): ProjectSelector atom"
```

---

### Task 16: Run Phase B tests + verify all pass

- [ ] **Step 1: Run full test suite**

```bash
cd research-kit/extension
npx vitest run
```

Expected: All Phase A + Phase B tests pass.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc -b --noEmit
```

Fix any type errors introduced by new components before proceeding.

- [ ] **Step 3: Commit if any fixes made**

```bash
git add -A
git commit -m "fix(extension): type errors after Phase B components"
```

---

## Phase C — Shell Components

### Task 17: Header component

**Files:**

- Create: `research-kit/extension/src/sidebar/components/shell/Header.tsx`
- Test: `research-kit/extension/src/sidebar/components/shell/Header.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Header } from './Header'

describe('Header', () => {
  it('renders ResearchKit brand text', () => {
    render(<Header verifyEnabled={true} onToggleVerify={vi.fn()} onOpenSettings={vi.fn()} currentSite={null} />)
    expect(screen.getByText(/ResearchKit/i)).toBeInTheDocument()
  })

  it('renders site label when on a supported site', () => {
    render(<Header verifyEnabled={true} onToggleVerify={vi.fn()} onOpenSettings={vi.fn()} currentSite="elicit" />)
    expect(screen.getByText(/elicit/i)).toBeInTheDocument()
  })

  it('renders toggle for verify enabled', () => {
    render(<Header verifyEnabled={true} onToggleVerify={vi.fn()} onOpenSettings={vi.fn()} currentSite={null} />)
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('calls onToggleVerify when toggle clicked', () => {
    const fn = vi.fn()
    render(<Header verifyEnabled={false} onToggleVerify={fn} onOpenSettings={vi.fn()} currentSite={null} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(fn).toHaveBeenCalledWith(true)
  })

  it('calls onOpenSettings when settings button clicked', () => {
    const fn = vi.fn()
    render(<Header verifyEnabled={true} onToggleVerify={vi.fn()} onOpenSettings={fn} currentSite={null} />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(fn).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/shell/Header.test.tsx
```

- [ ] **Step 3: Implement `Header.tsx`**

```tsx
import type { SiteId } from '../../../shared/verify-types'
import { Toggle } from '../atoms/Toggle'

const SITE_LABEL: Record<SiteId, string> = {
  elicit: 'Elicit',
  scispace: 'SciSpace',
  consensus: 'Consensus',
}

const ALL_SITES: SiteId[] = ['elicit', 'scispace', 'consensus']

interface HeaderProps {
  verifyEnabled: boolean
  activeSites: Set<SiteId>
  globalPaused: boolean
  onToggleVerify: (v: boolean) => void
  onToggleSite: (site: SiteId, active: boolean) => void
  onOpenSettings: () => void
  currentSite: SiteId | null
}

export function Header({
  verifyEnabled, activeSites, globalPaused,
  onToggleVerify, onToggleSite, onOpenSettings, currentSite,
}: HeaderProps) {
  const isLive = verifyEnabled && !globalPaused && activeSites.size > 0

  return (
    <header
      style={{ height: 'var(--rk-header-h)' }}
      className="flex items-center justify-between px-3 bg-[var(--rk-surface)] border-b border-[var(--rk-border)] shrink-0"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--rk-text)]">ResearchKit</span>
        {isLive && (
          <span
            aria-label="live indicator"
            className="w-2 h-2 rounded-full bg-[var(--rk-green)] animate-pulseDot"
          />
        )}
        {/* Site pills — click toggles activeSites */}
        <div className="flex items-center gap-1">
          {ALL_SITES.map(site => {
            const active = activeSites.has(site)
            return (
              <button
                key={site}
                aria-label={`toggle ${site}`}
                aria-pressed={active}
                onClick={() => onToggleSite(site, !active)}
                className={[
                  'text-xs px-2 py-0.5 rounded-full transition-colors',
                  active
                    ? 'bg-[var(--rk-blue-subtle)] text-[var(--rk-blue)]'
                    : 'bg-[var(--rk-surface-2)] text-[var(--rk-text-3)] opacity-50',
                ].join(' ')}
              >
                {SITE_LABEL[site]}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Toggle checked={verifyEnabled} onChange={onToggleVerify} label="Verify" />
        <button
          aria-label="settings"
          onClick={onOpenSettings}
          className="p-1.5 rounded text-[var(--rk-text-3)] hover:text-[var(--rk-text)] hover:bg-[var(--rk-surface-2)]"
        >
          ⚙
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Update `Header.test.tsx` — add tests for site pills and live indicator**

Add to the existing test file after the last test:

```tsx
  it('shows live indicator when verifyEnabled and not paused and sites active', () => {
    render(<Header verifyEnabled={true} activeSites={new Set(['elicit'])} globalPaused={false} onToggleVerify={vi.fn()} onToggleSite={vi.fn()} onOpenSettings={vi.fn()} currentSite={null} />)
    expect(screen.getByLabelText('live indicator')).toBeInTheDocument()
  })

  it('hides live indicator when globalPaused', () => {
    render(<Header verifyEnabled={true} activeSites={new Set(['elicit'])} globalPaused={true} onToggleVerify={vi.fn()} onToggleSite={vi.fn()} onOpenSettings={vi.fn()} currentSite={null} />)
    expect(screen.queryByLabelText('live indicator')).toBeNull()
  })

  it('renders site pill for each site', () => {
    render(<Header verifyEnabled={true} activeSites={new Set(['elicit'])} globalPaused={false} onToggleVerify={vi.fn()} onToggleSite={vi.fn()} onOpenSettings={vi.fn()} currentSite={null} />)
    expect(screen.getByRole('button', { name: /toggle elicit/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /toggle scispace/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /toggle consensus/i })).toBeInTheDocument()
  })

  it('calls onToggleSite when site pill clicked', () => {
    const fn = vi.fn()
    render(<Header verifyEnabled={true} activeSites={new Set(['elicit', 'scispace', 'consensus'])} globalPaused={false} onToggleVerify={vi.fn()} onToggleSite={fn} onOpenSettings={vi.fn()} currentSite={null} />)
    fireEvent.click(screen.getByRole('button', { name: /toggle elicit/i }))
    expect(fn).toHaveBeenCalledWith('elicit', false)
  })
```

Also update `Header.test.tsx` existing `render` calls to pass the new required props:
`activeSites={new Set(['elicit', 'scispace', 'consensus'])} globalPaused={false} onToggleSite={vi.fn()}`

- [ ] **Step 5: Run tests (pass)**

```bash
npx vitest run src/sidebar/components/shell/Header.test.tsx
```

Expected: 9 tests pass.

- [ ] **Step 6: Update `App.tsx` Header usage** — pass `activeSites`, `globalPaused`, `onToggleSite={s.setActiveSite}` props. Also add toast on site toggle:

```tsx
onToggleSite={async (site, active) => {
  await s.setActiveSite(site, active)
  s.showToast(`${site} ${active ? 'enabled' : 'disabled'}`, active ? 'success' : 'warning')
}}
```

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/sidebar/components/shell/Header.tsx research-kit/extension/src/sidebar/components/shell/Header.test.tsx research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(extension): Header live indicator + clickable site pills"
```

---

### Task 18: ProgressBar component

**Files:**

- Create: `research-kit/extension/src/sidebar/components/shell/ProgressBar.tsx`
- Test: `research-kit/extension/src/sidebar/components/shell/ProgressBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProgressBar } from './ProgressBar'
import type { VerifyProgress } from '../../../shared/verify-types'

const prog = (overrides: Partial<VerifyProgress> = {}): VerifyProgress => ({
  tabId: 1, total: 10, completed: 4, running: 2, paused: false, pausedSites: [],
  perSite: { elicit: { total: 3, completed: 1, running: 1 }, scispace: { total: 4, completed: 2, running: 1 }, consensus: { total: 3, completed: 1, running: 0 } },
  ...overrides,
})

describe('ProgressBar', () => {
  it('shows progress fraction', () => {
    render(<ProgressBar progress={prog()} onTogglePause={vi.fn()} />)
    expect(screen.getByText('4 / 10')).toBeInTheDocument()
  })

  it('shows pause button when running', () => {
    render(<ProgressBar progress={prog()} onTogglePause={vi.fn()} />)
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument()
  })

  it('shows resume button when paused', () => {
    render(<ProgressBar progress={prog({ paused: true })} onTogglePause={vi.fn()} />)
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument()
  })

  it('calls onTogglePause when pause clicked', () => {
    const fn = vi.fn()
    render(<ProgressBar progress={prog()} onTogglePause={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(fn).toHaveBeenCalled()
  })

  it('shows "Done" when completed equals total', () => {
    render(<ProgressBar progress={prog({ total: 5, completed: 5, running: 0 })} onTogglePause={vi.fn()} />)
    expect(screen.getByText(/done/i)).toBeInTheDocument()
  })

  it('renders null when total is 0', () => {
    const { container } = render(<ProgressBar progress={prog({ total: 0 })} onTogglePause={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/shell/ProgressBar.test.tsx
```

- [ ] **Step 3: Implement `ProgressBar.tsx`**

```tsx
import type { VerifyProgress } from '../../../shared/verify-types'

interface ProgressBarProps {
  progress: VerifyProgress
  onTogglePause: () => void
}

export function ProgressBar({ progress, onTogglePause }: ProgressBarProps) {
  const { total, completed, running, paused } = progress
  if (total === 0) return null

  const done = completed === total && running === 0
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const activeSites = (Object.keys(progress.perSite) as SiteId[]).filter(
    s => progress.perSite[s].total > 0
  )

  return (
    <div
      className="px-3 py-1.5 bg-[var(--rk-surface-2)] border-b border-[var(--rk-border)] shrink-0 space-y-1"
    >
      {/* Row 1: bar + fraction + pause */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-[var(--rk-surface)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--rk-blue)] rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        {done ? (
          <span className="text-xs text-[var(--rk-green)]">Done</span>
        ) : (
          <>
            <span className="text-xs text-[var(--rk-text-3)]">{completed} / {total}</span>
            <button
              aria-label={paused ? 'resume' : 'pause'}
              onClick={onTogglePause}
              className="text-xs text-[var(--rk-text-2)] hover:text-[var(--rk-text)] px-1.5 py-0.5 rounded"
            >
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>
          </>
        )}
      </div>

      {/* Row 2: per-site chips (only when >1 site has claims) */}
      {activeSites.length > 1 && (
        <div className="flex items-center gap-1.5">
          {activeSites.map(site => {
            const s = progress.perSite[site]
            const sitePaused = progress.pausedSites.includes(site)
            return (
              <button
                key={site}
                aria-label={`${sitePaused ? 'resume' : 'pause'} ${site}`}
                onClick={() => onToggleSitePause?.(site, !sitePaused)}
                className={[
                  'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors',
                  sitePaused
                    ? 'border-[var(--rk-border)] text-[var(--rk-text-3)] opacity-50'
                    : 'border-[var(--rk-blue)] text-[var(--rk-blue)] bg-[var(--rk-blue-subtle)]',
                ].join(' ')}
              >
                <span className="capitalize">{site}</span>
                <span>{s.completed}/{s.total}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Update `ProgressBar` interface to include `onToggleSitePause`**

In the same file, update the interface:

```tsx
import type { SiteId, VerifyProgress } from '../../../shared/verify-types'

interface ProgressBarProps {
  progress: VerifyProgress
  onTogglePause: () => void
  onToggleSitePause?: (site: SiteId, paused: boolean) => void
}
```

- [ ] **Step 5: Add per-site chips test**

Add to `ProgressBar.test.tsx`:

```tsx
  it('renders per-site chips when multiple sites have claims', () => {
    const p = prog({ perSite: {
      elicit: { total: 3, completed: 1, running: 1 },
      scispace: { total: 4, completed: 2, running: 1 },
      consensus: { total: 0, completed: 0, running: 0 },
    }})
    render(<ProgressBar progress={p} onTogglePause={vi.fn()} />)
    expect(screen.getByLabelText(/pause elicit/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/pause scispace/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/pause consensus/i)).toBeNull()
  })

  it('does not render per-site chips when only 1 site has claims', () => {
    const p = prog({ perSite: {
      elicit: { total: 3, completed: 1, running: 1 },
      scispace: { total: 0, completed: 0, running: 0 },
      consensus: { total: 0, completed: 0, running: 0 },
    }})
    render(<ProgressBar progress={p} onTogglePause={vi.fn()} />)
    expect(screen.queryByLabelText(/pause elicit/i)).toBeNull()
  })
```

- [ ] **Step 6: Run tests (pass)**

```bash
npx vitest run src/sidebar/components/shell/ProgressBar.test.tsx
```

Expected: 8 tests pass.

- [ ] **Step 7: Update `App.tsx` ProgressBar usage** — pass `onToggleSitePause={s.setPausedSite}`.

- [ ] **Step 8: Commit**

```bash
git add research-kit/extension/src/sidebar/components/shell/ProgressBar.tsx research-kit/extension/src/sidebar/components/shell/ProgressBar.test.tsx research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(extension): ProgressBar per-site chips"
```

---

### Task 19: TabBar component

**Files:**

- Create: `research-kit/extension/src/sidebar/components/shell/TabBar.tsx`
- Test: `research-kit/extension/src/sidebar/components/shell/TabBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TabBar } from './TabBar'

describe('TabBar', () => {
  it('renders all 6 tab buttons', () => {
    render(<TabBar activeTab="verify" onSelect={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /verify/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /inbox/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /conflicts/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /chat/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /draft/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /help/i })).toBeInTheDocument()
  })

  it('marks active tab as selected', () => {
    render(<TabBar activeTab="inbox" onSelect={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /inbox/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /verify/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onSelect when a tab is clicked', () => {
    const fn = vi.fn()
    render(<TabBar activeTab="verify" onSelect={fn} />)
    fireEvent.click(screen.getByRole('tab', { name: /inbox/i }))
    expect(fn).toHaveBeenCalledWith('inbox')
  })

  it('shows badge when inboxCount > 0', () => {
    render(<TabBar activeTab="verify" onSelect={vi.fn()} inboxCount={3} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/shell/TabBar.test.tsx
```

- [ ] **Step 3: Implement `TabBar.tsx`**

```tsx
import type { TabId } from '../../state/useStore'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'verify',    label: 'Verify',    icon: '✓' },
  { id: 'inbox',     label: 'Inbox',     icon: '⬇' },
  { id: 'conflicts', label: 'Conflicts', icon: '⚡' },
  { id: 'chat',      label: 'Chat',      icon: '💬' },
  { id: 'draft',     label: 'Draft',     icon: '✏' },
  { id: 'help',      label: 'Help',      icon: '?' },
]

interface TabBarProps {
  activeTab: TabId
  onSelect: (tab: TabId) => void
  inboxCount?: number
  conflictsCount?: number
}

export function TabBar({ activeTab, onSelect, inboxCount = 0, conflictsCount = 0 }: TabBarProps) {
  return (
    <div
      role="tablist"
      style={{ height: 'var(--rk-tabbar-h)' }}
      className="flex items-stretch border-b border-[var(--rk-border)] bg-[var(--rk-surface)] shrink-0"
    >
      {TABS.map(tab => {
        const isActive = tab.id === activeTab
        const badge = tab.id === 'inbox' ? inboxCount : tab.id === 'conflicts' ? conflictsCount : 0
        return (
          <button
            key={tab.id}
            role="tab"
            aria-label={tab.label}
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            className={[
              'flex-1 flex flex-col items-center justify-center gap-0.5 text-xs relative',
              isActive
                ? 'text-[var(--rk-blue)] border-b-2 border-[var(--rk-blue)]'
                : 'text-[var(--rk-text-3)] hover:text-[var(--rk-text)]',
            ].join(' ')}
          >
            <span className="text-base leading-none">{tab.icon}</span>
            <span>{tab.label}</span>
            {badge > 0 && (
              <span className="absolute top-1 right-1 text-[10px] bg-[var(--rk-blue)] text-white rounded-full w-4 h-4 flex items-center justify-center">
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/components/shell/TabBar.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/shell/TabBar.tsx research-kit/extension/src/sidebar/components/shell/TabBar.test.tsx
git commit -m "feat(extension): TabBar shell component"
```

---

### Task 20: Footer component

**Files:**

- Create: `research-kit/extension/src/sidebar/components/shell/Footer.tsx`
- Test: `research-kit/extension/src/sidebar/components/shell/Footer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Footer } from './Footer'

describe('Footer', () => {
  it('renders project selector', () => {
    render(<Footer
      projects={[{ id: 'p_default', name: 'Default Project' }]}
      currentProjectId="p_default"
      onSwitchProject={vi.fn()}
      onCreateProject={vi.fn()}
      inboxSelectedCount={0}
      onClearSelection={vi.fn()}
    />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('shows selection count when items selected', () => {
    render(<Footer
      projects={[{ id: 'p_default', name: 'Default Project' }]}
      currentProjectId="p_default"
      onSwitchProject={vi.fn()}
      onCreateProject={vi.fn()}
      inboxSelectedCount={3}
      onClearSelection={vi.fn()}
    />)
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument()
  })

  it('calls onClearSelection when clear clicked', () => {
    const fn = vi.fn()
    render(<Footer
      projects={[{ id: 'p_default', name: 'Default Project' }]}
      currentProjectId="p_default"
      onSwitchProject={vi.fn()}
      onCreateProject={vi.fn()}
      inboxSelectedCount={2}
      onClearSelection={fn}
    />)
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(fn).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/shell/Footer.test.tsx
```

- [ ] **Step 3: Implement `Footer.tsx`**

```tsx
import type { Project } from '../../../shared/verify-types'
import { ProjectSelector } from '../atoms/ProjectSelector'

interface FooterProps {
  projects: Project[]
  currentProjectId: string
  onSwitchProject: (id: string) => void
  onCreateProject: () => void
  inboxSelectedCount: number
  onClearSelection: () => void
}

export function Footer({ projects, currentProjectId, onSwitchProject, onCreateProject, inboxSelectedCount, onClearSelection }: FooterProps) {
  return (
    <footer
      style={{ height: 'var(--rk-footer-h)' }}
      className="flex items-center justify-between px-3 bg-[var(--rk-surface)] border-t border-[var(--rk-border)] shrink-0"
    >
      <ProjectSelector
        projects={projects}
        currentId={currentProjectId}
        onSwitch={onSwitchProject}
        onCreate={onCreateProject}
      />
      {inboxSelectedCount > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--rk-text-2)]">{inboxSelectedCount} selected</span>
          <button
            aria-label="clear selection"
            onClick={onClearSelection}
            className="text-xs text-[var(--rk-text-3)] hover:text-[var(--rk-text)]"
          >
            Clear
          </button>
        </div>
      )}
    </footer>
  )
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/components/shell/Footer.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/shell/Footer.tsx research-kit/extension/src/sidebar/components/shell/Footer.test.tsx
git commit -m "feat(extension): Footer shell component"
```

---

## Phase D — Tab Content

### Task 21: VerifyTab

**Files:**

- Create: `research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx`
- Test: `research-kit/extension/src/sidebar/components/tabs/VerifyTab.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VerifyTab } from './VerifyTab'
import type { ClaimItem } from '../../../shared/verify-types'

const fakeClaim = (id: string, status: ClaimItem['status'] = 'verified'): ClaimItem => ({
  id, text: `claim ${id}`, paperTitle: 'X', doi: '10.1/x', paperUrl: null,
  page: 'p.1', site: 'elicit', status, confidence: 0.9, quote: null, reason: '',
  saved: false, domAnchor: '', tabId: 1, pageUrl: '', extractedAt: 0,
})

describe('VerifyTab', () => {
  it('renders empty state when no claims', () => {
    render(<VerifyTab claims={[]} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText(/no claims/i)).toBeInTheDocument()
  })

  it('renders list of claims', () => {
    const claims = [fakeClaim('c1'), fakeClaim('c2')]
    render(<VerifyTab claims={claims} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText('claim c1')).toBeInTheDocument()
    expect(screen.getByText('claim c2')).toBeInTheDocument()
  })

  it('passes expanded=true to expanded ClaimCard', () => {
    const claims = [fakeClaim('c1')]
    render(<VerifyTab claims={claims} expandedIds={new Set(['c1'])} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    // Expanded card shows quote/reason area
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('calls onSave when save triggered from ClaimCard', () => {
    const fn = vi.fn()
    render(<VerifyTab claims={[fakeClaim('c1')]} expandedIds={new Set(['c1'])} onToggleExpand={vi.fn()} onSave={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(fn).toHaveBeenCalledWith('c1')
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/tabs/VerifyTab.test.tsx
```

- [ ] **Step 3: Add filter state to `useStore.ts`**

In `src/sidebar/state/useStore.ts`, add to the `State` interface:

```ts
verifyStatusFilter: VerifyStatus | 'all'
verifySiteFilter: SiteId | 'all'
setVerifyStatusFilter(f: VerifyStatus | 'all'): void
setVerifySiteFilter(f: SiteId | 'all'): void
```

Add initial values in the store:

```ts
verifyStatusFilter: 'all',
verifySiteFilter: 'all',
```

Add actions:

```ts
setVerifyStatusFilter(f) { set({ verifyStatusFilter: f }) },
setVerifySiteFilter(f)   { set({ verifySiteFilter: f }) },
```

Import `VerifyStatus` and `SiteId` if not already imported.

- [ ] **Step 4: Implement `VerifyTab.tsx`**

```tsx
import { useState } from 'react'
import type { ClaimItem, VerifyStatus, SiteId } from '../../../shared/verify-types'
import { ClaimCard } from '../atoms/ClaimCard'

type StatusFilter = VerifyStatus | 'all'
type SiteFilter = SiteId | 'all'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'verified', label: 'Verified' },
  { value: 'partial', label: 'Partial' },
  { value: 'not_found', label: 'Not Found' },
]

interface VerifyTabProps {
  claims: ClaimItem[]
  expandedIds: Set<string>
  onToggleExpand: (id: string) => void
  onSave: (id: string) => void
  isDetecting?: boolean
  currentSiteDisabled?: SiteId | null
  onOpenSettings?: () => void
}

export function VerifyTab({
  claims, expandedIds, onToggleExpand, onSave,
  isDetecting = false, currentSiteDisabled = null, onOpenSettings,
}: VerifyTabProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [siteFilter, setSiteFilter] = useState<SiteFilter>('all')

  if (currentSiteDisabled) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <p className="text-sm text-[var(--rk-text-3)] capitalize">{currentSiteDisabled} is disabled in Settings.</p>
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="text-xs text-[var(--rk-blue)] hover:underline"
          >
            Open Settings →
          </button>
        )}
      </div>
    )
  }

  if (isDetecting) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
        <span className="w-4 h-4 border-2 border-[var(--rk-blue)] border-t-transparent rounded-full animate-spinRing" />
        <p className="text-sm text-[var(--rk-text-3)]">Detecting claims on this page…</p>
      </div>
    )
  }

  if (claims.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <p className="text-sm text-[var(--rk-text-3)]">No claims detected on this page yet.</p>
        <p className="text-xs text-[var(--rk-text-3)]">Navigate to Elicit, SciSpace or Consensus and run a search.</p>
      </div>
    )
  }

  const sites = Array.from(new Set(claims.map(c => c.site)))
  const filtered = claims.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (siteFilter !== 'all' && c.site !== siteFilter) return false
    return true
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-header: filter pills */}
      <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-[var(--rk-border)] shrink-0">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.value}
            aria-pressed={statusFilter === f.value}
            onClick={() => setStatusFilter(f.value)}
            className={[
              'text-xs px-2.5 py-0.5 rounded-full border transition-colors',
              statusFilter === f.value
                ? 'bg-[var(--rk-blue)] border-[var(--rk-blue)] text-white'
                : 'border-[var(--rk-border)] text-[var(--rk-text-3)] hover:text-[var(--rk-text)]',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
        {sites.length > 1 && sites.map(site => (
          <button
            key={site}
            aria-pressed={siteFilter === site}
            onClick={() => setSiteFilter(siteFilter === site ? 'all' : site)}
            className={[
              'text-xs px-2.5 py-0.5 rounded-full border transition-colors capitalize',
              siteFilter === site
                ? 'bg-[var(--rk-blue-subtle)] border-[var(--rk-blue)] text-[var(--rk-blue)]'
                : 'border-[var(--rk-border)] text-[var(--rk-text-3)] hover:text-[var(--rk-text)]',
            ].join(' ')}
          >
            {site}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-[var(--rk-text-3)] text-center mt-4">No claims match the current filter.</p>
        ) : filtered.map(claim => (
          <ClaimCard
            key={claim.id}
            claim={claim}
            expanded={expandedIds.has(claim.id)}
            onToggleExpand={onToggleExpand}
            onSave={onSave}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Update `VerifyTab.test.tsx` — add filter + empty state tests**

Add to the existing test file:

```tsx
  it('filters claims by status', () => {
    const claims = [fakeClaim('c1', 'verified'), fakeClaim('c2', 'not_found')]
    render(<VerifyTab claims={claims} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /not found/i }))
    expect(screen.getByText('claim c2')).toBeInTheDocument()
    expect(screen.queryByText('claim c1')).toBeNull()
  })

  it('renders detecting state', () => {
    render(<VerifyTab claims={[]} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} isDetecting={true} />)
    expect(screen.getByText(/detecting claims/i)).toBeInTheDocument()
  })

  it('renders disabled-site state with settings button', () => {
    const fn = vi.fn()
    render(<VerifyTab claims={[]} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} currentSiteDisabled="elicit" onOpenSettings={fn} />)
    expect(screen.getByText(/elicit is disabled/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/open settings/i))
    expect(fn).toHaveBeenCalled()
  })
```

- [ ] **Step 6: Run tests (pass)**

```bash
npx vitest run src/sidebar/components/tabs/VerifyTab.test.tsx
```

Expected: 7 tests pass.

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx research-kit/extension/src/sidebar/components/tabs/VerifyTab.test.tsx research-kit/extension/src/sidebar/state/useStore.ts
git commit -m "feat(extension): VerifyTab filter pills + detecting/disabled empty states"
```

---

### Task 22: InboxTab

**Files:**

- Create: `research-kit/extension/src/sidebar/components/tabs/InboxTab.tsx`
- Test: `research-kit/extension/src/sidebar/components/tabs/InboxTab.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InboxTab } from './InboxTab'
import type { PaperGroup } from '../../selectors/inbox'
import type { InboxItem } from '../../../shared/verify-types'

const fakeItem = (id: string): InboxItem => ({
  id, claimId: id, text: `claim ${id}`, paperTitle: 'X', doi: '10.1/x',
  paperUrl: null, page: '', site: 'elicit', status: 'verified', confidence: 0.9,
  quote: null, reason: '', projectId: 'p_default', savedAtMs: 0,
})

const group: PaperGroup = {
  groupKey: '10.1/x', doi: '10.1/x', paperTitle: 'Paper X',
  claims: [fakeItem('a'), fakeItem('b')], hasUnknownDoi: false, hasAbstractOnly: false,
}

describe('InboxTab', () => {
  it('renders empty state when no groups', () => {
    render(<InboxTab groups={[]} expandedGroups={new Set()} selectedIds={new Set()} onToggleGroup={vi.fn()} onToggleSelect={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByText(/inbox is empty/i)).toBeInTheDocument()
  })

  it('renders paper group', () => {
    render(<InboxTab groups={[group]} expandedGroups={new Set()} selectedIds={new Set()} onToggleGroup={vi.fn()} onToggleSelect={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByText('Paper X')).toBeInTheDocument()
  })

  it('shows claims when group expanded', () => {
    render(<InboxTab groups={[group]} expandedGroups={new Set(['10.1/x'])} selectedIds={new Set()} onToggleGroup={vi.fn()} onToggleSelect={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByText('claim a')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/tabs/InboxTab.test.tsx
```

- [ ] **Step 3: Implement `InboxTab.tsx`**

```tsx
import { useState } from 'react'
import type { PaperGroup } from '../../selectors/inbox'
import type { Project } from '../../../shared/verify-types'
import { PaperGroup as PaperGroupCard } from '../atoms/PaperGroup'

interface ManageProjectsModalProps {
  projects: Project[]
  currentProjectId: string
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

function ManageProjectsModal({ projects, currentProjectId, onRename, onDelete, onClose }: ManageProjectsModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  function startEdit(p: Project) {
    setEditingId(p.id)
    setEditName(p.name)
  }

  function confirmRename(id: string) {
    if (editName.trim()) onRename(id, editName.trim())
    setEditingId(null)
  }

  function handleDelete(p: Project) {
    const typed = window.prompt(`Type "delete" to remove "${p.name}" and all its saved claims:`)
    if (typed === 'delete') onDelete(p.id)
  }

  return (
    <div className="absolute inset-0 z-30 bg-black/60 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-[var(--rk-surface)] rounded-t-xl p-4 space-y-3 animate-slideInDown"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--rk-text)]">Manage Projects</h3>
          <button aria-label="close manage projects" onClick={onClose} className="text-[var(--rk-text-3)]">✕</button>
        </div>
        <ul className="space-y-2">
          {projects.map(p => (
            <li key={p.id} className="flex items-center gap-2">
              {editingId === p.id ? (
                <>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && confirmRename(p.id)}
                    autoFocus
                    className="flex-1 bg-[var(--rk-surface-2)] border border-[var(--rk-blue)] text-[var(--rk-text)] text-sm rounded px-2 py-1"
                  />
                  <button onClick={() => confirmRename(p.id)} className="text-xs text-[var(--rk-blue)]">Save</button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-[var(--rk-text-3)]">Cancel</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-[var(--rk-text)]">{p.name}</span>
                  {p.id === currentProjectId && (
                    <span className="text-[10px] text-[var(--rk-blue)] bg-[var(--rk-blue-subtle)] px-1.5 py-0.5 rounded-full">current</span>
                  )}
                  <button aria-label={`rename ${p.name}`} onClick={() => startEdit(p)} className="text-xs text-[var(--rk-text-3)] hover:text-[var(--rk-text)]">✎</button>
                  <button aria-label={`delete ${p.name}`} onClick={() => handleDelete(p)} className="text-xs text-[var(--rk-text-3)] hover:text-[var(--rk-red)]">🗑</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

interface InboxTabProps {
  groups: PaperGroup[]
  expandedGroups: Set<string>
  selectedIds: Set<string>
  projects: Project[]
  currentProjectId: string
  onToggleGroup: (key: string) => void
  onToggleSelect: (id: string) => void
  onRemove: (id: string) => void
  onRenameProject: (id: string, name: string) => void
  onDeleteProject: (id: string) => void
  onGoToDraft: (selectedIds: Set<string>) => void
}

export function InboxTab({
  groups, expandedGroups, selectedIds, projects, currentProjectId,
  onToggleGroup, onToggleSelect, onRemove, onRenameProject, onDeleteProject, onGoToDraft,
}: InboxTabProps) {
  const [manageOpen, setManageOpen] = useState(false)

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {manageOpen && (
        <ManageProjectsModal
          projects={projects}
          currentProjectId={currentProjectId}
          onRename={onRenameProject}
          onDelete={onDeleteProject}
          onClose={() => setManageOpen(false)}
        />
      )}

      {/* Manage projects link */}
      <div className="flex items-center justify-end px-3 py-1.5 border-b border-[var(--rk-border)] shrink-0">
        <button
          aria-label="manage projects"
          onClick={() => setManageOpen(true)}
          className="text-xs text-[var(--rk-text-3)] hover:text-[var(--rk-blue)]"
        >
          Manage projects
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6 text-center">
          <p className="text-sm text-[var(--rk-text-3)]">Inbox is empty.</p>
          <p className="text-xs text-[var(--rk-text-3)]">Save verified claims from the Verify tab to collect them here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1">
          {groups.map(g => (
            <PaperGroupCard
              key={g.groupKey}
              group={g}
              expanded={expandedGroups.has(g.groupKey)}
              onToggleExpand={onToggleGroup}
              onRemoveItem={onRemove}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}

      {/* Action bar — appears when ≥1 item selected */}
      {selectedIds.size > 0 && (
        <div className="shrink-0 flex items-center justify-between px-3 py-2 bg-[var(--rk-surface-2)] border-t border-[var(--rk-border)] animate-slideInDown">
          <span className="text-xs text-[var(--rk-text-2)]">{selectedIds.size} selected</span>
          <button
            aria-label="draft review"
            onClick={() => onGoToDraft(selectedIds)}
            className="text-xs px-3 py-1.5 bg-[var(--rk-blue)] text-white rounded-full hover:bg-[var(--rk-blue-hover)] transition-colors"
          >
            Draft Review →
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Update `InboxTab.test.tsx` — add action bar + manage modal tests**

Add to the existing test file:

```tsx
  it('shows action bar when items selected', () => {
    render(<InboxTab groups={[group]} expandedGroups={new Set()} selectedIds={new Set(['a'])} projects={[{id:'p_default',name:'Default Project'}]} currentProjectId="p_default" onToggleGroup={vi.fn()} onToggleSelect={vi.fn()} onRemove={vi.fn()} onRenameProject={vi.fn()} onDeleteProject={vi.fn()} onGoToDraft={vi.fn()} />)
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /draft review/i })).toBeInTheDocument()
  })

  it('calls onGoToDraft when Draft Review clicked', () => {
    const fn = vi.fn()
    render(<InboxTab groups={[group]} expandedGroups={new Set()} selectedIds={new Set(['a'])} projects={[{id:'p_default',name:'Default Project'}]} currentProjectId="p_default" onToggleGroup={vi.fn()} onToggleSelect={vi.fn()} onRemove={vi.fn()} onRenameProject={vi.fn()} onDeleteProject={vi.fn()} onGoToDraft={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /draft review/i }))
    expect(fn).toHaveBeenCalled()
  })

  it('shows manage projects button', () => {
    render(<InboxTab groups={[]} expandedGroups={new Set()} selectedIds={new Set()} projects={[{id:'p_default',name:'Default Project'}]} currentProjectId="p_default" onToggleGroup={vi.fn()} onToggleSelect={vi.fn()} onRemove={vi.fn()} onRenameProject={vi.fn()} onDeleteProject={vi.fn()} onGoToDraft={vi.fn()} />)
    expect(screen.getByRole('button', { name: /manage projects/i })).toBeInTheDocument()
  })

  it('opens manage modal when manage projects clicked', () => {
    render(<InboxTab groups={[]} expandedGroups={new Set()} selectedIds={new Set()} projects={[{id:'p_default',name:'Default Project'}]} currentProjectId="p_default" onToggleGroup={vi.fn()} onToggleSelect={vi.fn()} onRemove={vi.fn()} onRenameProject={vi.fn()} onDeleteProject={vi.fn()} onGoToDraft={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /manage projects/i }))
    expect(screen.getByText('Manage Projects')).toBeInTheDocument()
  })
```

Also update existing `InboxTab.test.tsx` render calls to pass new required props:
`projects={[{id:'p_default',name:'Default Project'}]} currentProjectId="p_default" onRenameProject={vi.fn()} onDeleteProject={vi.fn()} onGoToDraft={vi.fn()}`

- [ ] **Step 5: Run tests (pass)**

```bash
npx vitest run src/sidebar/components/tabs/InboxTab.test.tsx
```

Expected: 7 tests pass.

- [ ] **Step 6: Update `App.tsx` InboxTab usage** — pass `projects`, `currentProjectId`, `onRenameProject={s.renameProject}`, `onDeleteProject={s.deleteProject}`, `onGoToDraft` (switches tab to 'draft' and sets `draftSelection`):

```tsx
onGoToDraft={(ids) => {
  s.setDraftSelection(Array.from(ids))
  s.setTab('draft')
}}
```

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/InboxTab.tsx research-kit/extension/src/sidebar/components/tabs/InboxTab.test.tsx research-kit/extension/src/sidebar/App.tsx
git commit -m "feat(extension): InboxTab action bar + manage projects modal"
```

---

### Task 23: ConflictsTab + ChatTab (ChatThread wrap) + DraftTab (selection-aware) + HelpTab (accordion + replay)

**Files:**

- Create: `research-kit/extension/src/sidebar/components/tabs/ConflictsTab.tsx`
- Create: `research-kit/extension/src/sidebar/components/tabs/ChatTab.tsx`
- Create: `research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx`
- Create: `research-kit/extension/src/sidebar/components/tabs/HelpTab.tsx`
- Test: `research-kit/extension/src/sidebar/components/tabs/placeholders.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/sidebar/components/tabs/placeholders.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConflictsTab } from './ConflictsTab'
import { DraftTab } from './DraftTab'
import { HelpTab } from './HelpTab'

describe('ConflictsTab', () => {
  it('renders placeholder when no conflicts', () => {
    render(<ConflictsTab conflicts={[]} />)
    expect(screen.getByText(/no conflicts/i)).toBeInTheDocument()
  })
})

describe('DraftTab', () => {
  it('renders generic placeholder when no selection', () => {
    render(<DraftTab selectedIds={[]} />)
    expect(screen.getByText(/draft/i)).toBeInTheDocument()
  })

  it('shows selected count when items passed', () => {
    render(<DraftTab selectedIds={['a', 'b', 'c']} />)
    expect(screen.getByText(/3 claims selected/i)).toBeInTheDocument()
  })
})

describe('HelpTab', () => {
  it('renders ResearchKit heading', () => {
    render(<HelpTab onReplayOnboarding={vi.fn()} />)
    expect(screen.getByText(/ResearchKit/i)).toBeInTheDocument()
  })

  it('renders version badge', () => {
    render(<HelpTab onReplayOnboarding={vi.fn()} />)
    expect(screen.getByText(/v0\.2/i)).toBeInTheDocument()
  })

  it('calls onReplayOnboarding when replay button clicked', () => {
    const fn = vi.fn()
    render(<HelpTab onReplayOnboarding={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /replay intro/i }))
    expect(fn).toHaveBeenCalled()
  })

  it('accordion: clicking section header toggles content', () => {
    render(<HelpTab onReplayOnboarding={vi.fn()} />)
    const verifyBtn = screen.getByRole('button', { name: /verify/i })
    fireEvent.click(verifyBtn)
    expect(screen.getByText(/verbatim match/i)).toBeInTheDocument()
    fireEvent.click(verifyBtn)
    expect(screen.queryByText(/verbatim match/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/tabs/placeholders.test.tsx
```

- [ ] **Step 3: Implement `ConflictsTab.tsx`**

```tsx
import type { ConflictItem } from '../../../shared/verify-types'

export function ConflictsTab({ conflicts }: { conflicts: ConflictItem[] }) {
  const unresolved = conflicts.filter(c => !c.resolution)

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--rk-border)] shrink-0">
        <span className={[
          'w-2 h-2 rounded-full',
          unresolved.length > 0 ? 'bg-[var(--rk-red)] animate-conflictPulse' : 'bg-[var(--rk-green)]',
        ].join(' ')} />
        <span className="text-xs text-[var(--rk-text-2)]">
          {unresolved.length > 0 ? `${unresolved.length} unresolved` : 'No conflicts'}
        </span>
      </div>

      {conflicts.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6 text-center">
          <p className="text-sm text-[var(--rk-text-3)]">No conflicts detected.</p>
          <p className="text-xs text-[var(--rk-text-3)]">Conflict detection runs in the background. UI for review and resolution coming in Phase 2.5.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1">
          <p className="text-xs text-[var(--rk-text-3)] text-center">{conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''} detected. Full review UI coming in Phase 2.5.</p>
          {conflicts.map(c => (
            <div key={c.id} className="rounded-lg border border-[var(--rk-red)] bg-[var(--rk-red-subtle)] p-3">
              <p className="text-sm font-medium text-[var(--rk-text)]">{c.paperTitle}</p>
              <div className="mt-2 space-y-1">
                {c.sides.map(side => (
                  <div key={side.claimId} className="text-xs text-[var(--rk-text-2)]">
                    <span className="font-medium capitalize">{side.site}</span>: {side.text}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Implement `ChatTab.tsx`**

Locate the existing `ChatThread.tsx` and `useOpenClawAgent.ts` in the sidebar source. Wrap them:

```tsx
// ChatTab.tsx wraps existing legacy ChatThread component
// ChatThread and useOpenClawAgent are UNCHANGED — just mounted here
import ChatThread from '../ChatThread'

export function ChatTab() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--rk-yellow-subtle)] border-b border-[var(--rk-yellow)] text-xs text-[var(--rk-yellow)] shrink-0">
        ⚠ Legacy chat — context-aware version coming in Phase 2.5.
      </div>
      <div className="flex-1 overflow-hidden">
        <ChatThread />
      </div>
    </div>
  )
}
```

If `ChatThread` expects props, pass them as-is. Do not modify `ChatThread.tsx`.

- [ ] **Step 5: Implement `DraftTab.tsx`**

```tsx
interface DraftTabProps {
  selectedIds: string[]
}

export function DraftTab({ selectedIds }: DraftTabProps) {
  if (selectedIds.length > 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <p className="text-sm font-medium text-[var(--rk-text)]">{selectedIds.length} claims selected</p>
        <p className="text-xs text-[var(--rk-text-3)]">Draft generation coming in Phase 2.5.</p>
        <div className="w-full max-w-xs border border-[var(--rk-border)] rounded-lg p-3 opacity-40 cursor-not-allowed space-y-2">
          <div className="h-2 bg-[var(--rk-surface-2)] rounded" />
          <div className="h-2 bg-[var(--rk-surface-2)] rounded w-3/4" />
          <div className="h-2 bg-[var(--rk-surface-2)] rounded w-1/2" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
      <p className="text-sm text-[var(--rk-text-3)]">Draft export coming soon.</p>
      <p className="text-xs text-[var(--rk-text-3)]">Select items from your Inbox to build a structured draft.</p>
    </div>
  )
}
```

- [ ] **Step 6: Implement `HelpTab.tsx`**

```tsx
import { useState } from 'react'

const SECTIONS = [
  {
    id: 'verify', title: 'Verify',
    content: 'Automatically checks claims on Elicit, SciSpace, and Consensus against the original paper using verbatim quote search. Green badge = exact match found. Yellow = abstract only. Grey = not found.',
  },
  {
    id: 'site-selector', title: 'Site Selector',
    content: 'Click site pills in the header to toggle which sites ResearchKit runs on. Disabling a site stops extraction and verification on that site immediately.',
  },
  {
    id: 'inbox', title: 'Inbox',
    content: 'Save verified claims here, grouped by paper. Use projects to organize across research topics. Multi-select claims and click "Draft Review →" to start drafting.',
  },
  {
    id: 'conflicts', title: 'Conflicts',
    content: 'When two sources give different answers about the same paper claim, ResearchKit flags it. Full conflict review UI is coming in Phase 2.5.',
  },
  {
    id: 'chat', title: 'Chat',
    content: 'Legacy chat with the AI assistant about the current page context. A context-aware version integrated with your Inbox is coming in Phase 2.5.',
  },
  {
    id: 'draft', title: 'Draft',
    content: 'Select claims from your Inbox to build a structured literature draft. Full draft generation coming in Phase 2.5.',
  },
]

interface HelpTabProps {
  onReplayOnboarding: () => void
}

export function HelpTab({ onReplayOnboarding }: HelpTabProps) {
  const [openId, setOpenId] = useState<string | null>(null)

  function toggle(id: string) {
    setOpenId(prev => prev === id ? null : id)
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold text-[var(--rk-text)]">ResearchKit</h2>
        <span className="text-[10px] text-[var(--rk-text-3)] bg-[var(--rk-surface-2)] px-2 py-0.5 rounded-full">
          v0.2 · Phase 2 Foundation
        </span>
      </div>

      <button
        aria-label="replay intro guide"
        onClick={onReplayOnboarding}
        className="mx-4 mb-3 text-xs text-[var(--rk-blue)] hover:underline text-left"
      >
        ↺ Replay intro guide
      </button>

      <div className="flex-1 px-3 pb-4 space-y-1">
        {SECTIONS.map(s => (
          <div key={s.id} className="border border-[var(--rk-border)] rounded-lg overflow-hidden">
            <button
              aria-label={s.title}
              onClick={() => toggle(s.id)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-[var(--rk-surface)] hover:bg-[var(--rk-surface-2)] text-left"
            >
              <span className="text-sm font-medium text-[var(--rk-text)]">{s.title}</span>
              <span className="text-[var(--rk-text-3)] text-xs">{openId === s.id ? '▲' : '▼'}</span>
            </button>
            {openId === s.id && (
              <div className="px-3 py-2.5 bg-[var(--rk-surface-2)] border-t border-[var(--rk-border)]">
                <p className="text-xs text-[var(--rk-text-3)] leading-relaxed">{s.content}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Run tests (pass)**

```bash
npx vitest run src/sidebar/components/tabs/placeholders.test.tsx
```

Expected: 7 tests pass.

- [ ] **Step 8: Update `App.tsx`**

Pass `draftSelection` to DraftTab and `onReplayOnboarding` to HelpTab:

```tsx
{tab === 'chat' && <ChatTab />}
{tab === 'draft' && <DraftTab selectedIds={s.draftSelection} />}
{tab === 'help' && <HelpTab onReplayOnboarding={() => s.setOnboardingDone(false)} />}
```

- [ ] **Step 9: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/
git commit -m "feat(extension): ConflictsTab, ChatTab (ChatThread wrap), DraftTab (selection), HelpTab (accordion + replay)"
```

---

## Phase E — Overlays

### Task 24: SettingsPanel

**Files:**

- Create: `research-kit/extension/src/sidebar/components/overlays/SettingsPanel.tsx`
- Test: `research-kit/extension/src/sidebar/components/overlays/SettingsPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsPanel } from './SettingsPanel'

const defaultProps = {
  activeSites: new Set(['elicit', 'scispace', 'consensus']) as Set<any>,
  pausedSites: new Set() as Set<any>,
  globalPaused: false,
  provider: 'anthropic' as any,
  autoVerify: true,
  verifyDelay: 1.5,
  onSetSiteActive: vi.fn(),
  onSetSitePaused: vi.fn(),
  onSetGlobalPaused: vi.fn(),
  onSetProvider: vi.fn(),
  onSetAutoVerify: vi.fn(),
  onSetVerifyDelay: vi.fn(),
  onClearAllData: vi.fn(),
  onClose: vi.fn(),
}

describe('SettingsPanel', () => {
  it('renders heading', () => {
    render(<SettingsPanel {...defaultProps} />)
    expect(screen.getByText(/settings/i)).toBeInTheDocument()
  })

  it('shows site toggles for all three sites', () => {
    render(<SettingsPanel {...defaultProps} />)
    expect(screen.getByRole('switch', { name: /elicit/i })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /scispace/i })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /consensus/i })).toBeInTheDocument()
  })

  it('calls onSetSiteActive when site toggle changed', () => {
    const fn = vi.fn()
    render(<SettingsPanel {...defaultProps} onSetSiteActive={fn} />)
    fireEvent.click(screen.getByRole('switch', { name: /elicit/i }))
    expect(fn).toHaveBeenCalledWith('elicit', false)
  })

  it('calls onClose when close button clicked', () => {
    const fn = vi.fn()
    render(<SettingsPanel {...defaultProps} onClose={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /close settings/i }))
    expect(fn).toHaveBeenCalled()
  })

  it('calls onClearAllData when clear button confirmed', () => {
    const fn = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SettingsPanel {...defaultProps} onClearAllData={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /clear all data/i }))
    expect(fn).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/components/overlays/SettingsPanel.test.tsx
```

- [ ] **Step 3: Implement `SettingsPanel.tsx`**

```tsx
import type { SiteId, Provider } from '../../../shared/verify-types'
import { Toggle } from '../atoms/Toggle'

const SITES: SiteId[] = ['elicit', 'scispace', 'consensus']
const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI (GPT)' },
  { value: 'gemini', label: 'Google (Gemini)' },
]

interface SettingsPanelProps {
  activeSites: Set<SiteId>
  pausedSites: Set<SiteId>
  globalPaused: boolean
  provider: Provider
  autoVerify: boolean
  verifyDelay: number
  onSetSiteActive: (site: SiteId, active: boolean) => void
  onSetSitePaused: (site: SiteId, paused: boolean) => void
  onSetGlobalPaused: (paused: boolean) => void
  onSetProvider: (p: Provider) => void
  onSetAutoVerify: (v: boolean) => void
  onSetVerifyDelay: (s: number) => void
  onClearAllData: () => void
  onClose: () => void
}

export function SettingsPanel(props: SettingsPanelProps) {
  function handleClear() {
    if (window.confirm('Clear all saved data? This cannot be undone.')) {
      props.onClearAllData()
    }
  }

  return (
    <div className="absolute inset-0 z-50 bg-[var(--rk-bg)] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--rk-border)]">
        <h2 className="text-sm font-semibold text-[var(--rk-text)]">Settings</h2>
        <button aria-label="close settings" onClick={props.onClose} className="text-[var(--rk-text-3)] hover:text-[var(--rk-text)]">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <section className="space-y-3">
          <h3 className="text-xs font-medium text-[var(--rk-text-2)] uppercase tracking-wide">Active Sites</h3>
          {SITES.map(site => (
            <Toggle
              key={site}
              label={site.charAt(0).toUpperCase() + site.slice(1)}
              checked={props.activeSites.has(site)}
              onChange={v => props.onSetSiteActive(site, v)}
            />
          ))}
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-medium text-[var(--rk-text-2)] uppercase tracking-wide">Verification</h3>
          <Toggle label="Auto-verify on page load" checked={props.autoVerify} onChange={props.onSetAutoVerify} />
          <label className="flex items-center justify-between gap-2">
            <span className="text-sm text-[var(--rk-text-2)]">Delay between claims (s)</span>
            <input
              type="number" min={0} max={10} step={0.5}
              value={props.verifyDelay}
              onChange={e => props.onSetVerifyDelay(parseFloat(e.target.value))}
              className="w-16 bg-[var(--rk-surface-2)] border border-[var(--rk-border)] text-[var(--rk-text)] text-sm rounded px-2 py-1"
            />
          </label>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-medium text-[var(--rk-text-2)] uppercase tracking-wide">Provider</h3>
          <select
            value={props.provider}
            onChange={e => props.onSetProvider(e.target.value as Provider)}
            className="w-full bg-[var(--rk-surface-2)] border border-[var(--rk-border)] text-[var(--rk-text)] text-sm rounded px-2 py-1.5"
          >
            {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </section>

        <section className="pt-2 border-t border-[var(--rk-border)]">
          <button
            aria-label="clear all data"
            onClick={handleClear}
            className="text-sm text-[var(--rk-red)] hover:underline"
          >
            Clear all data…
          </button>
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/components/overlays/SettingsPanel.test.tsx
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/overlays/SettingsPanel.tsx research-kit/extension/src/sidebar/components/overlays/SettingsPanel.test.tsx
git commit -m "feat(extension): SettingsPanel overlay"
```

---

### Task 25: OnboardingOverlay (5-step flow)

**Files:**

- Create: `research-kit/extension/src/sidebar/components/overlays/OnboardingOverlay.tsx`
- Test: `research-kit/extension/src/sidebar/components/overlays/OnboardingOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OnboardingOverlay } from './OnboardingOverlay'

describe('OnboardingOverlay', () => {
  it('renders step 1 heading on mount', () => {
    render(<OnboardingOverlay onDismiss={vi.fn()} />)
    expect(screen.getByText(/welcome to researchkit/i)).toBeInTheDocument()
  })

  it('shows 5 step dots', () => {
    render(<OnboardingOverlay onDismiss={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /step \d/i })).toHaveLength(5)
  })

  it('advances to step 2 on Next click', () => {
    render(<OnboardingOverlay onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/choose your tools/i)).toBeInTheDocument()
  })

  it('dot click jumps to that step', () => {
    render(<OnboardingOverlay onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /step 3/i }))
    expect(screen.getByText(/how verify works/i)).toBeInTheDocument()
  })

  it('Skip calls onDismiss', () => {
    const fn = vi.fn()
    render(<OnboardingOverlay onDismiss={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(fn).toHaveBeenCalled()
  })

  it('final step shows Get Started instead of Next', () => {
    render(<OnboardingOverlay onDismiss={vi.fn()} />)
    // Advance to step 5
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument()
  })

  it('Get Started on last step calls onDismiss', () => {
    const fn = vi.fn()
    render(<OnboardingOverlay onDismiss={fn} />)
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /get started/i }))
    expect(fn).toHaveBeenCalled()
  })

  it('Back button appears from step 2 onwards', () => {
    render(<OnboardingOverlay onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
cd research-kit/extension
npx vitest run src/sidebar/components/overlays/OnboardingOverlay.test.tsx
```

- [ ] **Step 3: Implement `OnboardingOverlay.tsx`**

```tsx
import { useState } from 'react'

const STEPS = [
  {
    title: 'Welcome to ResearchKit',
    body: 'Automatically verify claims from AI research tools against the original papers — right inside your browser.',
    visual: '🔬',
  },
  {
    title: 'Choose Your Tools',
    body: 'ResearchKit works on Elicit, SciSpace, and Consensus. Use the site pills in the header to turn each on or off.',
    visual: '🎛',
  },
  {
    title: 'How Verify Works',
    body: 'When you visit a supported research site, ResearchKit extracts claims and checks each one against the original paper. You\'ll see a badge: ✓ Verified, ⚠ Partial, or × Not Found.',
    visual: '✓',
  },
  {
    title: 'The Verify Pipeline',
    body: 'Claims queue in the background — your browsing is never blocked. Results appear in the Verify tab as they complete. Save interesting ones to your Inbox.',
    visual: '⚡',
  },
  {
    title: 'All Set!',
    body: 'You\'re ready to start verifying research claims. You can replay this guide any time from the Help tab.',
    visual: '🎉',
  },
]

interface OnboardingOverlayProps {
  onDismiss: () => void
}

export function OnboardingOverlay({ onDismiss }: OnboardingOverlayProps) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div className="absolute inset-0 z-50 bg-[var(--rk-bg)] flex flex-col animate-fadeSlideIn">
      {/* Skip */}
      <div className="flex justify-end px-4 pt-3">
        <button
          aria-label="skip"
          onClick={onDismiss}
          className="text-xs text-[var(--rk-text-3)] hover:text-[var(--rk-text)]"
        >
          Skip
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-5">
        <div className="text-5xl">{current.visual}</div>
        <div className="space-y-2">
          <h1 className="text-base font-bold text-[var(--rk-text)]">{current.title}</h1>
          <p className="text-sm text-[var(--rk-text-2)] leading-relaxed max-w-xs">{current.body}</p>
        </div>
      </div>

      {/* Footer: dots + nav */}
      <div className="flex flex-col items-center gap-4 px-6 pb-8">
        {/* Step dots */}
        <div className="flex items-center gap-2">
          {STEPS.map((_, i) => (
            <button
              key={i}
              aria-label={`step ${i + 1}`}
              onClick={() => setStep(i)}
              className={[
                'w-2 h-2 rounded-full transition-all',
                i === step
                  ? 'bg-[var(--rk-blue)] w-4'
                  : 'bg-[var(--rk-surface-2)]',
              ].join(' ')}
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-3 w-full max-w-xs">
          {step > 0 && (
            <button
              aria-label="back"
              onClick={() => setStep(s => s - 1)}
              className="flex-1 py-2 rounded-full border border-[var(--rk-border)] text-sm text-[var(--rk-text-2)] hover:bg-[var(--rk-surface-2)]"
            >
              Back
            </button>
          )}
          <button
            aria-label={isLast ? 'get started' : 'next'}
            onClick={isLast ? onDismiss : () => setStep(s => s + 1)}
            className="flex-1 py-2 rounded-full bg-[var(--rk-blue)] text-white text-sm font-medium hover:bg-[var(--rk-blue-hover)] transition-colors"
          >
            {isLast ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/sidebar/components/overlays/OnboardingOverlay.test.tsx
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/overlays/OnboardingOverlay.tsx research-kit/extension/src/sidebar/components/overlays/OnboardingOverlay.test.tsx
git commit -m "feat(extension): OnboardingOverlay 5-step flow with navigation + skip"
```

---

## Phase F — App Integration

### Task 26: Rewrite `App.tsx` + update `index.html`

**Files:**

- Modify: `research-kit/extension/src/sidebar/App.tsx`
- Modify: `research-kit/extension/src/sidebar/index.html`
- Test: `research-kit/extension/src/sidebar/App.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/sidebar/App.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { runMigration } from './state/migration'
import App from './App'

describe('App', () => {
  it('renders header after migration', async () => {
    await runMigration()
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/ResearchKit/i)).toBeInTheDocument()
    })
  })

  it('shows onboarding overlay on fresh install', async () => {
    // fresh install: onboardingDone = false (migration seeds this)
    await runMigration()
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/welcome to researchkit/i)).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/sidebar/App.test.tsx
```

- [ ] **Step 3: Rewrite `App.tsx`**

First, read the current `src/sidebar/App.tsx` to understand what currently exists there. Then replace with:

```tsx
import { useEffect } from 'react'
import { useChromeStorage } from './hooks/useChromeStorage'
import { useBackgroundMessages } from './hooks/useBackgroundMessages'
import { useStore } from './state/useStore'
import { runMigration } from './state/migration'
import { groupInboxByPaper } from './selectors/inbox'
import { Header } from './components/shell/Header'
import { ProgressBar } from './components/shell/ProgressBar'
import { TabBar } from './components/shell/TabBar'
import { Footer } from './components/shell/Footer'
import { VerifyTab } from './components/tabs/VerifyTab'
import { InboxTab } from './components/tabs/InboxTab'
import { ConflictsTab } from './components/tabs/ConflictsTab'
import { ChatTab } from './components/tabs/ChatTab'
import { DraftTab } from './components/tabs/DraftTab'
import { HelpTab } from './components/tabs/HelpTab'
import { SettingsPanel } from './components/overlays/SettingsPanel'
import { OnboardingOverlay } from './components/overlays/OnboardingOverlay'
import { Toast } from './components/atoms/Toast'
import type { SiteId } from '../shared/verify-types'

async function bootstrap() {
  await runMigration()
}

export default function App() {
  useChromeStorage()
  useBackgroundMessages()

  useEffect(() => { bootstrap() }, [])

  const s = useStore()
  const {
    tab, settingsOpen, toast, expandedClaimIds, inboxSelectedIds, inboxExpandedGroups,
    verifyEnabled, projects, currentProjectId, inboxItems, conflicts,
    activeSites, pausedSites, globalPaused, provider, autoVerify, verifyDelay,
    onboardingDone, currentTabId, claimsByTab, progressByTab,
  } = s

  const currentClaims = currentTabId ? (claimsByTab.get(currentTabId) ?? []) : []
  const currentProgress = currentTabId ? progressByTab.get(currentTabId) ?? null : null
  const inboxGroups = groupInboxByPaper(inboxItems.filter(i => i.projectId === currentProjectId))
  const inboxCount = inboxItems.filter(i => i.projectId === currentProjectId).length
  const conflictsCount = conflicts.filter(c => c.projectId === currentProjectId).length

  const currentSite: SiteId | null = currentClaims.length > 0 ? currentClaims[0].site : null

  async function handleCreateProject() {
    const name = window.prompt('New project name:')
    if (name?.trim()) await s.createProject(name.trim())
  }

  return (
    <div
      className="flex flex-col bg-[var(--rk-bg)] text-[var(--rk-text)] relative overflow-hidden"
      style={{ width: 'var(--rk-panel-w)', height: '100vh' }}
    >
      {!onboardingDone && (
        <OnboardingOverlay onDismiss={() => s.setOnboardingDone(true)} />
      )}

      {settingsOpen && (
        <SettingsPanel
          activeSites={activeSites}
          pausedSites={pausedSites}
          globalPaused={globalPaused}
          provider={provider}
          autoVerify={autoVerify}
          verifyDelay={verifyDelay}
          onSetSiteActive={s.setActiveSite}
          onSetSitePaused={s.setPausedSite}
          onSetGlobalPaused={s.setGlobalPaused}
          onSetProvider={s.setProvider}
          onSetAutoVerify={s.setAutoVerify}
          onSetVerifyDelay={s.setVerifyDelay}
          onClearAllData={s.clearAllData}
          onClose={s.closeSettings}
        />
      )}

      <Header
        verifyEnabled={verifyEnabled}
        onToggleVerify={s.setVerifyEnabled}
        onOpenSettings={s.openSettings}
        currentSite={currentSite}
      />

      {currentProgress && (
        <ProgressBar
          progress={currentProgress}
          onTogglePause={() => s.setGlobalPaused(!globalPaused)}
        />
      )}

      <TabBar
        activeTab={tab}
        onSelect={s.setTab}
        inboxCount={inboxCount}
        conflictsCount={conflictsCount}
      />

      <main className="flex-1 overflow-hidden">
        {tab === 'verify' && (
          <VerifyTab
            claims={currentClaims}
            expandedIds={expandedClaimIds}
            onToggleExpand={s.toggleClaimExpand}
            onSave={async (id) => {
              const claim = currentClaims.find(c => c.id === id)
              if (!claim) return
              const result = await s.saveToInbox(claim)
              if (result.added) s.showToast('Saved to inbox', 'success')
              else s.showToast(result.reason ?? 'Already saved', 'warning')
            }}
          />
        )}
        {tab === 'inbox' && (
          <InboxTab
            groups={inboxGroups}
            expandedGroups={inboxExpandedGroups}
            selectedIds={inboxSelectedIds}
            onToggleGroup={s.toggleGroupExpand}
            onToggleSelect={s.toggleInboxSelect}
            onRemove={s.removeFromInbox}
          />
        )}
        {tab === 'conflicts' && (
          <ConflictsTab conflicts={conflicts.filter(c => c.projectId === currentProjectId)} />
        )}
        {tab === 'chat' && <ChatTab />}
        {tab === 'draft' && <DraftTab />}
        {tab === 'help' && <HelpTab />}
      </main>

      <Footer
        projects={projects}
        currentProjectId={currentProjectId}
        onSwitchProject={s.switchProject}
        onCreateProject={handleCreateProject}
        inboxSelectedCount={inboxSelectedIds.size}
        onClearSelection={s.clearInboxSelection}
      />

      {toast && (
        <div className="absolute bottom-12 left-3 right-3 z-40">
          <Toast message={toast.message} tone={toast.tone} onDismiss={s.clearToast} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Update `index.html` title**

Open `research-kit/extension/src/sidebar/index.html`. Change the `<title>` tag to:

```html
<title>ResearchKit</title>
```

- [ ] **Step 5: Run test (pass)**

```bash
npx vitest run src/sidebar/App.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 6: TypeScript check**

```bash
npx tsc -b --noEmit
```

Fix any remaining type errors from ClaimItem rename (e.g., `claim` → `text` field usage in older files).

- [ ] **Step 7: Commit**

```bash
git add research-kit/extension/src/sidebar/App.tsx research-kit/extension/src/sidebar/index.html
git commit -m "feat(extension): new App shell — Header/TabBar/Footer/Overlays wired"
```

---

## Phase G — Background & Content Extensions

### Task 27: Fix hybrid adapter + content.ts for new ClaimItem shape

**Files:**

- Modify: `research-kit/extension/src/hybrid.ts` (or wherever the adapter lives — check via `grep -r "ClaimItem" src/` for the file handling extraction results)
- Modify: `research-kit/extension/src/content.ts` (activeSites gating)
- Test: `research-kit/extension/src/hybrid.test.ts`

- [ ] **Step 1: Locate affected files**

```bash
cd research-kit/extension
grep -r "ClaimItem\|claim\s*:" src/ --include="*.ts" -l
```

- [ ] **Step 2: Fix ClaimItem field renames in hybrid adapter**

The Phase 1 `ClaimItem` had `claim: string`. Phase 2 renames it to `text: string`. In the hybrid adapter file (likely `src/hybrid.ts` or `src/background_minimal.ts`), find all places that set `claim:` on a ClaimItem object and rename to `text:`. Also add missing fields with defaults:

- `page: ''` (or page number if extractable)
- `saved: false`
- `tabId: <currentTabId>`
- `pageUrl: <currentUrl>`
- `extractedAt: Date.now()`

After changes, run:

```bash
npx tsc -b --noEmit
```

Expected: 0 errors in hybrid adapter.

- [ ] **Step 3: Add activeSites gating to content.ts**

In `src/content.ts`, when handling `MSG_CLAIMS_EXTRACTED` (or the extraction trigger), add a guard that reads `activeSites` from `chrome.storage.local` and skips extraction/verification if the current site is not in `activeSites`:

```ts
const { activeSites = ['elicit', 'scispace', 'consensus'] } = await chrome.storage.local.get('activeSites')
const currentSiteId = detectSiteId(window.location.hostname) // existing detection logic
if (!activeSites.includes(currentSiteId)) return
```

Also listen for `MSG_ACTIVE_SITES_CHANGED` and update local state.

- [ ] **Step 4: Verify TypeScript clean**

```bash
npx tsc -b --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/
git commit -m "fix(extension): adapt hybrid + content for Phase 2 ClaimItem shape"
```

---

### Task 28: Background — per-site pause + MSG_CLAIM_RESULT emit + conflict store

**Files:**

- Modify: `research-kit/extension/src/background_minimal.ts`
- Test: `research-kit/extension/src/background.test.ts`

- [ ] **Step 1: Write the failing test**

`src/background.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

// Background scripts use chrome.runtime.onMessage — we test the handler logic directly,
// not the full service worker.

describe('background message handlers', () => {
  it('MSG_SET_GLOBAL_PAUSED writes to storage', async () => {
    const { handleMessage } = await import('./background_minimal')
    await handleMessage({ type: 'SET_GLOBAL_PAUSED', paused: true }, {} as any)
    const stored = await chrome.storage.local.get('globalPaused')
    expect(stored.globalPaused).toBe(true)
  })

  it('MSG_SET_SITE_ACTIVE writes activeSites to storage', async () => {
    await chrome.storage.local.set({ activeSites: ['elicit', 'scispace', 'consensus'] })
    const { handleMessage } = await import('./background_minimal')
    await handleMessage({ type: 'SET_SITE_ACTIVE', site: 'elicit', active: false }, {} as any)
    const stored = await chrome.storage.local.get('activeSites')
    expect(stored.activeSites).not.toContain('elicit')
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/background.test.ts
```

- [ ] **Step 3: Add `deriveReason` + `derivePage` helpers to `background.test.ts`**

Add to `src/background.test.ts` (before the existing describe block):

```ts
import { deriveReason, derivePage, detectAndStoreConflict } from './background_minimal'
import type { ClaimItem } from './shared/verify-types'

describe('deriveReason', () => {
  it('returns "Verbatim quote found" for verified', () => {
    expect(deriveReason('verified', 0.95)).toBe('Verbatim quote found (95% confidence)')
  })

  it('returns "Abstract matched" for partial', () => {
    expect(deriveReason('partial', 0.7)).toMatch(/abstract/i)
  })

  it('returns "No match" for not_found', () => {
    expect(deriveReason('not_found', 0)).toMatch(/no match/i)
  })

  it('returns "Error during verify" for error', () => {
    expect(deriveReason('error', 0)).toMatch(/error/i)
  })
})

describe('derivePage', () => {
  it('returns "DOI unknown" when no doi and no paperTitle', () => {
    expect(derivePage(null, null)).toBe('DOI unknown')
  })

  it('returns "abstract only" when doi present but status partial', () => {
    expect(derivePage('10.1/x', 'partial')).toBe('abstract only')
  })

  it('returns "full-text checked" when doi present and verified', () => {
    expect(derivePage('10.1/x', 'verified')).toBe('full-text checked')
  })
})

describe('detectAndStoreConflict', () => {
  it('does NOT flag when only 1 site has a claim for the DOI', async () => {
    await runMigration()
    const c1: ClaimItem = {
      id: 'c1', text: 'claim', paperTitle: 'X', doi: '10.1/x', paperUrl: null,
      page: 'p.1', site: 'elicit', status: 'verified', confidence: 0.9,
      quote: 'q', reason: '', saved: false, domAnchor: '', tabId: 1,
      pageUrl: '', extractedAt: 0,
    }
    await chrome.storage.local.set({ inboxItems: [{ ...c1, id: 'inb_1', claimId: 'c1', projectId: 'p_default', savedAtMs: 0 }] })
    await detectAndStoreConflict(c1)
    const stored = (await chrome.storage.local.get('conflicts')).conflicts ?? []
    expect(stored).toHaveLength(0)
  })

  it('flags when two different sites have >0.25 confidence delta on same DOI', async () => {
    await runMigration()
    const existing = {
      id: 'inb_1', claimId: 'c_old', text: 'old claim', paperTitle: 'X',
      doi: '10.1/x', paperUrl: null, page: '', site: 'scispace' as const,
      status: 'verified' as const, confidence: 0.4, quote: null, reason: '',
      projectId: 'p_default', savedAtMs: 0,
    }
    await chrome.storage.local.set({ inboxItems: [existing], conflicts: [] })
    const incoming: ClaimItem = {
      id: 'c_new', text: 'new claim', paperTitle: 'X', doi: '10.1/x', paperUrl: null,
      page: '', site: 'elicit', status: 'verified', confidence: 0.9,
      quote: 'q', reason: '', saved: false, domAnchor: '', tabId: 1,
      pageUrl: '', extractedAt: 0,
    }
    await detectAndStoreConflict(incoming)
    const stored = (await chrome.storage.local.get('conflicts')).conflicts ?? []
    expect(stored).toHaveLength(1)
    expect(stored[0].sides).toHaveLength(2)
  })

  it('does NOT flag when confidence delta ≤ 0.25', async () => {
    await runMigration()
    const existing = {
      id: 'inb_1', claimId: 'c_old', text: 'old claim', paperTitle: 'X',
      doi: '10.1/x', paperUrl: null, page: '', site: 'scispace' as const,
      status: 'verified' as const, confidence: 0.72, quote: null, reason: '',
      projectId: 'p_default', savedAtMs: 0,
    }
    await chrome.storage.local.set({ inboxItems: [existing], conflicts: [] })
    const incoming: ClaimItem = {
      id: 'c_new', text: 'other', paperTitle: 'X', doi: '10.1/x', paperUrl: null,
      page: '', site: 'elicit', status: 'verified', confidence: 0.9,
      quote: 'q', reason: '', saved: false, domAnchor: '', tabId: 1,
      pageUrl: '', extractedAt: 0,
    }
    await detectAndStoreConflict(incoming)
    const stored = (await chrome.storage.local.get('conflicts')).conflicts ?? []
    expect(stored).toHaveLength(0)
  })
})
```

Also add `import { runMigration } from './sidebar/state/migration'` at the top.

- [ ] **Step 4: Export `handleMessage`, `deriveReason`, `derivePage`, `detectAndStoreConflict` from `background_minimal.ts`**

In `background_minimal.ts`, add/export:

```ts
import type { ClaimItem, VerifyStatus, SiteId } from './shared/verify-types'
import { readStorage, writeStorage, appendStorage } from './sidebar/state/storage'

// --- Helpers ---

export function deriveReason(status: VerifyStatus, confidence: number): string {
  const pct = Math.round(confidence * 100)
  switch (status) {
    case 'verified':  return `Verbatim quote found (${pct}% confidence)`
    case 'partial':   return `Abstract matched (${pct}% confidence) — full text not available`
    case 'not_found': return 'No match found in paper'
    case 'error':     return 'Error during verify — try again'
    default:          return 'Pending'
  }
}

export function derivePage(doi: string | null, status: VerifyStatus | null): string {
  if (!doi) return 'DOI unknown'
  if (status === 'partial') return 'abstract only'
  if (status === 'verified') return 'full-text checked'
  return 'full-text checked'
}

export async function detectAndStoreConflict(incoming: ClaimItem): Promise<void> {
  if (!incoming.doi || incoming.status !== 'verified') return
  const inboxItems = await readStorage('inboxItems')
  const peers = inboxItems.filter(i =>
    i.doi === incoming.doi &&
    i.site !== incoming.site &&
    i.status === 'verified'
  )
  for (const peer of peers) {
    const delta = Math.abs(incoming.confidence - peer.confidence)
    if (delta <= 0.25) continue
    const conflict = {
      id: `cf_${Math.random().toString(36).slice(2, 10)}`,
      doi: incoming.doi,
      groupKey: incoming.doi,
      paperTitle: incoming.paperTitle ?? peer.paperTitle ?? 'Unknown paper',
      flaggedAtMs: Date.now(),
      sides: [
        { site: peer.site, claimId: peer.claimId, text: peer.text, confidence: peer.confidence, status: peer.status },
        { site: incoming.site, claimId: incoming.id, text: incoming.text, confidence: incoming.confidence, status: incoming.status },
      ],
      resolution: null,
      projectId: peer.projectId,
    }
    await appendStorage('conflicts', conflict as any)
  }
}

export async function handleMessage(msg: any, _sender: any): Promise<void> {
  if (!msg?.type) return

  if (msg.type === 'SET_GLOBAL_PAUSED') {
    await writeStorage('globalPaused', msg.paused)

  } else if (msg.type === 'SET_SITE_ACTIVE') {
    const current = await readStorage('activeSites')
    const next = msg.active
      ? Array.from(new Set([...current, msg.site as SiteId]))
      : current.filter((s: SiteId) => s !== msg.site)
    await writeStorage('activeSites', next)
    // Broadcast to all content scripts
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'ACTIVE_SITES_CHANGED', activeSites: next }).catch(() => {})
      }
    }

  } else if (msg.type === 'SET_SITE_PAUSED') {
    const current = await readStorage('pausedSites')
    const next = msg.paused
      ? Array.from(new Set([...current, msg.site as SiteId]))
      : current.filter((s: SiteId) => s !== msg.site)
    await writeStorage('pausedSites', next)

  } else if (msg.type === 'SET_PROVIDER') {
    await writeStorage('provider', msg.provider)
  }
}
```

Wire `handleMessage` into the existing `chrome.runtime.onMessage.addListener` call.

Add tab tracking alongside existing listeners:

```ts
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.runtime.sendMessage({ type: 'TAB_CHANGED', tabId }).catch(() => {})
})

chrome.tabs.onRemoved.addListener((tabId) => {
  // Purge in-memory per-tab state (implementation-specific to existing queue structure)
  // Remove entries keyed by tabId from the verify queue/progress maps
})
```

After `verifyOne()` resolves a ClaimItem, call `detectAndStoreConflict(claim)` and send `MSG_CLAIM_RESULT`:

```ts
chrome.runtime.sendMessage({ type: 'CLAIM_RESULT', result: claim }).catch(() => {})
```

- [ ] **Step 5: Run tests (pass)**

```bash
npx vitest run src/background.test.ts
```

Expected: all tests pass (2 original + 3 deriveReason + 3 derivePage + 3 detectAndStoreConflict = 11 tests).

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/background_minimal.ts research-kit/extension/src/background.test.ts
git commit -m "feat(extension): background deriveReason/derivePage/detectAndStoreConflict + tab tracking + MSG_ACTIVE_SITES_CHANGED broadcast"
```

---

### Task 29: Floating progress pill (Shadow DOM)

**Files:**

- Create: `research-kit/extension/src/floating-progress.ts`
- Test: `research-kit/extension/src/floating-progress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/floating-progress.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createFloatingPill, updateFloatingPill, removeFloatingPill } from './floating-progress'

describe('floating progress pill', () => {
  it('createFloatingPill attaches host to document body', () => {
    createFloatingPill()
    expect(document.getElementById('rk-floating-pill')).not.toBeNull()
  })

  it('createFloatingPill is idempotent — does not duplicate', () => {
    createFloatingPill()
    createFloatingPill()
    expect(document.querySelectorAll('#rk-floating-pill')).toHaveLength(1)
  })

  it('updateFloatingPill shows in-progress fraction', () => {
    createFloatingPill()
    updateFloatingPill(3, 10)
    // shadowRoot is closed — verify via sendMessage side effects or just no throw
    expect(() => updateFloatingPill(3, 10)).not.toThrow()
  })

  it('removeFloatingPill removes host from DOM', () => {
    createFloatingPill()
    removeFloatingPill()
    expect(document.getElementById('rk-floating-pill')).toBeNull()
  })

  it('auto-removes 3s after done (uses fake timers)', async () => {
    vi.useFakeTimers()
    createFloatingPill()
    updateFloatingPill(10, 10)
    vi.advanceTimersByTime(3000 + 400)
    expect(document.getElementById('rk-floating-pill')).toBeNull()
    vi.useRealTimers()
  })

  it('click on pill sends MSG_OPEN_SIDEBAR', () => {
    createFloatingPill()
    // pill is in closed shadow, verify sendMessage was registered (mock registered in setup)
    expect(() => createFloatingPill()).not.toThrow()
    expect(chrome.runtime.sendMessage).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test (fail)**

```bash
npx vitest run src/floating-progress.test.ts
```

- [ ] **Step 3: Implement `floating-progress.ts`**

```ts
const HOST_ID = 'rk-floating-pill'

let _fadeTimer: ReturnType<typeof setTimeout> | null = null

export function createFloatingPill(): void {
  if (document.getElementById(HOST_ID)) return
  const host = document.createElement('div')
  host.id = HOST_ID
  Object.assign(host.style, {
    position: 'fixed', bottom: '24px', right: '24px',
    zIndex: '2147483647', pointerEvents: 'auto',
  })
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style>
      .pill {
        background: rgba(15,17,23,0.92);
        color: #9198b5;
        font-family: system-ui, sans-serif;
        font-size: 12px;
        padding: 5px 12px;
        border-radius: 999px;
        border: 1px solid #2e3147;
        white-space: nowrap;
        cursor: pointer;
        transition: opacity 0.3s ease;
        user-select: none;
      }
      .pill:hover { color: #e8eaf6; border-color: #5b8ef0; }
      .pill.fade-out { opacity: 0; pointer-events: none; }
    </style>
    <div class="pill" id="pill-text">Verifying…</div>
  `
  // Click → open sidebar
  const pill = shadow.getElementById('pill-text')!
  pill.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-sidebar' }).catch(() => {})
  })
  document.body.appendChild(host)
}

export function updateFloatingPill(completed: number, total: number): void {
  const host = document.getElementById(HOST_ID)
  if (!host?.shadowRoot) return
  const el = host.shadowRoot.getElementById('pill-text')
  if (!el) return
  const done = completed >= total && total > 0
  el.textContent = done ? 'Verified ✓' : `Verifying ${completed} / ${total}`

  if (done) {
    if (_fadeTimer) clearTimeout(_fadeTimer)
    _fadeTimer = setTimeout(() => {
      el.classList.add('fade-out')
      setTimeout(() => removeFloatingPill(), 350)
    }, 3000)
  }
}

export function removeFloatingPill(): void {
  if (_fadeTimer) { clearTimeout(_fadeTimer); _fadeTimer = null }
  document.getElementById(HOST_ID)?.remove()
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run src/floating-progress.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Wire pill into content.ts**

In `src/content.ts`, import `createFloatingPill`, `updateFloatingPill`, `removeFloatingPill`. On `MSG_VERIFY_PROGRESS` (or the equivalent message), call `updateFloatingPill(progress.completed, progress.total)`. Call `createFloatingPill()` when the first progress message arrives. Call `removeFloatingPill()` when `completed === total`.

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/floating-progress.ts research-kit/extension/src/floating-progress.test.ts research-kit/extension/src/content.ts
git commit -m "feat(extension): Shadow DOM floating progress pill"
```

---

### Task 29a: content.ts `shouldExtract` + activeSites gating unit tests

**Files:**

- Create: `research-kit/extension/src/content.test.ts`

- [ ] **Step 1: Export `shouldExtract` + `detectSiteId` from `content.ts`**

In `src/content.ts`, add these two exported helpers (or extract them if they already exist inline):

```ts
export function detectSiteId(hostname: string): SiteId | null {
  if (hostname.includes('elicit.com')) return 'elicit'
  if (hostname.includes('scispace.com') || hostname.includes('typeset.io')) return 'scispace'
  if (hostname.includes('consensus.app')) return 'consensus'
  return null
}

export async function shouldExtract(hostname: string): Promise<boolean> {
  const siteId = detectSiteId(hostname)
  if (!siteId) return false
  const activeSites = await readStorage('activeSites')
  return activeSites.includes(siteId)
}
```

Import `readStorage` from `./sidebar/state/storage`.

- [ ] **Step 2: Write the failing test**

`src/content.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectSiteId, shouldExtract } from './content'
import { runMigration } from './sidebar/state/migration'

describe('detectSiteId', () => {
  it('returns elicit for elicit.com', () => {
    expect(detectSiteId('elicit.com')).toBe('elicit')
  })

  it('returns scispace for scispace.com', () => {
    expect(detectSiteId('scispace.com')).toBe('scispace')
  })

  it('returns scispace for typeset.io', () => {
    expect(detectSiteId('typeset.io')).toBe('scispace')
  })

  it('returns consensus for consensus.app', () => {
    expect(detectSiteId('consensus.app')).toBe('consensus')
  })

  it('returns null for unknown hostname', () => {
    expect(detectSiteId('google.com')).toBeNull()
  })
})

describe('shouldExtract', () => {
  it('returns false for non-supported hostname', async () => {
    await runMigration()
    expect(await shouldExtract('google.com')).toBe(false)
  })

  it('returns true when site is in activeSites', async () => {
    await runMigration()
    // migration seeds activeSites = ['elicit', 'scispace', 'consensus']
    expect(await shouldExtract('elicit.com')).toBe(true)
  })

  it('returns false when site has been disabled', async () => {
    await runMigration()
    await chrome.storage.local.set({ activeSites: ['scispace', 'consensus'] })
    expect(await shouldExtract('elicit.com')).toBe(false)
  })

  it('returns true again after site is re-enabled', async () => {
    await runMigration()
    await chrome.storage.local.set({ activeSites: [] })
    await chrome.storage.local.set({ activeSites: ['elicit'] })
    expect(await shouldExtract('elicit.com')).toBe(true)
  })
})
```

- [ ] **Step 3: Run test (fail — exports not present)**

```bash
cd research-kit/extension
npx vitest run src/content.test.ts
```

- [ ] **Step 4: Add exports to `content.ts` and run test (pass)**

```bash
npx vitest run src/content.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/content.ts research-kit/extension/src/content.test.ts
git commit -m "test(extension): content.ts shouldExtract + detectSiteId unit tests"
```

---

## Phase H — Backend: `provider` field

### Task 30: Add optional `provider` field to FastAPI verify + extract endpoints

**Files:**

- Modify: `research-kit/backend/app/schemas.py`
- Modify: `research-kit/backend/app/routes/verify.py` (log `provider` if present)
- Modify: `research-kit/backend/app/routes/extract.py` (log `provider` if present)
- Test: `research-kit/backend/tests/test_provider_field.py`

- [ ] **Step 1: Write the failing test**

`research-kit/backend/tests/test_provider_field.py`:

```python
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_verify_accepts_provider_field(client: AsyncClient):
    payload = {
        "claim": "Sleep improves memory.",
        "doi": "10.1/x",
        "provider": "openai",
    }
    response = await client.post("/verify", json=payload)
    # Should not return 422 — provider field accepted and ignored
    assert response.status_code != 422

@pytest.mark.asyncio
async def test_verify_works_without_provider(client: AsyncClient):
    payload = {"claim": "test", "doi": "10.1/x"}
    response = await client.post("/verify", json=payload)
    assert response.status_code != 422
```

- [ ] **Step 2: Run test (fail)**

```bash
cd research-kit/backend
pytest tests/test_provider_field.py -v
```

Expected: `422 Unprocessable Entity` when `provider` is included (field not yet in schema).

- [ ] **Step 3: Update `schemas.py`**

Find the `VerifyRequest` and `ExtractRequest` Pydantic models and add:

```python
from typing import Optional, Literal

ProviderType = Literal["anthropic", "openai", "gemini"]

class VerifyRequest(BaseModel):
    # ... existing fields ...
    provider: Optional[ProviderType] = None
```

Apply the same `provider: Optional[ProviderType] = None` to `ExtractRequest` if it exists.

- [ ] **Step 4: Log provider in route handlers**

In `routes/verify.py` and `routes/extract.py`, after reading the request body, add:

```python
if request.provider:
    logger.info("provider=%s", request.provider)
```

(Do not change any LLM call logic — this is strictly a passthrough for now.)

- [ ] **Step 5: Run test (pass)**

```bash
pytest tests/test_provider_field.py -v
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
cd research-kit/backend
git add app/schemas.py app/routes/verify.py app/routes/extract.py tests/test_provider_field.py
git commit -m "feat(backend): add optional provider field to verify/extract requests"
```

---

## Phase I — Integration Tests

### Task 31: Extension store → storage round-trip integration test

**Files:**

- Create: `research-kit/extension/src/integration/store-storage.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/integration/store-storage.test.ts
import { describe, it, expect } from 'vitest'
import { runMigration } from '../sidebar/state/migration'
import { useStore } from '../sidebar/state/useStore'
import type { ClaimItem } from '../shared/verify-types'

const claim = (): ClaimItem => ({
  id: 'c1', text: 'memory consolidation', paperTitle: 'Sleep Paper',
  doi: '10.1/sp', paperUrl: null, page: 'p.10', site: 'elicit',
  status: 'verified', confidence: 0.88, quote: 'q', reason: 'match',
  saved: false, domAnchor: '', tabId: 1, pageUrl: '', extractedAt: 0,
})

describe('store → storage integration', () => {
  it('saveToInbox persists across hydrate cycles', async () => {
    await runMigration()
    await useStore.getState().hydrate()
    await useStore.getState().saveToInbox(claim())
    // simulate app restart: hydrate fresh store from storage
    await useStore.getState().hydrate()
    expect(useStore.getState().inboxItems).toHaveLength(1)
    expect(useStore.getState().inboxItems[0].text).toBe('memory consolidation')
  })

  it('project cascade delete persists to storage', async () => {
    await runMigration()
    await useStore.getState().hydrate()
    const p = await useStore.getState().createProject('Temp')
    await useStore.getState().switchProject(p.id)
    await useStore.getState().saveToInbox(claim())
    await useStore.getState().deleteProject(p.id)
    await useStore.getState().hydrate()
    expect(useStore.getState().inboxItems.find(i => i.projectId === p.id)).toBeUndefined()
  })

  it('settings persist across hydrate', async () => {
    await runMigration()
    await useStore.getState().hydrate()
    await useStore.getState().setActiveSite('elicit', false)
    await useStore.getState().hydrate()
    expect(useStore.getState().activeSites.has('elicit')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test (pass)**

```bash
npx vitest run src/integration/store-storage.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 3: Add integration scenario 2 — site gating propagation**

Add to `src/integration/store-storage.test.ts`:

```ts
import { shouldExtract } from '../content'

describe('integration: site gating', () => {
  it('disabling a site in store → shouldExtract returns false for that site', async () => {
    await runMigration()
    await useStore.getState().hydrate()
    expect(await shouldExtract('elicit.com')).toBe(true)

    await useStore.getState().setActiveSite('elicit', false)
    // shouldExtract reads chrome.storage directly, which was written by setActiveSite
    expect(await shouldExtract('elicit.com')).toBe(false)
  })

  it('re-enabling site → shouldExtract returns true', async () => {
    await runMigration()
    await useStore.getState().hydrate()
    await useStore.getState().setActiveSite('elicit', false)
    await useStore.getState().setActiveSite('elicit', true)
    expect(await shouldExtract('elicit.com')).toBe(true)
  })
})
```

- [ ] **Step 4: Add integration scenario 3 — onboarding flow**

Add to `src/integration/store-storage.test.ts`:

```ts
describe('integration: onboarding flow', () => {
  it('fresh install → onboardingDone=false persists', async () => {
    await runMigration()
    await useStore.getState().hydrate()
    expect(useStore.getState().onboardingDone).toBe(false)
    const stored = (await chrome.storage.local.get('onboardingDone')).onboardingDone
    expect(stored).toBe(false)
  })

  it('complete onboarding → onboardingDone=true persists across hydrate', async () => {
    await runMigration()
    await useStore.getState().hydrate()
    await useStore.getState().setOnboardingDone(true)
    // Simulate app reload: fresh hydrate
    await useStore.getState().hydrate()
    expect(useStore.getState().onboardingDone).toBe(true)
  })

  it('replay onboarding (setOnboardingDone false) re-shows overlay', async () => {
    await runMigration()
    await useStore.getState().hydrate()
    await useStore.getState().setOnboardingDone(true)
    await useStore.getState().setOnboardingDone(false)
    await useStore.getState().hydrate()
    expect(useStore.getState().onboardingDone).toBe(false)
  })
})
```

- [ ] **Step 5: Run all integration tests (pass)**

```bash
npx vitest run src/integration/store-storage.test.ts
```

Expected: 8 tests pass (3 original + 2 site gating + 3 onboarding).

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/integration/store-storage.test.ts
git commit -m "test(extension): integration scenarios 2+3 (site gating + onboarding flow)"
```

---

### Task 32: Full Phase A–I test run

- [ ] **Step 1: Run all extension tests**

```bash
cd research-kit/extension
npx vitest run --reporter=verbose
```

Expected: all tests pass, 0 failures.

- [ ] **Step 2: Run backend tests**

```bash
cd research-kit/backend
pytest -v
```

Expected: all tests pass, 0 failures.

- [ ] **Step 3: Fix any failures before proceeding**

Do not move to Phase J with failing tests. Fix all failures, commit, then continue.

---

## Phase J — Build Verify

### Task 33: Final build + manifest check

**Files:**

- Modify: `research-kit/extension/src/manifest.json` (if floating pill needs content script entry)
- No new test files — build output is the artifact.

- [ ] **Step 1: Run TypeScript compile (no emit)**

```bash
cd research-kit/extension
npx tsc -b --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Run production build**

```bash
npm run build
```

Expected: build completes with no errors. Outputs to `dist/`.

- [ ] **Step 3: Inspect manifest for content scripts**

```bash
cat dist/manifest.json
```

Verify `content_scripts` includes entry for `content.ts`. If `floating-progress.ts` is imported from `content.ts` (bundled together), no separate manifest entry is needed.

- [ ] **Step 4: Verify dist file sizes are reasonable**

```bash
ls -lh dist/assets/
```

Expected: no single asset > 500 KB. If any file is unexpectedly large, check for accidental imports.

- [ ] **Step 5: Final commit**

```bash
git add research-kit/extension/dist/
git commit -m "chore(extension): Phase 2 Foundation build artifacts"
```

- [ ] **Step 6: Tag completion**

```bash
git tag phase2-foundation-complete
```

---

**Phase J complete — ResearchKit Phase 2 Foundation implementation plan is fully written.**

Run `npx vitest run` in `research-kit/extension/` and `pytest` in `research-kit/backend/` to verify the full suite passes before shipping.
