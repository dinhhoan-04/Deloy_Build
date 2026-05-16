import { create } from 'zustand'
import type {
  ClaimItem, SiteId, Provider, VerifyProgress,
} from '../../shared/verify-types'
import { readStorage, writeStorage } from './storage'
import { DEFAULTS } from './storage-schema'
import { genId } from './ids'
import { createProjectsSlice } from './slices/projects'
import type { ProjectsSlice } from './slices/projects'
import { createClaimsSlice } from './slices/claims'
import type { ClaimsSlice } from './slices/claims'
import { createInboxSlice } from './slices/inbox'
import type { InboxSlice } from './slices/inbox'
import { createConflictsSlice } from './slices/conflicts'
import type { ConflictsSlice } from './slices/conflicts'
import { createRunsSlice } from './slices/runs'
import type { RunsSlice } from './slices/runs'
import { createDraftSlice } from './slices/draft'
import type { DraftSlice } from './slices/draft'

export type TabId = 'verify' | 'inbox' | 'conflicts' | 'chat' | 'draft' | 'help'
export type Tone = 'success' | 'warning' | 'error'

interface ToastState { id: string; message: string; tone: Tone }
interface ClaimLiveStep { step: 'queued' | 'verifying' | 'retrying' | 'done' | 'failed'; detail?: string }

interface UIState {
  // UI
  tab: TabId
  settingsOpen: boolean
  toast: ToastState | null
  expandedClaimIds: Set<string>
  inboxSelectedIds: Set<string>
  inboxExpandedGroups: Set<string>
  draftSelection: string[]

  // Persisted (mirrored from chrome.storage)
  currentProjectId: string | null
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
  claimStepsById: Map<string, ClaimLiveStep>
  focusedClaimId: string | null

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
  switchProject(id: string): Promise<void>
  clearAllData(): Promise<void>
  ingestClaimResult(claim: ClaimItem): void
  ingestProgress(progress: VerifyProgress): void
  setCurrentTab(tabId: number | null, url: string | null): void
  setClaimStep(claimId: string, step: ClaimLiveStep['step'], detail?: string): void
  focusClaim(claimId: string | null): void
}

type State = UIState & ProjectsSlice & ClaimsSlice & InboxSlice & ConflictsSlice & RunsSlice & DraftSlice

export const useStore = create<State>((set, get) => ({
  // UI state
  tab: 'verify',
  settingsOpen: false,
  toast: null,
  expandedClaimIds: new Set(),
  inboxSelectedIds: new Set(),
  inboxExpandedGroups: new Set(),
  draftSelection: [],

  // Persisted settings
  currentProjectId: null,
  activeSites: new Set(DEFAULTS.activeSites),
  pausedSites: new Set(DEFAULTS.pausedSites),
  globalPaused: false,
  provider: 'openai',
  autoVerify: true,
  verifyDelay: 1.5,
  onboardingDone: false,
  verifyEnabled: true,

  // In-memory
  currentTabId: null,
  currentTabUrl: null,
  claimsByTab: new Map(),
  progressByTab: new Map(),
  claimStepsById: new Map(),
  focusedClaimId: null,

  // Slice state
  ...createProjectsSlice(set, get),
  ...createClaimsSlice(set, get),
  ...createInboxSlice(set, get),
  ...createConflictsSlice(set, get),
  ...createRunsSlice(set, get),
  ...createDraftSlice(set, get),

  async hydrate() {
    const [currentProjectId, activeSites, pausedSites,
      globalPaused, provider, autoVerify, verifyDelay, onboardingDone, verifyEnabled] = await Promise.all([
      readStorage('currentProjectId'), readStorage('activeSites'), readStorage('pausedSites'),
      readStorage('globalPaused'), readStorage('provider'), readStorage('autoVerify'),
      readStorage('verifyDelay'), readStorage('onboardingDone'), readStorage('verifyEnabled'),
    ])
    set({
      currentProjectId: currentProjectId ?? null,
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

  async switchProject(id) {
    set({ currentProjectId: id, inboxSelectedIds: new Set() })
    await writeStorage('currentProjectId', id)
  },

  async clearAllData() {
    set({ currentProjectId: null })
  },

  ingestClaimResult(claim) {
    const claimsByTab = new Map(get().claimsByTab)
    const list = claimsByTab.get(claim.tabId) ?? []
    const idx = list.findIndex(c => c.id === claim.id)
    if (idx >= 0) {
      const newList = [...list]
      newList[idx] = claim
      claimsByTab.set(claim.tabId, newList)
    } else {
      claimsByTab.set(claim.tabId, [...list, claim])
    }
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
  setClaimStep(claimId, step, detail) {
    const claimStepsById = new Map(get().claimStepsById)
    claimStepsById.set(claimId, { step, detail })
    set({ claimStepsById })
  },
  focusClaim(claimId) {
    set({ focusedClaimId: claimId })
  },
}))
