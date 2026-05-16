// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { serializeDOMToMarkdown } from '../dom-serializer'

function setBody(html: string) {
  document.body.innerHTML = html
}

describe('serializeDOMToMarkdown', () => {
  it('preserves DOI link with href', () => {
    setBody('<p>Cited <a href="https://doi.org/10.1/abc">[1]</a></p>')
    const md = serializeDOMToMarkdown()
    expect(md).toContain('[[1]](https://doi.org/10.1/abc)')
  })

  it('preserves non-DOI link href too', () => {
    setBody('<p>See <a href="https://example.com/paper">paper</a></p>')
    const md = serializeDOMToMarkdown()
    expect(md).toContain('[paper](https://example.com/paper)')
  })

  it('preserves sup citation markers', () => {
    setBody('<p>Some claim<sup>[1,2]</sup>.</p>')
    const md = serializeDOMToMarkdown()
    expect(md).toContain('[1,2]')
  })

  it('preserves elements with data-citation-id', () => {
    setBody('<p>x <span data-citation-id="p1">smith2020</span> y</p>')
    const md = serializeDOMToMarkdown()
    expect(md).toContain('smith2020')
  })

  it('preserves elements with data-doi attribute as link', () => {
    setBody('<p>Ref <span data-doi="10.1/xyz">[1]</span></p>')
    const md = serializeDOMToMarkdown()
    expect(md).toContain('10.1/xyz')
  })

  it('still skips script and style tags', () => {
    setBody('<p>visible</p><script>alert(1)</script><style>p{}</style>')
    const md = serializeDOMToMarkdown()
    expect(md).toContain('visible')
    expect(md).not.toContain('alert')
    expect(md).not.toContain('p{}')
  })

  it('respects 60K byte budget', () => {
    const huge = '<p>' + 'x '.repeat(40000) + '</p>'
    setBody(huge)
    const md = serializeDOMToMarkdown()
    expect(md.length).toBeLessThanOrEqual(60_000 + 1000)  // some slack from trailing parts
  })
})
