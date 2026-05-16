import { ConflictResolutionPanel } from '../atoms/ConflictResolutionPanel'
import { ConflictsCheckHeader } from '../atoms/ConflictsCheckHeader'
import { useConflictCheckPolling } from '../../hooks/useConflictCheckPolling'
import { useStore } from '../../state/useStore'
import type { Conflict } from '../../../shared/types'

interface Props {
  conflicts: Conflict[]
  onConfirm: (conflictId: string, acceptedClaimId: string) => Promise<void>
  onSuggest: (c: Conflict) => Promise<void>
}

export function ConflictsTab({ conflicts, onConfirm, onSuggest }: Props) {
  const projectId = useStore(s => s.currentProjectId)
  const activeTab = useStore(s => s.tab)
  const status = useStore(s => s.conflictCheckStatus.data)
  const stalled = useStore(s => s.conflictCheckStalled)
  const restartPolling = useStore(s => s.restartConflictCheckPolling)
  useConflictCheckPolling(projectId, activeTab === 'conflicts')

  const onRetry = projectId ? () => restartPolling() : undefined

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ConflictsCheckHeader status={status} stalled={stalled} onRetry={onRetry} />
      <div className="flex flex-col gap-2 p-2 overflow-y-auto flex-1">
        {conflicts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(37,99,235,0.12))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rk-brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rk-text-brand)' }}>No conflicts</p>
            <p style={{ fontSize: 12, color: 'var(--rk-text-3)', lineHeight: 1.5 }}>
              Conflicting claims from different sources will appear here.
            </p>
          </div>
        )}
        {conflicts.map(c => (
          <ConflictResolutionPanel
            key={c.id}
            conflict={c}
            onConfirm={acceptedClaimId => onConfirm(c.id, acceptedClaimId)}
            onSuggest={() => onSuggest(c)}
          />
        ))}
      </div>
    </div>
  )
}
