import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useConflictCheckPolling } from './useConflictCheckPolling'
import { useStore } from '../state/useStore'
import * as api from '../../shared/api'

describe('useConflictCheckPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    useStore.setState({
      conflictCheckStatus: { data: null, status: 'idle' } as any,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fetches immediately on mount when active', async () => {
    const spy = vi.spyOn(api, 'getConflictCheckStatus').mockResolvedValue({
      last_checked_at: null, pending_count: 0,
    })
    renderHook(() => useConflictCheckPolling('proj-1', true))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  })

  it('does not fetch when inactive', () => {
    const spy = vi.spyOn(api, 'getConflictCheckStatus').mockResolvedValue({
      last_checked_at: null, pending_count: 0,
    })
    renderHook(() => useConflictCheckPolling('proj-1', false))
    expect(spy).not.toHaveBeenCalled()
  })

  it('polls every 3s while pending_count > 0', async () => {
    const spy = vi.spyOn(api, 'getConflictCheckStatus').mockResolvedValue({
      last_checked_at: null, pending_count: 2,
    })
    renderHook(() => useConflictCheckPolling('proj-1', true))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    await act(async () => { vi.advanceTimersByTime(3000) })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    await act(async () => { vi.advanceTimersByTime(3000) })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3))
  })

  it('stops polling and calls loadConflicts when pending transitions to 0', async () => {
    let pending = 1
    const statusSpy = vi.spyOn(api, 'getConflictCheckStatus').mockImplementation(async () => ({
      last_checked_at: '2026-05-16T10:00:00Z', pending_count: pending,
    }))
    const loadSpy = vi.spyOn(api, 'listConflicts').mockResolvedValue([])

    renderHook(() => useConflictCheckPolling('proj-1', true))
    // Wait for initial fetch (pending=1 → interval started)
    await waitFor(() => expect(statusSpy).toHaveBeenCalledTimes(1))

    // Next interval tick with pending=0 should trigger loadConflicts
    pending = 0
    await act(async () => { vi.advanceTimersByTime(3000) })
    await waitFor(() => expect(statusSpy).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(loadSpy).toHaveBeenCalledWith('proj-1'))

    // No more polling after pending=0
    const callsBefore = statusSpy.mock.calls.length
    await act(async () => { vi.advanceTimersByTime(6000) })
    expect(statusSpy.mock.calls.length).toBe(callsBefore)
  })
})
