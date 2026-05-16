export type SiteId = 'elicit' | 'scispace' | 'consensus'
export type VerifyStatus = 'verified' | 'partial' | 'not_found' | 'inaccessible' | 'pending' | 'error'
export type Provider = 'openai' | 'zai' | 'gemini'

export interface Project {
  id: string
  name: string
}

export interface ClaimItem {
  id: string
  claimGroupId?: string  // groups (claim × paper) rows back under their original claim for UI
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
  archived_at: string | null
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
  step?: 'idle' | 'detecting' | 'queueing' | 'verifying' | 'saving' | 'done' | 'error'
  stepMessage?: string
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
