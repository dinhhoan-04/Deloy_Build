import { useState } from 'react'
import type { ClaimItem, VerifyStatus, SiteId } from '../../../shared/verify-types'
import { ClaimCard } from '../atoms/ClaimCard'
import { useStore } from '../../state/useStore'
import { verifyWithPdf, ApiError } from '../../../shared/api'

type StatusFilter = VerifyStatus | 'all'
type SiteFilter = SiteId | 'all'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all',          label: 'All' },
  { value: 'verified',     label: 'Verified' },
  { value: 'partial',      label: 'Partial' },
  { value: 'not_found',    label: 'Not Found' },
  { value: 'inaccessible', label: 'Inaccessible' },
]

interface VerifyTabProps {
  claims: ClaimItem[]
  expandedIds: Set<string>
  savingIds?: Set<string>
  onToggleExpand: (id: string) => void
  onSave: (id: string) => void
  isDetecting?: boolean
  currentSiteDisabled?: SiteId | null
  onOpenSettings?: () => void
  liveStepsByClaim?: Map<string, { step: 'queued' | 'verifying' | 'retrying' | 'done' | 'failed'; detail?: string }>
}

function SkeletonCard() {
  const shimmerStyle: React.CSSProperties = {
    background: 'linear-gradient(90deg, #f0e8ff 25%, #e9d5ff 50%, #f0e8ff 75%)',
    backgroundSize: '800px 100%',
    borderRadius: 6,
  }
  return (
    <div style={{ border: '1px solid var(--rk-border-warm)', borderRadius: 10, padding: 12 }}>
      <div className="animate-shimmer" style={{ ...shimmerStyle, height: 10, marginBottom: 8, width: '100%' }} />
      <div className="animate-shimmer" style={{ ...shimmerStyle, height: 10, marginBottom: 10, width: '60%' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="animate-shimmer" style={{ ...shimmerStyle, height: 18, width: 56, borderRadius: 99 }} />
      </div>
    </div>
  )
}

export function VerifyTab({
  claims, expandedIds, savingIds = new Set(), onToggleExpand, onSave,
  isDetecting = false, currentSiteDisabled = null, onOpenSettings,
  liveStepsByClaim = new Map(),
}: VerifyTabProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [siteFilter, setSiteFilter]     = useState<SiteFilter>('all')
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set())

  const ingestClaimResult = useStore(s => s.ingestClaimResult)
  const showToast = useStore(s => s.showToast)

  async function handleUploadPdf(claimId: string, file: File) {
    const claim = claims.find(c => c.id === claimId)
    if (!claim) return

    setUploadingIds(prev => new Set(prev).add(claimId))
    try {
      const result = await verifyWithPdf({
        file,
        claim: claim.text,
        doi: claim.doi ?? undefined,
        paperTitle: claim.paperTitle ?? undefined,
      })
      ingestClaimResult({
        ...claim,
        status: result.status,
        confidence: result.confidence,
        quote: result.verbatim_quote,
        reason: result.reason,
      })
      showToast('PDF verified successfully', 'success')
    } catch (e) {
      console.error('[verify] upload failed', e)
      const msg = e instanceof ApiError
        ? (e.code === 'pdf_too_large' ? 'PDF too large'
           : e.code === 'pdf_invalid' ? 'PDF is not readable'
           : e.status === 400 ? 'Validation error — check the PDF'
           : e.status === 503 ? 'Service unavailable — try again later'
           : `Upload failed (${e.status})`)
        : 'Upload failed. Please retry.'
      showToast(msg, 'error')
    } finally {
      setUploadingIds(prev => { const s = new Set(prev); s.delete(claimId); return s })
    }
  }

  if (currentSiteDisabled) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <p className="text-sm text-[var(--rk-text-3)] capitalize">{currentSiteDisabled} is disabled in Settings.</p>
        {onOpenSettings && (
          <button onClick={onOpenSettings} className="text-xs hover:underline" style={{ color: 'var(--rk-brand)' }}>
            Open Settings →
          </button>
        )}
      </div>
    )
  }

  if (isDetecting) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  if (claims.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(37,99,235,0.12))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rk-brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rk-text-brand)' }}>No claims yet</p>
        <p style={{ fontSize: 12, color: 'var(--rk-text-3)', lineHeight: 1.5 }}>
          Open Elicit, SciSpace or Consensus and run a search to start.
        </p>
      </div>
    )
  }

  const sites    = Array.from(new Set(claims.map(c => c.site)))
  const filtered = claims.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (siteFilter   !== 'all' && c.site   !== siteFilter)   return false
    return true
  })

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Filter pills */}
      <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-[var(--rk-border-warm)] shrink-0">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.value}
            aria-pressed={statusFilter === f.value}
            onClick={() => setStatusFilter(f.value)}
            style={statusFilter === f.value ? {
              background: 'var(--rk-brand-gradient)',
              border: '1px solid transparent',
              color: 'white',
              fontWeight: 600,
            } : {
              background: 'transparent',
              border: '1px solid var(--rk-border-warm)',
              color: 'var(--rk-text-3)',
            }}
            className="text-xs px-2.5 py-0.5 rounded-full transition-colors hover:text-[var(--rk-brand)]"
          >
            {f.label}
          </button>
        ))}
        {sites.length > 1 && sites.map(site => (
          <button
            key={site}
            aria-pressed={siteFilter === site}
            onClick={() => setSiteFilter(siteFilter === site ? 'all' : site)}
            style={siteFilter === site ? {
              background: 'var(--rk-brand-subtle)',
              border: '1px solid var(--rk-border-warm)',
              color: 'var(--rk-brand)',
              fontWeight: 600,
            } : {
              background: 'transparent',
              border: '1px solid var(--rk-border-warm)',
              color: 'var(--rk-text-3)',
            }}
            className="text-xs px-2.5 py-0.5 rounded-full transition-colors capitalize hover:text-[var(--rk-brand)]"
          >
            {site}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1 min-h-0">
        {filtered.length === 0 ? (
          <p className="text-xs text-[var(--rk-text-3)] text-center mt-4">No claims match the current filter.</p>
        ) : filtered.map((claim, index) => (
          <div
            key={claim.id}
            className="animate-staggerIn"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <ClaimCard
              claim={claim}
              expanded={expandedIds.has(claim.id)}
              onToggleExpand={onToggleExpand}
              onSave={onSave}
              savePending={savingIds.has(claim.id)}
              onUploadPdf={handleUploadPdf}
              uploadPending={uploadingIds.has(claim.id)}
              liveStep={liveStepsByClaim.get(claim.id)?.step}
              liveDetail={liveStepsByClaim.get(claim.id)?.detail}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
