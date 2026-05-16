import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../state/useStore'
import { createRun, getRun, cancelRun, listClaims } from '../../../shared/api'
import { useRunStream } from '../../hooks/useRunStream'
import { MessageBubble } from '../atoms/MessageBubble'
import { ingestChunks, getAllChunks } from '../../../shared/rag-store'
import { bm25Search, buildContext } from '../../../shared/bm25'
import type { RagChunk } from '../../../shared/bm25'

interface Message { role: 'user' | 'assistant'; content: string; runId?: string }

export function ChatTab() {
  const projectId = useStore(s => s.currentProjectId)
  const provider = useStore(s => s.provider)
  const [thread, setThread] = useState<Message[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const stream = useRunStream(activeRunId)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!projectId) {
      setThread([])
      setHistoryLoaded(false)
      return
    }
    setHistoryLoaded(false)
    chrome.storage.local.get(`chat:${projectId}`).then((result: any) => {
      setThread(result[`chat:${projectId}`] ?? [])
      setHistoryLoaded(true)
    })
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    chrome.storage.local.set({ [`chat:${projectId}`]: thread })
  }, [thread, projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread, stream.tokens])

  useEffect(() => {
    if (!activeRunId) return
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const run = await getRun(activeRunId)
          if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') {
            setSendError(run.status === 'failed'
              ? (run.error?.message || 'Run failed')
              : null)
            setActiveRunId(null)
          } else {
            setSendError('Chat stream is not progressing. Please retry.')
          }
        } catch {
          setSendError('Cannot read chat run status. Please retry.')
          setActiveRunId(null)
        }
      })()
    }, 15000)
    return () => window.clearTimeout(timer)
  }, [activeRunId])

  useEffect(() => {
    if (!projectId) return
    listClaims(projectId).then(claims => {
      const chunks: RagChunk[] = claims.map(c => ({
        id: `claim:${c.id}`,
        source: 'claim',
        siteUrl: c.page_url ?? c.site,
        pageTitle: c.paper_title ?? c.site,
        text: `[Claim] ${c.text}${c.paper_title ? ` — Source: ${c.paper_title}` : ''}`,
      }))
      ingestChunks(chunks).catch(() => {})
    }).catch(() => {})
  }, [projectId])

  useEffect(() => {
    if (!activeRunId) return
    if (stream.status === 'succeeded' || stream.status === 'failed' || stream.status === 'cancelled') {
      ;(async () => {
        let final = stream.finalContent ?? stream.tokens
        if (stream.finalContent) {
          try {
            const parsed = JSON.parse(stream.finalContent)
            if (typeof parsed?.text === 'string') final = parsed.text
          } catch {}
        }
        if (stream.status === 'succeeded' && !stream.finalContent) {
          try {
            const r = await getRun(activeRunId)
            final = (r.result as any)?.text ?? final
          } catch {}
        }
        setThread(t => {
          const last = t[t.length - 1]
          if (last?.runId === activeRunId) {
            const next = [...t]
            next[next.length - 1] = { ...last, content: final ?? '(no response)' }
            return next
          }
          return t
        })
        setActiveRunId(null)
      })()
    }
  }, [stream.status])

  useEffect(() => {
    if (!activeRunId || !stream.error) return
    setSendError(stream.error.message)
    setActiveRunId(null)
  }, [activeRunId, stream.error])

  async function send() {
    if (!input.trim() || !projectId || !historyLoaded) return
    setSendError(null)
    const userMsg: Message = { role: 'user', content: input.trim() }
    const newThread = [...thread, userMsg]
    setThread(newThread)
    const query = input.trim()
    setInput('')

    const chunks = await getAllChunks()
    const topChunks = bm25Search(query, chunks)
    const context = topChunks.length > 0 ? buildContext(topChunks) : undefined

    const messages = newThread
      .map(m => ({ role: m.role, content: m.content.trim() }))
      .filter(m => m.content.length > 0)

    const idem = `chat:${projectId}:${Date.now()}`
    try {
      const { run_id } = await createRun({
        kind: 'chat', project_id: projectId, idempotency_key: idem,
        provider,
        input: {
          messages,
          ...(context && { context }),
        },
      })
      setThread(t => [...t, { role: 'assistant', content: '', runId: run_id }])
      setActiveRunId(run_id)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Chat request failed')
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header strip */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0 border-b"
        style={{ borderColor: 'var(--rk-border-warm)', background: 'var(--rk-surface-warm)' }}
      >
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'var(--rk-brand-gradient)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--rk-text-brand)' }}>AI Research Assistant</p>
        </div>
        <div className="flex items-center gap-1">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
          <span className="text-xs" style={{ color: 'var(--rk-text-3)' }}>Online</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pt-2 pb-1 flex flex-col gap-1">
        {thread.map((m, i) => {
          const isActiveAssistant = m.runId === activeRunId
          const content = isActiveAssistant ? stream.tokens : m.content
          const isTyping = isActiveAssistant && content === ''
          return (
            <MessageBubble key={i} role={m.role} content={content} isTyping={isTyping} />
          )
        })}
        {stream.error && <div className="text-red-600 text-sm px-1">{stream.error.message}</div>}
        {sendError && <div className="text-red-600 text-sm px-1">{sendError}</div>}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="p-2 shrink-0 border-t" style={{ borderColor: 'var(--rk-border-warm)' }}>
        <div
          className="flex items-end gap-2"
          style={{
            background: 'var(--rk-surface-warm)',
            border: `1.5px solid ${focused ? 'var(--rk-brand)' : 'var(--rk-border-warm)'}`,
            borderRadius: 12,
            padding: '6px 8px',
            transition: 'border-color 0.15s',
          }}
        >
          <textarea
            ref={textareaRef}
            className="flex-1"
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontSize: 14,
              lineHeight: 1.5,
              minHeight: 36,
              maxHeight: 120,
            }}
            value={input}
            onChange={e => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            disabled={!!activeRunId || !historyLoaded}
            placeholder="Ask anything…"
            rows={1}
          />
          {activeRunId ? (
            <button
              onClick={() => cancelRun(activeRunId)}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#ef4444',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: 'white',
                boxShadow: 'var(--rk-shadow-sm)',
              }}
              aria-label="Cancel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!input.trim() || !projectId || !historyLoaded}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'var(--rk-brand-gradient)',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: 'white',
                boxShadow: 'var(--rk-shadow-sm)',
              }}
              aria-label="Send"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
