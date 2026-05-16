import { useState } from 'react'

interface Props { onSignIn: () => Promise<unknown> }

function GoogleLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M13.7 7.16c0-.5-.04-.98-.12-1.44H7v2.73h3.77a3.22 3.22 0 0 1-1.4 2.12v1.76h2.27C12.96 11.07 13.7 9.27 13.7 7.16z" fill="#4285F4"/>
      <path d="M7 14c1.89 0 3.48-.63 4.64-1.7l-2.27-1.77a4.16 4.16 0 0 1-6.19-2.19H.83v1.82A7 7 0 0 0 7 14z" fill="#34A853"/>
      <path d="M3.18 8.34A4.21 4.21 0 0 1 2.96 7c0-.47.08-.93.22-1.34V3.84H.83A7.01 7.01 0 0 0 0 7c0 1.13.27 2.2.83 3.16l2.35-1.82z" fill="#FBBC05"/>
      <path d="M7 2.78c1.06 0 2.01.36 2.76 1.08L11.72 1.9A7 7 0 0 0 7 0 7 7 0 0 0 .83 3.84l2.35 1.82C3.83 4.06 5.22 2.78 7 2.78z" fill="#EA4335"/>
    </svg>
  )
}

export function LoginGate({ onSignIn }: Props) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div
      className="flex flex-col items-center justify-center h-screen gap-4 p-6"
      style={{ background: 'linear-gradient(160deg, #ede9fe 0%, #dbeafe 100%)' }}
    >
      {/* Logo block */}
      <div className="flex flex-col items-center gap-2">
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'var(--rk-brand-gradient)',
          boxShadow: '0 4px 16px rgba(124,58,237,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4,12 9,17 20,6" />
          </svg>
        </div>
        <h1 style={{ fontSize: 17, fontWeight: 800, color: 'var(--rk-text-brand)', letterSpacing: '-0.3px' }}>ResearchKit</h1>
        <p style={{ fontSize: 11, color: 'var(--rk-brand)' }}>Verify research claims in seconds</p>
      </div>

      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true); setErr(null)
          try { await onSignIn() } catch (e: any) { setErr(e.message) }
          finally { setBusy(false) }
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'white', color: 'var(--rk-text-brand)',
          border: '1px solid var(--rk-border-warm)',
          borderRadius: 10, padding: '9px 20px',
          fontSize: 12, fontWeight: 600,
          boxShadow: '0 2px 8px rgba(124,58,237,0.10)',
        }}
        className="disabled:opacity-50"
      >
        <GoogleLogo />
        {busy ? 'Signing in…' : 'Sign in with Google'}
      </button>
      {err && <p style={{ color: 'var(--rk-red)' }} className="text-sm">{err}</p>}
    </div>
  )
}
