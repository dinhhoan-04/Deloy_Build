import { MarkdownView } from './MarkdownView'

interface Props {
  role: 'user' | 'assistant'
  content: string
  isTyping?: boolean
}

export function MessageBubble({ role, content, isTyping }: Props) {
  if (role === 'user') {
    return (
      <div
        className="my-1 self-end max-w-[85%]"
        style={{
          padding: '7px 10px',
          background: 'var(--rk-brand-gradient)',
          color: 'white',
          borderRadius: '14px 14px 3px 14px',
          boxShadow: 'var(--rk-shadow-sm)',
        }}
      >
        <MarkdownView source={content} />
      </div>
    )
  }

  return (
    <div className="flex items-start gap-1.5 my-1 max-w-[90%]">
      <div
        className="shrink-0 mt-1"
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'var(--rk-brand-gradient)',
        }}
      />
      <div
        style={{
          padding: '7px 10px',
          background: 'white',
          color: 'var(--rk-text)',
          borderRadius: '14px 14px 14px 3px',
          boxShadow: 'var(--rk-shadow-sm)',
          border: '1px solid var(--rk-border-warm)',
        }}
      >
        {isTyping && content === '' ? (
          <div className="flex items-center gap-1 px-1 py-0.5">
            {[0, 0.2, 0.4].map((delay, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--rk-brand)',
                  animation: `pulseDot 1.2s ease-in-out ${delay}s infinite`,
                }}
              />
            ))}
          </div>
        ) : (
          <MarkdownView source={content} />
        )}
      </div>
    </div>
  )
}
