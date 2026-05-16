import type { VerifyResult, VerifyStatus } from '../shared/verify-types'

const BADGE_CLASS = 'rk-verify-badge'

const STATUS_CONFIG: Record<VerifyStatus, { icon: string; bg: string; label: string }> = {
  pending:      { icon: '⋯', bg: '#1e293b', label: 'Verifying...' },
  verified:     { icon: '✓', bg: '#166534', label: 'Verified' },
  partial:      { icon: '~', bg: '#713f12', label: 'Partial — limited access' },
  not_found:    { icon: '✗', bg: '#7f1d1d', label: 'Not found in paper' },
  inaccessible: { icon: '⊘', bg: '#92400e', label: 'Paper inaccessible' },
  error:        { icon: '!', bg: '#4a1d1d', label: 'Error during verify' },
}
const STEP_CONFIG: Record<'queued' | 'verifying' | 'retrying' | 'done' | 'failed', { icon: string; bg: string; label: string }> = {
  queued: { icon: '⋯', bg: '#1e293b', label: 'Queued' },
  verifying: { icon: '⟳', bg: '#1d4ed8', label: 'Verifying evidence' },
  retrying: { icon: '↻', bg: '#92400e', label: 'Retrying verification' },
  done: { icon: '✓', bg: '#166534', label: 'Done' },
  failed: { icon: '!', bg: '#7f1d1d', label: 'Verification failed' },
}

export function injectPendingBadge(claimId: string, domAnchor: string): void {
  const node = findTextNode(domAnchor)
  if (!node || document.querySelector(`[data-rk-claim-id="${claimId}"]`)) return

  const badge = createBadge(claimId, 'pending')
  node.parentElement?.insertAdjacentElement('afterend', badge)
}

export function updateBadge(result: VerifyResult): void {
  const badge = document.querySelector(`[data-rk-claim-id="${result.claimId}"]`) as HTMLElement
  if (!badge) return

  const cfg = STATUS_CONFIG[result.status]
  badge.textContent = cfg.icon
  badge.style.background = cfg.bg
  badge.title = buildTooltipText(result)
  badge.setAttribute('data-rk-status', result.status)
}

export function updateBadgeStep(claimId: string, step: 'queued' | 'verifying' | 'retrying' | 'done' | 'failed', detail?: string): void {
  const badge = document.querySelector(`[data-rk-claim-id="${claimId}"]`) as HTMLElement
  if (!badge) return
  const cfg = STEP_CONFIG[step]
  badge.textContent = cfg.icon
  badge.style.background = cfg.bg
  badge.title = detail ? `${cfg.label}\n${detail}` : cfg.label
  badge.setAttribute('data-rk-step', step)
}

export function clearAllBadges(): void {
  document.querySelectorAll(`.${BADGE_CLASS}`).forEach(el => el.remove())
}

function createBadge(claimId: string, status: VerifyStatus): HTMLElement {
  const cfg = STATUS_CONFIG[status]
  const badge = document.createElement('span')
  badge.className = BADGE_CLASS
  badge.setAttribute('data-rk-claim-id', claimId)
  badge.setAttribute('data-rk-status', status)
  badge.textContent = cfg.icon
  badge.style.cssText = `
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 50%;
    background: ${cfg.bg}; color: white; font-size: 10px; font-weight: bold;
    margin-left: 4px; cursor: help; vertical-align: middle;
    font-family: monospace; line-height: 1; flex-shrink: 0;
  `
  badge.title = cfg.label
  badge.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-sidebar' })
    chrome.runtime.sendMessage({ type: 'FOCUS_CLAIM', claimId })
  })
  return badge
}

function buildTooltipText(result: VerifyResult): string {
  const parts = [STATUS_CONFIG[result.status].label]
  if (result.paperTitle) parts.push(`Paper: ${result.paperTitle}`)
  if (result.verbatimQuote) parts.push(`Quote: "${result.verbatimQuote}"`)
  if (result.reason) parts.push(`Note: ${result.reason}`)
  return parts.join('\n')
}

function findTextNode(anchor: string): Element | null {
  if (!anchor || anchor.length < 5) return null
  const searchText = anchor.slice(0, 50).toLowerCase()

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.textContent?.toLowerCase().includes(searchText)) {
      return node.parentElement
    }
  }
  return null
}
