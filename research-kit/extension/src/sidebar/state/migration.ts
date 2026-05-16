import { DEFAULTS, type StorageSchema } from './storage-schema'

export async function runMigration(): Promise<void> {
  const all = await chrome.storage.local.get(null)
  const v = all.schemaVersion ?? (all.verifyEnabled !== undefined ? 1 : undefined)
  if (v === 2) return

  const next: StorageSchema = {
    ...DEFAULTS,
    verifyEnabled: typeof all.verifyEnabled === 'boolean' ? all.verifyEnabled : DEFAULTS.verifyEnabled,
    onboardingDone: v === 1 ? true : false,
  }

  await chrome.storage.local.set(next)
}
