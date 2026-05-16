// research-kit/extension/src/shared/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).chrome = {
    identity: {
      launchWebAuthFlow: vi.fn(),
      getRedirectURL: () => 'https://abc.chromiumapp.org/',
    },
    storage: { local: {
      get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    } },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis.crypto as any).randomUUID = () => '11111111-1111-1111-1111-111111111111'
  globalThis.fetch = vi.fn()
})

describe('googleSignIn', () => {
  it('exchanges id_token for session_token and persists', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(chrome.identity.launchWebAuthFlow as any).mockResolvedValue('https://abc.chromiumapp.org/#id_token=GTOKEN&state=x')
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        session_token: 'STOK',
        user: { id: 'u1', email: 'a@b.c', name: 'A' },
        expires_at: '2099-01-01T00:00:00Z',
      }),
    })
    const auth = await import('./auth')
    const result = await auth.googleSignIn()
    expect(result?.token).toBe('STOK')
    expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      rk_auth: expect.objectContaining({ token: 'STOK' }),
    }))
  })

  it('signOut clears state and storage', async () => {
    const auth = await import('./auth')
    await auth.signOut()
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('rk_auth')
  })

  it('loadStoredAuth returns null when expired', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(chrome.storage.local.get as any).mockResolvedValue({
      rk_auth: { token: 'old', user: {}, expiresAt: 0 },
    })
    const auth = await import('./auth')
    const r = await auth.loadStoredAuth()
    expect(r).toBeNull()
  })
})
