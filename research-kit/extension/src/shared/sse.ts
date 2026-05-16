export interface SSEFrame {
  event?: string
  id?: string
  data: string
}

export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncIterable<SSEFrame> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let event: string | undefined
  let id: string | undefined
  let dataLines: string[] = []

  function flush(): SSEFrame | null {
    if (dataLines.length === 0) {
      event = undefined; id = undefined
      return null
    }
    const frame: SSEFrame = { event, id, data: dataLines.join('\n') }
    event = undefined; id = undefined; dataLines = []
    return frame
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (line === '') {
          const f = flush()
          if (f) yield f
          continue
        }
        if (line.startsWith(':')) continue  // comment
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const valueRaw = colon < 0 ? '' : line.slice(colon + 1)
        const v = valueRaw.startsWith(' ') ? valueRaw.slice(1) : valueRaw
        if (field === 'event') event = v
        else if (field === 'id') id = v
        else if (field === 'data') dataLines.push(v)
      }
      if (done) {
        const f = flush()
        if (f) yield f
        return
      }
    }
  } finally {
    reader.releaseLock()
  }
}
