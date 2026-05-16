// DOM → markdown serializer for LLM-based extract.
//
// TWO-PASS STRATEGY:
//   Pass 1 — structured sections first (tables, ordered/unordered lists).
//             These contain the actual paper metadata (title, DOI, authors, year).
//   Pass 2 — prose paragraphs and remaining block elements (up to budget).
//
// WHY: On Elicit/SciSpace/Consensus, papers appear in table-like grids or
// numbered lists. Prose paragraphs are AI-generated summaries that lack real
// citation data and cause the LLM to hallucinate DOIs.
//
// Additional notes:
// - Preserve ALL anchor hrefs (paper URLs live here).
// - Keep <sup> text for citation markers ([1], [1,2]).
// - Surface data-doi / data-citation-id attributes.
// - Tables serialized as markdown pipe rows (|col1|col2|…) to preserve column association.

const SKIP_TAGS = new Set([
  'script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'svg', 'iframe',
])
const HEADING_TAGS: Record<string, string> = {
  h1: '# ', h2: '## ', h3: '### ', h4: '#### ', h5: '##### ', h6: '###### ',
}
const MAX_BYTES = 60_000

// ── Helpers ──────────────────────────────────────────────────────────────────

function cellText(el: Element): string {
  // Extract readable text from a table cell, including href targets.
  const parts: string[] = []
  function gather(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent?.replace(/\s+/g, ' ').trim()
      if (t) parts.push(t)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element
      const tag = child.tagName.toLowerCase()
      if (SKIP_TAGS.has(tag)) return
      const href = tag === 'a' ? (child as HTMLAnchorElement).href : null
      const dataDoi = child.getAttribute('data-doi')
      if (dataDoi) parts.push(`[doi:${dataDoi}]`)
      for (const c of child.childNodes) gather(c)
      if (href && !href.startsWith('javascript')) parts.push(`(${href})`)
    }
  }
  gather(el)
  return parts.join(' ').replace(/\s{2,}/g, ' ').trim()
}

function serializeTable(table: Element): string {
  const rows: string[][] = []
  for (const tr of table.querySelectorAll('tr')) {
    const cells = Array.from(tr.querySelectorAll('td, th')).map(cellText)
    if (cells.some(c => c.length > 0)) rows.push(cells)
  }
  if (rows.length === 0) return ''

  const lines: string[] = []
  for (let i = 0; i < rows.length; i++) {
    lines.push('| ' + rows[i].join(' | ') + ' |')
    if (i === 0) {
      // separator after first row (treat as header)
      lines.push('| ' + rows[i].map(() => '---').join(' | ') + ' |')
    }
  }
  return '\n' + lines.join('\n') + '\n'
}

function serializeList(list: Element, ordered: boolean): string {
  const parts: string[] = []
  let idx = 1
  for (const li of list.querySelectorAll(':scope > li')) {
    const prefix = ordered ? `${idx}. ` : '- '
    idx++
    // Walk li children to preserve links and data attributes
    const lineParts: string[] = []
    function gatherLi(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent?.replace(/\s+/g, ' ').trim()
        if (t) lineParts.push(t)
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element
        const tag = el.tagName.toLowerCase()
        if (SKIP_TAGS.has(tag)) return
        const dataDoi = el.getAttribute('data-doi')
        if (dataDoi) lineParts.push(`[doi:${dataDoi}]`)
        const dataCid = el.getAttribute('data-citation-id')
        if (dataCid) lineParts.push(`[cite:${dataCid}]`)
        if (tag === 'a') {
          const href = (el as HTMLAnchorElement).href
          const text = el.textContent?.trim()
          if (text && href) lineParts.push(`[${text}](${href})`)
          else if (text) lineParts.push(text)
        } else if (tag === 'sup') {
          const t = el.textContent?.trim()
          if (t) lineParts.push(t)
        } else {
          for (const c of el.childNodes) gatherLi(c)
        }
      }
    }
    for (const c of li.childNodes) gatherLi(c)
    const line = lineParts.join(' ').replace(/\s{2,}/g, ' ').trim()
    if (line) parts.push(prefix + line)
  }
  return parts.length ? '\n' + parts.join('\n') + '\n' : ''
}

// ── Main serializer ───────────────────────────────────────────────────────────

export function serializeDOMToMarkdown(root: Element = document.body): string {
  const parts: string[] = []
  let bytes = 0
  const visited = new Set<Element>()

  function push(s: string) {
    parts.push(s)
    bytes += s.length
  }

  // ── Pass 1: structured sections (tables, lists) ───────────────────────────
  const structured = root.querySelectorAll('table, ol, ul')
  for (const el of structured) {
    if (bytes >= MAX_BYTES) break
    // Skip nested structures (already captured by parent)
    if ([...visited].some(v => v.contains(el))) continue
    visited.add(el)

    const tag = el.tagName.toLowerCase()
    let chunk = ''
    if (tag === 'table') {
      chunk = serializeTable(el)
    } else {
      chunk = serializeList(el, tag === 'ol')
    }
    if (chunk.length > 0) {
      const remaining = MAX_BYTES - bytes
      push(chunk.length > remaining ? chunk.substring(0, remaining) : chunk)
    }
  }

  // ── Pass 2: prose and remaining blocks (skip already-visited structured roots) ──
  function walkProse(node: Node) {
    if (bytes >= MAX_BYTES) return
    if (node.nodeType === Node.COMMENT_NODE) return

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      const tag = el.tagName.toLowerCase()

      if (SKIP_TAGS.has(tag)) return
      if (el.getAttribute('aria-hidden') === 'true') return
      if (el.getAttribute('role') === 'presentation') return

      // Skip structured sections already serialized in pass 1
      if (visited.has(el)) return

      // Data attributes
      const dataDoi = el.getAttribute('data-doi')
      if (dataDoi) push(` [data-doi:${dataDoi}] `)
      const dataCid = el.getAttribute('data-citation-id')
      if (dataCid) push(` [cite:${dataCid}] `)

      if (tag in HEADING_TAGS) {
        const text = el.textContent?.trim()
        if (text) push(`\n${HEADING_TAGS[tag]}${text}\n`)
        return
      }

      if (tag === 'a') {
        const href = (el as HTMLAnchorElement).href
        const text = el.textContent?.trim()
        if (!text) return
        if (href) push(`[${text}](${href})`)
        else push(text)
        return
      }

      if (tag === 'sup') {
        const text = el.textContent?.trim()
        if (text) push(text)
        return
      }

      // Block elements
      if (['p', 'div', 'section', 'article', 'blockquote'].includes(tag)) {
        push('\n')
        for (const child of el.childNodes) walkProse(child)
        push('\n')
        return
      }

      for (const child of el.childNodes) walkProse(child)
      return
    }

    if (node.nodeType === Node.TEXT_NODE) {
      if (bytes >= MAX_BYTES) return
      const text = node.textContent?.replace(/\s+/g, ' ').trim()
      if (text) {
        const remaining = MAX_BYTES - bytes
        push(text.length > remaining ? text.substring(0, remaining) : text + ' ')
      }
    }
  }

  push('\n\n--- PROSE SECTIONS ---\n')
  walkProse(root)

  return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
}
