import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useRunStream } from './useRunStream'

vi.mock('../../shared/api', () => ({
  streamRun: async function* () {
    yield { type: 'status', payload: { status: 'running' } }
    yield { type: 'token', payload: { text: 'hel' } }
    yield { type: 'token', payload: { text: 'lo' } }
    yield { type: 'status', payload: { status: 'succeeded' } }
  },
}))

describe('useRunStream', () => {
  it('accumulates tokens and tracks status', async () => {
    const { result } = renderHook(() => useRunStream('run-1'))
    await waitFor(() => expect(result.current.status).toBe('succeeded'))
    expect(result.current.tokens).toBe('hello')
  })
})
