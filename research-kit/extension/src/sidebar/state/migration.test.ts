import { describe, it, expect } from 'vitest'
import { runMigration } from './migration'
import { DEFAULTS, DEFAULT_PROJECT } from './storage-schema'

describe('migration', () => {
  it('seeds defaults on fresh install', async () => {
    await runMigration()
    const all = await chrome.storage.local.get(null)
    expect(all.schemaVersion).toBe(2)
    expect(all.projects).toEqual([DEFAULT_PROJECT])
    expect(all.currentProjectId).toBe(DEFAULT_PROJECT.id)
    expect(all.activeSites).toEqual(DEFAULTS.activeSites)
    expect(all.onboardingDone).toBe(false)
    expect(all.verifyEnabled).toBe(true)
  })

  it('is idempotent (v=2 short-circuits)', async () => {
    await chrome.storage.local.set({ schemaVersion: 2, verifyEnabled: false, provider: 'gemini' })
    await runMigration()
    const all = await chrome.storage.local.get(null)
    expect(all.verifyEnabled).toBe(false)
    expect(all.provider).toBe('gemini')
  })

  it('preserves existing verifyEnabled when bootstrapping', async () => {
    await chrome.storage.local.set({ verifyEnabled: false })
    await runMigration()
    const all = await chrome.storage.local.get(null)
    expect(all.verifyEnabled).toBe(false)
    expect(all.schemaVersion).toBe(2)
  })

  it('marks onboardingDone=true when migrating from v1 (verifyEnabled present, no schemaVersion)', async () => {
    await chrome.storage.local.set({ verifyEnabled: true })
    await runMigration()
    const all = await chrome.storage.local.get(null)
    expect(all.onboardingDone).toBe(true)
  })
})
