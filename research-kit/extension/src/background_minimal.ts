import {
  MSG_CLAIMS_EXTRACTED, MSG_VERIFY_PROGRESS, MSG_VERIFY_RESULT,
  MSG_CLAIM_RESULT, MSG_TAB_CHANGED,
  MSG_CLAIM_STEP,
  MSG_VERIFY_TOGGLE, MSG_VERIFY_PAUSE,
  MSG_FOCUS_CLAIM, MSG_OPEN_SIDEBAR,
  MSG_RAG_INGEST,
  type MessageClaimsExtracted, type MessageVerifyToggle, type MessageVerifyPause,
  type MessageFocusClaim, type MessageRagIngest,
} from './shared/messages'
import { API_URL as BACKEND_URL } from './shared/config'
import { ingestChunks } from './shared/rag-store'
import type { ClaimItem, VerifyResult, VerifyProgress } from './shared/verify-types'
const MAX_CONCURRENT = 3
const VERIFY_TIMEOUT_MS = 60_000
const SESSION_KEY = 'rk_pending_claims'

let verifyEnabled = true
let paused = false
const queue: ClaimItem[] = []
const inFlight = new Set<string>()
const results = new Map<string, VerifyResult>()
const claimsMap = new Map<string, ClaimItem>()  // full claim data keyed by id
const progressByTab = new Map<number, VerifyProgress>()

// Persist in-flight claims so they can be recovered if the service worker is killed
function persistPending() {
  const pending = [...inFlight].map(id => claimsMap.get(id)).filter(Boolean) as ClaimItem[]
  chrome.storage.session.set({ [SESSION_KEY]: pending }).catch(() => {})
}

// On startup, re-queue any claims that were in-flight when the SW was last killed
chrome.storage.session.get(SESSION_KEY).then((data: any) => {
  const pending: ClaimItem[] = data?.[SESSION_KEY] ?? []
  if (pending.length === 0) return
  chrome.storage.session.remove(SESSION_KEY).catch(() => {})
  for (const c of pending) claimsMap.set(c.id, c)
  queue.push(...pending)
  pump()
}).catch(() => {})

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { })

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.runtime.sendMessage({ type: MSG_TAB_CHANGED, tabId }).catch(() => { })
})

chrome.tabs.onRemoved.addListener((tabId) => {
  progressByTab.delete(tabId)
  for (const [id, c] of claimsMap) {
    if (c.tabId === tabId) {
      claimsMap.delete(id)
      results.delete(id)
    }
  }
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].tabId === tabId) queue.splice(i, 1)
  }
})

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Research Kit] Service Worker initialized')
  chrome.storage.local.get('verifyEnabled', (result: any) => {
    if (result && result.verifyEnabled !== undefined) verifyEnabled = result.verifyEnabled
  })
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MSG_CLAIMS_EXTRACTED) {
    const { tabId, claims } = msg as MessageClaimsExtracted
    if (!verifyEnabled) return
    enqueueForTab(tabId, claims)
    sendResponse({ ok: true })
    return
  }
  if (msg.type === MSG_VERIFY_TOGGLE) {
    verifyEnabled = (msg as MessageVerifyToggle).enabled
    chrome.storage.local.set({ verifyEnabled })
    if (!verifyEnabled) { queue.length = 0; inFlight.clear() }
    return
  }
  if (msg.type === MSG_VERIFY_PAUSE) {
    paused = (msg as MessageVerifyPause).paused
    if (!paused) pump()
    return
  }
  if (msg.type === 'page-detected') {
    if (sender.tab?.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => { })
    }
    return
  }
  if (msg.type === MSG_OPEN_SIDEBAR) {
    if (sender.tab?.id) chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => { })
    return
  }
  if (msg.type === MSG_FOCUS_CLAIM) {
    const m = msg as MessageFocusClaim
    chrome.runtime.sendMessage({ type: MSG_FOCUS_CLAIM, claimId: m.claimId, tabId: sender.tab?.id }).catch(() => { })
    return
  }
  if (msg.type === 'verify:get_results') {
    sendResponse({ results: Object.fromEntries(results) })
    return true
  }
  if (msg.type === 'get:tabid') {
    sendResponse({ tabId: sender.tab?.id ?? 0 })
    return true
  }
  if (msg.type === MSG_RAG_INGEST) {
    const { chunks } = msg as MessageRagIngest
    ingestChunks(chunks).catch(() => {})
    return
  }
})

function enqueueForTab(tabId: number, claims: ClaimItem[]) {
  const existing = new Set(queue.map(c => c.id))
  const fresh = claims.filter(c => !existing.has(c.id) && !results.has(c.id))
  for (const c of fresh) claimsMap.set(c.id, c)
  queue.push(...fresh)
  progressByTab.set(tabId, {
    tabId,
    total: (progressByTab.get(tabId)?.total ?? 0) + fresh.length,
    completed: progressByTab.get(tabId)?.completed ?? 0,
    running: inFlight.size,
    paused,
    pausedSites: [],
    perSite: {
      elicit: { total: 0, completed: 0, running: 0 },
      scispace: { total: 0, completed: 0, running: 0 },
      consensus: { total: 0, completed: 0, running: 0 },
    },
    step: 'queueing',
    stepMessage: `Queued ${fresh.length} claim${fresh.length > 1 ? 's' : ''}`,
  })
  // Notify sidebar of tab and broadcast each pending claim immediately
  chrome.runtime.sendMessage({ type: MSG_TAB_CHANGED, tabId }).catch(() => { })
  for (const c of fresh) broadcastClaimResult(c)
  for (const c of fresh) broadcastClaimStep(c.id, tabId, 'queued', 'Queued for verification')
  broadcastProgress(tabId)
  pump()
}

function pump() {
  if (paused || !verifyEnabled) return
  while (inFlight.size < MAX_CONCURRENT && queue.length > 0) {
    const claim = queue.shift()!
    inFlight.add(claim.id)
    persistPending()
    verifyOne(claim).then(() => {
      inFlight.delete(claim.id)
      persistPending()
      pump()
    })
  }
}

async function verifyOne(claim: ClaimItem) {
  broadcastClaimStep(claim.id, claim.tabId, 'verifying', 'Checking source and evidence')
  let updatedClaim: ClaimItem
  try {
    const resp = await fetch(`${BACKEND_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claim: claim.text,
        doi: claim.doi,
        paper_url: claim.paperUrl,
        paper_title: claim.paperTitle,
      }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })

    if (!resp.ok) {
      const errorReason =
        resp.status === 503 ? 'Service unavailable — try again later'
        : resp.status === 429 ? 'Rate limited — try again later'
        : resp.status === 400 ? 'Invalid request'
        : `Server error (${resp.status})`
      const errorResult: VerifyResult = {
        claimId: claim.id, status: 'error',
        verbatimQuote: null, confidence: 0, reason: errorReason,
        paperTitle: claim.paperTitle, doi: claim.doi,
      }
      results.set(claim.id, errorResult)
      updatedClaim = { ...claim, status: 'error', confidence: 0, reason: errorReason }
      broadcastClaimStep(claim.id, claim.tabId, 'failed', errorReason)
    } else {
      const data = await resp.json()
      const result: VerifyResult = {
        claimId: claim.id,
        status: data.status,
        verbatimQuote: data.verbatim_quote ?? null,
        confidence: data.confidence ?? 0,
        reason: data.reason ?? '',
        paperTitle: data.paper_title ?? claim.paperTitle,
        doi: data.doi ?? claim.doi,
      }
      results.set(claim.id, result)
      updatedClaim = {
        ...claim,
        status: result.status,
        confidence: result.confidence,
        quote: result.verbatimQuote,
        reason: result.reason,
      }
    }
  } catch (e) {
    const isTimeout = e instanceof DOMException && e.name === 'TimeoutError'
    const reason = isTimeout ? 'Verification timed out — try again' : 'Network error'
    const errorResult: VerifyResult = {
      claimId: claim.id, status: 'error',
      verbatimQuote: null, confidence: 0, reason,
      paperTitle: claim.paperTitle, doi: claim.doi,
    }
    results.set(claim.id, errorResult)
    updatedClaim = { ...claim, status: 'error', confidence: 0, reason }
  }
  claimsMap.set(claim.id, updatedClaim)
  broadcastClaimResult(updatedClaim)
  // Keep MSG_VERIFY_RESULT for legacy listeners (badge.ts etc.)
  chrome.runtime.sendMessage({ type: MSG_VERIFY_RESULT, result: results.get(claim.id) }).catch(() => { })
  broadcastClaimStep(claim.id, claim.tabId, updatedClaim.status === 'error' ? 'failed' : 'done')

  const prog = progressByTab.get(claim.tabId)
  if (prog) {
    const nextCompleted = prog.completed + 1
    const nextRunning = inFlight.size
    progressByTab.set(claim.tabId, {
      ...prog,
      completed: nextCompleted,
      running: nextRunning,
      step: nextCompleted >= prog.total && nextRunning === 0 ? 'done' : 'verifying',
      stepMessage: nextCompleted >= prog.total && nextRunning === 0
        ? 'Verification complete'
        : `Verifying ${nextRunning} in progress`,
    })
    broadcastProgress(claim.tabId)
  }
}

function broadcastClaimResult(claim: ClaimItem) {
  chrome.runtime.sendMessage({ type: MSG_CLAIM_RESULT, result: claim }).catch(() => { })
}

function broadcastProgress(tabId: number) {
  const progress = progressByTab.get(tabId)
  if (!progress) return
  chrome.runtime.sendMessage({ type: MSG_VERIFY_PROGRESS, progress }).catch(() => { })
}

function broadcastClaimStep(
  claimId: string,
  tabId: number,
  step: 'queued' | 'verifying' | 'retrying' | 'done' | 'failed',
  detail?: string,
) {
  chrome.runtime.sendMessage({ type: MSG_CLAIM_STEP, claimId, tabId, step, detail }).catch(() => { })
}
