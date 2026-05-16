import * as api from '../../../shared/api'
import type { Claim, ClaimPatch } from '../../../shared/types'
import { idle } from './_slice'
import type { Slice } from './_slice'

export interface ClaimsSlice {
  claims: Slice<Claim[]>
  loadClaims(projectId: string): Promise<void>
  patchClaim(id: string, patch: ClaimPatch): Promise<void>
}

export function createClaimsSlice(set: any, get: any): ClaimsSlice {
  return {
    claims: idle<Claim[]>([]),
    async loadClaims(projectId) {
      set((s: any) => ({ claims: { ...s.claims, status: 'loading' } }))
      try {
        const data = await api.listClaims(projectId)
        set({ claims: { data, status: 'ready', lastFetched: Date.now() } })
      } catch (e: any) {
        set((s: any) => ({ claims: { ...s.claims, status: 'error', error: e.message } }))
      }
    },
    async patchClaim(id, patch) {
      await api.patchClaim(id, patch)
      const pid = get().currentProjectId
      if (pid) await get().loadClaims(pid)
    },
  }
}
