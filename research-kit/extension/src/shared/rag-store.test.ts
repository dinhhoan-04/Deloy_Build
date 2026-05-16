import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getAllChunks, ingestChunks, clearChunks } from './rag-store'
import type { RagChunk } from './bm25'

// chrome.storage.session mock (not in global setup — session storage is separate)
const sessionData: Record<string, any> = {}
const sessionMock = {
  get: vi.fn((key: string) => Promise.resolve({ [key]: sessionData[key] })),
  set: vi.fn((items: Record<string, any>) => {
    Object.assign(sessionData, items)
    return Promise.resolve()
  }),
  remove: vi.fn((key: string) => {
    delete sessionData[key]
    return Promise.resolve()
  }),
}

beforeEach(() => {
  for (const k of Object.keys(sessionData)) delete sessionData[k]
  vi.clearAllMocks()
  ;(globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    storage: { ...(globalThis as any).chrome?.storage, session: sessionMock },
  }
})

function chunk(id: string, text = 'hello world'): RagChunk {
  return { id, source: 'page', siteUrl: 'https://x.com', pageTitle: 'X', text }
}

describe('getAllChunks', () => {
  it('returns empty array when nothing stored', async () => {
    expect(await getAllChunks()).toEqual([])
  })
})

describe('ingestChunks', () => {
  it('stores new chunks', async () => {
    await ingestChunks([chunk('a'), chunk('b')])
    expect(await getAllChunks()).toHaveLength(2)
  })

  it('deduplicates by siteUrl + text prefix', async () => {
    await ingestChunks([chunk('a', 'same text')])
    await ingestChunks([chunk('b', 'same text')]) // same siteUrl + same text
    expect(await getAllChunks()).toHaveLength(1)
  })

  it('accepts different text on same siteUrl', async () => {
    await ingestChunks([chunk('a', 'text one')])
    await ingestChunks([chunk('b', 'text two')])
    expect(await getAllChunks()).toHaveLength(2)
  })

  it('trims to MAX_CHUNKS=500 dropping oldest', async () => {
    const initial = Array.from({ length: 498 }, (_, i) => chunk(`c${i}`, `text ${i}`))
    await ingestChunks(initial)
    await ingestChunks([chunk('new1', 'new one'), chunk('new2', 'new two'), chunk('new3', 'new three')])
    const all = await getAllChunks()
    expect(all).toHaveLength(500)
    expect(all[all.length - 1].id).toBe('new3')
  })
})

describe('clearChunks', () => {
  it('removes all chunks', async () => {
    await ingestChunks([chunk('a'), chunk('b')])
    await clearChunks()
    expect(await getAllChunks()).toEqual([])
  })
})
