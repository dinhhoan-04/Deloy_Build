import { useEffect, useRef } from 'react'
import { ToolCallCard } from './ToolCallCard'
import type { AgentMessage } from './useOpenClawAgent'

interface ChatThreadProps {
  messages: AgentMessage[]
  isLoading?: boolean
}

export function ChatThread({ messages, isLoading }: ChatThreadProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [messages])

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-slate-400 text-sm">Ask a question about the page to get started</p>
          <p className="text-slate-500 text-xs mt-2">The agent will analyze content and verify claims</p>
        </div>
      </div>
    )
  }

  // Group consecutive text messages together
  const groupedMessages = messages.reduce((acc: any[], msg, i) => {
    if (msg.type === 'text') {
      if (acc.length > 0 && acc[acc.length - 1].type === 'text') {
        // Append to last text group
        acc[acc.length - 1].content += msg.delta
      } else {
        // Start new text group
        acc.push({ type: 'text', content: msg.delta, key: i })
      }
    } else {
      acc.push({ ...msg, key: i })
    }
    return acc
  }, [])

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 space-y-3"
    >
      {groupedMessages.map((msg) => {
        if (msg.type === 'text') {
          return (
            <div key={msg.key} className="bg-slate-800 p-3 rounded text-sm text-slate-100 leading-relaxed whitespace-pre-wrap break-words">
              {msg.content}
            </div>
          )
        }

        if (msg.type === 'tool_use') {
          return (
            <ToolCallCard
              key={msg.key}
              name={msg.name || '?'}
              input={msg.input || {}}
            />
          )
        }

        if (msg.type === 'tool_result') {
          return (
            <div key={msg.key} className="bg-slate-800/50 border-l-2 border-green-600 p-3 rounded text-xs text-slate-300">
              <div className="font-semibold text-green-400 mb-1">✓ {msg.name} result</div>
              <code className="block bg-slate-900 p-2 rounded mt-1 overflow-x-auto text-slate-200">
                {JSON.stringify(msg.output, null, 2).substring(0, 200)}
                {JSON.stringify(msg.output || {}).length > 200 ? '...' : ''}
              </code>
            </div>
          )
        }

        if (msg.type === 'error') {
          return (
            <div
              key={msg.key}
              className="bg-red-900/20 border border-red-700/30 p-3 rounded text-sm text-red-200"
            >
              ❌ {msg.message}
            </div>
          )
        }

        if (msg.type === 'done') {
          return (
            <div
              key={msg.key}
              className="text-center text-xs text-slate-500 mt-4 pt-4 border-t border-slate-700"
            >
              Agent finished (stop_reason: {msg.stop_reason})
            </div>
          )
        }

        return null
      })}

      {isLoading && messages.length > 0 && (
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <span className="animate-pulse">●</span>
          Agent is thinking...
        </div>
      )}
    </div>
  )
}
