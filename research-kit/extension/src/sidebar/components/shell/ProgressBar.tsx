import type { SiteId, VerifyProgress } from '../../../shared/verify-types'

interface ProgressBarProps {
  progress: VerifyProgress
  onTogglePause: () => void
  onToggleSitePause?: (site: SiteId, paused: boolean) => void
}

function PauseIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor">
      <rect x="1" y="1" width="2.5" height="7" rx="0.5" />
      <rect x="5.5" y="1" width="2.5" height="7" rx="0.5" />
    </svg>
  )
}

function ResumeIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor">
      <polygon points="1.5,1 8,4.5 1.5,8" />
    </svg>
  )
}

export function ProgressBar({ progress, onTogglePause, onToggleSitePause }: ProgressBarProps) {
  const { total, completed, running, paused } = progress
  if (total === 0) return null

  const done = completed === total && running === 0
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const activeSites = (Object.keys(progress.perSite) as SiteId[]).filter(
    s => progress.perSite[s].total > 0
  )
  const stepMessage = progress.stepMessage ?? (
    done ? 'Verification complete'
      : paused ? 'Paused'
        : running > 0 ? 'Verifying claims'
          : 'Queued'
  )

  return (
    <div className="px-3 py-2 bg-[var(--rk-surface)] border-b border-[var(--rk-border-warm)] shrink-0 space-y-1">
      {/* Row 1: bar + fraction + pause */}
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-full overflow-hidden" style={{ height: 6, background: 'var(--rk-brand-subtle)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: 'var(--rk-brand-gradient)',
              boxShadow: '0 0 6px rgba(124,58,237,0.40)',
            }}
          />
        </div>
        {done ? (
          <span className="text-xs text-[var(--rk-green)]">Done</span>
        ) : (
          <>
            <span className="text-xs font-semibold" style={{ color: 'var(--rk-brand)' }}>{completed} / {total}</span>
            <button
              aria-label={paused ? 'resume' : 'pause'}
              onClick={onTogglePause}
              style={{
                background: 'var(--rk-surface-warm)',
                border: '1px solid var(--rk-border-warm)',
                color: 'var(--rk-brand)',
                borderRadius: 99,
                fontSize: 10,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
              }}
            >
              {paused ? <><ResumeIcon /> Resume</> : <><PauseIcon /> Pause</>}
            </button>
          </>
        )}
      </div>

      {/* Step message with dot */}
      <div className="flex items-center gap-1.5">
        <span
          className={done ? '' : 'animate-pulseDot'}
          style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: done ? 'var(--rk-green)' : 'var(--rk-brand)',
            display: 'inline-block',
          }}
        />
        <span className="text-[11px] font-medium" style={{ color: 'var(--rk-brand)' }}>{stepMessage}</span>
      </div>

      {/* Row 2: per-site chips (only when >1 site has claims) */}
      {activeSites.length > 1 && (
        <div className="flex items-center gap-1.5">
          {activeSites.map(site => {
            const s = progress.perSite[site]
            const sitePaused = progress.pausedSites.includes(site)
            return (
              <button
                key={site}
                aria-label={`${sitePaused ? 'resume' : 'pause'} ${site}`}
                onClick={() => onToggleSitePause?.(site, !sitePaused)}
                className={[
                  'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors',
                  sitePaused
                    ? 'border-[var(--rk-border)] text-[var(--rk-text-3)] opacity-50'
                    : 'border-[var(--rk-border-warm)] text-[var(--rk-brand)] bg-[var(--rk-brand-subtle)]',
                ].join(' ')}
              >
                <span className="capitalize">{site}</span>
                <span>{s.completed}/{s.total}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
