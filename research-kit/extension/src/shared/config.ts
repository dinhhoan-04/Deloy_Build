const DEFAULT_API_URL = 'http://localhost:8000/v1'

function normalizeApiUrl(raw: string | undefined): string {
  const value = (raw || DEFAULT_API_URL).trim()
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function toWebSocketOrigin(origin: string): string {
  if (origin.startsWith('https://')) return `wss://${origin.slice('https://'.length)}`
  if (origin.startsWith('http://')) return `ws://${origin.slice('http://'.length)}`
  return origin
}

export const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL)
export const API_ORIGIN = new URL(API_URL).origin
export const OPENCLAW_WS_URL = import.meta.env.VITE_OPENCLAW_WS_URL ?? `${toWebSocketOrigin(API_ORIGIN)}/ws`
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
