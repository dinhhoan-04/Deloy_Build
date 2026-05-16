import * as api from '../../../shared/api'
import type { Conflict, ConflictCheckStatus, ResolutionPayload } from '../../../shared/types'
import { idle } from './_slice'
import type { Slice } from './_slice'

export interface ConflictsSlice {
  conflicts: Slice<Conflict[]>
  conflictCheckStatus: Slice<ConflictCheckStatus | null>
  conflictCheckStalled: boolean
  conflictCheckPollEpoch: number
  loadConflicts(projectId: string): Promise<void>
  loadConflictCheckStatus(projectId: string): Promise<void>
  bumpPendingCheck(): void
  markConflictCheckStalled(stalled: boolean): void
  restartConflictCheckPolling(): void
  patchConflict(id: string, resolution: ResolutionPayload): Promise<void>
  confirmConflict(conflictId: string, acceptedClaimId: string): Promise<void>
}

export function createConflictsSlice(set: any, get: any): ConflictsSlice {
  return {
    conflicts: idle<Conflict[]>([]),
    conflictCheckStatus: idle<ConflictCheckStatus | null>(null),
    conflictCheckStalled: false,
    conflictCheckPollEpoch: 0,
    async loadConflicts(projectId) {
      set((s: any) => ({ conflicts: { ...s.conflicts, status: 'loading' } }))
      try {
        const data = await api.listConflicts(projectId)
        set({ conflicts: { data, status: 'ready', lastFetched: Date.now() } })
      } catch (e: any) {
        set((s: any) => ({ conflicts: { ...s.conflicts, status: 'error', error: e.message } }))
      }
    },
    async loadConflictCheckStatus(projectId) {
      try {
        const data = await api.getConflictCheckStatus(projectId)
        set((s: any) => ({
          conflictCheckStatus: { data, status: 'ready', lastFetched: Date.now() },
          conflictCheckStalled: data.pending_count === 0 ? false : s.conflictCheckStalled,
        }))
      } catch (e: any) {
        set((s: any) => ({ conflictCheckStatus: { ...s.conflictCheckStatus, status: 'error', error: e.message } }))
      }
    },
    markConflictCheckStalled(stalled) {
      set({ conflictCheckStalled: stalled })
    },
    restartConflictCheckPolling() {
      set((s: any) => ({
        conflictCheckStalled: false,
        conflictCheckPollEpoch: s.conflictCheckPollEpoch + 1,
      }))
    },
    bumpPendingCheck() {
      const s = get().conflictCheckStatus
      if (!s.data) return
      set({
        conflictCheckStatus: {
          ...s,
          data: { ...s.data, pending_count: s.data.pending_count + 1 },
        },
      })
    },
    async patchConflict(id, resolution) {
      await api.patchConflict(id, resolution)
      const pid = get().currentProjectId
      if (pid) await get().loadConflicts(pid)
    },
    async confirmConflict(conflictId, acceptedClaimId) {
      const { conflict, inbox_item } = await api.confirmConflict(conflictId, acceptedClaimId)
      set((s: any) => ({
        conflicts: {
          ...s.conflicts,
          data: s.conflicts.data.filter((c: any) => c.id !== conflict.id),
        },
        inbox: {
          ...s.inbox,
          data: [inbox_item, ...s.inbox.data],
        },
      }))
    },
  }
}
