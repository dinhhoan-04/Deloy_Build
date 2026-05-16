import type { ConflictCheckStatus } from '../../../shared/types'

interface Props {
  status: ConflictCheckStatus | null
  stalled?: boolean
  onRetry?: () => void
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${Math.max(sec, 1)}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} h ago`
  const day = Math.floor(hr / 24)
  return `${day} d ago`
}

export function ConflictsCheckHeader({ status, stalled, onRetry }: Props) {
  if (!status) return null
  const { last_checked_at, pending_count } = status
  if (pending_count === 0 && !last_checked_at) return null

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 12px',
    borderBottom: '1px solid var(--rk-border-1, rgba(0,0,0,0.08))',
    fontSize: 12, color: 'var(--rk-text-3, #6b7280)',
  }

  if (pending_count > 0 && stalled) {
    return (
      <div style={rowStyle} role="status">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>Check incomplete for {pending_count} claim{pending_count === 1 ? '' : 's'}.</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'var(--rk-brand, #2563eb)', cursor: 'pointer',
              fontSize: 12, textDecoration: 'underline',
            }}
          >
            Retry
          </button>
        )}
      </div>
    )
  }

  if (pending_count > 0) {
    return (
      <div style={rowStyle} role="status" aria-live="polite">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
             style={{ animation: 'rk-spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span>Checking {pending_count} claim{pending_count === 1 ? '' : 's'}…</span>
        <style>{`@keyframes rk-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div style={rowStyle}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span>Last checked {relativeTime(last_checked_at!)}</span>
    </div>
  )
}
