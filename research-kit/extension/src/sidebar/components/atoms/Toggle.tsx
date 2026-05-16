interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  hideLabel?: boolean
}

export function Toggle({ checked, onChange, label, disabled = false, hideLabel = false }: ToggleProps) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={checked ? { background: 'var(--rk-brand-gradient)' } : undefined}
        className={[
          'relative w-9 h-5 rounded-full transition-colors duration-150',
          checked ? '' : 'bg-[var(--rk-surface-2)]',
          disabled ? 'opacity-40 cursor-not-allowed' : '',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-150',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
      {!hideLabel && <span className="text-sm text-[var(--rk-text-2)]">{label}</span>}
    </label>
  )
}
