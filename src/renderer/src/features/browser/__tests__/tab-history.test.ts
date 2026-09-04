import { describe, expect, it } from 'vitest'
import { selectTabTraversal, tabNavigationFlags } from '../tab-history'

describe('native and internal navigation boundaries', () => {
  it('returns through native history before resuming the internal forward entry', () => {
    const tab = {
      url: 'http://site.ton/b',
      history: ['http://site.ton/b', 'ton://settings'],
      historyIndex: 0,
      nativeCanGoBack: true,
      nativeCanGoForward: false,
    }
    expect(selectTabTraversal(tab, 'forward')).toBe(1)
    expect(selectTabTraversal(tab, 'back')).toBe('native')
    const previousNativePage = { ...tab, url: 'http://site.ton/a', nativeCanGoBack: false, nativeCanGoForward: true }
    expect(selectTabTraversal(previousNativePage, 'forward')).toBe('native')
    expect(selectTabTraversal({ ...previousNativePage, url: tab.url }, 'forward')).toBe(1)
    expect(tabNavigationFlags({ ...tab, url: 'ton://settings', historyIndex: 1 })).toEqual({
      canGoBack: true,
      canGoForward: false,
    })
  })

  it('never traverses native data/file entries in a legacy Storage segment', () => {
    const listing = {
      url: 'http://bag.ton',
      history: ['http://bag.ton', 'file:///storage/bag/file.pdf'],
      historyIndex: 0,
      legacyStorageHistory: true,
      nativeCanGoBack: true,
      nativeCanGoForward: true,
    }
    expect(tabNavigationFlags(listing)).toEqual({ canGoBack: false, canGoForward: true })
    expect(selectTabTraversal(listing, 'back')).toBeNull()
    expect(selectTabTraversal(listing, 'forward')).toBe(1)
    expect(selectTabTraversal({ ...listing, url: listing.history[1], historyIndex: 1 }, 'back')).toBe(0)
  })
})
