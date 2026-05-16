import { useState, useEffect } from 'react'
import { detectSite, shouldExtract } from '../shared/site-detect'
import { API_URL as BACKEND_URL } from '../shared/config'
import type { SiteId } from '../shared/verify-types'
import type { ExtractResponse } from '../extract/types'
import { serializeDOMToMarkdown } from '../adapters/dom-serializer'

interface TabInfo {
  tabId: number
  title: string
  url: string
  site?: SiteId
  extract?: ExtractResponse
  isLoading?: boolean
  error?: string
}

export function usePageModels() {
  const [tabs, setTabs] = useState<Map<number, TabInfo>>(new Map())
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    chrome.tabs.query({}, (allTabs) => {
      const supported = new Map<number, TabInfo>()
      for (const tab of allTabs) {
        if (tab.id && tab.url) {
          const site = detectSite(tab.url)
          if (site && shouldExtract(tab.url)) {
            supported.set(tab.id, { tabId: tab.id, title: tab.title || 'Untitled', url: tab.url, site })
          }
        }
      }
      setTabs(supported)
    })
  }, [])

  const fetchExtract = async (tabId: number) => {
    const info = tabs.get(tabId)
    if (!info || !info.site) return
    setTabs((prev) => {
      const next = new Map(prev)
      const t = next.get(tabId)
      if (t) next.set(tabId, { ...t, isLoading: true })
      return next
    })
    try {
      const md = await chrome.tabs.sendMessage(tabId, { type: 'content:serialize' }).catch(() => null)
      const markdown = typeof md === 'string' ? md : serializeDOMToMarkdown()
      const resp = await fetch(`${BACKEND_URL}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: info.url, site: info.site, page_markdown: markdown }),
      })
      if (!resp.ok) throw new Error(`backend ${resp.status}`)
      const data = (await resp.json()) as ExtractResponse
      setTabs((prev) => {
        const next = new Map(prev)
        const t = next.get(tabId)
        if (t) next.set(tabId, { ...t, extract: data, isLoading: false, error: undefined })
        return next
      })
    } catch (e) {
      setTabs((prev) => {
        const next = new Map(prev)
        const t = next.get(tabId)
        if (t) next.set(tabId, { ...t, error: e instanceof Error ? e.message : String(e), isLoading: false })
        return next
      })
    }
  }

  const toggleTabSelection = (tabId: number) => {
    let adding = false
    setSelectedTabIds((prev) => {
      const next = new Set(prev)
      if (next.has(tabId)) next.delete(tabId)
      else { next.add(tabId); adding = true }
      return next
    })
    // fetchExtract is a side-effect — call outside the setState updater so Strict Mode
    // double-invocation of the updater doesn't double-fire the network request.
    if (adding) fetchExtract(tabId)
  }

  const getSelectedExtracts = (): ExtractResponse[] =>
    Array.from(selectedTabIds)
      .map((id) => tabs.get(id)?.extract)
      .filter((e): e is ExtractResponse => !!e)

  return {
    tabs: Array.from(tabs.values()),
    selectedTabIds,
    toggleTabSelection,
    getSelectedExtracts,
  }
}
