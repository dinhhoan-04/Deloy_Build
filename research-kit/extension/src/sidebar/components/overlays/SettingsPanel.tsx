import type { Provider, SiteId } from '../../../shared/verify-types'
import { Toggle } from '../atoms/Toggle'
import { signOut } from '../../../shared/auth'

interface SettingsPanelProps {
  activeSites: SiteId[]
  provider: Provider
  onToggleSite: (site: SiteId) => void
  onProviderChange: (provider: Provider) => void
  onClose: () => void
}

const SITES: { id: SiteId; label: string; description: string }[] = [
  { id: 'elicit', label: 'Elicit', description: 'Extract claims from Elicit' },
  { id: 'scispace', label: 'SciSpace', description: 'Extract claims from SciSpace' },
  { id: 'consensus', label: 'Consensus', description: 'Extract claims from Consensus' },
]

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'zai', label: 'Z.ai (GLM-4.7)' },
  { id: 'gemini', label: 'Gemini' },
]

function LogoutIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2H2C1.4 2 1 2.4 1 3v4c0 .6.4 1 1 1h2" />
      <polyline points="7,3 9,5 7,7" />
      <line x1="9" y1="5" x2="3.5" y2="5" />
    </svg>
  )
}

export function SettingsPanel({
  activeSites, provider, onToggleSite, onProviderChange, onClose,
}: SettingsPanelProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <button
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(124,58,237,0.15)', backdropFilter: 'blur(4px)' }}
        aria-label="close"
      />
      <div
        className="relative w-full bg-[var(--rk-surface)] max-h-[80vh] overflow-y-auto"
        style={{ borderRadius: '14px 14px 0 0', borderTop: '1px solid var(--rk-border-warm)' }}
      >
        {/* Drag handle */}
        <div style={{ width: 32, height: 4, background: 'var(--rk-border-warm)', borderRadius: 99, margin: '10px auto 0' }} />

        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-[var(--rk-border-warm)] bg-[var(--rk-surface)]">
          <h2 style={{ fontWeight: 700, color: 'var(--rk-text-brand)' }} className="text-base">Settings</h2>
          <button
            onClick={onClose}
            aria-label="close"
            style={{
              width: 26, height: 26, borderRadius: 7,
              background: 'var(--rk-surface-warm)',
              border: '1px solid var(--rk-border-warm)',
              color: 'var(--rk-brand)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        <div className="p-4">
          <h3 style={{ color: 'var(--rk-brand)' }} className="text-xs font-medium uppercase tracking-wider mb-3">LLM Provider</h3>
          <div className="flex gap-2 mb-4">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                onClick={() => onProviderChange(p.id)}
                style={provider === p.id ? {
                  background: 'var(--rk-brand-gradient)',
                  color: 'white',
                  boxShadow: '0 2px 6px rgba(124,58,237,0.30)',
                  border: 'none',
                  borderRadius: 99,
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                } : {
                  background: 'var(--rk-surface-warm)',
                  color: 'var(--rk-brand)',
                  border: '1px solid var(--rk-border-warm)',
                  borderRadius: 99,
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <h3 style={{ color: 'var(--rk-brand)' }} className="text-xs font-medium uppercase tracking-wider mb-3">Source Sites</h3>
          <div className="space-y-3">
            {SITES.map(site => (
              <div key={site.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--rk-text)]">{site.label}</p>
                  <p style={{ color: 'var(--rk-brand)', fontSize: 10 }}>{site.description}</p>
                </div>
                <Toggle
                  checked={activeSites.includes(site.id)}
                  onChange={() => onToggleSite(site.id)}
                  label={site.label}
                  hideLabel
                />
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-[var(--rk-border-warm)] p-4 bg-[var(--rk-surface-warm)]">
          <p className="text-xs text-[var(--rk-text-3)]">
            Enabled sites will automatically extract claims when you perform searches.
          </p>
        </div>

        <div className="border-t border-[var(--rk-border-warm)] p-4">
          <button
            onClick={() => void signOut()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#fff1f2', color: '#e11d48',
              border: '1px solid #fecdd3',
              borderRadius: 99,
              fontSize: 11, fontWeight: 600,
              padding: '5px 12px',
            }}
          >
            <LogoutIcon />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
