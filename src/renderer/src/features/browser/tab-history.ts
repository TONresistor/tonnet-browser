interface TabHistory {
  url: string
  history: string[]
  historyIndex: number
  nativeCanGoBack?: boolean
  nativeCanGoForward?: boolean
  legacyStorageHistory?: boolean
}

function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href
  } catch {
    return a === b
  }
}

/** Chromium owns web visits; React routes and legacy Storage keep their existing URL history. */
export function selectTabTraversal(tab: TabHistory, direction: 'back' | 'forward'): number | 'native' | null {
  const step = direction === 'back' ? -1 : 1
  const adjacent = tab.historyIndex + step
  if (tab.url.startsWith('ton://') || tab.url.startsWith('file:') || tab.legacyStorageHistory) {
    return adjacent >= 0 && adjacent < tab.history.length ? adjacent : null
  }
  let internal: number | null = null
  for (let index = adjacent; index >= 0 && index < tab.history.length; index += step) {
    if (tab.history[index].startsWith('ton://')) {
      internal = index
      break
    }
  }
  if (direction === 'forward' && internal !== null && sameUrl(tab.url, tab.history[tab.historyIndex])) return internal
  if (direction === 'back' ? tab.nativeCanGoBack : tab.nativeCanGoForward) return 'native'
  return internal
}

export function tabNavigationFlags(tab: TabHistory): { canGoBack: boolean; canGoForward: boolean } {
  return {
    canGoBack: selectTabTraversal(tab, 'back') !== null,
    canGoForward: selectTabTraversal(tab, 'forward') !== null,
  }
}
