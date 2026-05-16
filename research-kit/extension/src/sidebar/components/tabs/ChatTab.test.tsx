import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatTab } from './ChatTab'

vi.mock('../../../shared/api', () => ({
  createRun: vi.fn().mockResolvedValue({ run_id: 'r1', status: 'queued', stream_url: '' }),
  getRun: vi.fn().mockResolvedValue({ result: { text: 'pong' } }),
  cancelRun: vi.fn(),
  listClaims: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../hooks/useRunStream', () => ({
  useRunStream: (id: string | null) => id
    ? { status: 'succeeded', tokens: 'pong', toolCalls: [], error: null, finalContent: 'pong' }
    : { status: 'queued', tokens: '', toolCalls: [], error: null, finalContent: null },
}))
vi.mock('../../state/useStore', () => ({ useStore: (sel: any) => sel({ currentProjectId: 'p1', provider: 'openai' }) }))
vi.mock('../../../shared/rag-store', () => ({
  ingestChunks: vi.fn().mockResolvedValue(undefined),
  getAllChunks: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../shared/bm25', () => ({
  bm25Search: vi.fn().mockReturnValue([]),
  buildContext: vi.fn().mockReturnValue(''),
}))

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

describe('ChatTab', () => {
  it('renders send button', () => {
    ;(globalThis as any).chrome = {
      storage: {
        local: { get: async () => ({}), set: async () => {} },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      },
    }
    render(<ChatTab />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })
})
