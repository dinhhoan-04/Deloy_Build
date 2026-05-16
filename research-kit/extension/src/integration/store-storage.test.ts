import { describe, it, expect, beforeEach } from 'vitest'
import { runMigration } from '../sidebar/state/migration'
import { useStore } from '../sidebar/state/useStore'

beforeEach(async () => {
  // Reset storage between tests via migration (idempotent fresh state)
  await runMigration()
})

describe('store → storage: site settings persistence', () => {
  it('disabling a site persists across hydrate', async () => {
    await useStore.getState().hydrate()
    expect(useStore.getState().activeSites.has('elicit')).toBe(true)

    await useStore.getState().setActiveSite('elicit', false)
    await useStore.getState().hydrate()
    expect(useStore.getState().activeSites.has('elicit')).toBe(false)
  })

  it('re-enabling site persists across hydrate', async () => {
    await useStore.getState().hydrate()
    await useStore.getState().setActiveSite('elicit', false)
    await useStore.getState().setActiveSite('elicit', true)
    await useStore.getState().hydrate()
    expect(useStore.getState().activeSites.has('elicit')).toBe(true)
  })

  it('globalPaused persists across hydrate', async () => {
    await useStore.getState().hydrate()
    await useStore.getState().setGlobalPaused(true)
    await useStore.getState().hydrate()
    expect(useStore.getState().globalPaused).toBe(true)
  })
})

describe('store → storage: onboarding flow', () => {
  it('fresh install → onboardingDone=false persists', async () => {
    await useStore.getState().hydrate()
    expect(useStore.getState().onboardingDone).toBe(false)
    const stored = (await chrome.storage.local.get('onboardingDone')).onboardingDone
    expect(stored).toBe(false)
  })

  it('completing onboarding persists across hydrate', async () => {
    await useStore.getState().hydrate()
    await useStore.getState().setOnboardingDone(true)
    await useStore.getState().hydrate()
    expect(useStore.getState().onboardingDone).toBe(true)
  })

  it('replaying onboarding (setOnboardingDone false) re-shows overlay', async () => {
    await useStore.getState().hydrate()
    await useStore.getState().setOnboardingDone(true)
    await useStore.getState().setOnboardingDone(false)
    await useStore.getState().hydrate()
    expect(useStore.getState().onboardingDone).toBe(false)
  })
})

describe('store → storage: project switching', () => {
  it('switchProject persists across hydrate', async () => {
    await useStore.getState().hydrate()
    await useStore.getState().switchProject('p_123')
    await useStore.getState().hydrate()
    expect(useStore.getState().currentProjectId).toBe('p_123')
  })
})
