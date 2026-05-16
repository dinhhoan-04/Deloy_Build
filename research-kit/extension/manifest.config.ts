import baseManifest from './manifest.json'

type BuildEnv = Record<string, string | undefined>

const DEFAULT_API_URL = 'http://localhost:8000/v1'

function normalizeApiUrl(raw: string | undefined): string {
  const value = (raw || DEFAULT_API_URL).trim()
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export function buildManifest(env: BuildEnv) {
  const apiOrigin = new URL(normalizeApiUrl(env.VITE_API_URL)).origin
  const hostPermissions = Array.from(
    new Set([...(baseManifest.host_permissions ?? []), `${apiOrigin}/*`]),
  )

  return {
    ...baseManifest,
    host_permissions: hostPermissions,
  }
}
