import type { RagChunk } from './bm25'

const RAG_KEY = 'rag:chunks'
const MAX_CHUNKS = 500

export async function getAllChunks(): Promise<RagChunk[]> {
  const result = await chrome.storage.session.get(RAG_KEY)
  return (result[RAG_KEY] as RagChunk[]) ?? []
}

export async function ingestChunks(incoming: RagChunk[]): Promise<void> {
  const existing = await getAllChunks()
  const seen = new Set(existing.map(dedupKey))
  const fresh = incoming.filter(c => !seen.has(dedupKey(c)))
  if (fresh.length === 0) return
  const combined = [...existing, ...fresh]
  const trimmed = combined.length > MAX_CHUNKS ? combined.slice(combined.length - MAX_CHUNKS) : combined
  await chrome.storage.session.set({ [RAG_KEY]: trimmed })
}

export async function clearChunks(): Promise<void> {
  await chrome.storage.session.remove(RAG_KEY)
}

function dedupKey(c: RagChunk): string {
  return `${c.siteUrl}:${c.text.slice(0, 50)}`
}
