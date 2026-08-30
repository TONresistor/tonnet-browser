import { errorMessage } from '../../../shared/errors'
import { isValidNavigationUrl } from '../validation'
import { log } from './shared'
import { loadDataHtml } from '../../windows/page-templates'
import type { TabManager } from '../../windows/tabs'
import {
  goBackContract,
  goForwardContract,
  navigateContract,
  reloadContract,
  stopContract,
  zoomGetContract,
  zoomSetContract,
} from '../../../shared/ipc-contract/browsing'
import { ipcFailure, secureContractHandle } from '../contract-handler'

export function registerNavigationHandlers(tabManager: TabManager): void {
  secureContractHandle(navigateContract, async (url, tabId?: string) => {
    log.debug(`Navigate called with URL: ${url}, tabId: ${tabId || 'none'}`)

    // Security: Validate URL before navigation
    const validation = isValidNavigationUrl(url)
    if (!validation.valid) {
      log.event('warn', 'navigation.invalid_url', 'invalid navigation rejected', { reason: validation.error })
      ipcFailure('INVALID_URL', 'Invalid navigation URL')
    }

    // ton://storage/browse/<bagId> is handled in-app by the React master-detail
    // file browser (StorageBrowsePage); it falls through to the internal ton://
    // branch below which hides the WebContentsView so React can render.

    // ton://storage/file/<bagId>/<encodedRelPath> opens a single bag file inline
    // in this tab (audio/pdf/image render in the browser, like the old browser).
    const fileMatch = url.match(/^ton:\/\/storage\/file\/([a-fA-F0-9]{64})\/(.+)$/)
    if (fileMatch) {
      const bagId = fileMatch[1]
      let relPath: string
      try {
        relPath = decodeURIComponent(fileMatch[2])
      } catch {
        ipcFailure('INVALID_FILE_PATH', 'Invalid file path')
      }
      const targetTab = tabId || tabManager.getActiveTabId()
      if (!targetTab) ipcFailure('TAB_NOT_FOUND', 'No tab available')
      tabManager.loadBagFile(targetTab, bagId, relPath).catch((err) => {
        log.error('Failed to open bag file:', errorMessage(err))
      })
      return { success: true }
    }

    // Don't load internal ton:// URLs in WebContentsView
    if (url.startsWith('ton://')) {
      log.debug('Internal URL, hiding views')
      tabManager.hideAllViews(tabId || tabManager.getActiveTabId() || undefined)
      return { success: true, internal: true }
    }

    // navigateInTab handles view visibility (show/attach) internally
    const targetTabId = tabId || tabManager.getActiveTabId()
    if (targetTabId) {
      const success = await tabManager.navigateInTab(targetTabId, url)
      return { success }
    }

    log.warn('No active tab')
    ipcFailure('TAB_NOT_FOUND', 'No active tab')
  })

  secureContractHandle(goBackContract, async () => {
    const view = tabManager.getActiveView()
    if (!view) return { success: false }

    // If viewing a local bag file, restore the file browser instead of goBack
    const currentUrl = view.webContents.getURL()
    if (currentUrl.startsWith('file:///') && currentUrl.includes('/storage/')) {
      const cached = tabManager.storage.fileBrowserCache.get(view.webContents.id)
      if (cached) {
        const tabId = tabManager.getActiveTabId()
        if (tabId) tabManager.cancelNavigation(tabId)
        await loadDataHtml(view.webContents, cached)
        return { success: true }
      }
    }

    if (view.webContents.navigationHistory.canGoBack()) {
      const tabId = tabManager.getActiveTabId()
      if (tabId) tabManager.cancelNavigation(tabId)
      view.webContents.navigationHistory.goBack()
      return { success: true }
    }
    return { success: false }
  })

  secureContractHandle(goForwardContract, () => {
    const view = tabManager.getActiveView()
    if (view?.webContents.navigationHistory.canGoForward()) {
      const tabId = tabManager.getActiveTabId()
      if (tabId) tabManager.cancelNavigation(tabId)
      view.webContents.navigationHistory.goForward()
      return { success: true }
    }
    return { success: false }
  })

  secureContractHandle(reloadContract, () => {
    return { success: tabManager.reloadActivePage(false) }
  })

  secureContractHandle(stopContract, () => {
    return { success: tabManager.stopActivePage() }
  })

  secureContractHandle(zoomGetContract, () => {
    const zoom = tabManager.pageZoom.get()
    return { success: zoom !== null, zoom }
  })

  secureContractHandle(zoomSetContract, (percent) => {
    const zoom = tabManager.pageZoom.set(percent)
    return { success: zoom !== null, zoom }
  })
}
