/**
 * Hook for IPC events from main process.
 * Navigation state, loading, title, favicon, context menu, history reset.
 */

import { useEffect } from 'react'
import { useBrowserStore } from '@/stores/browser'
import { useTabsStore } from '@/stores/tabs'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { browserClient } from '@/features/browser/client'
import { resolveInternalRoute } from '@/app-shell/internal-routes'

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
      if (!pageTab(data.tabId)) return
      if (isActive(data.tabId)) setNavigation(data.url, data.canGoBack, data.canGoForward)
      // Update tab state + push to history for bag file navigation
      if (data.tabId) {
        const tab = useTabsStore.getState().tabs.find((t) => t.id === data.tabId)
        if (tab && data.url !== tab.url && data.url.startsWith('file:///') && data.url.includes('/storage/')) {
          const newHistory = tab.history.slice(0, tab.historyIndex + 1)
          newHistory.push(data.url)
          updateTab(data.tabId, {
            url: data.url,
            canGoBack: true,
            canGoForward: false,
            history: newHistory,
            historyIndex: newHistory.length - 1,
          })
        } else {
          updateTab(data.tabId, { url: data.url, canGoBack: data.canGoBack, canGoForward: data.canGoForward })
        }
      }
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
