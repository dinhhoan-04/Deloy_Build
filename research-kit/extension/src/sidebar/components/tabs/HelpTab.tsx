const SECTIONS = [
  {
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    title: 'Verify',
    body: 'Review and verify claims extracted from Elicit, SciSpace, and Consensus.',
  },
  {
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
    title: 'Inbox',
    body: 'Manage verified claims by paper, organize into projects, and archive when done.',
  },
  {
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    title: 'Conflicts',
    body: 'Review and resolve conflicting claims from different sites.',
  },
  {
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: 'Chat',
    body: 'Ask the AI assistant about your research claims and findings.',
  },
  {
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
    title: 'Draft',
    body: 'Synthesize verified claims into a structured research document.',
  },
]

export function HelpTab() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--rk-text-brand)' }}>How to use ResearchKit</p>
        <div className="flex flex-col gap-3">
          {SECTIONS.map(s => (
            <div
              key={s.title}
              className="flex gap-3 items-start"
              style={{
                background: 'var(--rk-surface-warm)',
                border: '1px solid var(--rk-border-warm)',
                borderRadius: 10,
                padding: '9px 10px',
              }}
            >
              <div
                style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: 'var(--rk-brand-subtle)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--rk-brand)',
                  flexShrink: 0,
                }}
              >
                {s.icon}
              </div>
              <div>
                <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--rk-text-brand)' }}>{s.title}</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--rk-text-3)' }}>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="shrink-0 px-3 py-2"
        style={{ borderTop: '1px solid var(--rk-border-warm)', background: 'var(--rk-surface-warm)' }}
      >
        <p className="text-xs" style={{ color: 'var(--rk-text-3)' }}>Version 2.0 · ResearchKit</p>
      </div>
    </div>
  )
}
