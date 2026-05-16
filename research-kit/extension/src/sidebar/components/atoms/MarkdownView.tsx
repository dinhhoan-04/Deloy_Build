import ReactMarkdown from 'react-markdown'

export function MarkdownView({ source }: { source: string }) {
  return <ReactMarkdown>{source}</ReactMarkdown>
}
