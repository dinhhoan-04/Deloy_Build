import { useEffect, useRef } from 'react'
import { useStore } from '../state/useStore'

const POLL_INTERVAL_MS = 3000
const MAX_POLL_ATTEMPTS = 20 // ~60s total before giving up

/**
 * Polls GET /v1/conflicts/check-status while `isActive` is true. Stops polling
 * the moment `pending_count` reaches 0, and triggers one `loadConflicts` refresh
 * at the > 0 → 0 transition so newly-created conflicts surface in the list.
 *
 * Guard rail: if pending stays > 0 after MAX_POLL_ATTEMPTS (~60s), stop polling
 * and flip `conflictCheckStalled` so the header can show a stalled fallback
 * instead of an infinite spinner.
 */
export function useConflictCheckPolling(projectId: string | null, isActive: boolean) {
  const loadStatus = useStore(s => s.loadConflictCheckStatus)
  const loadConflicts = useStore(s => s.loadConflicts)
  const markStalled = useStore(s => s.markConflictCheckStalled)
  const pollEpoch = useStore(s => s.conflictCheckPollEpoch)
  const prevPendingRef = useRef<number | null>(null)
  const attemptsRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!projectId || !isActive) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      prevPendingRef.current = null
      attemptsRef.current = 0
      return
    }

    let cancelled = false
    attemptsRef.current = 0
    markStalled(false)

    const tick = async () => {
      attemptsRef.current += 1
      await loadStatus(projectId)
      if (cancelled) return
      const next = useStore.getState().conflictCheckStatus.data?.pending_count ?? 0
      const prev = prevPendingRef.current
      if (prev !== null && prev > 0 && next === 0) {
        await loadConflicts(projectId)
      }
      prevPendingRef.current = next

      if (next === 0) {
        if (intervalRef.current !== null) { clearInterval(intervalRef.current); intervalRef.current = null }
        return
      }
      if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
        if (intervalRef.current !== null) { clearInterval(intervalRef.current); intervalRef.current = null }
        markStalled(true)
        await loadConflicts(projectId)
        return
      }
      if (intervalRef.current === null) {
        intervalRef.current = setInterval(tick, POLL_INTERVAL_MS)
      }
    }

    tick()

    return () => {
      cancelled = true
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    }
  }, [projectId, isActive, loadStatus, loadConflicts, markStalled, pollEpoch])
}
