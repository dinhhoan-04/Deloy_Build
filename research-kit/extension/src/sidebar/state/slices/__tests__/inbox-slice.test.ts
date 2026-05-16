import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as api from '../../../../shared/api'

vi.mock('../../../../shared/api')

describe('InboxSlice archiveMany', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls bulkPatchInbox with archived_at for all ids', async () => {
    const mockBulk = vi.fn().mockResolvedValue([
      { id: 'id-1', archived_at: '2026-05-15T00:00:00Z' },
      { id: 'id-2', archived_at: '2026-05-15T00:00:00Z' },
    ])
    vi.mocked(api.bulkPatchInbox).mockImplementation(mockBulk)
    vi.mocked(api.listInbox).mockResolvedValue([])

    const { createInboxSlice } = await import('../inbox')
    const get = vi.fn().mockReturnValue({ currentProjectId: 'p1', loadInbox: vi.fn() })
    const set = vi.fn()
    const slice = createInboxSlice(set, get)

    await slice.archiveMany(['id-1', 'id-2'])

    expect(mockBulk).toHaveBeenCalledTimes(1)
    expect(mockBulk).toHaveBeenCalledWith(['id-1', 'id-2'], expect.stringMatching(/^\d{4}-/))
  })

  it('calls bulkPatchInbox with null archived_at for unarchiveMany', async () => {
    const mockBulk = vi.fn().mockResolvedValue([{ id: 'id-1', archived_at: null }])
    vi.mocked(api.bulkPatchInbox).mockImplementation(mockBulk)
    vi.mocked(api.listInbox).mockResolvedValue([])

    const { createInboxSlice } = await import('../inbox')
    const get = vi.fn().mockReturnValue({ currentProjectId: 'p1', loadInbox: vi.fn() })
    const set = vi.fn()
    const slice = createInboxSlice(set, get)

    await slice.unarchiveMany(['id-1'])

    expect(mockBulk).toHaveBeenCalledWith(['id-1'], null)
  })
})
