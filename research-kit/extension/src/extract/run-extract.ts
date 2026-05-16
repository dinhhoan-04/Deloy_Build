import { serializeDOMToMarkdown } from '../adapters/dom-serializer'
import { API_URL as BACKEND_URL } from '../shared/config'
import type { ClaimItem, SiteId } from '../shared/verify-types'
import type { ExtractResponse } from './types'
const MIN_MARKDOWN_CHARS = 500  // skip empty/loading pages — real result pages are always >> 500 chars

export interface RunExtractOptions {
  url: string
  site: SiteId
  tabId: number
}

export interface FlattenContext {
  site: SiteId
  tabId: number
  pageUrl: string
}

interface LocalPair {
  key: string
  claimText: string
  paperTitle: string | null
  doi: string | null
  paperUrl: string | null
  anchorText: string
}

const DOI_RE = /10\.\d{4,9}\/[^\s"'>)]+/i

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function cleanDoi(raw: string | null): string | null {
  if (!raw) return null
  const m = raw.match(DOI_RE)
  return m ? m[0].replace(/[.,;:]+$/, '') : null
}

function extractLocalPairs(site: SiteId): LocalPair[] {
  if (site !== 'scispace') return []

  const out: LocalPair[] = []
  const debugRows: Array<{
    rowId: string
    hasPaperCell: boolean
    hasInsightCell: boolean
    title: string
    doi: string
    claimLen: number
    droppedReason: string | null
  }> = []

  // SciSpace table mode: each row maps one paper cell to one insight cell.
  const rows = Array.from(document.querySelectorAll('tr[id^="PAPER-"]'))
  for (const row of rows) {
    const rowId = row.getAttribute('id') ?? ''
    const paperCell = row.querySelector(`td[id="${rowId}-papers"]`) ?? row.querySelector('td[id$="-papers"]')
    const insightCell = row.querySelector('td[data-column-key="insights"]')
    if (!paperCell || !insightCell) {
      debugRows.push({
        rowId,
        hasPaperCell: Boolean(paperCell),
        hasInsightCell: Boolean(insightCell),
        title: '',
        doi: '',
        claimLen: 0,
        droppedReason: 'missing_paper_or_insight_cell',
      })
      continue
    }

    const claimEl = insightCell.querySelector('span[data-markdown-renderer-content="true"] p, div.prose p, p')
    const claimText = normalizeText(claimEl?.textContent ?? '')
    if (!claimText || claimText.length < 20) {
      debugRows.push({
        rowId,
        hasPaperCell: true,
        hasInsightCell: true,
        title: '',
        doi: '',
        claimLen: claimText.length,
        droppedReason: 'insight_too_short_or_empty',
      })
      continue
    }

    const titleAnchor = paperCell.querySelector('[data-element="publication_name"] a, a[href*="/papers/"]')
    const paperTitle = normalizeText(titleAnchor?.textContent ?? '').replace(/^\d+\.\s*/, '') || null

    const doiAnchor = paperCell.querySelector('a[href*="doi.org/"]') as HTMLAnchorElement | null
    const doi = cleanDoi(doiAnchor?.textContent ?? doiAnchor?.href ?? null)
    const paperUrl = doiAnchor?.href ?? (titleAnchor as HTMLAnchorElement | null)?.href ?? null
    const anchorText = normalizeText(doiAnchor?.textContent ?? titleAnchor?.textContent ?? '')

    if (!paperTitle && !doi) {
      debugRows.push({
        rowId,
        hasPaperCell: true,
        hasInsightCell: true,
        title: '',
        doi: '',
        claimLen: claimText.length,
        droppedReason: 'missing_title_and_doi',
      })
      continue
    }
    out.push({ key: rowId, claimText, paperTitle, doi, paperUrl, anchorText })
    debugRows.push({
      rowId,
      hasPaperCell: true,
      hasInsightCell: true,
      title: paperTitle ?? '',
      doi: doi ?? '',
      claimLen: claimText.length,
      droppedReason: null,
    })
  }

  // SciSpace card mode fallback.
  const cards = Array.from(document.querySelectorAll('div[id^="PAPER-"][id$="-insights"]'))
  for (const insights of cards) {
    const key = insights.getAttribute('id') ?? `insights-${out.length}`
    const wrapper = insights.closest('div.border-neutral-a300, div[class*="shadow-card"], div[class*="rounded-md"]')
      ?? insights.parentElement
    if (!wrapper) continue

    const claimEl = insights.querySelector('span[data-markdown-renderer-content="true"] p, div.prose p')
    const claimText = normalizeText(claimEl?.textContent ?? '')
    if (!claimText || claimText.length < 30) continue

    const titleAnchor = wrapper.querySelector('a[href*="/papers/"], [data-element="publication_name"] a')
    const paperTitle = normalizeText(titleAnchor?.textContent ?? '') || null

    const doiAnchor = wrapper.querySelector('a[href*="doi.org/"]') as HTMLAnchorElement | null
    const doi = cleanDoi(doiAnchor?.textContent ?? doiAnchor?.href ?? null)
    const paperUrl = doiAnchor?.href ?? null
    const anchorText = normalizeText(doiAnchor?.textContent ?? titleAnchor?.textContent ?? '')

    if (!paperTitle && !doi) continue
    out.push({ key, claimText, paperTitle, doi, paperUrl, anchorText })
  }

  const kept = debugRows.filter((r) => r.droppedReason === null).length
  const dropped = debugRows.length - kept
  console.groupCollapsed('[extract][scispace-debug] row scan rows=%d kept=%d dropped=%d cardFallbackPairs=%d', rows.length, kept, dropped, out.length - kept)
  for (const r of debugRows.slice(0, 20)) {
    console.log(
      'row=%s paperCell=%s insightCell=%s claimLen=%d doi=%s title=%s drop=%s',
      r.rowId || '(none)',
      r.hasPaperCell,
      r.hasInsightCell,
      r.claimLen,
      r.doi || '(none)',
      r.title ? r.title.slice(0, 80) : '(none)',
      r.droppedReason ?? 'kept',
    )
  }
  if (debugRows.length > 20) {
    console.log('... %d more rows omitted', debugRows.length - 20)
  }
  console.groupEnd()

  return out
}

function localPairsToItems(pairs: LocalPair[], ctx: FlattenContext): ClaimItem[] {
  const now = Date.now()
  return pairs.map((pair, i) => ({
    id: `local-${pair.key || i}`,
    claimGroupId: `local-c${i + 1}`,
    text: pair.claimText,
    paperTitle: pair.paperTitle,
    doi: pair.doi,
    paperUrl: pair.paperUrl,
    page: '',
    site: ctx.site,
    status: 'pending',
    confidence: 0,
    quote: null,
    reason: '',
    saved: false,
    domAnchor: pair.anchorText,
    tabId: ctx.tabId,
    pageUrl: ctx.pageUrl,
    extractedAt: now,
  }))
}

// Flatten {papers, claims} into 1 ClaimItem per (claim × paper) pair.
//
// WHY THIS EXISTS: the current backend POST /v1/verify accepts 1 claim × 1 paper.
// The extract response uses claims[i].paperIds[] to bind correctly (one claim
// can cite multiple papers). We expand here so the existing verify queue in
// background_minimal.ts can consume it without change.
//
// IF YOU REFACTOR /v1/verify TO ACCEPT {claims, papers} DIRECTLY, delete this
// flatten step and pass the response through unchanged.
export function flattenForVerifyQueue(
  resp: ExtractResponse,
  ctx: FlattenContext,
): ClaimItem[] {
  const paperById = new Map(resp.papers.map((p) => [p.id, p]))
  const now = Date.now()
  const items: ClaimItem[] = []
  for (const claim of resp.claims) {
    for (const paperId of claim.paperIds) {
      const paper = paperById.get(paperId)
      if (!paper) continue  // defensive — backend validator should already drop these
      items.push({
        id: `${claim.id}::${paperId}`,
        claimGroupId: claim.id,
        text: claim.text,
        paperTitle: paper.title,
        doi: paper.doi,
        paperUrl: paper.url,
        page: '',  // paper page number — not available from LLM extract; ignored by verify queue
        site: ctx.site,
        status: 'pending',
        confidence: 0,
        quote: null,
        reason: '',
        saved: false,
        domAnchor: paper.anchorText,
        tabId: ctx.tabId,
        pageUrl: ctx.pageUrl,
        extractedAt: now,
      })
    }
  }
  return items
}

export async function runExtract(opts: RunExtractOptions): Promise<ClaimItem[]> {
  const localPairs = extractLocalPairs(opts.site)
  if (localPairs.length > 0) {
    console.log('[extract] local DOM pairs found=%d (site=%s)', localPairs.length, opts.site)
    const localItems = localPairsToItems(localPairs, {
      site: opts.site,
      tabId: opts.tabId,
      pageUrl: opts.url,
    })
    console.log('[extract] local DOM extraction returning %d claim×paper pairs', localItems.length)
    return localItems
  }

  const markdown = serializeDOMToMarkdown()
  console.log('[extract] markdown serialized chars=%d', markdown.length)

  if (markdown.length < MIN_MARKDOWN_CHARS) {
    console.log('[extract] skip: markdown too short (min=%d)', MIN_MARKDOWN_CHARS)
    return []
  }

  console.log('[extract] POST %s/extract site=%s', BACKEND_URL, opts.site)
  const t0 = performance.now()

  let resp: Response
  try {
    resp = await fetch(`${BACKEND_URL}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: opts.url,
        site: opts.site,
        page_markdown: markdown,
      }),
    })
  } catch (e) {
    console.error('[extract] network error (is backend running on port 8000?)', e)
    return []
  }

  const elapsed = Math.round(performance.now() - t0)
  if (!resp.ok) {
    console.warn('[extract] backend %d in %dms', resp.status, elapsed)
    return []
  }

  const data = (await resp.json()) as ExtractResponse
  const { provider, latencyMs, papersCount, claimsCount, warnings } = data.extractMeta
  console.log(
    '[extract] ✓ provider=%s latency=%dms papers=%d claims=%d totalRtt=%dms',
    provider, latencyMs, papersCount, claimsCount, elapsed,
  )
  if (warnings.length > 0) {
    console.warn('[extract] warnings:', warnings)
  }

  // ── DETAILED EXTRACT LOG ──────────────────────────────────────────────────
  console.groupCollapsed('[extract] RAW PAPERS (%d)', data.papers.length)
  for (const p of data.papers) {
    console.log(
      '  %s | title: %s | doi: %s | url: %s | authors: %s | year: %s',
      p.id,
      p.title || '(none)',
      p.doi || '(none)',
      p.url || '(none)',
      p.authors.length ? p.authors.join(', ') : '(none)',
      p.year ?? '(none)',
    )
  }
  console.groupEnd()

  console.groupCollapsed('[extract] RAW CLAIMS (%d)', data.claims.length)
  const paperById = new Map(data.papers.map((p) => [p.id, p]))
  for (const c of data.claims) {
    const papers = c.paperIds
      .map((pid) => {
        const p = paperById.get(pid)
        return p ? `${pid}(${p.doi ?? p.title ?? '?'})` : `${pid}(?)`
      })
      .join(', ')
    console.log('  %s | papers: [%s]\n       text: %s', c.id, papers, c.text)
  }
  console.groupEnd()

  console.log('[extract] SUMMARY — claims with doi: %d / %d | claims with title: %d / %d',
    data.claims.filter(c => c.paperIds.some(pid => paperById.get(pid)?.doi)).length,
    data.claims.length,
    data.claims.filter(c => c.paperIds.some(pid => paperById.get(pid)?.title)).length,
    data.claims.length,
  )
  // ─────────────────────────────────────────────────────────────────────────

  const items = flattenForVerifyQueue(data, {
    site: opts.site,
    tabId: opts.tabId,
    pageUrl: opts.url,
  })

  console.log('[extract] flattened to %d ClaimItems (claim×paper pairs)', items.length)
  return items
}
