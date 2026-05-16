// research-kit/extension/src/shared/auth.ts
import { API_URL, GOOGLE_CLIENT_ID } from './config'
import type { UserOut } from './types'

export type AuthState = { token: string; user: UserOut; expiresAt: number } | null

let _state: AuthState = null
const _listeners = new Set<(s: AuthState) => void>()

export async function googleSignIn(): Promise<AuthState> {
  const nonce = crypto.randomUUID()
  const redirectUri = chrome.identity.getRedirectURL()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  url.searchParams.set('response_type', 'id_token')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('nonce', nonce)

  const redirected = await chrome.identity.launchWebAuthFlow({
    url: url.toString(), interactive: true,
  })
  if (!redirected) throw new Error('OAuth flow returned no URL')
  const fragment = redirected.split('#')[1] || ''
  const params = new URLSearchParams(fragment)
  const idToken = params.get('id_token')
  if (!idToken) throw new Error('No id_token in redirect')

  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ google_id_token: idToken }),
  })
  if (!res.ok) throw new Error(`Login failed: ${res.status}`)
  const { session_token, user, expires_at } = await res.json()
  const next: AuthState = { token: session_token, user, expiresAt: Date.parse(expires_at) }
  await chrome.storage.local.set({ rk_auth: next })
  _setState(next)
  return next
}

export async function loadStoredAuth(): Promise<AuthState> {
  const result = await chrome.storage.local.get('rk_auth')
  const rk_auth = result['rk_auth'] as AuthState | undefined
  if (!rk_auth || rk_auth.expiresAt < Date.now()) {
    await chrome.storage.local.remove('rk_auth')
    _setState(null)
    return null
  }
  _setState(rk_auth)
  return rk_auth
}

export async function signOut(): Promise<void> {
  if (_state) {
    fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: authHeader() }).catch(() => { })
  }
  await chrome.storage.local.remove('rk_auth')
  _setState(null)
}

export function getToken(): string | null { return _state?.token ?? null }
export function getUser(): UserOut | null { return _state?.user ?? null }
export function getAuthState(): AuthState { return _state }
export function authHeader(): Record<string, string> {
  return _state ? { Authorization: `Bearer ${_state.token}` } : {}
}
export function onAuthChange(fn: (s: AuthState) => void) {
  _listeners.add(fn); return () => { _listeners.delete(fn) }
}
function _setState(s: AuthState) { _state = s; _listeners.forEach(l => l(s)) }
