import { describe, it, expect } from 'vitest'
import { shouldExtract, detectSite } from './site-detect'

describe('shouldExtract', () => {
  // Elicit
  it('extracts on elicit notebook page', () => {
    expect(shouldExtract('https://elicit.com/notebook/abc-123')).toBe(true)
  })
  it('extracts on elicit sharable page', () => {
    expect(shouldExtract('https://elicit.com/sharable/xyz')).toBe(true)
  })
  it('skips elicit homepage', () => {
    expect(shouldExtract('https://elicit.com/')).toBe(false)
  })
  it('skips elicit notebooks list', () => {
    expect(shouldExtract('https://elicit.com/notebooks')).toBe(false)
  })
  it('skips elicit login', () => {
    expect(shouldExtract('https://elicit.com/login')).toBe(false)
  })

  // SciSpace
  it('extracts on scispace search', () => {
    expect(shouldExtract('https://scispace.com/search?q=foo')).toBe(true)
  })
  it('extracts on scispace literature-review', () => {
    expect(shouldExtract('https://scispace.com/literature-review/abc')).toBe(true)
  })
  it('extracts on scispace papers', () => {
    expect(shouldExtract('https://scispace.com/papers/xyz')).toBe(true)
  })
  it('extracts on scispace chat', () => {
    expect(shouldExtract('https://scispace.com/chat/123')).toBe(true)
  })
  it('skips scispace homepage', () => {
    expect(shouldExtract('https://scispace.com/')).toBe(false)
  })
  it('skips scispace pricing', () => {
    expect(shouldExtract('https://scispace.com/pricing')).toBe(false)
  })

  // Consensus
  it('extracts on consensus results', () => {
    expect(shouldExtract('https://consensus.app/results?q=foo')).toBe(true)
  })
  it('extracts on consensus paper page', () => {
    expect(shouldExtract('https://consensus.app/papers/123')).toBe(true)
  })
  it('extracts on consensus search with slug', () => {
    expect(shouldExtract('https://consensus.app/search/protein-function-prediction/14mr1btJQm2WaWXksUac8Q/')).toBe(true)
  })
  it('skips consensus homepage', () => {
    expect(shouldExtract('https://consensus.app/')).toBe(false)
  })
  it('skips consensus login', () => {
    expect(shouldExtract('https://consensus.app/login')).toBe(false)
  })

  // Elicit — real URLs encountered in testing
  it('extracts on elicit review page', () => {
    expect(shouldExtract('https://elicit.com/review/5a4da4d8-58fb-494c-b07b-7f35afa18978')).toBe(true)
  })

  // Unsupported
  it('returns false for unsupported site', () => {
    expect(shouldExtract('https://google.com/')).toBe(false)
  })
  it('returns false for invalid url', () => {
    expect(shouldExtract('not-a-url')).toBe(false)
  })
})

describe('detectSite (unchanged behavior)', () => {
  it('detects elicit', () => {
    expect(detectSite('https://elicit.com/notebook/x')).toBe('elicit')
  })
})
