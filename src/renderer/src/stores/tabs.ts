/**
 * Tabs store.
 * Multi-tab state management.
 */

import { create } from 'zustand'
import { useBrowserStore } from './browser'
import i18n from '@/i18n'
import type { Tab as BaseTab } from '@shared/types'
import { shortId } from '@/lib/id'
import { createLogger } from '@/logger'
import { settingsClient } from '@/features/settings/client'
import { browserClient } from '@/features/browser/client'
import { getInternalPageFavicon, getInternalPageTitle, isInternalUrl } from '@/app-shell/internal-routes'

export { getInternalPageFavicon, getInternalPageTitle } from '@/app-shell/internal-routes'

const log = createLogger('tabs')
const navigationRequestByTab = new Map<string, number>()

export interface Tab extends BaseTab {
  history: string[]
  historyIndex: number
}

// Limit history size to prevent memory growth
const MAX_HISTORY = 10

interface TabsState {
  tabs: Tab[]
  activeTabId: string | null
  closedTabs: Array<{ url: string; title: string }> // Last 10 closed tabs for Ctrl+Shift+T
  addTab: (url?: string) => Promise<void>
  closeTab: (id: string) => Promise<void>
  setActiveTab: (id: string) => Promise<void>
  updateTab: (id: string, updates: Partial<Tab>) => void
  navigateActiveTab: (url: string) => Promise<void>
  openOrSwitchToTab: (url: string) => Promise<void>
  ensureDefaultTab: () => Promise<void>
  goBack: () => Promise<void>
  goForward: () => Promise<void>
  duplicateTab: (id: string) => Promise<void>
  closeOtherTabs: (id: string) => Promise<void>
  reopenLastClosedTab: () => Promise<void>
  nextTab: () => Promise<void>
  previousTab: () => Promise<void>
  goToTabByIndex: (index: number) => Promise<void>
  reorderTabs: (tabId: string, newIndex: number) => void
}

// Get homepage from main process settings
async function getHomepage(): Promise<string> {
  try {
    const general = await settingsClient.get('general')
    return general?.homepage || 'ton://start'
  } catch {
    return 'ton://start'
  }
}

/**
 * Applies a navigation result to a tab: writes the tab state, syncs the browser
 * store (nav buttons + optional title), then tells main to navigate. Callers pass
 * the already-computed url/canGoBack/canGoForward/title in `updates`.
 */
async function applyTabNavigation(
  set: (updater: (state: TabsState) => Partial<TabsState>) => void,
  get: () => TabsState,
  tabId: string,
  updates: Partial<Tab>,
  errorLabel: string
): Promise<void> {
  const previousTab = get().tabs.find((tab) => tab.id === tabId)
  if (!previousTab) return
  const request = (navigationRequestByTab.get(tabId) ?? 0) + 1
  navigationRequestByTab.set(tabId, request)
  const rollback = Object.fromEntries(
    (Object.keys(updates) as Array<keyof Tab>).map((key) => [key, previousTab[key]])
  ) as Partial<Tab>
  set((state) => ({
    tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
  }))
  const browser = useBrowserStore.getState()
  if (updates.url !== undefined) {
    browser.setNavigation(updates.url, updates.canGoBack ?? false, updates.canGoForward ?? false)
    if (updates.title) browser.setTitle(updates.title)
    let success = false
    try {
      success = (await browserClient.navigate(updates.url, tabId)).success
    } catch (error) {
      log.error(errorLabel, error)
    }
    if (navigationRequestByTab.get(tabId) !== request) return
    navigationRequestByTab.delete(tabId)
    if (success) return
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...rollback } : tab)),
    }))
    const restored = get().tabs.find((tab) => tab.id === tabId)
    if (restored && get().activeTabId === tabId) {
      browser.setNavigation(restored.url, restored.canGoBack, restored.canGoForward)
      browser.setTitle(restored.title)
    }
  }
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  closedTabs: [],

  addTab: async (url?: string) => {
    // Use homepage if no URL provided
    const targetUrl = url ?? (await getHomepage())
    const id = shortId()
    const title = getInternalPageTitle(targetUrl) || i18n.t('tabs.newTab', { ns: 'browser' })
    const newTab: Tab = {
      id,
      url: targetUrl,
      title,
      favicon: getInternalPageFavicon(targetUrl) ?? undefined,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      history: [targetUrl],
      historyIndex: 0,
    }

    try {
      // Create tab in main process
      await browserClient.createTab(id, targetUrl)

      set((state) => ({
        tabs: [...state.tabs, newTab],
        activeTabId: id,
      }))

      // Sync settings store with new tab's state
      useBrowserStore.getState().setNavigation(targetUrl, false, false)
      useBrowserStore.getState().setTitle(title)

      // Always call navigate - it handles hiding views for internal pages
      // and loading URLs for external pages
      await browserClient.navigate(targetUrl, id)
    } catch (error) {
      log.error('Failed to create tab:', error)
    }
  },

  closeTab: async (id: string) => {
    navigationRequestByTab.delete(id)
    const { tabs, activeTabId, closedTabs } = get()
    const index = tabs.findIndex((t) => t.id === id)
    const closedTab = tabs.find((t) => t.id === id)
    const newTabs = tabs.filter((t) => t.id !== id)

    // Save closed tab for Ctrl+Shift+T (skip ton://start and ton://loading)
    if (closedTab && !closedTab.url.startsWith('ton://start') && !closedTab.url.startsWith('ton://loading')) {
      const newClosedTabs = [{ url: closedTab.url, title: closedTab.title }, ...closedTabs].slice(0, 10) // Keep last 10
      set({ closedTabs: newClosedTabs })
    }

    try {
      // Close tab in main process
      await browserClient.closeTab(id)

      let newActiveId = activeTabId
      if (activeTabId === id && newTabs.length > 0) {
        // Select adjacent tab
        newActiveId = newTabs[Math.min(index, newTabs.length - 1)]?.id ?? null
        if (newActiveId) {
          await browserClient.switchTab(newActiveId)
          // Sync settings store with new active tab
          const newActiveTab = newTabs.find((t) => t.id === newActiveId)
          if (newActiveTab) {
            useBrowserStore
              .getState()
              .setNavigation(newActiveTab.url, newActiveTab.canGoBack, newActiveTab.canGoForward)
            // Hide views for internal pages
            if (isInternalUrl(newActiveTab.url)) {
              void browserClient.navigate(newActiveTab.url, newActiveId)
            }
          }
        }
      } else if (newTabs.length === 0) {
        // Last tab closed - create a new default tab with homepage
        set({ tabs: newTabs, activeTabId: null })
        await get().addTab() // Uses homepage from settings
        return
      }

      set({ tabs: newTabs, activeTabId: newActiveId })
    } catch (error) {
      log.error('Failed to close tab:', error)
    }
  },

  setActiveTab: async (id: string) => {
    const { tabs, activeTabId } = get()
    if (id === activeTabId) return

    const tab = tabs.find((t) => t.id === id)
    if (!tab) return

    try {
      // Switch tab in main process (shows/hides WebContentsViews)
      await browserClient.switchTab(id)
      set({ activeTabId: id })

      // Sync settings store with this tab's state
      useBrowserStore.getState().setNavigation(tab.url, tab.canGoBack, tab.canGoForward)
      useBrowserStore.getState().setTitle(tab.title)

      // For internal pages, hide WebContentsViews so React content is visible
      if (isInternalUrl(tab.url)) {
        await browserClient.hideView()
      }
    } catch (error) {
      log.error('Failed to switch tab:', error)
    }
  },

  updateTab: (id: string, updates: Partial<Tab>) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    }))
  },

  navigateActiveTab: async (url: string) => {
    const { activeTabId, ensureDefaultTab } = get()

    // Ensure we have a tab to navigate in
    if (!activeTabId) {
      await ensureDefaultTab()
    }

    const currentActiveTabId = get().activeTabId
    if (!currentActiveTabId) return

    const activeTab = get().tabs.find((t) => t.id === currentActiveTabId)
    if (!activeTab) return

    // Don't navigate if already on this URL
    if (activeTab.url === url) return

    // Determine title for internal pages
    const internalTitle = getInternalPageTitle(url)

    // Update history: truncate forward history and add new URL
    let newHistory = [...activeTab.history.slice(0, activeTab.historyIndex + 1), url]
    let newHistoryIndex = newHistory.length - 1

    // Trim oldest entries if over limit
    if (newHistory.length > MAX_HISTORY) {
      const overflow = newHistory.length - MAX_HISTORY
      newHistory = newHistory.slice(overflow)
      newHistoryIndex = newHistoryIndex - overflow
    }

    const updates: Partial<Tab> = {
      url,
      history: newHistory,
      historyIndex: newHistoryIndex,
      canGoBack: newHistoryIndex > 0,
      canGoForward: false,
    }
    if (internalTitle) {
      updates.title = internalTitle
    }
    if (isInternalUrl(url)) {
      updates.favicon = getInternalPageFavicon(url) ?? undefined
    }

    await applyTabNavigation(set, get, currentActiveTabId, updates, 'Failed to navigate:')
  },

  openOrSwitchToTab: async (url: string) => {
    const { tabs, activeTabId, setActiveTab, addTab, navigateActiveTab } = get()

    // Check if a tab with this URL already exists
    const existingTab = tabs.find((t) => t.url === url)

    if (existingTab) {
      // Switch to existing tab
      await setActiveTab(existingTab.id)
    } else {
      // Check if current tab is a "New Tab" (ton://start)
      const activeTab = tabs.find((t) => t.id === activeTabId)
      if (activeTab && activeTab.url === 'ton://start') {
        // Navigate in current tab instead of opening a new one
        await navigateActiveTab(url)
      } else {
        // Open new tab with this URL
        await addTab(url)
      }
    }
  },

  ensureDefaultTab: async () => {
    const { tabs, addTab } = get()
    if (tabs.length === 0) {
      await addTab() // Uses homepage from settings
    }
  },

  goBack: async () => {
    const { activeTabId, tabs } = get()
    if (!activeTabId) return

    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (!activeTab || activeTab.historyIndex <= 0) return

    const newIndex = activeTab.historyIndex - 1
    const newUrl = activeTab.history[newIndex]
    const internalTitle = getInternalPageTitle(newUrl)

    const updates: Partial<Tab> = {
      url: newUrl,
      historyIndex: newIndex,
      canGoBack: newIndex > 0,
      canGoForward: true,
    }
    if (internalTitle) {
      updates.title = internalTitle
    }
    if (isInternalUrl(newUrl)) {
      updates.favicon = getInternalPageFavicon(newUrl) ?? undefined
    }

    await applyTabNavigation(set, get, activeTabId, updates, 'Failed to go back:')
  },

  goForward: async () => {
    const { activeTabId, tabs } = get()
    if (!activeTabId) return

    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (!activeTab || activeTab.historyIndex >= activeTab.history.length - 1) return

    const newIndex = activeTab.historyIndex + 1
    const newUrl = activeTab.history[newIndex]
    const internalTitle = getInternalPageTitle(newUrl)

    const updates: Partial<Tab> = {
      url: newUrl,
      historyIndex: newIndex,
      canGoBack: true,
      canGoForward: newIndex < activeTab.history.length - 1,
    }
    if (internalTitle) {
      updates.title = internalTitle
    }
    if (isInternalUrl(newUrl)) {
      updates.favicon = getInternalPageFavicon(newUrl) ?? undefined
    }

    await applyTabNavigation(set, get, activeTabId, updates, 'Failed to go forward:')
  },

  duplicateTab: async (id: string) => {
    const { tabs, addTab } = get()
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return

    // Create a new tab with the same URL
    await addTab(tab.url)
  },

  closeOtherTabs: async (id: string) => {
    const { tabs, closeTab } = get()
    const otherTabs = tabs.filter((t) => t.id !== id)

    // Close all other tabs
    for (const tab of otherTabs) {
      await closeTab(tab.id)
    }
  },

  reopenLastClosedTab: async () => {
    const { closedTabs, addTab } = get()
    if (closedTabs.length === 0) return

    // Get and remove the last closed tab
    const lastClosed = closedTabs[0]
    set({ closedTabs: closedTabs.slice(1) })

    // Reopen it
    await addTab(lastClosed.url)
  },

  nextTab: async () => {
    const { tabs, activeTabId, setActiveTab } = get()
    if (tabs.length <= 1) return

    const currentIndex = tabs.findIndex((t) => t.id === activeTabId)
    const nextIndex = (currentIndex + 1) % tabs.length
    await setActiveTab(tabs[nextIndex].id)
  },

  previousTab: async () => {
    const { tabs, activeTabId, setActiveTab } = get()
    if (tabs.length <= 1) return

    const currentIndex = tabs.findIndex((t) => t.id === activeTabId)
    const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1
    await setActiveTab(tabs[prevIndex].id)
  },

  goToTabByIndex: async (index: number) => {
    const { tabs, setActiveTab } = get()
    const tabIndex = index === 9 ? tabs.length - 1 : index - 1
    if (tabIndex >= 0 && tabIndex < tabs.length) {
      await setActiveTab(tabs[tabIndex].id)
    }
  },

  reorderTabs: (tabId, newIndex) => {
    set((state) => {
      const { tabs } = state

      // Find the tab to move
      const oldIndex = tabs.findIndex((t) => t.id === tabId)
      if (oldIndex === -1 || oldIndex === newIndex) return state

      // Create new array with reordered tabs
      const newTabs = [...tabs]
      const [movedTab] = newTabs.splice(oldIndex, 1)
      newTabs.splice(newIndex, 0, movedTab)

      return { tabs: newTabs }
    })
  },
}))
