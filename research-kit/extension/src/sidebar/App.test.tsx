import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { App } from './App'
import { create } from 'zustand'

vi.mock('../shared/api', () => ({
  batchCreateClaims: vi.fn().mockResolvedValue({ created: [{ id: 'backend-1' }], skipped: [] }),
  createRun: vi.fn(),
  bootstrapDemoProject: vi.fn(),
  getConflictCheckStatus: vi.fn().mockResolvedValue({ last_checked_at: null, pending_count: 0 }),
  listConflicts: vi.fn().mockResolvedValue([]),
}))

// Mock useAuth to prevent chrome.storage calls
vi.mock('./hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'test@test.com', name: 'Test User' },
    state: { user: { id: '1', email: 'test@test.com', name: 'Test User' }, expiresAt: Date.now() + 3600000 },
    loading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}))

// Define testStore at module level so it's available to the mock
let testStore: any = null

// Mock the store hook BEFORE importing App
vi.mock('./state/useStore', () => ({
  useStore: Object.assign(() => {
    if (!testStore) {
      testStore = create((set) => ({
        tab: 'verify',
        setTab: (newTab: any) => set({ tab: newTab }),
        projects: { data: [{ id: 'p_default', name: 'Default Project' }], status: 'ready' },
        currentProjectId: 'p_default',
        switchProject: vi.fn(),
        createProject: vi.fn(),
        loadProjects: vi.fn(),
        activeSites: new Set(['elicit', 'scispace']),
        setActiveSite: vi.fn(),
        progressByTab: new Map(),
        currentTabId: null,
        globalPaused: false,
        setGlobalPaused: vi.fn(),
        claimStepsById: new Map(),
        focusedClaimId: null,
        focusClaim: vi.fn(),
        toast: null,
        showToast: vi.fn(),
        clearToast: vi.fn(),
        inbox: { data: [], status: 'ready' },
        loadInbox: vi.fn(),
        loadClaims: vi.fn(),
        claims: { data: [], status: 'ready' },
        loadConflicts: vi.fn(),
        addToInbox: vi.fn(),
        removeFromInbox: vi.fn(),
        conflicts: { data: [], status: 'ready' },
        inboxSelectedIds: new Set(),
        toggleInboxSelect: vi.fn(),
        clearInboxSelection: vi.fn(),
        expandedClaimIds: new Set(),
        toggleClaimExpand: vi.fn(),
        settingsOpen: false,
        openSettings: vi.fn(),
        closeSettings: vi.fn(),
        onboardingDone: true,
        setOnboardingDone: vi.fn(),
        archiveMany: vi.fn(),
        unarchiveMany: vi.fn(),
        updateProject: vi.fn(),
        deleteProject: vi.fn(),
        runs: new Map(),
        patchClaim: vi.fn(),
        patchConflict: vi.fn(),
        bumpPendingCheck: vi.fn(),
        claimsByTab: new Map(),
        conflictCheckStatus: { data: null, status: 'idle' },
        loadConflictCheckStatus: vi.fn(),
        provider: null,
        setProvider: vi.fn(),
      }))
    }
    return testStore()
  }, { getState: () => ({ runs: new Map() }) }),
}))

beforeEach(() => {
  // Reset store for each test
  testStore = create((set) => ({
    tab: 'verify',
    setTab: (newTab: any) => set({ tab: newTab }),
    projects: { data: [{ id: 'p_default', name: 'Default Project' }], status: 'ready' },
    currentProjectId: 'p_default',
    switchProject: vi.fn(),
    createProject: vi.fn(),
    loadProjects: vi.fn(),
    activeSites: new Set(['elicit', 'scispace']),
    setActiveSite: vi.fn(),
    progressByTab: new Map(),
    currentTabId: null,
    globalPaused: false,
    setGlobalPaused: vi.fn(),
    claimStepsById: new Map(),
    focusedClaimId: null,
    focusClaim: vi.fn(),
    toast: null,
    showToast: vi.fn(),
    clearToast: vi.fn(),
    inbox: { data: [], status: 'ready' },
    loadInbox: vi.fn(),
    loadClaims: vi.fn(),
    claims: { data: [], status: 'ready' },
    loadConflicts: vi.fn(),
    addToInbox: vi.fn(),
    removeFromInbox: vi.fn(),
    conflicts: { data: [], status: 'ready' },
    inboxSelectedIds: new Set(),
    toggleInboxSelect: vi.fn(),
    clearInboxSelection: vi.fn(),
    expandedClaimIds: new Set(),
    toggleClaimExpand: vi.fn(),
    settingsOpen: false,
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    onboardingDone: true,
    setOnboardingDone: vi.fn(),
    archiveMany: vi.fn(),
    patchClaim: vi.fn(),
    patchConflict: vi.fn(),
    bumpPendingCheck: vi.fn(),
    claimsByTab: new Map(),
    conflictCheckStatus: { data: null, status: 'idle' },
    loadConflictCheckStatus: vi.fn(),
    provider: null,
    setProvider: vi.fn(),
  }))
})

// Mock hooks
vi.mock('./hooks/useChromeStorage', () => ({
  useChromeStorage: () => { },
}))

vi.mock('./hooks/useBackgroundMessages', () => ({
  useBackgroundMessages: () => { },
}))

describe('App', () => {
  it('renders tabbar', () => {
    render(<App />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
  })

  it('renders verify tab by default', () => {
    render(<App />)
    expect(screen.getByText(/no claims detected/i)).toBeInTheDocument()
  })

  it('switches to inbox tab when clicked', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: /inbox/i }))
    expect(screen.getByText(/no active claims/i)).toBeInTheDocument()
  })

  it('has settings button in header', () => {
    render(<App />)
    const settingsButton = screen.getByRole('button', { name: /settings|⚙/i })
    expect(settingsButton).toBeInTheDocument()
  })

  it('bumpPendingCheck is called after PATCH with status=verified', async () => {
    const verifiedClaim = {
      id: 'local-c1', text: 'test', paperTitle: null, doi: null,
      paperUrl: null, page: null, site: 'elicit', status: 'verified',
      confidence: 0.9, quote: 'q', reason: '', saved: false,
      domAnchor: 'x', tabId: 42, pageUrl: 'https://e/x',
      extractedAt: Date.now(),
    }
    const bumpFn = vi.fn()
    testStore.setState({
      currentTabId: 42,
      claimsByTab: new Map([[42, [verifiedClaim]]]),
      progressByTab: new Map([[42, {
        tabId: 42, total: 1, completed: 1, running: 0, paused: false, pausedSites: [],
        perSite: {
          elicit: { total: 1, completed: 1, running: 0 },
          scispace: { total: 0, completed: 0, running: 0 },
          consensus: { total: 0, completed: 0, running: 0 },
        },
      }]]),
      patchClaim: vi.fn().mockResolvedValue(undefined),
      addToInbox: vi.fn().mockResolvedValue({ id: 'inbox-1', claim_id: 'backend-1', project_id: 'p_default', saved_at: '', archived_at: null }),
      showToast: vi.fn(),
      bumpPendingCheck: bumpFn,
      expandedClaimIds: new Set(['local-c1']),
    })

    render(<App />)
    const saveBtn = screen.getByRole('button', { name: /save to inbox/i })
    fireEvent.click(saveBtn)

    await waitFor(() => expect(bumpFn).toHaveBeenCalled())
  })
})
