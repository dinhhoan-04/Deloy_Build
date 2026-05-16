type Tone = 'success' | 'warning' | 'error'

interface ToastProps {
  message: string
  tone: Tone
  onDismiss: () => void
}

const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-[var(--rk-green-subtle)] text-[var(--rk-green)] border-[var(--rk-green)]',
  warning: 'bg-[var(--rk-yellow-subtle)] text-[var(--rk-yellow)] border-[var(--rk-yellow)]',
  error:   'bg-[var(--rk-red-subtle)] text-[var(--rk-red)] border-[var(--rk-red)]',
}

function SuccessIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="8,12 11,15 16,9" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}

const ICON: Record<Tone, React.FC> = {
  success: SuccessIcon,
  warning: WarningIcon,
  error:   ErrorIcon,
}

export function Toast({ message, tone, onDismiss }: ToastProps) {
  const Icon = ICON[tone]
  return (
    <div
      className={`toast--${tone} animate-toastSlide flex items-center gap-2 px-3 py-2 border text-sm ${TONE_CLASS[tone]}`}
      style={{ borderRadius: 10, boxShadow: 'var(--rk-shadow-sm)' }}
    >
      <Icon />
      <span className="flex-1">{message}</span>
      <button aria-label="dismiss" onClick={onDismiss} className="opacity-60 hover:opacity-100 ml-1 text-inherit">✕</button>
    </div>
  )
}
