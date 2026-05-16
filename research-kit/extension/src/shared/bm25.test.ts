import { describe, it, expect } from 'vitest'
import { bm25Search, buildContext, type RagChunk } from './bm25'

function makeChunk(id: string, text: string, source: 'page' | 'claim' = 'page'): RagChunk {
  return { id, source, siteUrl: 'https://example.com', pageTitle: 'Test', text }
}

describe('bm25Search', () => {
  it('returns empty array when no chunks', () => {
    expect(bm25Search('hello', [])).toEqual([])
  })

  it('returns top matching chunks', () => {
    const chunks = [
      makeChunk('a', 'deep learning neural networks'),
      makeChunk('b', 'gardening tips and tricks'),
      makeChunk('c', 'neural network architectures in deep learning'),
    ]
    const results = bm25Search('deep learning', chunks)
    expect(results[0].id).toBe('a')
    expect(results[1].id).toBe('c')
  })

  it('respects topK limit', () => {
    const chunks = Array.from({ length: 10 }, (_, i) =>
      makeChunk(`c${i}`, `machine learning model ${i}`)
    )
    expect(bm25Search('machine learning', chunks, 3)).toHaveLength(3)
  })

  it('returns empty when no scores match', () => {
    const chunks = [makeChunk('a', 'cats and dogs')]
    expect(bm25Search('quantum physics', chunks)).toEqual([])
  })
})

describe('buildContext', () => {
  it('formats page and claim chunks differently', () => {
    const chunks: RagChunk[] = [
      { id: '1', source: 'page', siteUrl: 'https://pubmed.com', pageTitle: 'P', text: 'some finding' },
      { id: '2', source: 'claim', siteUrl: 'https://elicit.com', pageTitle: 'C', text: 'claim text' },
    ]
    const ctx = buildContext(chunks)
    expect(ctx).toContain('[Page from https://pubmed.com]')
    expect(ctx).toContain('[Claim from https://elicit.com]')
    expect(ctx).toContain('some finding')
    expect(ctx).toContain('claim text')
  })

  it('returns empty string for empty chunks', () => {
    expect(buildContext([])).toBe('')
  })
})
