import type { SiteId } from './verify-types'

// Per-site URL rules. shouldExtract returns false ONLY when path matches a skip
// pattern. Everything else on a recognised site is allowed.
//
// Skip rules block pages with no extractable content: homepages, auth, settings,
// pricing, and list pages that show no claims. Err on the side of attempting
// extraction — a wasted LLM call on a thin page is cheaper than silently missing
// a real result page because its URL didn't match a narrow allowlist.

const SITE_RULES: Record<SiteId, { skip: RegExp[] }> = {
  elicit: {
    skip: [
      /^\/?$/,            // homepage
      /^\/notebooks\/?$/, // notebooks list (not an individual notebook)
      /^\/login/,
      /^\/settings/,
      /^\/pricing/,
    ],
  },
  scispace: {
    skip: [
      /^\/?$/,
      /^\/login/,
      /^\/pricing/,
    ],
  },
  consensus: {
    skip: [
      /^\/?$/,
      /^\/login/,
      /^\/pricing/,
    ],
  },
}

export type ElicitMode = 'notebook' | 'research' | 'list' | 'paper' | 'search' | null

export function detectElicitMode(url: string): ElicitMode {
  const patterns = {
    notebook: /\/notebooks?\/[^/]+/,
    research: /\/research\/[^/]+/,
    list: /\/lists?\/[^/]+/,
    paper: /\/papers?\/[^/]+/,
    search: /\/search/,
  }
  for (const [mode, pattern] of Object.entries(patterns)) {
    if (pattern.test(url)) return mode as ElicitMode
  }
  return null
}

export function detectSite(url: string): SiteId | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname.includes('elicit.com')) return 'elicit'
    if (hostname.includes('scispace.com')) return 'scispace'
    if (hostname.includes('consensus.app')) return 'consensus'
    return null
  } catch {
    return null
  }
}

export function shouldExtract(url: string): boolean {
  const site = detectSite(url)
  if (!site) return false  // detectSite already validated the URL parses
  const path = new URL(url).pathname
  return !SITE_RULES[site].skip.some((rx) => rx.test(path))
}

export function detectToolName(url: string): 'chatgpt' | 'perplexity' | 'elicit' | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) return 'chatgpt'
    if (hostname.includes('perplexity.ai')) return 'perplexity'
    if (hostname.includes('elicit.com')) return 'elicit'
    return null
  } catch {
    return null
  }
}
