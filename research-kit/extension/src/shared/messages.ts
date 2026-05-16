import type { ClaimItem, VerifyResult, VerifyProgress, ConflictItem, SiteId, Provider } from './verify-types'

export const MSG_READY = 'site:ready'
export const MSG_EXTRACT = 'panel:extract'
export const MSG_VERIFY = 'panel:verify'
export const MSG_STATE_UPDATE = 'bg:state:update'
export const MSG_STATE_INIT = 'bg:state:init'
export const MSG_CLAIMS_EXTRACTED = 'claims:extracted'
export const MSG_VERIFY_PROGRESS = 'verify:progress'
export const MSG_VERIFY_RESULT = 'verify:result'
export const MSG_VERIFY_TOGGLE = 'verify:toggle'
export const MSG_VERIFY_PAUSE = 'verify:pause'

export interface MessageReady {
  type: typeof MSG_READY
  hasContent: boolean
}

export interface MessageExtract {
  type: typeof MSG_EXTRACT
}

export interface MessageVerify {
  type: typeof MSG_VERIFY
}

export interface MessageStateUpdate {
  type: typeof MSG_STATE_UPDATE
  state: Map<number, any>
}

export interface MessageStateInit {
  type: typeof MSG_STATE_INIT
  state: Map<number, any>
}

export interface MessageClaimsExtracted {
  type: typeof MSG_CLAIMS_EXTRACTED
  tabId: number
  claims: ClaimItem[]
}

export interface MessageVerifyProgress {
  type: typeof MSG_VERIFY_PROGRESS
  progress: VerifyProgress
}

export interface MessageVerifyResult {
  type: typeof MSG_VERIFY_RESULT
  result: VerifyResult
}

export interface MessageVerifyToggle {
  type: typeof MSG_VERIFY_TOGGLE
  enabled: boolean
}

export interface MessageVerifyPause {
  type: typeof MSG_VERIFY_PAUSE
  paused: boolean
}

// Phase 2 — Sidebar ← Background
export const MSG_CLAIM_RESULT = 'CLAIM_RESULT'
export const MSG_CONFLICT_DETECTED = 'CONFLICT_DETECTED'
export const MSG_VERIFY_DONE = 'VERIFY_DONE'
export const MSG_TAB_CHANGED = 'TAB_CHANGED'
export const MSG_CLAIM_STEP = 'CLAIM_STEP'
export const MSG_FOCUS_CLAIM = 'FOCUS_CLAIM'

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
export interface MessageClaimStep {
  type: typeof MSG_CLAIM_STEP
  claimId: string
  tabId: number
  step: 'queued' | 'verifying' | 'retrying' | 'done' | 'failed'
  detail?: string
}
export interface MessageFocusClaim { type: typeof MSG_FOCUS_CLAIM; claimId: string; tabId?: number }
export interface MessageSetSiteActive { type: typeof MSG_SET_SITE_ACTIVE; site: SiteId; active: boolean }
export interface MessageSetSitePaused { type: typeof MSG_SET_SITE_PAUSED; site: SiteId; paused: boolean }
export interface MessageSetGlobalPaused { type: typeof MSG_SET_GLOBAL_PAUSED; paused: boolean }
export interface MessageSetProvider { type: typeof MSG_SET_PROVIDER; provider: Provider }
export interface MessageOpenSidebar { type: typeof MSG_OPEN_SIDEBAR }
export interface MessageRequestReExtract { type: typeof MSG_REQUEST_RE_EXTRACT }
export interface MessageActiveSitesChanged { type: typeof MSG_ACTIVE_SITES_CHANGED; activeSites: SiteId[] }

// RAG — Content → Background
export const MSG_RAG_INGEST = 'RAG_INGEST_CHUNKS'
export interface MessageRagIngest {
  type: typeof MSG_RAG_INGEST
  chunks: import('./bm25').RagChunk[]
}
