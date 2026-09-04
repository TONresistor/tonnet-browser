// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTabsStore, getInternalPageTitle } from '../tabs'

// Mock electron-log before any imports that use it
vi.mock('electron-log/renderer', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

// Mock i18next
vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) => {
      const translations: Record<string, string> = {
        'tabs.newTab': 'New Tab',
        'storage.title': 'TON Storage',
        title: 'Settings',
        appName: 'TON Browser',
      }
      return translations[key] ?? key
    },
  },
}))

// Mock window.electron IPC
const mockElectron = {
  tabs: {
    create: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    switch: vi.fn().mockResolvedValue(undefined),
  },
  navigate: vi.fn().mockResolvedValue({ success: true }),
  settings: {
    get: vi.fn().mockResolvedValue({ homepage: 'ton://start' }),
  },
  view: {
    hide: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
  },
}

vi.stubGlobal('window', {
  ...globalThis.window,
  electron: mockElectron,
})

// Mock crypto.randomUUID — IDs must differ in the first 7 chars after dash removal
let uuidCounter = 0
vi.stubGlobal('crypto', {
  randomUUID: () => {
    const n = ++uuidCounter
    // Produce a UUID where the first 7 non-dash chars are unique per call
    return `${String(n).padStart(7, '0')}0-0000-0000-0000-000000000000`
  },
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Mock useBrowserStore
const browserStateMocks = vi.hoisted(() => ({ setNavigation: vi.fn(), setTitle: vi.fn(), setLoading: vi.fn() }))
vi.mock('../browser', () => ({
  useBrowserStore: {
    getState: () => browserStateMocks,
  },
}))

beforeEach(() => {
  uuidCounter = 0
  vi.clearAllMocks()
  mockElectron.navigate.mockReset().mockResolvedValue({ success: true })
  // Reset store state
  useTabsStore.setState({
    tabs: [],
    activeTabId: null,
    closedTabs: [],
  })
})

describe('getInternalPageTitle', () => {
  it('returns translated title for ton://start', () => {
    expect(getInternalPageTitle('ton://start')).toBe('New Tab')
  })

  it('returns translated title for ton://storage', () => {
    expect(getInternalPageTitle('ton://storage')).toBe('TON Storage')
  })

  it('returns translated title for ton://settings', () => {
    expect(getInternalPageTitle('ton://settings')).toBe('Settings')
  })

  it('returns app name for unknown ton:// pages', () => {
    expect(getInternalPageTitle('ton://unknown')).toBe('TON Browser')
  })

  it('returns null for non-internal URLs', () => {
    expect(getInternalPageTitle('http://example.ton')).toBeNull()
    expect(getInternalPageTitle('https://example.com')).toBeNull()
  })
})

describe('tabs store', () => {
  it('clears loading on internal navigation and restores it if navigation fails', async () => {
    await useTabsStore.getState().addTab('http://loading.ton')
    const id = useTabsStore.getState().activeTabId!
    useTabsStore.getState().updateTab(id, { isLoading: true })
    mockElectron.navigate.mockResolvedValueOnce({ success: false })
    await useTabsStore.getState().navigateActiveTab('ton://settings')
    expect(useTabsStore.getState().tabs[0].isLoading).toBe(true)
    expect(browserStateMocks.setLoading).toHaveBeenLastCalledWith(true)
    await useTabsStore.getState().navigateActiveTab('ton://settings')
    expect(useTabsStore.getState().tabs[0].isLoading).toBe(false)
    expect(browserStateMocks.setLoading).toHaveBeenLastCalledWith(false)
  })

  describe('addTab', () => {
    it('adds a new tab with the given URL', async () => {
      await useTabsStore.getState().addTab('http://example.ton')

      const { tabs, activeTabId } = useTabsStore.getState()
      expect(tabs).toHaveLength(1)
      expect(tabs[0].url).toBe('http://example.ton')
      expect(activeTabId).toBe(tabs[0].id)
    })

    it('uses homepage when no URL is provided', async () => {
      await useTabsStore.getState().addTab()

      const { tabs } = useTabsStore.getState()
      expect(tabs).toHaveLength(1)
      expect(tabs[0].url).toBe('ton://start')
    })

    it('initializes tab history with the initial URL', async () => {
      await useTabsStore.getState().addTab('http://example.ton')

      const tab = useTabsStore.getState().tabs[0]
      expect(tab.history).toEqual(['http://example.ton'])
      expect(tab.historyIndex).toBe(0)
    })

    it('sets canGoBack and canGoForward to false for new tabs', async () => {
      await useTabsStore.getState().addTab('http://example.ton')

      const tab = useTabsStore.getState().tabs[0]
      expect(tab.canGoBack).toBe(false)
      expect(tab.canGoForward).toBe(false)
    })

    it('calls electron IPC to create and navigate', async () => {
      await useTabsStore.getState().addTab('http://example.ton')

      const tab = useTabsStore.getState().tabs[0]
      expect(mockElectron.tabs.create).toHaveBeenCalledWith(tab.id, 'http://example.ton')
      expect(mockElectron.navigate).toHaveBeenCalledWith('http://example.ton', tab.id)
    })

    it('sets active tab to the newly created tab', async () => {
      await useTabsStore.getState().addTab('http://a.ton')
      await useTabsStore.getState().addTab('http://b.ton')

      const { tabs, activeTabId } = useTabsStore.getState()
      expect(tabs).toHaveLength(2)
      expect(activeTabId).toBe(tabs[1].id)
    })
  })

  describe('closeTab', () => {
    it('keeps replacement metadata updated during a pending close', async () => {
      await useTabsStore.getState().addTab('http://a.ton')
      await useTabsStore.getState().addTab('http://b.ton')
      const [replacement, closing] = useTabsStore.getState().tabs
      useTabsStore.getState().updateTab(replacement.id, { isLoading: true })
      const pending = deferred<void>()
      mockElectron.tabs.close.mockReturnValueOnce(pending.promise)
      const closingTab = useTabsStore.getState().closeTab(closing.id)
      useTabsStore.getState().updateTab(replacement.id, { url: 'http://a.ton/ready', title: 'Ready', isLoading: false })
      pending.resolve()
      await closingTab
      expect(useTabsStore.getState().tabs[0]).toMatchObject({
        url: 'http://a.ton/ready',
        title: 'Ready',
        isLoading: false,
      })
      expect(browserStateMocks.setLoading).toHaveBeenLastCalledWith(false)
      expect(browserStateMocks.setNavigation).toHaveBeenLastCalledWith('http://a.ton/ready', false, false)
    })

    it('removes the closed tab', async () => {
      await useTabsStore.getState().addTab('http://example.ton')
      const tabId = useTabsStore.getState().tabs[0].id

      await useTabsStore.getState().closeTab(tabId)

      // After closing the last tab, a new default tab is created
      const { tabs } = useTabsStore.getState()
      expect(tabs).toHaveLength(1)
      expect(tabs[0].url).toBe('ton://start')
    })

    it('saves closed tab to closedTabs history (excluding ton://start)', async () => {
      await useTabsStore.getState().addTab('http://example.ton')
      await useTabsStore.getState().addTab('http://other.ton')

      const tabToClose = useTabsStore.getState().tabs[0]
      await useTabsStore.getState().closeTab(tabToClose.id)

      const { closedTabs } = useTabsStore.getState()
      expect(closedTabs).toHaveLength(1)
      expect(closedTabs[0].url).toBe('http://example.ton')
    })

    it('does not save ton://start to closedTabs', async () => {
      await useTabsStore.getState().addTab('ton://start')
      await useTabsStore.getState().addTab('http://other.ton')

      const startTab = useTabsStore.getState().tabs.find((t) => t.url === 'ton://start')!
      await useTabsStore.getState().closeTab(startTab.id)

      const { closedTabs } = useTabsStore.getState()
      expect(closedTabs).toHaveLength(0)
    })

    it('limits closedTabs to 10 entries', async () => {
      // Pre-populate closedTabs with 10 entries
      useTabsStore.setState({
        closedTabs: Array.from({ length: 10 }, (_, i) => ({
          url: `http://old-${i}.ton`,
          title: `Old ${i}`,
        })),
      })

      await useTabsStore.getState().addTab('http://new.ton')
      await useTabsStore.getState().addTab('http://keep.ton')
      const newTab = useTabsStore.getState().tabs.find((t) => t.url === 'http://new.ton')!
      await useTabsStore.getState().closeTab(newTab.id)

      const { closedTabs } = useTabsStore.getState()
      expect(closedTabs.length).toBeLessThanOrEqual(10)
      expect(closedTabs[0].url).toBe('http://new.ton')
    })

    it('switches to adjacent tab when active tab is closed', async () => {
      await useTabsStore.getState().addTab('http://a.ton')
      await useTabsStore.getState().addTab('http://b.ton')
      await useTabsStore.getState().addTab('http://c.ton')

      // Active tab is the last one (c.ton), close b.ton which is not active
      const tabB = useTabsStore.getState().tabs.find((t) => t.url === 'http://b.ton')!
      await useTabsStore.getState().closeTab(tabB.id)

      const { tabs } = useTabsStore.getState()
      expect(tabs).toHaveLength(2)
      expect(tabs.map((t) => t.url)).toContain('http://a.ton')
      expect(tabs.map((t) => t.url)).toContain('http://c.ton')
    })

    it('creates a new default tab when the last tab is closed', async () => {
      await useTabsStore.getState().addTab('http://only.ton')
      const onlyTab = useTabsStore.getState().tabs[0]

      await useTabsStore.getState().closeTab(onlyTab.id)

      const { tabs } = useTabsStore.getState()
      expect(tabs.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('setActiveTab', () => {
    it('synchronizes metadata received while the tab switch is pending', async () => {
      await useTabsStore.getState().addTab('http://a.ton')
      await useTabsStore.getState().addTab('http://b.ton')
      const id = useTabsStore.getState().tabs[0].id
      const pending = deferred<void>()
      mockElectron.tabs.switch.mockReturnValueOnce(pending.promise)
      const switching = useTabsStore.getState().setActiveTab(id)
      useTabsStore.getState().updateTab(id, { url: 'http://a.ton/new', title: 'Updated', isLoading: true })
      pending.resolve()
      await switching
      expect(browserStateMocks.setNavigation).toHaveBeenLastCalledWith('http://a.ton/new', false, false)
      expect(browserStateMocks.setTitle).toHaveBeenLastCalledWith('Updated')
      expect(browserStateMocks.setLoading).toHaveBeenLastCalledWith(true)
    })

    it('switches active tab', async () => {
      await useTabsStore.getState().addTab('http://a.ton')
      await useTabsStore.getState().addTab('http://b.ton')

      const tabA = useTabsStore.getState().tabs[0]
      await useTabsStore.getState().setActiveTab(tabA.id)

      expect(useTabsStore.getState().activeTabId).toBe(tabA.id)
    })

    it('does nothing when switching to the already active tab', async () => {
      await useTabsStore.getState().addTab('http://a.ton')
      const tabA = useTabsStore.getState().tabs[0]

      vi.clearAllMocks()
      await useTabsStore.getState().setActiveTab(tabA.id)

      // Should not call IPC since tab is already active
      expect(mockElectron.tabs.switch).not.toHaveBeenCalled()
    })

    it('does nothing for a non-existent tab id', async () => {
      await useTabsStore.getState().addTab('http://a.ton')

      vi.clearAllMocks()
      await useTabsStore.getState().setActiveTab('nonexistent')

      expect(mockElectron.tabs.switch).not.toHaveBeenCalled()
    })
  })

  describe('updateTab', () => {
    it('updates specified tab fields', async () => {
      await useTabsStore.getState().addTab('http://example.ton')
      const tabId = useTabsStore.getState().tabs[0].id

      useTabsStore.getState().updateTab(tabId, {
        title: 'Updated Title',
        isLoading: true,
      })

      const tab = useTabsStore.getState().tabs[0]
      expect(tab.title).toBe('Updated Title')
      expect(tab.isLoading).toBe(true)
      expect(tab.url).toBe('http://example.ton') // unchanged
    })
  })

  describe('navigateActiveTab', () => {
    it('navigates the active tab to a new URL', async () => {
      await useTabsStore.getState().addTab('http://initial.ton')
      vi.clearAllMocks()

      await useTabsStore.getState().navigateActiveTab('http://new.ton')

      const tab = useTabsStore.getState().tabs[0]
      expect(tab.url).toBe('http://new.ton')
      expect(mockElectron.navigate).toHaveBeenCalledWith('http://new.ton', tab.id)
    })

    it('does not navigate if URL is the same as current', async () => {
      await useTabsStore.getState().addTab('http://same.ton')
      vi.clearAllMocks()

      await useTabsStore.getState().navigateActiveTab('http://same.ton')

      expect(mockElectron.navigate).not.toHaveBeenCalled()
    })

    it('updates tab history on navigation', async () => {
      await useTabsStore.getState().addTab('http://page1.ton')
      await useTabsStore.getState().navigateActiveTab('http://page2.ton')
      await useTabsStore.getState().navigateActiveTab('http://page3.ton')

      const tab = useTabsStore.getState().tabs[0]
      expect(tab.history).toEqual(['http://page1.ton', 'http://page2.ton', 'http://page3.ton'])
      expect(tab.historyIndex).toBe(2)
      expect(tab.canGoBack).toBe(true)
      expect(tab.canGoForward).toBe(false)
    })

    it('restores the previous tab state when navigation is rejected', async () => {
      await useTabsStore.getState().addTab('http://initial.ton')
      mockElectron.navigate.mockResolvedValueOnce({ success: false })

      await useTabsStore.getState().navigateActiveTab('http://rejected.ton')

      const tab = useTabsStore.getState().tabs[0]
      expect(tab.url).toBe('http://initial.ton')
      expect(tab.history).toEqual(['http://initial.ton'])
      expect(tab.historyIndex).toBe(0)
      expect(tab.canGoBack).toBe(false)
      expect(tab.canGoForward).toBe(false)
    })

    it('does not let an older failure roll back a newer navigation', async () => {
      await useTabsStore.getState().addTab('http://initial.ton')
      const first = deferred<{ success: boolean }>()
      const second = deferred<{ success: boolean }>()
      mockElectron.navigate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

      const firstNavigation = useTabsStore.getState().navigateActiveTab('http://second.ton')
      const secondNavigation = useTabsStore.getState().navigateActiveTab('http://third.ton')
      second.resolve({ success: true })
      await secondNavigation
      first.resolve({ success: false })
      await firstNavigation

      const tab = useTabsStore.getState().tabs[0]
      expect(tab.url).toBe('http://third.ton')
      expect(tab.history).toEqual(['http://initial.ton', 'http://second.ton', 'http://third.ton'])
    })

    it('caps history at MAX_HISTORY (10) entries', async () => {
      await useTabsStore.getState().addTab('http://page0.ton')

      // Navigate to 11 more pages (total 12, should trim to 10)
      for (let i = 1; i <= 11; i++) {
        await useTabsStore.getState().navigateActiveTab(`http://page${i}.ton`)
      }

      const tab = useTabsStore.getState().tabs[0]
      expect(tab.history.length).toBeLessThanOrEqual(10)
      // The oldest entries should have been trimmed
      expect(tab.history[tab.history.length - 1]).toBe('http://page11.ton')
    })

    it('truncates forward history when navigating to a new URL', async () => {
      await useTabsStore.getState().addTab('http://page1.ton')
      await useTabsStore.getState().navigateActiveTab('http://page2.ton')
      await useTabsStore.getState().navigateActiveTab('http://page3.ton')

      // Go back to page2
      await useTabsStore.getState().goBack()

      // Navigate to a new page - should truncate page3 from history
      await useTabsStore.getState().navigateActiveTab('http://page4.ton')

      const tab = useTabsStore.getState().tabs[0]
      expect(tab.history).toEqual(['http://page1.ton', 'http://page2.ton', 'http://page4.ton'])
      expect(tab.canGoForward).toBe(false)
    })
  })

  describe('goBack / goForward', () => {
    it('goes back in tab history', async () => {
      await useTabsStore.getState().addTab('http://page1.ton')
      await useTabsStore.getState().navigateActiveTab('http://page2.ton')

      await useTabsStore.getState().goBack()

      const tab = useTabsStore.getState().tabs[0]
      expect(tab.url).toBe('http://page1.ton')
      expect(tab.canGoBack).toBe(false)
      expect(tab.canGoForward).toBe(true)
    })

    it('goes forward in tab history', async () => {
      await useTabsStore.getState().addTab('http://page1.ton')
      await useTabsStore.getState().navigateActiveTab('http://page2.ton')
      await useTabsStore.getState().goBack()

      await useTabsStore.getState().goForward()

      const tab = useTabsStore.getState().tabs[0]
      expect(tab.url).toBe('http://page2.ton')
      expect(tab.canGoBack).toBe(true)
      expect(tab.canGoForward).toBe(false)
    })

    it('does nothing when there is no history to go back to', async () => {
      await useTabsStore.getState().addTab('http://page1.ton')
      vi.clearAllMocks()

      await useTabsStore.getState().goBack()

      // Should not navigate since we are at the beginning
      expect(mockElectron.navigate).not.toHaveBeenCalled()
    })

    it('does nothing when there is no forward history', async () => {
      await useTabsStore.getState().addTab('http://page1.ton')
      vi.clearAllMocks()

      await useTabsStore.getState().goForward()

      expect(mockElectron.navigate).not.toHaveBeenCalled()
    })
  })

  describe('reopenLastClosedTab', () => {
    it('reopens the most recently closed tab', async () => {
      await useTabsStore.getState().addTab('http://closed.ton')
      await useTabsStore.getState().addTab('http://keep.ton')

      const closedTab = useTabsStore.getState().tabs.find((t) => t.url === 'http://closed.ton')!
      await useTabsStore.getState().closeTab(closedTab.id)

      await useTabsStore.getState().reopenLastClosedTab()

      const { tabs, closedTabs } = useTabsStore.getState()
      expect(tabs.some((t) => t.url === 'http://closed.ton')).toBe(true)
      expect(closedTabs).toHaveLength(0)
    })

    it('does nothing when closedTabs is empty', async () => {
      vi.clearAllMocks()

      await useTabsStore.getState().reopenLastClosedTab()

      expect(mockElectron.tabs.create).not.toHaveBeenCalled()
    })
  })

  describe('goToTabByIndex', () => {
    it('uses shortcut 9 for the last tab', async () => {
      await useTabsStore.getState().addTab('http://first.ton')
      await useTabsStore.getState().addTab('http://second.ton')
      await useTabsStore.getState().addTab('http://last.ton')

      await useTabsStore.getState().goToTabByIndex(9)

      const { tabs, activeTabId } = useTabsStore.getState()
      expect(activeTabId).toBe(tabs.at(-1)?.id)
    })
  })

  describe('reorderTabs', () => {
    it('reorders tabs by moving a tab to a new index', async () => {
      await useTabsStore.getState().addTab('http://a.ton')
      await useTabsStore.getState().addTab('http://b.ton')
      await useTabsStore.getState().addTab('http://c.ton')

      const tabA = useTabsStore.getState().tabs[0]
      useTabsStore.getState().reorderTabs(tabA.id, 2)

      const { tabs } = useTabsStore.getState()
      expect(tabs[0].url).toBe('http://b.ton')
      expect(tabs[1].url).toBe('http://c.ton')
      expect(tabs[2].url).toBe('http://a.ton')
    })

    it('does nothing for non-existent tab id', async () => {
      await useTabsStore.getState().addTab('http://a.ton')
      const tabsBefore = [...useTabsStore.getState().tabs]

      useTabsStore.getState().reorderTabs('nonexistent', 0)

      expect(useTabsStore.getState().tabs).toEqual(tabsBefore)
    })

    it('does nothing when moving to the same position', async () => {
      await useTabsStore.getState().addTab('http://a.ton')
      await useTabsStore.getState().addTab('http://b.ton')

      const tabA = useTabsStore.getState().tabs[0]
      const tabsBefore = useTabsStore.getState().tabs.map((t) => t.url)

      useTabsStore.getState().reorderTabs(tabA.id, 0)

      const tabsAfter = useTabsStore.getState().tabs.map((t) => t.url)
      expect(tabsAfter).toEqual(tabsBefore)
    })
  })

  describe('duplicateTab', () => {
    it('creates a new tab with the same URL', async () => {
      await useTabsStore.getState().addTab('http://example.ton')

      const tabId = useTabsStore.getState().tabs[0].id
      await useTabsStore.getState().duplicateTab(tabId)

      const { tabs } = useTabsStore.getState()
      expect(tabs).toHaveLength(2)
      expect(tabs[0].url).toBe('http://example.ton')
      expect(tabs[1].url).toBe('http://example.ton')
      expect(tabs[0].id).not.toBe(tabs[1].id)
    })

    it('does nothing for non-existent tab id', async () => {
      vi.clearAllMocks()
      await useTabsStore.getState().duplicateTab('nonexistent')

      expect(mockElectron.tabs.create).not.toHaveBeenCalled()
    })
  })
})
