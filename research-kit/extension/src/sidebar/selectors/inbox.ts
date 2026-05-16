import type { InboxItem } from '../../shared/verify-types'
import { normalizeTitle } from '../state/ids'

export interface PaperGroup {
  groupKey: string
  doi: string | null
  paperTitle: string
  claims: InboxItem[]
  hasUnknownDoi: boolean
  hasAbstractOnly: boolean
}

export function groupInboxByPaper(items: InboxItem[]): PaperGroup[] {
  const map = new Map<string, PaperGroup>()
  for (const item of items) {
    const key = item.doi ?? (normalizeTitle(item.paperTitle) || `untitled_${item.id}`)
    let g = map.get(key)
    if (!g) {
      g = {
        groupKey: key,
        doi: item.doi,
        paperTitle: item.paperTitle ?? 'Untitled source',
        claims: [],
        hasUnknownDoi: !item.doi,
        hasAbstractOnly: false,
      }
      map.set(key, g)
    }
    g.claims.push(item)
    if (item.status === 'partial') g.hasAbstractOnly = true
  }

  const groups = Array.from(map.values())
  for (const g of groups) g.claims.sort((a, b) => b.savedAtMs - a.savedAtMs)
  groups.sort((a, b) => {
    const aMax = Math.max(...a.claims.map(c => c.savedAtMs))
    const bMax = Math.max(...b.claims.map(c => c.savedAtMs))
    return bMax - aMax
  })
  return groups
}
