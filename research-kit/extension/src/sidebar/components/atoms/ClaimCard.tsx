import { useRef, useState } from 'react'
import type { ClaimItem } from '../../../shared/verify-types'
import { StatusBadge } from './StatusBadge'

interface ClaimCardProps {
  claim: ClaimItem
  expanded: boolean
  onToggleExpand: (id: string) => void
  onSave: (id: string) => void
  savePending?: boolean
  onUploadPdf?: (id: string, file: File) => void
  uploadPending?: boolean
  liveStep?: 'queued' | 'verifying' | 'retrying' | 'done' | 'failed'
  liveDetail?: string
}

function leftBorderColor(status: ClaimItem['status'] | undefined, liveStep: ClaimCardProps['liveStep']): string {
  if (status === 'verified') return 'var(--rk-green)'
  if (status === 'partial') return 'var(--rk-yellow)'
  if (status === 'not_found' || status === 'inaccessible') return 'var(--rk-red)'
  if (liveStep === 'queued' || liveStep === 'verifying' || liveStep === 'retrying') return 'var(--rk-brand)'
  return 'var(--rk-border-warm)'
}

function statusColorForGradient(status: ClaimItem['status'] | undefined): string {
  if (status === 'verified') return 'var(--rk-green)'
  if (status === 'partial') return 'var(--rk-yellow)'
  if (status === 'not_found' || status === 'inaccessible') return 'var(--rk-red)'
  return 'var(--rk-brand)'
}

const ChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)
const ChevronUp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
)

export function ClaimCard({
  claim, expanded, onToggleExpand, onSave, savePending, onUploadPdf, uploadPending,
  liveStep, liveDetail,
}: ClaimCardProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [hovered, setHovered] = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file && onUploadPdf) onUploadPdf(claim.id, file)
    e.target.value = ''
  }

  const isInaccessible = claim.status === 'inaccessible'
  const canSave = claim.status === 'verified' || claim.status === 'partial'
  const accentColor = leftBorderColor(claim.status, liveStep)
  const isLivePending = liveStep && liveStep !== 'done' && liveStep !== 'failed'

  return (
    <div
      className="w-full shrink-0 bg-[var(--rk-surface)] overflow-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1px solid ${hovered ? '#c4b5fd' : 'var(--rk-border-warm)'}`,
        borderLeftWidth: 3,
        borderLeftColor: accentColor,
        borderRadius: 'var(--rk-r-md)',
        boxShadow: hovered ? '0 6px 16px rgba(124,58,237,0.14)' : 'var(--rk-shadow-sm)',
        transform: hovered ? 'translateY(-2px)' : 'none',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
      }}
    >
      <div className="flex items-start gap-2 p-3">
        <div className="flex-1 min-w-0">
          <p className="text-[var(--rk-text)] line-clamp-3" style={{ fontSize: 13 }}>{claim.text}</p>
          {claim.paperTitle && (
            <p className="text-xs mt-1 truncate" style={{ color: 'var(--rk-brand)', fontSize: 10, fontWeight: 500 }}>{claim.paperTitle}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <StatusBadge status={claim.status} />
            {claim.status !== 'inaccessible' && (
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: 'var(--rk-brand-subtle)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${(claim.confidence ?? 0) * 100}%`,
                      background: `linear-gradient(90deg, var(--rk-brand), ${statusColorForGradient(claim.status)})`,
                      borderRadius: 2,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          {liveStep && liveStep !== 'done' && (
            <div className="flex items-center gap-1 mt-1">
              {isLivePending && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    border: '2px solid var(--rk-brand)',
                    borderTopColor: 'transparent',
                    animation: 'spinRing 0.8s linear infinite',
                  }}
                />
              )}
              <span className="text-[10px]" style={{ color: 'var(--rk-brand)' }}>
                {liveStep === 'queued' && 'Queued'}
                {liveStep === 'verifying' && 'Verifying…'}
                {liveStep === 'retrying' && 'Retrying…'}
                {liveStep === 'failed' && 'Failed'}
                {liveDetail ? ` - ${liveDetail}` : ''}
              </span>
            </div>
          )}
        </div>
        <button
          aria-label="expand"
          onClick={() => onToggleExpand(claim.id)}
          className="shrink-0 p-1 hover:opacity-70"
          style={{ color: 'var(--rk-brand)' }}
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t pt-2 space-y-2" style={{ borderColor: 'var(--rk-border-warm)' }}>
          {claim.quote && claim.status === 'verified' && (
            <blockquote className="text-xs text-[var(--rk-text-2)] italic border-l-2 border-[var(--rk-green)] pl-2 bg-green-50 py-1 rounded-r">
              "{claim.quote}"
            </blockquote>
          )}
          {claim.quote && claim.status === 'partial' && (
            <blockquote className="text-xs text-[var(--rk-text-2)] italic border-l-2 border-[var(--rk-yellow)] pl-2">
              "{claim.quote}"
            </blockquote>
          )}

          {claim.reason && (
            <p className="text-xs text-[var(--rk-text-3)]">{claim.reason}</p>
          )}

          {isInaccessible && onUploadPdf && (
            <div className="mt-2">
              <p className="text-xs text-orange-500 mb-1">
                Paper could not be fetched automatically. Upload the PDF to verify.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploadPending}
                className="text-xs px-3 py-1 rounded-full bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 disabled:opacity-50 transition-colors"
              >
                {uploadPending ? 'Verifying…' : 'Upload PDF'}
              </button>
            </div>
          )}

          {!isInaccessible && canSave && (
            <button
              aria-label="save to inbox"
              onClick={() => onSave(claim.id)}
              disabled={claim.saved || savePending}
              className="mt-1 text-xs px-3 py-1 rounded-full disabled:opacity-40 transition-colors"
              style={{
                background: 'var(--rk-brand-subtle)',
                border: '1px solid var(--rk-border-warm)',
                color: 'var(--rk-brand)',
              }}
            >
              {claim.saved ? 'Saved' : savePending ? 'Saving…' : 'Save to Inbox →'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
