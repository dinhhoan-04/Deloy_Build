export type SiteTool = 'elicit' | 'chatgpt' | 'perplexity'

export type ExtractionStatus = 'idle' | 'extracting' | 'extracted' | 'error'
export type VerifyStatus = 'idle' | 'verifying' | 'verified' | 'error'

export interface LinkRef {
  url: string
  anchor: string
  source: 'inline' | 'citation'
}

export interface ExtractedContent {
  mainText: string
  inlineLinks: LinkRef[]
  citationLinks: LinkRef[]
  unresolvedCitations: string[]
  charCount: number
  extractedAt: number
}

export interface LinkResult {
  input_url: string
  final_url: string | null
  doi: string | null
  depth: number
  status: 'doi_found' | 'terminal_no_doi' | 'unreachable' | 'max_depth' | 'timeout'
  http_status?: number
  hops: Array<{ url: string; via: string }>
  error?: string
}

export interface VerifyResult {
  results: LinkResult[]
  summary: {
    total: number
    dead: number
    doi_found: number
    terminal_no_doi: number
  }
}

export interface SiteState {
  tabId: number
  tool: SiteTool
  url: string
  title: string
  windowId: number
  hasContent: boolean
  extraction: {
    status: ExtractionStatus
    content?: ExtractedContent
    error?: string
  }
  verify: {
    status: VerifyStatus
    result?: VerifyResult
    progress?: { done: number; total: number }
    error?: string
  }
}
