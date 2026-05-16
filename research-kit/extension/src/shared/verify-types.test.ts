import { describe, it, expectTypeOf } from 'vitest'
import type {
  SiteId, Provider, Project,
  ClaimItem, InboxItem, ConflictItem, ConflictSide, VerifyProgress,
} from './verify-types'

describe('verify-types', () => {
  it('SiteId is restricted to three sites', () => {
    expectTypeOf<SiteId>().toEqualTypeOf<'elicit' | 'scispace' | 'consensus'>()
  })

  it('ClaimItem includes merged fields', () => {
    const c: ClaimItem = {
      id: 'c1', text: 'claim', paperTitle: null, doi: null, paperUrl: null,
      page: 'p.1', site: 'elicit', status: 'pending', confidence: 0,
      quote: null, reason: '', saved: false, domAnchor: 'x',
      tabId: 1, pageUrl: 'https://x', extractedAt: 0,
    }
    expectTypeOf(c).toMatchTypeOf<ClaimItem>()
  })

  it('Project has id and name only', () => {
    const p: Project = { id: 'p_default', name: 'Default Project' }
    expectTypeOf(p).toMatchTypeOf<Project>()
  })

  it('InboxItem references projectId', () => {
    const i: InboxItem = {
      id: 'inb_1', claimId: 'c1', text: 't', paperTitle: null, doi: null,
      paperUrl: null, page: '', site: 'elicit', status: 'verified',
      confidence: 0.9, quote: null, reason: '', projectId: 'p_default', savedAtMs: 0, archived_at: null,
    }
    expectTypeOf(i).toMatchTypeOf<InboxItem>()
  })

  it('ConflictItem holds at least one side', () => {
    const cs: ConflictSide = { site: 'elicit', claimId: 'c1', text: 't', confidence: 0.8, status: 'verified' }
    const cf: ConflictItem = {
      id: 'cf_1', doi: '10.1/x', groupKey: '10.1/x', paperTitle: 'P',
      flaggedAtMs: 0, sides: [cs], resolution: null, projectId: 'p_default',
    }
    expectTypeOf(cf).toMatchTypeOf<ConflictItem>()
  })

  it('VerifyProgress includes perSite breakdown', () => {
    const vp: VerifyProgress = {
      tabId: 1, total: 0, completed: 0, running: 0, paused: false, pausedSites: [],
      perSite: { elicit: { total: 0, completed: 0, running: 0 }, scispace: { total: 0, completed: 0, running: 0 }, consensus: { total: 0, completed: 0, running: 0 } },
    }
    expectTypeOf(vp).toMatchTypeOf<VerifyProgress>()
  })

  it('Provider matches three providers', () => {
    expectTypeOf<Provider>().toEqualTypeOf<'openai' | 'zai' | 'gemini'>()
  })
})
