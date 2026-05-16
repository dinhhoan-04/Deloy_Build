import { useState } from 'react'

interface Props { onCreate(name: string): Promise<unknown>; onClose(): void }

export function ProjectCreateModal({ onCreate, onClose }: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(124,58,237,0.15)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: 280,
          borderRadius: 14,
          border: '1px solid var(--rk-border-warm)',
          boxShadow: 'var(--rk-shadow-modal)',
          background: 'white',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: 'linear-gradient(135deg, var(--rk-surface-warm), #eff6ff)',
            padding: '12px 14px 10px',
            borderBottom: '1px solid var(--rk-border-warm)',
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--rk-text-brand)' }}>New project</p>
          <p style={{ fontSize: 10, color: 'var(--rk-brand)', marginTop: 2 }}>Give your project a name to get started</p>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 14px 0' }}>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && name.trim() && !busy) {
                setBusy(true)
                onCreate(name.trim()).then(onClose).finally(() => setBusy(false))
              }
            }}
            placeholder="e.g. Omega-3 Research"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: '1.5px solid var(--rk-border-warm)',
              borderRadius: 8,
              padding: '7px 10px',
              fontSize: 12,
              color: 'var(--rk-text)',
              background: 'var(--rk-surface-warm)',
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--rk-brand)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--rk-border-warm)')}
          />
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 14px',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--rk-text-3)',
              fontSize: 12,
              cursor: 'pointer',
              padding: '5px 10px',
            }}
          >
            Cancel
          </button>
          <button
            disabled={!name.trim() || busy}
            onClick={async () => {
              setBusy(true)
              try { await onCreate(name.trim()); onClose() } finally { setBusy(false) }
            }}
            style={{
              background: 'var(--rk-brand-gradient)',
              color: 'white',
              border: 'none',
              borderRadius: 99,
              padding: '5px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(124,58,237,0.30)',
              opacity: !name.trim() || busy ? 0.5 : 1,
            }}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
