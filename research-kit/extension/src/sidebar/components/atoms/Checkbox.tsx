interface CheckboxProps {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  disabled?: boolean
}

export function Checkbox({ checked, onChange, label, disabled = false }: CheckboxProps) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <button
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => { if (!disabled) onChange(!checked) }}
        style={{
          width: 16, height: 16, borderRadius: 5, flexShrink: 0,
          border: checked ? 'none' : '2px solid var(--rk-border-warm)',
          background: checked ? 'var(--rk-brand-gradient)' : 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1.5,5 4,7.5 8.5,2.5" />
          </svg>
        )}
      </button>
      {label && (
        <span style={{
          fontSize: 12,
          color: checked ? 'var(--rk-text-brand)' : 'var(--rk-text)',
          fontWeight: checked ? 600 : 400,
        }}>
          {label}
        </span>
      )}
    </label>
  )
}
