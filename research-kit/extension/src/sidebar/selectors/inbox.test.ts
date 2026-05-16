import { describe, it, expect } from 'vitest'
import { groupInboxByPaper } from './inbox'
import type { InboxItem } from '../../shared/verify-types'

const fake = (o: Partial<InboxItem>): InboxItem => ({
  id: 'inb_' + Math.random(),
  claimId: 'c', text: 't', paperTitle: null, doi: null, paperUrl: null,
  page: '', site: 'elicit', status: 'verified', confidence: 0.9, quote: null,
  reason: '', projectId: 'p_default', savedAtMs: 0, archived_at: null, ...o,
})

describe('groupInboxByPaper', () => {
  it('groups by DOI', () => {
    const items = [
      fake({ id: 'a', doi: '10.1/x', paperTitle: 'X', text: 'q1', savedAtMs: 1 }),
      fake({ id: 'b', doi: '10.1/x', paperTitle: 'X', text: 'q2', savedAtMs: 2 }),
      fake({ id: 'c', doi: '10.2/y', paperTitle: 'Y', text: 'q3', savedAtMs: 3 }),
    ]
    const groups = groupInboxByPaper(items)
    expect(groups).toHaveLength(2)
    expect(groups[0].groupKey).toBe('10.2/y')          // most recent first
    expect(groups[1].claims).toHaveLength(2)
  })

  it('falls back to normalized title when DOI missing', () => {
    const items = [
      fake({ doi: null, paperTitle: 'Why We Sleep', text: 'a' }),
      fake({ doi: null, paperTitle: 'why we sleep', text: 'b' }),
    ]
    const groups = groupInboxByPaper(items)
    expect(groups).toHaveLength(1)
    expect(groups[0].claims).toHaveLength(2)
  })

  it('untitled items become individual groups', () => {
    const items = [
      fake({ id: 'x', doi: null, paperTitle: null, text: 'a' }),
      fake({ id: 'y', doi: null, paperTitle: null, text: 'b' }),
    ]
    const groups = groupInboxByPaper(items)
    expect(groups).toHaveLength(2)
  })

  it('sets hasUnknownDoi when DOI missing', () => {
    const items = [fake({ doi: null, paperTitle: 'X' })]
    const groups = groupInboxByPaper(items)
    expect(groups[0].hasUnknownDoi).toBe(true)
  })

  it('sets hasAbstractOnly when any claim status=partial', () => {
    const items = [
      fake({ doi: '10.1/x', status: 'verified' }),
      fake({ doi: '10.1/x', status: 'partial', text: 'b' }),
    ]
    const groups = groupInboxByPaper(items)
    expect(groups[0].hasAbstractOnly).toBe(true)
  })

  it('sorts claims within group DESC by savedAtMs', () => {
    const items = [
      fake({ doi: '10.1/x', text: 'a', savedAtMs: 1 }),
      fake({ doi: '10.1/x', text: 'b', savedAtMs: 3 }),
      fake({ doi: '10.1/x', text: 'c', savedAtMs: 2 }),
    ]
    const groups = groupInboxByPaper(items)
    expect(groups[0].claims.map(c => c.text)).toEqual(['b', 'c', 'a'])
  })
})
