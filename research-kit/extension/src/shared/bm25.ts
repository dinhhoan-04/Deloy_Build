export interface RagChunk {
  id: string
  source: 'page' | 'claim'
  siteUrl: string
  pageTitle: string
  text: string
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean)
}

export function bm25Search(query: string, chunks: RagChunk[], topK = 5): RagChunk[] {
  if (chunks.length === 0) return []
  const k1 = 1.5, b = 0.75
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return chunks.slice(0, topK)

  const docs = chunks.map(c => tokenize(c.text))
  const avgDl = docs.reduce((s, d) => s + d.length, 0) / docs.length

  const idf = new Map<string, number>()
  for (const term of queryTokens) {
    const df = docs.filter(d => d.includes(term)).length
    idf.set(term, Math.log((docs.length - df + 0.5) / (df + 0.5) + 1))
  }

  const scored = chunks.map((chunk, i) => {
    const doc = docs[i]
    const dl = doc.length
    const freq = new Map<string, number>()
    for (const t of doc) freq.set(t, (freq.get(t) ?? 0) + 1)
    let score = 0
    for (const term of queryTokens) {
      const tf = freq.get(term) ?? 0
      score += (idf.get(term) ?? 0) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgDl))
    }
    return { chunk, score }
  })

  return scored
    .sort((a, z) => z.score - a.score)
    .slice(0, topK)
    .filter(s => s.score > 0)
    .map(s => s.chunk)
}

export function buildContext(chunks: RagChunk[]): string {
  if (chunks.length === 0) return ''
  const parts = chunks.map(c =>
    `[${c.source === 'claim' ? 'Claim' : 'Page'} from ${c.siteUrl}]\n${c.text}`
  )
  return 'Relevant content:\n\n' + parts.join('\n\n---\n\n')
}
