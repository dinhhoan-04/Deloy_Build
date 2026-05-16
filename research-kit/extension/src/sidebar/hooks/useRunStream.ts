import { useEffect, useState } from 'react'
import { streamRun } from '../../shared/api'
import type { RunEvent, RunStatus } from '../../shared/types'

interface ToolCall { id?: string; name: string; args?: unknown; result?: unknown }
interface RunError { code: string; message: string; recoverable?: boolean }

export function useRunStream(runId: string | null) {
  const [tokens, setTokens] = useState('')
  const [status, setStatus] = useState<RunStatus>('queued')
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [error, setError] = useState<RunError | null>(null)
  const [finalContent, setFinalContent] = useState<string | null>(null)

  useEffect(() => {
    if (!runId) return
    const ctrl = new AbortController()
    setTokens(''); setStatus('queued'); setToolCalls([]); setError(null); setFinalContent(null)
    ;(async () => {
      try {
        for await (const evt of streamRun(runId, { signal: ctrl.signal })) {
          dispatch(evt)
        }
      } catch (e: unknown) {
        if (!ctrl.signal.aborted) {
          const err = e as { name?: string; message?: string }
          setError({ code: err.name || 'error', message: err.message ?? String(e) })
        }
      }
    })()
    function dispatch(evt: RunEvent) {
      switch (evt.type) {
        case 'status': setStatus(evt.payload.status); break
        case 'token': setTokens(t => t + evt.payload.text); break
        case 'tool_call': setToolCalls(c => [...c, { id: evt.payload.id, name: evt.payload.name, args: evt.payload.args }]); break
        case 'tool_result': setToolCalls(c => c.map(x => x.id === evt.payload.id
          ? { ...x, result: evt.payload.result } : x)); break
        case 'error': setError(evt.payload); break
        case 'final': setFinalContent(evt.payload.content); break
      }
    }
    return () => ctrl.abort()
  }, [runId])

  return { tokens, status, toolCalls, error, finalContent }
}
