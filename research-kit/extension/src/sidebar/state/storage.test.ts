import { describe, it, expect, vi } from 'vitest'
import { readStorage, writeStorage, appendStorage, subscribeStorage } from './storage'
import { DEFAULTS } from './storage-schema'

describe('storage', () => {
  it('readStorage returns default when key missing', async () => {
    const v = await readStorage('verifyEnabled')
    expect(v).toBe(DEFAULTS.verifyEnabled)
  })

  it('writeStorage persists value, readStorage returns it', async () => {
    await writeStorage('provider', 'gemini')
    const v = await readStorage('provider')
    expect(v).toBe('gemini')
  })

  it('appendStorage adds to array atomically', async () => {
    await writeStorage('inboxItems', [])
    await appendStorage('inboxItems', { id: 'inb_1' } as any)
    await appendStorage('inboxItems', { id: 'inb_2' } as any)
    const items = await readStorage('inboxItems')
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe('inb_1')
  })

  it('subscribeStorage fires on change', async () => {
    const fn = vi.fn()
    const unsub = subscribeStorage(fn)
    await writeStorage('verifyEnabled', false)
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ verifyEnabled: expect.anything() }), 'local')
    unsub()
  })
})
