import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useChromeStorage } from './useChromeStorage'
import { useStore } from '../state/useStore'
import { runMigration } from '../state/migration'

describe('useChromeStorage', () => {
  it('hydrates store on mount', async () => {
    await runMigration()
    renderHook(() => useChromeStorage())
    await waitFor(() => {
      // useChromeStorage hydrates persisted settings, not projects
      expect(useStore.getState().currentProjectId).toBe('p_default')
      expect(useStore.getState().verifyEnabled).toBe(true)
    })
  })

  it('re-hydrates on storage change', async () => {
    await runMigration()
    renderHook(() => useChromeStorage())
    await chrome.storage.local.set({ verifyEnabled: false })
    await waitFor(() => {
      expect(useStore.getState().verifyEnabled).toBe(false)
    })
  })
})
