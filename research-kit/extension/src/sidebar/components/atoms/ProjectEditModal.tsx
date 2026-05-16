import { useState } from 'react'

interface ProjectEditModalProps {
  project: { id: string; name: string }
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
  deleteDisabled?: boolean
}

export function ProjectEditModal({
  project, onRename, onDelete, onClose, deleteDisabled = false,
}: ProjectEditModalProps) {
  const [name, setName] = useState(project.name)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRename = async () => {
    if (!name.trim() || name === project.name) { onClose(); return }
    setSaving(true)
    try {
      await onRename(name.trim())
      onClose()
    } catch {
      setError('Rename failed. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setSaving(true)
    try {
      await onDelete()
      onClose()
    } catch (e: any) {
      setError(e?.message?.includes('in progress')
        ? 'Cannot delete — a run is in progress.'
        : 'Delete failed. Please retry.')
      setConfirmDelete(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--rk-bg)', boxShadow: '0 -4px 24px rgba(0,0,0,0.15)' }}
      >
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--rk-text-1)' }}>Edit Project</p>

        {error && (
          <p style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', borderRadius: 6, padding: '6px 10px' }}>
            {error}
          </p>
        )}

        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void handleRename() }}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
            border: '1px solid var(--rk-border-warm)', background: 'var(--rk-surface-warm)',
            color: 'var(--rk-text-1)', outline: 'none',
          }}
        />

        <div className="flex gap-2">
          <button
            onClick={() => void handleRename()}
            disabled={saving || !name.trim()}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'var(--rk-brand-gradient)', color: 'white', border: 'none',
              opacity: saving || !name.trim() ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13,
              border: '1px solid var(--rk-border-warm)', background: 'white',
              color: 'var(--rk-text-2)',
            }}
          >
            Cancel
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--rk-border-warm)', paddingTop: 12 }}>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleteDisabled || saving}
              title={deleteDisabled ? 'A run is in progress' : undefined}
              style={{
                width: '100%', padding: '8px 0', borderRadius: 8, fontSize: 13,
                border: '1px solid #fca5a5', background: 'white', color: '#dc2626',
                opacity: deleteDisabled ? 0.4 : 1,
              }}
            >
              Delete project…
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p style={{ fontSize: 12, color: 'var(--rk-text-2)', textAlign: 'center' }}>
                Delete "{project.name}"? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleDelete()}
                  disabled={saving}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    background: '#dc2626', color: 'white', border: 'none',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  style={{
                    padding: '7px 16px', borderRadius: 8, fontSize: 13,
                    border: '1px solid var(--rk-border-warm)', background: 'white',
                    color: 'var(--rk-text-2)',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
