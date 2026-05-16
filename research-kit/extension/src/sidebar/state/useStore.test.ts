import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { runMigration } from './migration'
import * as api from '../../shared/api'
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
    // projects is now a Slice, not a plain array
    expect(s.projects.status).toBe('idle')
    // After migration and hydration, currentProjectId should be 'p_default' (from DEFAULTS)
    expect(s.currentProjectId).toBe('p_default')
    expect(s.verifyEnabled).toBe(true)
  })

  it('setActiveSite updates set + persists', async () => {
    await useStore.getState().setActiveSite('elicit', false)
    expect(useStore.getState().activeSites.has('elicit')).toBe(false)
    const stored = (await chrome.storage.local.get('activeSites')).activeSites
    expect(stored).not.toContain('elicit')
  })

  it('switchProject updates currentProjectId + persists', async () => {
    await useStore.getState().switchProject('p_test')
    expect(useStore.getState().currentProjectId).toBe('p_test')
    const stored = (await chrome.storage.local.get('currentProjectId')).currentProjectId
    expect(stored).toBe('p_test')
  })

  it('clearInboxSelection empties selection set', () => {
    useStore.setState({ inboxSelectedIds: new Set(['a', 'b']) })
    useStore.getState().clearInboxSelection()
    expect(useStore.getState().inboxSelectedIds.size).toBe(0)
  })

  it('tab switching works', () => {
    useStore.getState().setTab('inbox')
    expect(useStore.getState().tab).toBe('inbox')
    useStore.getState().setTab('conflicts')
    expect(useStore.getState().tab).toBe('conflicts')
  })

  it('ingestClaimResult stores claim by tabId', () => {
    const claim = fakeClaim({ tabId: 42 })
    useStore.getState().ingestClaimResult(claim)
    const claims = useStore.getState().claimsByTab.get(42)
    expect(claims).toHaveLength(1)
    expect(claims![0].id).toBe('c1')
  })

  it('showToast sets toast state', () => {
    useStore.getState().showToast('hello', 'success')
    expect(useStore.getState().toast?.message).toBe('hello')
    expect(useStore.getState().toast?.tone).toBe('success')
  })
})

describe('conflictCheckStatus', () => {
  it('loadConflictCheckStatus fetches and stores status', async () => {
    const spy = vi.spyOn(api, 'getConflictCheckStatus').mockResolvedValue({
      last_checked_at: '2026-05-16T10:00:00Z',
      pending_count: 3,
    })
    await useStore.getState().loadConflictCheckStatus('proj-1')
    const slice = useStore.getState().conflictCheckStatus
    expect(slice.data).toEqual({ last_checked_at: '2026-05-16T10:00:00Z', pending_count: 3 })
    expect(slice.status).toBe('ready')
    spy.mockRestore()
  })

  it('bumpPendingCheck increments pending_count', () => {
    useStore.setState({
      conflictCheckStatus: {
        data: { last_checked_at: null, pending_count: 0 },
        status: 'ready', lastFetched: Date.now(),
      },
    } as any)
    useStore.getState().bumpPendingCheck()
    expect(useStore.getState().conflictCheckStatus.data?.pending_count).toBe(1)
  })

  it('bumpPendingCheck is a no-op when no data loaded yet', () => {
    useStore.setState({
      conflictCheckStatus: { data: null, status: 'idle' },
    } as any)
    useStore.getState().bumpPendingCheck()
    expect(useStore.getState().conflictCheckStatus.data).toBe(null)
  })
})
