import { detectSite, shouldExtract } from './shared/site-detect'
import { updateBadge, clearAllBadges, updateBadgeStep } from './content/badge'
import { runExtract } from './extract/run-extract'
import {
  MSG_VERIFY_RESULT,
  MSG_CLAIMS_EXTRACTED,
  MSG_CLAIM_STEP,
  MSG_RAG_INGEST,
  type MessageVerifyResult,
  type MessageClaimStep,
} from './shared/messages'
import type { RagChunk } from './shared/bm25'

const DEBOUNCE_MS = 1500
const RETRY_MS = 2500
const MAX_RETRIES_PER_URL = 6

const site = detectSite(window.location.href)
console.log('[content] init site=%s url=%s', site, window.location.href)
if (site) init()

function extractPageText(): string {
  const skip = new Set(['SCRIPT', 'STYLE', 'NAV', 'FOOTER', 'HEADER', 'ASIDE', 'NOSCRIPT'])
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    const parent = node.parentElement
    if (!parent || skip.has(parent.tagName)) continue
    const t = node.textContent?.trim() ?? ''
    if (t.length >= 50) parts.push(t)
  }
  return parts.join('\n')
}

function chunkText(text: string, maxChars = 500): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/)
  const chunks: string[] = []
  let current = ''
  for (const s of sentences) {
    if (current.length + s.length > maxChars && current.length > 0) {
      chunks.push(current.trim())
      current = ''
    }
    current += (current ? ' ' : '') + s
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

function indexPageForRag(): void {
  function doIndex() {
    const url = location.href
    const title = document.title
    const raw = extractPageText()
    if (raw.length < 100) return
    const chunks: RagChunk[] = chunkText(raw).map((text, i) => ({
      id: `${url}:${i}`,
      source: 'page',
      siteUrl: url,
      pageTitle: title,
      text,
    }))
    chrome.runtime.sendMessage({ type: MSG_RAG_INGEST, chunks }).catch(() => {})
  }
  if (document.readyState === 'complete') doIndex()
  else window.addEventListener('load', doIndex, { once: true })
}

async function init() {
  chrome.runtime.sendMessage({ type: 'site:ready', hasContent: true })

  // Per-tab in-flight flag (set when an extract is running for the current URL).
  let inFlight = false
  let lastExtractedUrl = ''
  let retryCountForUrl = 0
  let debounceTimer: number | undefined
  let retryTimer: number | undefined

  const myTabId = await getTabId()
  console.log('[content] ready site=%s tabId=%d', site, myTabId)

  function scheduleExtract() {
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer)
    console.log('[content] schedule extract in %dms', DEBOUNCE_MS)
    debounceTimer = window.setTimeout(() => triggerExtract(), DEBOUNCE_MS)
  }

  async function triggerExtract() {
    const currentUrl = location.href
    if (!shouldExtract(currentUrl)) {
      console.log('[content] skip: URL gate blocked', currentUrl)
      return
    }
    if (inFlight) {
      console.log('[content] skip: extract already in flight')
      return
    }
    if (currentUrl === lastExtractedUrl) {
      console.log('[content] skip: URL already extracted')
      return
    }
    if (!site) return
    console.log('[content] trigger extract url=%s', currentUrl)
    inFlight = true
    try {
      const claims = await runExtract({ url: currentUrl, site, tabId: myTabId })
      // Drop response if user navigated away mid-extract.
      if (location.href !== currentUrl) {
        console.log('[content] drop: navigated away during extract')
        return
      }
      console.log('[content] extract done claimsCount=%d', claims.length)
      if (claims.length > 0) {
        lastExtractedUrl = currentUrl
        retryCountForUrl = 0
        if (retryTimer !== undefined) {
          window.clearTimeout(retryTimer)
          retryTimer = undefined
        }
        chrome.runtime.sendMessage({
          type: MSG_CLAIMS_EXTRACTED,
          tabId: myTabId,
          claims,
        })
      } else {
        // Do not lock URL as extracted yet: many SPA pages render citations/insights late.
        retryCountForUrl += 1
        console.log('[content] no claims to send (retry %d/%d)', retryCountForUrl, MAX_RETRIES_PER_URL)
        if (retryCountForUrl <= MAX_RETRIES_PER_URL) {
          if (retryTimer !== undefined) window.clearTimeout(retryTimer)
          retryTimer = window.setTimeout(() => {
            // Retry on same URL while content is still streaming in.
            if (location.href === currentUrl) triggerExtract()
          }, RETRY_MS)
        } else {
          console.log('[content] stop retries for url=%s', currentUrl)
        }
      }
    } finally {
      inFlight = false
    }
  }

  // Initial extract once DOM has settled.
  scheduleExtract()
  indexPageForRag()

  // SPA navigation: URL changes without full reload.
  let lastUrl = location.href
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      console.log('[content] SPA nav detected %s → %s', lastUrl, location.href)
      lastUrl = location.href
      retryCountForUrl = 0
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer)
        retryTimer = undefined
      }
      clearAllBadges()
      scheduleExtract()
    }
  }).observe(document, { subtree: true, childList: true })

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MSG_VERIFY_RESULT) {
      const { result } = msg as MessageVerifyResult
      updateBadge(result)
    } else if (msg.type === MSG_CLAIM_STEP) {
      const { claimId, step, detail } = msg as MessageClaimStep
      updateBadgeStep(claimId, step, detail)
    }
  })
}

async function getTabId(): Promise<number> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'get:tabid' }, (resp) => {
      resolve(resp?.tabId ?? 0)
    })
  })
}
