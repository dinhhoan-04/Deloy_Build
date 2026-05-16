import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, AuthExpiredError } from './errors'
import { authHeader, signOut } from './auth'
import { verifyWithPdf, getConflictCheckStatus } from './api'
import * as auth from './auth'

vi.mock('./auth', () => ({
  authHeader: vi.fn(() => ({ Authorization: 'Bearer STOK' })),
  signOut: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).chrome = {
    storage: { local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(), remove: vi.fn().mockResolvedValue(undefined),
    } },
  }
})

describe('apiFetch behavior', () => {
  it('listProjects sends auth header', async () => {
    ;(authHeader as any).mockReturnValue({ Authorization: 'Bearer STOK' })
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true, status: 200,
      json: async () => [{ id: 'p1', name: 'A' }],
    })
    const api = await import('./api')
    const projects = await api.listProjects()
    expect(projects).toEqual([{ id: 'p1', name: 'A' }])
    const call = (globalThis.fetch as any).mock.calls[0]
    expect(call[1].headers.Authorization).toBe('Bearer STOK')
  })

  it('401 triggers signOut and AuthExpiredError', async () => {
    ;(authHeader as any).mockReturnValue({})
    ;(globalThis.fetch as any).mockResolvedValue({ ok: false, status: 401, text: async () => '' })
    const api = await import('./api')
    await expect(api.listProjects()).rejects.toBeInstanceOf(AuthExpiredError)
    expect(signOut).toHaveBeenCalled()
  })

  it('5xx throws ApiError', async () => {
    ;(authHeader as any).mockReturnValue({})
    ;(globalThis.fetch as any).mockResolvedValue({ ok: false, status: 500, text: async () => 'oops', headers: { get: () => null } })
    const api = await import('./api')
    await expect(api.listProjects()).rejects.toBeInstanceOf(ApiError)
  })
})

describe('verifyWithPdf', () => {
  it('sends Authorization header and does not set Content-Type', async () => {
    vi.spyOn(auth, 'authHeader').mockReturnValue({ Authorization: 'Bearer testtoken' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        status: 'verified', verbatim_quote: 'q', confidence: 0.9,
        reason: 'ok', paper_title: 'P', doi: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }) as any
    )

    const file = new File(['x'], 'p.pdf', { type: 'application/pdf' })
    await verifyWithPdf({ file, claim: 'c' })

    const [, init] = fetchSpy.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer testtoken')
    expect(headers['Content-Type']).toBeUndefined()
    fetchSpy.mockRestore()
  })
})

describe('getConflictCheckStatus', () => {
  it('GETs /v1/conflicts/check-status with project_id and returns parsed body', async () => {
    const fakeBody = { last_checked_at: '2026-05-16T10:00:00Z', pending_count: 2 }
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => fakeBody,
    } as Response)

    const out = await getConflictCheckStatus('proj-1')
    expect(out).toEqual(fakeBody)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/conflicts/check-status?project_id=proj-1'),
      expect.any(Object),
    )
  })
})
