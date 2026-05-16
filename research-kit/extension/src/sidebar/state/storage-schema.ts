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
  provider: 'openai',
  autoVerify: true,
  verifyDelay: 1.5,
  onboardingDone: false,
  verifyEnabled: true,
}
