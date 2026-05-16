import { useEffect, useState } from 'react'
import { OPENCLAW_WS_URL } from '../shared/config'

export interface AgentMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done'
  delta?: string
  name?: string
  input?: Record<string, any>
  output?: Record<string, any>
  message?: string
  stop_reason?: string
}

export function useOpenClawAgent(wsUrl = OPENCLAW_WS_URL) {
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize WebSocket connection
  useEffect(() => {
    let socket: WebSocket | null = null

    try {
      socket = new WebSocket(wsUrl)

      socket.onopen = () => {
        console.log('[OpenClaw] WebSocket connected')
        setError(null)
        setWs(socket)
      }

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as AgentMessage
          console.log('[OpenClaw] Message received:', msg.type)

          setMessages((prev) => [...prev, msg])

          if (msg.type === 'done') {
            setIsRunning(false)
          }
        } catch (e) {
          console.error('[OpenClaw] Failed to parse message:', e)
        }
      }

      socket.onerror = (event) => {
        console.error('[OpenClaw] WebSocket error:', event)
        setError('WebSocket connection error')
        setIsRunning(false)
      }

      socket.onclose = () => {
        console.log('[OpenClaw] WebSocket closed')
      }
    } catch (e) {
      console.error('[OpenClaw] Failed to create WebSocket:', e)
      setError(`Connection failed: ${String(e)}`)
    }

    return () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close()
      }
    }
  }, [wsUrl])

  const runAgent = (
    request: string,
    pageModels: object[],
    provider: 'anthropic' | 'openai' | 'gemini' | 'zai' | 'ollama' = 'anthropic'
  ) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('WebSocket not connected')
      return
    }

    setMessages([])
    setIsRunning(true)
    setError(null)

    const payload = {
      type: 'agent:run',
      request,
      page_models: pageModels,
      provider,
      mode: 'chat',
    }

    try {
      ws.send(JSON.stringify(payload))
      console.log('[OpenClaw] Agent request sent, provider:', provider)
    } catch (e) {
      console.error('[OpenClaw] Failed to send message:', e)
      setError(`Send failed: ${String(e)}`)
      setIsRunning(false)
    }
  }

  return {
    messages,
    isRunning,
    runAgent,
    connected: ws?.readyState === WebSocket.OPEN,
    error,
  }
}
