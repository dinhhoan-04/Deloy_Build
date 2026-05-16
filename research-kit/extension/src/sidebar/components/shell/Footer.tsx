import type { Project } from '../../../shared/verify-types'
import { ProjectSelector } from '../atoms/ProjectSelector'

interface FooterProps {
  projects: Project[]
  currentProjectId: string
  onSwitchProject: (id: string) => void
  onCreateProject: () => void
  onOpenDemo: () => void
  inboxSelectedCount: number
  onClearSelection: () => void
  onEditProject?: (project: { id: string; name: string }) => void
}

export function Footer({
  projects, currentProjectId, onSwitchProject, onCreateProject, onOpenDemo,
  inboxSelectedCount, onClearSelection, onEditProject,
}: FooterProps) {
  const currentProject = projects.find(p => p.id === currentProjectId)

  return (
    <footer
      style={{ height: 'var(--rk-footer-h)' }}
      className="flex items-center justify-between px-3 bg-[var(--rk-surface)] border-t border-[var(--rk-border-warm)] shrink-0"
    >
      <div className="flex items-center gap-1 group">
        <ProjectSelector
          projects={projects}
          currentId={currentProjectId}
          onSwitch={onSwitchProject}
          onCreate={onCreateProject}
        />
        {onEditProject && currentProject && (
          <button
            onClick={e => { e.stopPropagation(); onEditProject(currentProject) }}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'none', border: 'none', padding: '2px', color: 'var(--rk-text-3)', cursor: 'pointer' }}
            title="Edit project"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          aria-label="open demo project"
          onClick={onOpenDemo}
          style={{ borderRadius: 99, background: 'var(--rk-surface-warm)', border: '1px solid var(--rk-border-warm)', color: 'var(--rk-brand)', fontWeight: 500 }}
          className="text-xs px-2 py-1"
        >
          Demo
        </button>
        {inboxSelectedCount > 0 && (
          <>
          <span className="text-xs text-[var(--rk-text-2)]">{inboxSelectedCount} selected</span>
          <button
            aria-label="clear selection"
            onClick={onClearSelection}
            className="text-xs text-[var(--rk-text-3)] hover:text-[var(--rk-text)]"
          >
            Clear
          </button>
          </>
        )}
      </div>
    </footer>
  )
}
