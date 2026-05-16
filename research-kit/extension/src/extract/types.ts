// Mirror of backend app/schemas/extract.py response shape.
// Keep in sync if backend schema changes.

export interface ExtractedPaper {
  id: string
  title: string
  doi: string | null
  url: string | null
  authors: string[]
  year: number | null
  anchorText: string
}

export interface ExtractedClaim {
  id: string
  text: string
  paperIds: string[]
}

export interface ExtractMeta {
  provider: string
  latencyMs: number
  inputChars: number
  papersCount: number
  claimsCount: number
  warnings: string[]
}

export interface ExtractResponse {
  papers: ExtractedPaper[]
  claims: ExtractedClaim[]
  extractMeta: ExtractMeta
}
