import '@testing-library/jest-dom/vitest'
import { vi, beforeEach } from 'vitest'

const storageData: Record<string, any> = {}
const listeners: Array<(changes: any, area: string) => void> = []

const chromeMock = {
  storage: {
    local: {
      get: vi.fn((keyOrKeys: string | string[] | null) => {
        if (keyOrKeys === null) return Promise.resolve({ ...storageData })
        if (typeof keyOrKeys === 'string') return Promise.resolve({ [keyOrKeys]: storageData[keyOrKeys] })
        const out: Record<string, any> = {}
        for (const k of keyOrKeys) out[k] = storageData[k]
        return Promise.resolve(out)
      }),
      set: vi.fn((items: Record<string, any>) => {
        const changes: Record<string, any> = {}
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: storageData[k], newValue: v }
          storageData[k] = v
        }
        for (const l of listeners) l(changes, 'local')
        return Promise.resolve()
      }),
      remove: vi.fn((keys: string | string[]) => {
        const keysArray = typeof keys === 'string' ? [keys] : keys
        for (const k of keysArray) delete storageData[k]
        return Promise.resolve()
      }),
      clear: vi.fn(() => {
        for (const k of Object.keys(storageData)) delete storageData[k]
        return Promise.resolve()
      }),
    },
    onChanged: {
      addListener: vi.fn((cb: any) => listeners.push(cb)),
      removeListener: vi.fn((cb: any) => {
        const i = listeners.indexOf(cb)
        if (i >= 0) listeners.splice(i, 1)
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn(() => Promise.resolve()),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([])),
    sendMessage: vi.fn(() => Promise.resolve()),
    onActivated: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
  },
  sidePanel: {
    setPanelBehavior: vi.fn(() => Promise.resolve()),
    open: vi.fn(() => Promise.resolve()),
  },
} as any

;(globalThis as any).chrome = chromeMock

beforeEach(() => {
  for (const k of Object.keys(storageData)) delete storageData[k]
  listeners.length = 0
  vi.clearAllMocks()
})

export { storageData }
