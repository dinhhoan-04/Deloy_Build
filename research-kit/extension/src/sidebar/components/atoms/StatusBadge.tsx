import type { VerifyStatus } from '../../../shared/verify-types'

const LABELS: Record<VerifyStatus, string> = {
  verified:     'Verified',
  partial:      'Partial',
  not_found:    'Not Found',
  inaccessible: '🔒 Locked',
  pending:      '⏳ Pending',
  error:        'Error',
}

const COLORS: Record<VerifyStatus, string> = {
  verified:     'bg-[var(--rk-green-subtle)] text-[var(--rk-green)] border border-[color:rgba(15,138,86,0.25)]',
  partial:      'bg-[var(--rk-yellow-subtle)] text-[var(--rk-yellow)] border border-[color:rgba(168,101,0,0.25)]',
  not_found:    'bg-[var(--rk-grey-subtle)] text-[var(--rk-grey)] border border-[color:rgba(94,111,143,0.25)]',
  inaccessible: 'border border-[color:rgba(234,88,12,0.25)]',
  pending:      'border border-[color:rgba(124,58,237,0.25)]',
  error:        'bg-[var(--rk-red-subtle)] text-[var(--rk-red)] border border-[color:rgba(196,63,50,0.25)]',
}

const INLINE_COLORS: Partial<Record<VerifyStatus, React.CSSProperties>> = {
  inaccessible: { background: 'rgba(234,88,12,0.10)', color: '#c2410c' },
  pending:      { background: 'rgba(124,58,237,0.10)', color: 'var(--rk-brand)' },
}

export function StatusBadge({ status }: { status: VerifyStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${COLORS[status]}`}
      style={INLINE_COLORS[status]}
    >
      {LABELS[status]}
    </span>
  )
}
