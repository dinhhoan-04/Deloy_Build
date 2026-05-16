import { DEFAULTS, type StorageSchema } from './storage-schema'

export async function readStorage<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K]> {
  const result = await chrome.storage.local.get(key as string)
  const v = (result as any)[key]
  return v === undefined ? DEFAULTS[key] : v
}

export async function writeStorage<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value })
}

export async function appendStorage<K extends keyof StorageSchema>(
  key: K,
  item: StorageSchema[K] extends Array<infer U> ? U : never,
): Promise<void> {
  const current = (await readStorage(key)) as any[]
  const next = [...(current ?? []), item]
  await writeStorage(key, next as any)
}

export function subscribeStorage(
  callback: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void,
): () => void {
  const wrapped = (changes: any, area: string) => callback(changes, area)
  chrome.storage.onChanged.addListener(wrapped)
  return () => chrome.storage.onChanged.removeListener(wrapped)
}
