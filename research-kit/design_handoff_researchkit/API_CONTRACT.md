# API Contract & Message Protocol

This document specifies the messages the sidebar expects from the background worker, and any new API calls needed to support the redesigned UI.

---

## New Types (extend `src/shared/verify-types.ts`)

```typescript
export type SiteId = 'elicit' | 'scispace' | 'consensus'
export type VerifyStatus = 'verified' | 'partial' | 'not_found' | 'pending' | 'error'

// Extended ClaimItem — replaces current interface
export interface ClaimItem {
  id: string
  text: string            // The claim sentence (quoted, with surrounding quotes)
  paperTitle: string | null
  doi: string | null
  paperUrl: string | null
  page: string            // "p.142", "abstract only", "full-text checked"
  site: SiteId            // Which tool this claim came from
  status: VerifyStatus
  confidence: number      // 0.0–1.0
  quote: string | null    // Verbatim quote from paper (null if partial/not_found)
  saved: boolean          // Whether user saved to inbox
  sourceToolSite: string  // Same as site (for backward compat with old ClaimItem)
  domAnchor: string       // CSS selector for the DOM element where badge injects
}

// New: inbox item
export interface InboxItem {
  id: string
  claimId: string
  text: string
  paperTitle: string
  quote: string | null
  project: string
  savedAt: string         // human-readable relative time
  savedAtMs: number       // timestamp ms for sorting
  status: VerifyStatus
  confidence: number
}

// New: conflict between two tools on same paper
export interface ConflictItem {
  id: string
  paper: string           // human-readable paper title
  doi: string | null
  topic: string           // short description of what conflicts
  flaggedAt: string       // human-readable
  flaggedAtMs: number
  sides: ConflictSide[]   // always 2 sides
  resolution: SiteId | null  // which site the user trusts; null = unresolved
}

export interface ConflictSide {
  site: SiteId
  claim: string
  confidence: number
  status: VerifyStatus
}

// Progress per page
export interface VerifyProgress {
  tabId: number
  total: number
  completed: number
  running: number
  paused: boolean
  pausedSites: SiteId[]   // NEW: per-site paused state
}
```

---

## Chrome Extension Messages (extend `src/shared/messages.ts`)

### Background → Sidebar

```typescript
// Existing — extend payload
{ type: 'VERIFY_PROGRESS', payload: VerifyProgress }

// New: a single claim result has arrived
{ type: 'CLAIM_RESULT', payload: ClaimItem }

// New: a conflict was detected
{ type: 'CONFLICT_DETECTED', payload: ConflictItem }

// New: verification complete for this page
{ type: 'VERIFY_DONE', payload: { tabId: number; total: number } }
```

### Sidebar → Background

```typescript
// Existing
{ type: 'GET_VERIFY_PROGRESS' }

// New: user toggled a site on/off globally
{ type: 'SET_SITE_ACTIVE', payload: { site: SiteId; active: boolean } }

// New: user paused/resumed a specific site
{ type: 'SET_SITE_PAUSED', payload: { site: SiteId; paused: boolean } }

// New: user paused/resumed all verification
{ type: 'SET_VERIFY_PAUSED', payload: { paused: boolean } }

// New: user changed AI provider in settings
{ type: 'SET_PROVIDER', payload: { provider: 'anthropic' | 'openai' | 'gemini' } }
```

---

## Storage Schema (extend `src/shared/storage.ts`)

Use `chrome.storage.local` for all persistent data.

```typescript
interface StorageSchema {
  // Existing
  sessions: Session[]

  // New
  inboxItems: InboxItem[]         // all saved claims across sessions
  conflicts: ConflictItem[]       // all detected conflicts
  activeSites: SiteId[]           // default: ['elicit', 'scispace', 'consensus']
  pausedSites: SiteId[]           // default: []
  provider: 'anthropic' | 'openai' | 'gemini'  // default: 'anthropic'
  autoVerify: boolean             // default: true
  verifyDelay: number             // seconds, default: 1.5
  onboardingDone: boolean         // default: false
  currentProject: string          // default: 'Default Project'
  projects: string[]              // list of project names
}
```

**Migration note:** If upgrading from the old schema, run a migration that seeds `activeSites` from existing site state and sets `onboardingDone: true` (to avoid showing onboarding to existing users).

---

## Conflict Detection Algorithm

Implement in background worker (`src/background_minimal.ts`):

```typescript
// When a new ClaimItem arrives, check against existing claims for same DOI
function checkForConflicts(newClaim: ClaimItem, existingClaims: ClaimItem[]): ConflictItem | null {
  if (!newClaim.doi) return null

  const sameDoiClaims = existingClaims.filter(c =>
    c.doi === newClaim.doi &&
    c.site !== newClaim.site &&
    (c.status === 'verified' || c.status === 'partial')
  )

  for (const existing of sameDoiClaims) {
    // Simple heuristic: if confidence scores differ by >0.25 AND claims differ semantically
    // For MVP: flag if two verified claims from different sites about same paper exist
    if (Math.abs(existing.confidence - newClaim.confidence) > 0.2) {
      return {
        id: `cf_${newClaim.doi}_${Date.now()}`,
        paper: newClaim.paperTitle || existing.paperTitle || 'Unknown paper',
        doi: newClaim.doi,
        topic: 'Conflicting confidence scores on same paper',
        flaggedAt: 'just now',
        flaggedAtMs: Date.now(),
        sides: [
          { site: existing.site, claim: existing.text, confidence: existing.confidence, status: existing.status },
          { site: newClaim.site, claim: newClaim.text, confidence: newClaim.confidence, status: newClaim.status },
        ],
        resolution: null,
      }
    }
  }
  return null
}
```

---

## Onboarding Storage

Use `chrome.storage.local` key `onboardingDone: boolean` instead of `localStorage` (extension context).

```typescript
// On sidebar mount
chrome.storage.local.get('onboardingDone', ({ onboardingDone }) => {
  if (!onboardingDone) showOnboarding()
})

// On onboarding complete
chrome.storage.local.set({ onboardingDone: true })
```

---

## Draft Export Formats

The Draft tab has "Export RIS" and "Markdown" buttons. When implementing:

### RIS format
```
TY  - JOUR
AU  - Walker, Matthew
TI  - Why We Sleep
PY  - 2017
DO  - 10.1038/s41593-019-0483-5
ER  -
```
Generate a `.ris` file and trigger download via `URL.createObjectURL(new Blob([risContent], { type: 'application/x-research-info-systems' }))`.

### Markdown format
```markdown
## Sleep & Memory — Verified Claims

> "Sleep increases memory consolidation by 40% compared to wakefulness"
> — Walker 2017, p.142 (confidence: 94%)

> "NREM slow oscillations actively transfer memories..."
> — Stickgold 2005, p.3 (confidence: 89%)
```

---

## AI Chat Integration

The Chat tab should use the existing `useOpenClawAgent` hook. The context passed to the agent must include **only verified inbox claims** for the current project:

```typescript
const verifiedContext = inboxItems
  .filter(item => item.status === 'verified' && item.project === currentProject)
  .map(item => ({
    claim: item.text,
    paper: item.paperTitle,
    quote: item.quote,
    confidence: item.confidence,
  }))

runAgent(userInput, verifiedContext, provider)
```

The system prompt should instruct the agent to only synthesize from the provided context and explicitly flag if it cannot answer from verified data alone.
