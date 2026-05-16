// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flattenForVerifyQueue, runExtract } from '../run-extract'

describe('flattenForVerifyQueue', () => {
  it('produces one ClaimItem per (claim × paper) pair', () => {
    const resp = {
      papers: [
        { id: 'p1', title: 'Paper A', doi: '10.1/a', url: null, authors: ['Smith'], year: 2020, anchorText: '[1]' },
        { id: 'p2', title: 'Paper B', doi: null, url: 'http://x', authors: ['Doe'], year: 2021, anchorText: '[2]' },
      ],
      claims: [
        { id: 'c1', text: 'multi-cite claim', paperIds: ['p1', 'p2'] },
        { id: 'c2', text: 'single', paperIds: ['p1'] },
      ],
      extractMeta: { provider: 'gemini', latencyMs: 100, inputChars: 5, papersCount: 2, claimsCount: 2, warnings: [] },
    }
    const items = flattenForVerifyQueue(resp, {
      site: 'elicit', tabId: 7, pageUrl: 'http://elicit.com/notebook/x',
    })
    expect(items).toHaveLength(3)
    expect(items[0].id).toBe('c1::p1')
    expect(items[0].claimGroupId).toBe('c1')
    expect(items[0].text).toBe('multi-cite claim')
    expect(items[0].paperTitle).toBe('Paper A')
    expect(items[0].doi).toBe('10.1/a')
    expect(items[1].id).toBe('c1::p2')
    expect(items[1].claimGroupId).toBe('c1')
    expect(items[1].paperUrl).toBe('http://x')
    expect(items[2].id).toBe('c2::p1')
  })

  it('drops claim×paper combos where paper id is unknown', () => {
    const resp = {
      papers: [{ id: 'p1', title: 'A', doi: null, url: null, authors: [], year: null, anchorText: '' }],
      claims: [{ id: 'c1', text: 't', paperIds: ['pX'] }],
      extractMeta: { provider: 'gemini', latencyMs: 0, inputChars: 0, papersCount: 1, claimsCount: 1, warnings: [] },
    }
    const items = flattenForVerifyQueue(resp, { site: 'elicit', tabId: 0, pageUrl: '' })
    expect(items).toEqual([])
  })

  it('stamps tabId, pageUrl, site, extractedAt on every item', () => {
    const resp = {
      papers: [{ id: 'p1', title: 'A', doi: null, url: null, authors: [], year: null, anchorText: '' }],
      claims: [{ id: 'c1', text: 't', paperIds: ['p1'] }],
      extractMeta: { provider: 'gemini', latencyMs: 0, inputChars: 0, papersCount: 1, claimsCount: 1, warnings: [] },
    }
    const items = flattenForVerifyQueue(resp, { site: 'consensus', tabId: 42, pageUrl: 'http://c' })
    expect(items[0].site).toBe('consensus')
    expect(items[0].tabId).toBe(42)
    expect(items[0].pageUrl).toBe('http://c')
    expect(typeof items[0].extractedAt).toBe('number')
  })
})

describe('runExtract', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Body must serialize to ≥ MIN_MARKDOWN_CHARS (500) so the POST path is exercised.
    const filler = 'Background context on climate change and health outcomes. '.repeat(10)
    document.body.innerHTML = `<p>${filler} Cited paper: <a href="https://doi.org/10.1/x">[1]</a>.</p>`
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs serialized markdown to /v1/extract and returns ClaimItem[]', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        papers: [{ id: 'p1', title: 'X', doi: null, url: null, authors: [], year: null, anchorText: '' }],
        claims: [{ id: 'c1', text: 'y', paperIds: ['p1'] }],
        extractMeta: { provider: 'gemini', latencyMs: 0, inputChars: 0, papersCount: 1, claimsCount: 1, warnings: [] },
      }),
    })
    const items = await runExtract({
      url: 'http://elicit.com/notebook/x', site: 'elicit', tabId: 1,
    })
    expect(items).toHaveLength(1)
    expect(items[0].claimGroupId).toBe('c1')
    const call = mockFetch.mock.calls[0]
    expect(call[0]).toMatch(/\/v1\/extract$/)
    const body = JSON.parse(call[1].body)
    expect(body.site).toBe('elicit')
    expect(body.page_markdown.length).toBeGreaterThan(0)
  })

  it('returns empty array on backend 503', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    const items = await runExtract({ url: 'http://elicit.com/notebook/x', site: 'elicit', tabId: 1 })
    expect(items).toEqual([])
  })

  it('returns empty array when markdown too small', async () => {
    document.body.innerHTML = '<p>hi</p>'
    const items = await runExtract({ url: 'http://elicit.com/notebook/x', site: 'elicit', tabId: 1 })
    expect(items).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('prefers SciSpace local block pairing for doi/title when present', async () => {
    const claim = 'Biến đổi khí hậu tác động đến đa dạng sinh học thông qua nhiệt độ tăng.'
    document.body.innerHTML = `
      <div class="border-neutral-a300 shadow-card rounded-md">
        <div data-element="publication_name">
          <a href="/papers/x">Climate Change Impacts on Global Biodiversity</a>
        </div>
        <a href="https://doi.org/10.9734/ijecc/2026/v16i15230">10.9734/ijecc/2026/v16i15230</a>
        <div id="PAPER-1-insights">
          <span data-markdown-renderer-content="true"><p>${claim}</p></span>
        </div>
      </div>
      <p>${'filler '.repeat(200)}</p>
    `
    const items = await runExtract({
      url: 'https://scispace.com/papers/x', site: 'scispace', tabId: 9,
    })
    expect(items).toHaveLength(1)
    expect(items[0].paperTitle).toContain('Climate Change Impacts')
    expect(items[0].doi).toBe('10.9734/ijecc/2026/v16i15230')
    expect(items[0].paperUrl).toBe('https://doi.org/10.9734/ijecc/2026/v16i15230')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('maps each SciSpace table row claim to the same row paper', async () => {
    document.body.innerHTML = `
      <table><tbody>
        <tr id="PAPER-a">
          <td id="PAPER-a-papers">
            <a href="https://doi.org/10.1234/a">10.1234/a</a>
            <div data-element="publication_name"><a href="/papers/a">1. Paper A</a></div>
          </td>
          <td data-column-key="insights">
            <span data-markdown-renderer-content="true"><p>Claim for paper A with enough words to pass threshold.</p></span>
          </td>
        </tr>
        <tr id="PAPER-b">
          <td id="PAPER-b-papers">
            <a href="https://doi.org/10.1234/b">10.1234/b</a>
            <div data-element="publication_name"><a href="/papers/b">2. Paper B</a></div>
          </td>
          <td data-column-key="insights">
            <span data-markdown-renderer-content="true"><p>Claim for paper B with enough words to pass threshold.</p></span>
          </td>
        </tr>
      </tbody></table>
    `
    const items = await runExtract({
      url: 'https://scispace.com/search?q=x', site: 'scispace', tabId: 3,
    })
    expect(items).toHaveLength(2)
    expect(items[0].doi).toBe('10.1234/a')
    expect(items[0].paperTitle).toBe('Paper A')
    expect(items[0].text).toContain('paper A')
    expect(items[1].doi).toBe('10.1234/b')
    expect(items[1].paperTitle).toBe('Paper B')
    expect(items[1].text).toContain('paper B')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
