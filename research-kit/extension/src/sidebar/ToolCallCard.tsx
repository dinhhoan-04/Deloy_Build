import { useState } from 'react'

interface ToolCallCardProps {
  name: string
  input: Record<string, any>
}

export function ToolCallCard({ name, input }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const getIcon = (toolName: string) => {
    switch (toolName) {
      case 'fetch_paper':
        return '📄'
      case 'verify_link':
        return '🔗'
      case 'verify_claim':
        return '✓'
      case 'extract_section':
        return '📋'
      case 'summarize':
        return '📝'
      case 'cross_compare':
        return '⚖️'
      case 'web_search':
        return '🔍'
      default:
        return '⚙️'
    }
  }

  return (
    <div className="bg-slate-800/50 border-l-2 border-blue-600 rounded overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 text-left hover:bg-slate-700/50 transition flex items-center justify-between"
      >
        <span className="font-semibold text-blue-400 flex items-center gap-2">
          <span>{getIcon(name)}</span>
          <span>{name}</span>
        </span>
        <span className="text-slate-500 text-xs">{isExpanded ? '▼' : '▶'}</span>
      </button>

      {isExpanded && (
        <div className="p-3 bg-slate-900/50 border-t border-slate-700">
          <div className="text-xs text-slate-400 font-mono">
            <div className="mb-2">
              <div className="text-slate-500 mb-1">Input:</div>
              <pre className="bg-slate-900 p-2 rounded overflow-x-auto text-slate-200">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
