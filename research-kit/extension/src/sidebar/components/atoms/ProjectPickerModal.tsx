interface Project { id: string; name: string }

interface ProjectPickerModalProps {
  projects: Project[]
  selectedCount: number
  onSelect: (projectId: string) => void
  onClose: () => void
}

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
)

export function ProjectPickerModal({ projects, selectedCount, onSelect, onClose }: ProjectPickerModalProps) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(124,58,237,0.15)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: 240,
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
            background: 'linear-gradient(180deg, var(--rk-surface-warm), #eff6ff)',
            padding: '12px 14px 10px',
            borderBottom: '1px solid var(--rk-border-warm)',
          }}
        >
          <p className="font-semibold text-sm" style={{ color: 'var(--rk-text-brand)' }}>Add to project</p>
          {selectedCount > 0 && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--rk-text-3)' }}>{selectedCount} item{selectedCount !== 1 ? 's' : ''} selected</p>
          )}
        </div>

        {/* Project rows */}
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
              style={{ background: 'white', border: 'none' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--rk-surface-warm)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'white')}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: 'var(--rk-brand-gradient)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  flexShrink: 0,
                }}
              >
                <FolderIcon />
              </div>
              <span className="truncate" style={{ color: 'var(--rk-text)' }}>{p.name}</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '8px 14px',
            borderTop: '1px solid var(--rk-border-warm)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            className="text-sm"
            style={{ background: 'none', border: 'none', color: 'var(--rk-brand)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
