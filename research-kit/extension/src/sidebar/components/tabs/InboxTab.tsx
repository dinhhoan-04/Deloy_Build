import { useState } from 'react'
import type { InboxItem } from '../../../shared/verify-types'
import { groupInboxByPaper } from '../../selectors/inbox'
import { PaperGroup } from '../atoms/PaperGroup'

type InboxView = 'active' | 'archived'
type StatusFilter = 'all' | 'verified' | 'partial'
type SortOrder = 'newest' | 'oldest'

interface InboxTabProps {
  items: InboxItem[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onArchive: (ids: string[]) => void
  onUnarchive: (ids: string[]) => void
  onAddToProject: (ids: string[]) => void
  onClearSelection: () => void
  onRemove?: (id: string) => void
  loadError?: string | null
  onRetry?: () => void
}

export function InboxTab({
  items, selectedIds, onToggleSelect, onArchive, onUnarchive,
  onAddToProject, onClearSelection, onRemove, loadError, onRetry,
}: InboxTabProps) {
  const [view, setView] = useState<InboxView>('active')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortOrder>('newest')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const activeItems   = items.filter(i => !i.archived_at)
  const archivedItems = items.filter(i =>  i.archived_at)

  const baseItems = view === 'active' ? activeItems : archivedItems

  const filtered = baseItems
    .filter(i => statusFilter === 'all' || i.status === statusFilter)
    .sort((a, b) =>
      sort === 'newest'
        ? b.savedAtMs - a.savedAtMs
        : a.savedAtMs - b.savedAtMs
    )

  const groups = groupInboxByPaper(filtered)
  const selectedList = Array.from(selectedIds)

  const handleToggleExpand = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const pillStyle = (active: boolean): React.CSSProperties => active
    ? { background: 'var(--rk-brand-gradient)', border: '1px solid transparent', color: 'white', fontWeight: 600 }
    : { background: 'transparent', border: '1px solid var(--rk-border-warm)', color: 'var(--rk-text-3)' }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Active / Archived toggle + Sort */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--rk-border-warm)' }}
      >
        <div className="flex gap-1.5">
          {(['active', 'archived'] as InboxView[]).map(v => (
            <button
              key={v}
              onClick={() => { setView(v); onClearSelection() }}
              style={{ ...pillStyle(view === v), fontSize: 11, padding: '3px 10px', borderRadius: 99 }}
              className="capitalize transition-colors"
            >
              {v} ({v === 'active' ? activeItems.length : archivedItems.length})
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortOrder)}
          style={{
            fontSize: 11, color: 'var(--rk-text-3)', background: 'transparent',
            border: 'none', outline: 'none', cursor: 'pointer',
          }}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {/* Status filter pills (active view only) */}
      {view === 'active' && (
        <div
          className="flex gap-1.5 px-3 py-2 shrink-0"
          style={{ borderBottom: '1px solid var(--rk-border-warm)' }}
        >
          {(['all', 'verified', 'partial'] as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              style={{ ...pillStyle(statusFilter === f), fontSize: 11, padding: '2px 8px', borderRadius: 99 }}
              className="capitalize transition-colors hover:text-[var(--rk-brand)]"
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {/* List */}
      <div className="flex-1 min-h-0 relative">
        <div
          className="absolute inset-0 flex flex-col gap-2 p-3 overflow-y-auto"
          style={{ overflowY: 'auto', overflowX: 'hidden' }}
        >
          {loadError && (
            <div
              className="flex items-center justify-between px-3 py-2 rounded-lg shrink-0"
              style={{ background: '#fffbeb', border: '1px solid #fbbf24' }}
            >
              <span style={{ fontSize: 12, color: '#92400e' }}>⚠ Could not load inbox.</span>
              {onRetry && (
                <button
                  onClick={onRetry}
                  style={{ fontSize: 11, color: '#b45309', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
              <p style={{ fontSize: 12, color: 'var(--rk-text-3)', lineHeight: 1.5 }}>
                {view === 'active' ? 'No active claims.' : 'No archived claims.'}
              </p>
            </div>
          ) : groups.map(group => (
            <PaperGroup
              key={group.groupKey}
              group={group}
              expanded={expandedKeys.has(group.groupKey)}
              onToggleExpand={handleToggleExpand}
              onRemoveItem={id => onRemove?.(id)}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedList.length > 0 && (
        <div
          className="flex items-center justify-between px-3 py-2 shrink-0"
          style={{ borderTop: '1px solid var(--rk-border-warm)', background: 'var(--rk-surface-warm)' }}
        >
          <span className="text-xs font-medium" style={{ color: 'var(--rk-brand)' }}>
            {selectedList.length} selected
          </span>
          <div className="flex gap-1.5">
            {view === 'active' ? (
              <>
                <button
                  onClick={() => onArchive(selectedList)}
                  style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 99,
                    border: '1px solid var(--rk-border-warm)',
                    background: 'white', color: 'var(--rk-text-2)',
                  }}
                >
                  Archive
                </button>
                <button
                  onClick={() => onAddToProject(selectedList)}
                  style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 99,
                    background: 'var(--rk-brand-gradient)',
                    border: 'none', color: 'white', fontWeight: 600,
                    boxShadow: '0 2px 6px rgba(124,58,237,0.25)',
                  }}
                >
                  Add to project
                </button>
              </>
            ) : (
              <button
                onClick={() => onUnarchive(selectedList)}
                style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 99,
                  background: 'var(--rk-brand-gradient)',
                  border: 'none', color: 'white', fontWeight: 600,
                  boxShadow: '0 2px 6px rgba(124,58,237,0.25)',
                }}
              >
                Unarchive
              </button>
            )}
            <button
              aria-label="clear"
              onClick={onClearSelection}
              style={{ fontSize: 11, color: 'var(--rk-text-3)', background: 'none', border: 'none' }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
