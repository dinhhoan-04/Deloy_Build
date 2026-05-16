import { describe, it, expect } from 'vitest'
import * as M from './messages'

describe('messages', () => {
  it('Phase 1 constants are preserved', () => {
    expect(M.MSG_VERIFY_RESULT).toBe('verify:result')
    expect(M.MSG_VERIFY_PROGRESS).toBe('verify:progress')
  })

  it('Phase 2 sidebar←background constants exist', () => {
    expect(M.MSG_CLAIM_RESULT).toBe('CLAIM_RESULT')
    expect(M.MSG_CONFLICT_DETECTED).toBe('CONFLICT_DETECTED')
    expect(M.MSG_VERIFY_DONE).toBe('VERIFY_DONE')
    expect(M.MSG_TAB_CHANGED).toBe('TAB_CHANGED')
  })

  it('Phase 2 sidebar→background constants exist', () => {
    expect(M.MSG_SET_SITE_ACTIVE).toBe('SET_SITE_ACTIVE')
    expect(M.MSG_SET_SITE_PAUSED).toBe('SET_SITE_PAUSED')
    expect(M.MSG_SET_GLOBAL_PAUSED).toBe('SET_GLOBAL_PAUSED')
    expect(M.MSG_SET_PROVIDER).toBe('SET_PROVIDER')
    expect(M.MSG_OPEN_SIDEBAR).toBe('open-sidebar')
    expect(M.MSG_REQUEST_RE_EXTRACT).toBe('REQUEST_RE_EXTRACT')
  })

  it('Phase 2 content←background constant exists', () => {
    expect(M.MSG_ACTIVE_SITES_CHANGED).toBe('ACTIVE_SITES_CHANGED')
  })
})
