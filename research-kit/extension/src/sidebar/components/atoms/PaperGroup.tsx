import type { PaperGroup as PaperGroupType } from '../../selectors/inbox'
import type { InboxItem } from '../../../shared/verify-types'
import { StatusBadge } from './StatusBadge'
import { Checkbox } from './Checkbox'

interface PaperGroupProps {
  group: PaperGroupType
  expanded: boolean
  onToggleExpand: (key: string) => void
  onRemoveItem: (id: string) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
}

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function ChevronUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function PaperGroup({ group, expanded, onToggleExpand, onRemoveItem, selectedIds, onToggleSelect }: PaperGroupProps) {
  return (
    <div
      className="overflow-hidden bg-[var(--rk-surface)] shrink-0"
      style={{
        border: '1px solid var(--rk-border-warm)',
        borderRadius: 12,
        boxShadow: 'var(--rk-shadow-sm)',
      }}
    >
      <button
        aria-label="expand group"
        onClick={() => onToggleExpand(group.groupKey)}
        className="w-full flex items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--rk-surface-warm)]"
        style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.04), rgba(37,99,235,0.04))' }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: 'var(--rk-brand-gradient)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FolderIcon />
          </div>
          <div className="min-w-0">
            <span className="block truncate" style={{ fontSize: 12, fontWeight: 600, color: 'var(--rk-text-brand)' }}>
              {group.paperTitle}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span style={{ fontSize: 10, color: 'var(--rk-brand)', fontWeight: 500 }}>
                {group.claims.length} claim{group.claims.length !== 1 ? 's' : ''}
              </span>
              {group.hasUnknownDoi && (
                <span className="text-xs text-[var(--rk-yellow)] bg-[var(--rk-yellow-subtle)] px-1.5 py-0.5 rounded-full">No DOI</span>
              )}
              {group.hasAbstractOnly && (
                <span className="text-xs text-[var(--rk-blue)] bg-[var(--rk-blue-subtle)] px-1.5 py-0.5 rounded-full">Abstract only</span>
              )}
            </div>
          </div>
        </div>
        <span style={{ color: 'var(--rk-brand)', marginLeft: 8, flexShrink: 0 }}>
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </span>
      </button>

      {expanded && (
        <ul className="divide-y divide-[var(--rk-border-warm)]">
          {group.claims.map((item: InboxItem) => (
            <li key={item.id} className="flex items-start gap-2 px-3 py-3 bg-[var(--rk-surface)]">
              <Checkbox
                checked={selectedIds.has(item.id)}
                onChange={() => onToggleSelect(item.id)}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[var(--rk-text)] break-words whitespace-pre-wrap" style={{ fontSize: 13 }}>{item.text}</p>
                <div className="flex items-center gap-2 mt-1">
                  <StatusBadge status={item.status} />
                  <span className="text-xs text-[var(--rk-text-3)]">{item.site}</span>
                </div>
              </div>
              <button
                aria-label="remove"
                onClick={() => onRemoveItem(item.id)}
                className="shrink-0 text-xs text-[var(--rk-text-3)] hover:text-[var(--rk-red)] p-1"
              >✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
