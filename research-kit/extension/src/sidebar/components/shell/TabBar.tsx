import type { TabId } from '../../state/useStore'

const IconVerify = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
const IconInbox = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
)
const IconConflicts = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
)
const IconChat = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)
const IconDraft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)
const IconHelp = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

const TABS: { id: TabId; label: string; Icon: React.FC }[] = [
  { id: 'verify',    label: 'Verify',    Icon: IconVerify },
  { id: 'inbox',     label: 'Inbox',     Icon: IconInbox },
  { id: 'conflicts', label: 'Conflicts', Icon: IconConflicts },
  { id: 'chat',      label: 'Chat',      Icon: IconChat },
  { id: 'draft',     label: 'Draft',     Icon: IconDraft },
  { id: 'help',      label: 'Help',      Icon: IconHelp },
]

interface TabBarProps {
  activeTab: TabId
  onSelect: (tab: TabId) => void
  inboxCount?: number
  conflictsCount?: number
}

export function TabBar({ activeTab, onSelect, inboxCount = 0, conflictsCount = 0 }: TabBarProps) {
  return (
    <div
      role="tablist"
      style={{ height: 'var(--rk-tabbar-h)' }}
      className="grid grid-cols-6 items-stretch border-b border-[var(--rk-border)] bg-[var(--rk-surface)] shrink-0 px-1"
    >
      {TABS.map(tab => {
        const isActive = tab.id === activeTab
        const badge = tab.id === 'inbox' ? inboxCount : tab.id === 'conflicts' ? conflictsCount : 0
        return (
          <button
            key={tab.id}
            role="tab"
            aria-label={tab.label}
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            style={isActive ? {
              background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(37,99,235,0.12))',
              color: 'var(--rk-brand)',
            } : undefined}
            className={[
              'flex flex-col items-center justify-center gap-0.5 text-xs relative rounded-lg my-1 mx-0.5 transition-colors',
              isActive
                ? ''
                : 'text-[var(--rk-text-3)] hover:text-[var(--rk-text)] hover:bg-[var(--rk-surface-2)]',
            ].join(' ')}
          >
            <tab.Icon />
            <span style={isActive ? { fontWeight: 700 } : undefined}>{tab.label}</span>
            {badge > 0 && (
              <span
                className="absolute top-1 right-1 text-[10px] text-white rounded-full w-4 h-4 flex items-center justify-center"
                style={{ background: 'var(--rk-brand-gradient)' }}
              >
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
