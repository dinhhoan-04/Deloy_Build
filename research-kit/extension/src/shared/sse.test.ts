import { describe, it, expect } from 'vitest'
import { parseSSE } from './sse'

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]))
      else controller.close()
    },
  })
}

describe('parseSSE', () => {
  it('parses single complete frame', async () => {
    const s = makeStream(['event: run_event\nid: 7\ndata: {"a":1}\n\n'])
    const out: any[] = []
    for await (const f of parseSSE(s)) out.push(f)
    expect(out).toEqual([{ event: 'run_event', id: '7', data: '{"a":1}' }])
  })

  it('handles split frames across chunks', async () => {
    const s = makeStream(['event: x\nid: 1\nda', 'ta: hello\n\nevent: y\nid: 2\ndata: world\n\n'])
    const out: any[] = []
    for await (const f of parseSSE(s)) out.push(f)
    expect(out.map(f => f.data)).toEqual(['hello', 'world'])
  })

  it('handles multi-line data', async () => {
    const s = makeStream(['data: line1\ndata: line2\n\n'])
    const out: any[] = []
    for await (const f of parseSSE(s)) out.push(f)
    expect(out[0].data).toBe('line1\nline2')
  })

  it('skips comments', async () => {
    const s = makeStream([': keepalive\nid: 5\ndata: ok\n\n'])
    const out: any[] = []
    for await (const f of parseSSE(s)) out.push(f)
    expect(out[0]).toEqual({ event: undefined, id: '5', data: 'ok' })
  })
})
