import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../state/useStore'
import { createRun } from '../../../shared/api'
import { API_URL } from '../../../shared/config'
import { useRunStream } from '../../hooks/useRunStream'
import { MarkdownView } from '../atoms/MarkdownView'
import { Checkbox } from '../atoms/Checkbox'
import { authHeader } from '../../../shared/auth'

const TEMPLATES: { value: 'literature_review' | 'research_summary'; label: string }[] = [
  { value: 'research_summary', label: 'Research Summary' },
  { value: 'literature_review', label: 'Literature Review' },
]

const CITATION_STYLES: { value: 'apa' | 'vancouver' | 'ieee'; label: string }[] = [
  { value: 'apa', label: 'APA' },
  { value: 'vancouver', label: 'Vancouver' },
  { value: 'ieee', label: 'IEEE' },
]

export function DraftTab({ demoRunId }: { demoRunId?: string | null }) {
  const projectId = useStore(s => s.currentProjectId)
  const provider = useStore(s => s.provider)
  const inboxItems = useStore(s => s.inbox.data)
  const claims = useStore(s => s.claims.data)
  const draft = useStore(s => s.draft)
  const loadDraft = useStore(s => s.loadDraft)
  const saveDraft = useStore(s => s.saveDraft)
  const updateDraftField = useStore(s => s.updateDraftField)
  const deleteDraft = useStore(s => s.deleteDraft)
  const showToast = useStore(s => s.showToast)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [template, setTemplate] = useState<'literature_review' | 'research_summary'>('research_summary')
  const [citationStyle, setCitationStyle] = useState<'apa' | 'vancouver' | 'ieee'>('apa')
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const stream = useRunStream(activeRunId)

  const [localTitle, setLocalTitle] = useState('')
  const [localMarkdown, setLocalMarkdown] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!activeRunId && demoRunId) setActiveRunId(demoRunId)
  }, [activeRunId, demoRunId])

  useEffect(() => {
    if (projectId) loadDraft(projectId)
  }, [projectId])

  useEffect(() => {
    if (draft.data) {
      setLocalTitle(draft.data.title)
      setLocalMarkdown(draft.data.markdown)
    }
  }, [draft.data?.id])

  function toggle(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function generate() {
    if (!projectId || selected.size === 0) return
    const claimsForDraft = inboxItems
      .filter(i => selected.has(i.id))
      .map(i => {
        const c = claims.find(x => x.id === i.claim_id)
        return c ? {
          id: c.id,
          text: c.text,
          verbatim_quote: c.quote ?? undefined,
          paper_title: c.paper_title ?? undefined,
          doi: c.doi ?? undefined,
        } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    const idem = `draft:${projectId}:${Date.now()}`
    const { run_id } = await createRun({
      kind: 'draft', project_id: projectId, idempotency_key: idem,
      provider,
      input: { claims: claimsForDraft, template, citation_style: citationStyle },
    })
    setActiveRunId(run_id)
  }

  const streamMarkdown = stream.finalContent
    ? (() => { try { return JSON.parse(stream.finalContent).markdown } catch { return stream.tokens } })()
    : stream.tokens

  const streamSections = stream.finalContent
    ? (() => { try { return JSON.parse(stream.finalContent).sections ?? [] } catch { return [] } })()
    : []

  async function handleSave() {
    if (!projectId || !streamMarkdown) return
    await saveDraft(projectId, activeRunId, streamMarkdown, streamSections)
  }

  async function handleExport(format: 'md' | 'docx') {
    if (!draft.data) return
    try {
      const res = await fetch(`${API_URL}/drafts/${draft.data.id}/export?format=${format}`, {
        headers: authHeader() as Record<string, string>,
      })
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${draft.data.title || 'draft'}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      showToast('Export failed', 'error')
    }
  }

  async function handleDelete() {
    if (!draft.data) return
    if (!confirm('Delete this draft?')) return
    await deleteDraft(draft.data.id)
  }

  const hasDraft = !!draft.data

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Claim selector */}
      <div
        className="shrink-0 overflow-y-auto"
        style={{ maxHeight: 160, borderBottom: '1px solid var(--rk-border-warm)', background: 'var(--rk-surface-warm)' }}
      >
        {inboxItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-1 text-center px-4">
            <p className="text-sm" style={{ color: 'var(--rk-text-3)' }}>No inbox items yet.</p>
            <p className="text-xs" style={{ color: 'var(--rk-text-3)' }}>Add verified claims to inbox first.</p>
          </div>
        ) : (
          <div className="px-3 pt-2 pb-1">
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--rk-brand)' }}>Select claims to include</p>
            <div className="flex flex-col gap-1">
              {inboxItems.map(i => {
                const c = claims.find(x => x.id === i.claim_id)
                return (
                  <div key={i.id} className="flex gap-2 items-start py-1">
                    <Checkbox checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                    <span className="text-xs leading-relaxed" style={{ color: 'var(--rk-text)' }}>{c?.text ?? '(missing claim)'}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div
        className="shrink-0 px-3 py-2"
        style={{ borderBottom: '1px solid var(--rk-border-warm)', background: 'white' }}
      >
        {/* Template row */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs shrink-0" style={{ color: 'var(--rk-text-3)', width: 48 }}>Template</span>
          <div className="flex gap-1">
            {TEMPLATES.map(t => (
              <button
                key={t.value}
                onClick={() => setTemplate(t.value)}
                style={template === t.value ? {
                  background: 'var(--rk-brand-gradient)', color: 'white',
                  border: 'none', fontWeight: 600, boxShadow: '0 2px 4px rgba(124,58,237,0.25)',
                } : {
                  background: 'var(--rk-surface-warm)', color: 'var(--rk-brand)',
                  border: '1px solid var(--rk-border-warm)',
                }}
                className="text-xs px-3 py-1 rounded-full transition-colors"
              >{t.label}</button>
            ))}
          </div>
        </div>
        {/* Citation style row */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs shrink-0" style={{ color: 'var(--rk-text-3)', width: 48 }}>Citation</span>
          <div className="flex gap-1">
            {CITATION_STYLES.map(s => (
              <button
                key={s.value}
                onClick={() => setCitationStyle(s.value)}
                style={citationStyle === s.value ? {
                  background: 'var(--rk-brand-gradient)', color: 'white',
                  border: 'none', fontWeight: 600, boxShadow: '0 2px 4px rgba(124,58,237,0.25)',
                } : {
                  background: 'var(--rk-surface-warm)', color: 'var(--rk-brand)',
                  border: '1px solid var(--rk-border-warm)',
                }}
                className="text-xs px-3 py-1 rounded-full transition-colors"
              >{s.label}</button>
            ))}
          </div>
        </div>
        {/* Action buttons row */}
        <div className="flex items-center gap-2">
          <div className="flex-1" />
          <button
            onClick={() => void generate()}
            disabled={selected.size === 0 || !!activeRunId}
            style={{
              background: selected.size === 0 || !!activeRunId ? 'var(--rk-border-warm)' : 'var(--rk-brand-gradient)',
              color: selected.size === 0 || !!activeRunId ? 'var(--rk-text-3)' : 'white',
              border: 'none', borderRadius: 99, padding: '5px 14px', fontSize: 12, fontWeight: 600,
              cursor: selected.size === 0 || !!activeRunId ? 'not-allowed' : 'pointer',
            }}
          >{activeRunId ? 'Generating…' : 'Generate'}</button>
          {streamMarkdown && (
            <button
              onClick={() => void handleSave()}
              disabled={draft.saving}
              style={{
                background: draft.saving ? 'var(--rk-border-warm)' : 'var(--rk-brand-gradient)',
                color: draft.saving ? 'var(--rk-text-3)' : 'white',
                border: 'none', borderRadius: 99, padding: '5px 14px', fontSize: 12, fontWeight: 600,
                cursor: draft.saving ? 'not-allowed' : 'pointer',
              }}
            >{draft.saving ? 'Saving…' : 'Save'}</button>
          )}
        </div>
      </div>

      {/* Output / Editor */}
      <div className="flex-1 overflow-y-auto flex flex-col" style={{ background: 'white' }}>
        {hasDraft ? (
          <div className="flex flex-col h-full p-3 gap-2">
            <div className="flex items-center gap-1">
              <input
                ref={titleRef}
                value={localTitle}
                onChange={e => setLocalTitle(e.target.value)}
                onBlur={() => draft.data && updateDraftField(draft.data.id, 'title', localTitle)}
                className="flex-1 text-sm font-semibold border-0 border-b outline-none py-1"
                style={{ borderColor: 'var(--rk-border-warm)', color: 'var(--rk-text)' }}
              />
              {draft.dirty && (
                <span className="text-xs" style={{ color: 'var(--rk-text-3)' }}>Unsaved</span>
              )}
            </div>
            <textarea
              value={localMarkdown}
              onChange={e => setLocalMarkdown(e.target.value)}
              onBlur={() => draft.data && updateDraftField(draft.data.id, 'markdown', localMarkdown)}
              className="flex-1 text-xs font-mono resize-none outline-none p-2 rounded"
              style={{
                minHeight: 120, border: '1px solid var(--rk-border-warm)',
                color: 'var(--rk-text)', background: 'var(--rk-surface-warm)',
              }}
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => void handleExport('md')}
                className="text-xs px-3 py-1 rounded-full"
                style={{ background: 'var(--rk-surface-warm)', color: 'var(--rk-brand)', border: '1px solid var(--rk-border-warm)' }}
              >↓ .md</button>
              <button
                onClick={() => void handleExport('docx')}
                className="text-xs px-3 py-1 rounded-full"
                style={{ background: 'var(--rk-surface-warm)', color: 'var(--rk-brand)', border: '1px solid var(--rk-border-warm)' }}
              >↓ .docx</button>
              <div className="flex-1" />
              <button
                onClick={() => void handleDelete()}
                className="text-xs px-3 py-1 rounded-full"
                style={{ background: 'var(--rk-surface-warm)', color: 'var(--rk-red)', border: '1px solid var(--rk-border-warm)' }}
              >🗑 Delete</button>
            </div>
          </div>
        ) : streamMarkdown ? (
          <div className="p-3">
            <MarkdownView source={streamMarkdown} />
            {stream.error && (
              <p className="text-xs mt-2" style={{ color: 'var(--rk-red)' }}>{stream.error.message}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-3">
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'var(--rk-brand-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--rk-brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </div>
            <p className="text-xs" style={{ color: 'var(--rk-text-3)' }}>Select claims and click Generate</p>
          </div>
        )}
      </div>
    </div>
  )
}
