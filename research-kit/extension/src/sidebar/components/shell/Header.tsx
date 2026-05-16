import type { SiteId } from '../../../shared/verify-types'

const SITE_LABEL: Record<SiteId, string> = {
  elicit: 'Elicit',
  scispace: 'SciSpace',
  consensus: 'Consensus',
}

const ALL_SITES: SiteId[] = ['elicit', 'scispace', 'consensus']

interface HeaderProps {
  activeSites: Set<SiteId>
  onToggleSite: (site: SiteId, active: boolean) => void
  onOpenSettings: () => void
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function Header({
  activeSites,
  onToggleSite, onOpenSettings,
}: HeaderProps) {
  return (
    <header
      style={{ height: 'var(--rk-header-h)' }}
      className="flex items-center justify-between px-3 bg-[var(--rk-surface)]/95 backdrop-blur border-b border-[var(--rk-border-warm)] shrink-0 shadow-[0_1px_0_rgba(24,32,51,0.04)]"
    >
      <div className="flex items-center gap-2">
        {/* Logo mark */}
        <div
          style={{
            width: 26, height: 26, borderRadius: 7,
            background: 'var(--rk-brand-gradient)',
            boxShadow: '0 2px 6px rgba(124,58,237,0.30)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2.5 8.5 6.5 12.5 13.5 4.5" />
          </svg>
        </div>
        <span style={{ fontWeight: 700, color: 'var(--rk-text-brand)', letterSpacing: '-0.2px' }} className="text-sm">ResearchKit</span>
        {/* Divider */}
        <div style={{ width: 1, height: 16, background: 'var(--rk-border-warm)', flexShrink: 0 }} />
        {/* Site pills */}
        <div className="flex items-center gap-1">
          {ALL_SITES.map(site => {
            const active = activeSites.has(site)
            return (
              <button
                key={site}
                aria-label={`toggle ${site}`}
                aria-pressed={active}
                onClick={() => onToggleSite(site, !active)}
                style={active ? {
                  background: 'linear-gradient(135deg, rgba(124,58,237,0.10), rgba(37,99,235,0.10))',
                  color: 'var(--rk-brand)',
                  border: '1px solid var(--rk-border-warm)',
                  fontWeight: 600,
                } : {
                  background: 'rgba(124,58,237,0.04)',
                  color: 'var(--rk-text-3)',
                  border: '1px solid var(--rk-border-warm)',
                }}
                className="text-xs px-2.5 py-1 rounded-full transition-colors"
              >
                {SITE_LABEL[site]}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          aria-label="settings"
          onClick={onOpenSettings}
          style={{ width: 32, height: 32, borderRadius: 8, color: 'var(--rk-brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          className="border border-transparent hover:bg-[var(--rk-surface-warm)] transition-colors"
        >
          <GearIcon />
        </button>
      </div>
    </header>
  )
}
