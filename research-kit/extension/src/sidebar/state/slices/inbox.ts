import * as api from '../../../shared/api'
import type { InboxItem } from '../../../shared/types'
import { idle } from './_slice'
import type { Slice } from './_slice'

export interface InboxSlice {
  inbox: Slice<InboxItem[]>
  loadInbox(projectId: string): Promise<void>
  addToInbox(projectId: string, claimId: string): Promise<void>
  removeFromInbox(inboxId: string): Promise<void>
  archiveMany(inboxIds: string[]): Promise<void>
  unarchiveMany(inboxIds: string[]): Promise<void>
}

export function createInboxSlice(set: any, get: any): InboxSlice {
  return {
    inbox: idle<InboxItem[]>([]),
    async loadInbox(projectId) {
      set((s: any) => ({ inbox: { ...s.inbox, status: 'loading' } }))
      try {
        const data = await api.listInbox(projectId)
        set({ inbox: { data, status: 'ready', lastFetched: Date.now() } })
      } catch (e: any) {
        set((s: any) => ({ inbox: { ...s.inbox, status: 'error', error: e.message } }))
      }
    },
    async addToInbox(projectId, claimId) {
      await api.addToInbox(projectId, claimId)
      await get().loadInbox(projectId)
    },
    async removeFromInbox(inboxId) {
      await api.removeFromInbox(inboxId)
      const pid = get().currentProjectId
      if (pid) await get().loadInbox(pid)
    },
    async archiveMany(ids) {
      const now = new Date().toISOString()
      await api.bulkPatchInbox(ids, now)
      const pid = get().currentProjectId
      if (pid) await get().loadInbox(pid)
    },
    async unarchiveMany(ids) {
      await api.bulkPatchInbox(ids, null)
      const pid = get().currentProjectId
      if (pid) await get().loadInbox(pid)
    },
  }
}
