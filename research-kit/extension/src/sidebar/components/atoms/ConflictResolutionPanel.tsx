import { useState, useEffect } from 'react'
import type { Conflict } from '../../../shared/types'

interface Props {
  conflict: Conflict
  onConfirm(acceptedClaimId: string): Promise<void>
  onSuggest(): Promise<void>
}

function LightningIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

export function ConflictResolutionPanel({ conflict, onConfirm, onSuggest }: Props) {
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const suggestion = (() => {
    if (!conflict.resolution) return null
    try { return JSON.parse(conflict.resolution) } catch { return null }
  })()

  useEffect(() => {
    let pick: string | null = null
    if (suggestion?.kind === 'suggestion') {
      if (suggestion.recommendation === 'side_a' && conflict.sides[0]) {
        pick = conflict.sides[0].claim_id
      } else if (suggestion.recommendation === 'side_b' && conflict.sides[1]) {
        pick = conflict.sides[1].claim_id
      }
    }
    setSelected(pick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflict.id, conflict.resolution])

  return (
    <div
      className="overflow-hidden"
      style={{ border: '1px solid var(--rk-border-warm)', borderRadius: 12, boxShadow: 'var(--rk-shadow-sm)' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(37,99,235,0.06))', borderBottom: '1px solid var(--rk-border-warm)' }}
      >
        <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, background: 'var(--rk-brand-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LightningIcon />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--rk-text-brand)' }}>
          Conflict · {conflict.paper_title ?? conflict.group_key}
        </span>
      </div>

      {/* Radio-select sides */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        {conflict.sides.map((s, i) => {
          const isSelected = selected === s.claim_id
          return (
            <div
              key={s.claim_id}
              onClick={() => setSelected(s.claim_id)}
              style={{
                padding: '10px 12px',
                borderRight: i === 0 ? '1px solid var(--rk-border-warm)' : undefined,
                cursor: 'pointer',
                border: isSelected ? '2px solid var(--rk-brand)' : undefined,
                borderRadius: isSelected ? 4 : undefined,
                background: isSelected ? 'rgba(124,58,237,0.04)' : undefined,
                transition: 'background 0.15s',
              }}
            >
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--rk-brand)', marginBottom: 4 }}>
                {s.label}
              </div>
              <p style={{ fontSize: 11, color: 'var(--rk-text)', lineHeight: 1.5, marginBottom: 4 }}>
                {s.quote}
              </p>
              <div style={{
                width: 14, height: 14, borderRadius: '50%',
                border: isSelected ? '4px solid var(--rk-brand)' : '2px solid var(--rk-border-warm)',
                background: isSelected ? 'white' : 'transparent',
                transition: 'border 0.15s',
              }} />
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--rk-border-warm)', background: 'var(--rk-surface-warm)' }}>
        {suggestion?.kind === 'suggestion' && (
          <div className="mb-2">
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rk-text-brand)' }}>AI: </span>
            <span style={{ fontSize: 11, color: 'var(--rk-text-2)' }}>{suggestion.rationale}</span>
            {suggestion.synthesis && (
              <p style={{ fontSize: 11, color: 'var(--rk-text-3)', marginTop: 2 }}>{suggestion.synthesis}</p>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          {!suggestion && (
            <button
              disabled={busy}
              onClick={async () => { setBusy(true); try { await onSuggest() } finally { setBusy(false) } }}
              style={{ fontSize: 10, padding: '4px 12px', background: 'white', color: 'var(--rk-brand)', border: '1px solid var(--rk-border-warm)', borderRadius: 99, fontWeight: 600, opacity: busy ? 0.5 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}
            >
              ✦ Get AI Suggestion
            </button>
          )}
          <div className="flex-1" />
          <button
            disabled={!selected || busy}
            onClick={async () => {
              if (!selected) return
              setBusy(true)
              try { await onConfirm(selected) } finally { setBusy(false) }
            }}
            style={{
              fontSize: 10, padding: '4px 14px', borderRadius: 99, border: 'none', fontWeight: 600,
              background: selected && !busy ? 'var(--rk-brand-gradient)' : 'var(--rk-border-warm)',
              color: selected && !busy ? 'white' : 'var(--rk-text-3)',
              cursor: selected && !busy ? 'pointer' : 'not-allowed',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Confirming…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
