import { useEffect } from 'react'
import { subscribeStorage } from '../state/storage'
import { useStore } from '../state/useStore'

/**
 * Re-hydrates the Zustand store whenever any chrome.storage.local key changes.
 * Mount once at App root.
 */
export function useChromeStorage(): void {
  const hydrate = useStore(s => s.hydrate)
  useEffect(() => {
    hydrate()
    const unsub = subscribeStorage(() => { hydrate() })
    return unsub
  }, [hydrate])
}
