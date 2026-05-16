import { useState, useEffect, useRef } from 'react'
import type { Project } from '../../../shared/verify-types'

interface ProjectSelectorProps {
  projects: Project[]
  currentId: string
  onSwitch: (id: string) => void
  onCreate: () => void
}

function FolderIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 2.5C1 2 1.4 1.5 2 1.5h1.5l1 1H8C8.6 2.5 9 3 9 3.5v4C9 8 8.6 8.5 8 8.5H2C1.4 8.5 1 8 1 7.5V2.5z" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,3.5 5,6.5 8,3.5" />
    </svg>
  )
}

export function ProjectSelector({ projects, currentId, onSwitch, onCreate }: ProjectSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [isOpen])

  const currentProject = projects.find(p => p.id === currentId)
  const displayName = currentProject?.name ?? 'Select project…'

  return (
    <div className="flex items-center gap-1.5">
      <div ref={ref} style={{ position: 'relative' }}>
        {/* Pill button */}
        <button
          onClick={() => setIsOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'var(--rk-surface-warm)',
            border: '1px solid var(--rk-border-warm)',
            borderRadius: 99,
            padding: '4px 10px 4px 8px',
          }}
        >
          {/* Folder icon in gradient pill */}
          <span style={{
            width: 18, height: 18, borderRadius: '50%',
            background: 'var(--rk-brand-gradient)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <FolderIcon />
          </span>
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'var(--rk-text-brand)',
            maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {displayName}
          </span>
          <span style={{ color: 'var(--rk-brand)', display: 'flex', alignItems: 'center' }}>
            <ChevronIcon />
          </span>
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
            borderRadius: 10, border: '1px solid var(--rk-border-warm)',
            boxShadow: 'var(--rk-shadow-md)', background: 'white',
            minWidth: 180, zIndex: 10,
          }}>
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => { onSwitch(p.id); setIsOpen(false) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 10px', fontSize: 12,
                  color: p.id === currentId ? 'var(--rk-brand)' : 'var(--rk-text)',
                  fontWeight: p.id === currentId ? 600 : 400,
                }}
                className="hover:bg-[var(--rk-surface-warm)]"
              >
                {p.name}
              </button>
            ))}
            <button
              onClick={() => { onCreate(); setIsOpen(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '7px 10px', fontSize: 12,
                color: 'var(--rk-brand)', fontWeight: 500,
                borderTop: '1px solid var(--rk-border-warm)',
              }}
              className="hover:bg-[var(--rk-surface-warm)]"
            >
              + New project
            </button>
          </div>
        )}
      </div>

      {/* New project button */}
      <button
        onClick={onCreate}
        title="New project"
        style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'var(--rk-surface-warm)',
          border: '1px solid var(--rk-border-warm)',
          color: 'var(--rk-brand)',
          fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >+</button>
    </div>
  )
}
