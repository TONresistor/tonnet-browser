/**
 * Hook for IPC events from main process.
 * Navigation state, loading, title, favicon, context menu, history reset.
 */

import { useEffect } from 'react'
import { useBrowserStore } from '@/stores/browser'
import { useTabsStore, type Tab } from '@/stores/tabs'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { browserClient } from '@/features/browser/client'
import { resolveInternalRoute } from '@/app-shell/internal-routes'
import { tabNavigationFlags } from '@/features/browser/tab-history'

export function useIpcEvents(updateTab: ReturnType<typeof useTabsStore.getState>['updateTab']): void {
  useEffect(() => {
    const { setNavigation, setLoading, setTitle } = useBrowserStore.getState()

    const pageTab = (tabId: string) => {
      const tab = useTabsStore.getState().tabs.find((candidate) => candidate.id === tabId)
      if (!tab) return undefined
      const route = resolveInternalRoute(tab.url)
      return !route || route.kind === 'storage-file' ? tab : undefined
    }
    const isActive = (tabId: string) => useTabsStore.getState().activeTabId === tabId

    const unsubNavigate = browserClient.on(IPC_CHANNELS.PAGE_NAVIGATE, (data) => {
      const page = pageTab(data.tabId)
      if (!page) return
      const updates: Partial<Tab> = {
        url: data.url,
        nativeCanGoBack: data.canGoBack,
        nativeCanGoForward: data.canGoForward,
      }
      if (data.url !== page.url && data.url.startsWith('file:///') && data.url.includes('/storage/')) {
        updates.history = [...page.history.slice(0, page.historyIndex + 1), data.url]
        updates.historyIndex = updates.history.length - 1
        updates.legacyStorageHistory = true
      }
      const flags = tabNavigationFlags({ ...page, ...updates })
      updateTab(data.tabId, { ...updates, ...flags })
      if (isActive(data.tabId)) setNavigation(data.url, flags.canGoBack, flags.canGoForward)
    })

    const unsubLoading = browserClient.on(IPC_CHANNELS.PAGE_LOADING, (loading, tabId) => {
      if (!pageTab(tabId)) return
      if (isActive(tabId)) setLoading(loading)
      if (tabId) {
        updateTab(tabId, { isLoading: loading })
      }
    })

    const unsubTitle = browserClient.on(IPC_CHANNELS.PAGE_TITLE, (title, tabId) => {
      if (!pageTab(tabId)) return
      if (isActive(tabId)) setTitle(title)
      if (tabId) {
        updateTab(tabId, { title })
      }
    })

    const unsubFavicon = browserClient.on(IPC_CHANNELS.PAGE_FAVICON, (favicon, tabId) => {
      if (pageTab(tabId)) {
        updateTab(tabId, { favicon })
      }
    })

    // Handle "Open Link in New Tab" from context menu
    const unsubOpenLink = browserClient.on(IPC_CHANNELS.CONTEXT_OPEN_LINK, (url) => {
      useTabsStore.getState().addTab(url)
    })

    // Handle first-party isolation view recreation: reset renderer history so
    // back/forward buttons don't point to URLs of a destroyed WebContentsView
    const unsubHistoryReset = browserClient.on(IPC_CHANNELS.TAB_HISTORY_RESET, (tabId, url) => {
      const state = useTabsStore.getState()
      const tab = state.tabs.find((candidate) => candidate.id === tabId)
      if (tab) {
        state.updateTab(tabId, {
          url,
          history: [url],
          historyIndex: 0,
          canGoBack: false,
          canGoForward: false,
          legacyStorageHistory: false,
          nativeCanGoBack: false,
          nativeCanGoForward: false,
        })
        if (state.activeTabId === tabId) setNavigation(url, false, false)
      }
    })

    return () => {
      unsubNavigate()
      unsubLoading()
      unsubTitle()
      unsubFavicon()
      unsubOpenLink()
      unsubHistoryReset()
    }
  }, [updateTab])
}
