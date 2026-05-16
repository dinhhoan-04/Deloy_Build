import * as api from '../../../shared/api'
import type { Draft } from '../../../shared/types'

export interface DraftSlice {
  draft: {
    data: Draft | null
    saving: boolean
    dirty: boolean
  }
  loadDraft(projectId: string): Promise<void>
  saveDraft(projectId: string, runId: string | null, markdown: string, sections: Array<{ title: string; claim_refs: string[] }>): Promise<void>
  updateDraftField(draftId: string, field: 'title' | 'markdown', value: string): Promise<void>
  deleteDraft(draftId: string): Promise<void>
  markDraftDirty(): void
}

export function createDraftSlice(set: any, get: any): DraftSlice {
  return {
    draft: { data: null, saving: false, dirty: false },

    async loadDraft(projectId) {
      const data = await api.getDraft(projectId)
      set({ draft: { data, saving: false, dirty: false } })
    },

    async saveDraft(projectId, runId, markdown, sections) {
      set((s: any) => ({ draft: { ...s.draft, saving: true } }))
      try {
        const data = await api.upsertDraft({ project_id: projectId, run_id: runId, markdown, sections })
        set({ draft: { data, saving: false, dirty: false } })
      } catch {
        set((s: any) => ({ draft: { ...s.draft, saving: false } }))
        get().showToast('Failed to save draft', 'error')
      }
    },

    async updateDraftField(draftId, field, value) {
      set((s: any) => ({ draft: { ...s.draft, dirty: true } }))
      try {
        const data = await api.patchDraft(draftId, { [field]: value })
        set({ draft: { data, saving: false, dirty: false } })
      } catch {
        set((s: any) => ({ draft: { ...s.draft, dirty: true } }))
        get().showToast('Unsaved changes — auto-save failed', 'warning')
      }
    },

    async deleteDraft(draftId) {
      await api.deleteDraft(draftId)
      set({ draft: { data: null, saving: false, dirty: false } })
    },

    markDraftDirty() {
      set((s: any) => ({ draft: { ...s.draft, dirty: true } }))
    },
  }
}
