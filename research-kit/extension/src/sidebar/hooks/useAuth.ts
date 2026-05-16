import { useEffect, useState } from 'react'
import { onAuthChange, getAuthState, googleSignIn, signOut, loadStoredAuth } from '../../shared/auth'
import type { AuthState } from '../../shared/auth'

export function useAuth() {
  const [state, setState] = useState<AuthState>(getAuthState())
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    loadStoredAuth().finally(() => setLoading(false))
    return onAuthChange(setState)
  }, [])
  return { state, user: state?.user ?? null, loading, signIn: googleSignIn, signOut }
}
