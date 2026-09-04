/**
 * Event listeners for tab WebContentsViews.
 * Handles navigation events, loading states, favicon extraction, and context menus.
 */

import { WebContentsView } from 'electron'
import { loadStorageBrowser, loadErrorPage } from './tabs-storage'
import { extractFavicon } from './browser-view'
import { createLogger } from '../../shared/logger'
import { emitContractToRenderer } from '../events/renderer-events'
import {
  BrowserUrlSchema,
  contextOpenLinkContract,
  pageFaviconContract,
  pageLoadingContract,
  pageNavigateContract,
  pageTitleContract,
} from '../../shared/ipc-contract/browsing'
import { CONTEXT_MENU_WIDTH } from './constants'
import { clipboard } from 'electron'
import { DisposableStore, onWebContents } from '../utils/disposable'
import type { WebContentsInputHandler } from './browser-shortcuts'
import type { HistoryManager } from '../history/manager'
import type { OverlayManager } from './overlay-manager'
import type { OverlayMenuItem } from '../../shared/types'
import type { TabStorageState } from './tabs-storage'

const log = createLogger('tabs-events')

function isInternalPresentationUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('file:')
}

function isPublishablePageUrl(url: string): boolean {
  if (isInternalPresentationUrl(url)) return false
  if (BrowserUrlSchema.safeParse(url).success) return true
  log.event('warn', 'page.url.rejected', 'page URL exceeds the browser contract', { length: url.length })
  return false
}

// History has the tightest title limit among the consumers of page metadata.
const boundedTitle = (title: string): string => title.slice(0, 4_096)

/** Dependencies needed by setupViewEventListeners */
export interface TabEventDeps {
  historyManager: HistoryManager
  overlayManager: OverlayManager
  storage: TabStorageState
  cancelNavigation(tabId: string): void
  captureNavigation(tabId: string, view: WebContentsView): () => boolean
  handleInput: WebContentsInputHandler
}

/** Set up non-security event listeners on a view (loading, navigation, favicon, context menu). */
export function setupViewEventListeners(view: WebContentsView, tabId: string, deps: TabEventDeps): DisposableStore {
  const { historyManager, overlayManager, storage } = deps

  const store = new DisposableStore()

  store.add(onWebContents(view.webContents, 'before-input-event', deps.handleInput))

  store.add(
    onWebContents(view.webContents, 'did-start-loading', () => {
      emitContractToRenderer(pageLoadingContract, true, tabId)
    })
  )

  store.add(
    onWebContents(view.webContents, 'did-stop-loading', () => {
      emitContractToRenderer(pageLoadingContract, false, tabId)
    })
  )

  const handleNavigate = (_e: unknown, url: string): void => {
    if (!isPublishablePageUrl(url)) return
    emitContractToRenderer(pageNavigateContract, {
      tabId,
      url,
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    })
    historyManager.addEntry(url, boundedTitle(view.webContents.getTitle()))
  }
  store.add(onWebContents(view.webContents, 'did-navigate', handleNavigate))
  store.add(
    onWebContents(view.webContents, 'did-navigate-in-page', (event: unknown, url: string, isMainFrame: boolean) => {
      if (isMainFrame) handleNavigate(event, url)
    })
  )

  store.add(
    onWebContents(view.webContents, 'page-title-updated', (_e: unknown, title: string) => {
      const safeTitle = boundedTitle(title)
      emitContractToRenderer(pageTitleContract, safeTitle, tabId)

      const url = view.webContents.getURL()
      if (isPublishablePageUrl(url)) historyManager.addEntry(url, safeTitle, undefined, false)
    })
  )

  // Extract favicon and detect empty storage bag pages
  store.add(
    onWebContents(view.webContents, 'did-finish-load', async () => {
      const isCurrent = deps.captureNavigation(tabId, view)
      try {
        const favicon = await extractFavicon(view)
        if (!isCurrent()) return
        if (favicon) {
          emitContractToRenderer(pageFaviconContract, favicon, tabId)
        }
      } catch (error) {
        log.debug(`Failed to extract favicon for tab ${tabId}:`, error)
      }

      try {
        if (!isCurrent()) return
        const pageUrl = view.webContents.getURL()
        const url = new URL(pageUrl)
        if (url.hostname.endsWith('.ton') && !pageUrl.startsWith('data:')) {
          const { textLen, htmlLen } = await view.webContents.executeJavaScript(
            '({ textLen: document.body ? document.body.innerText.trim().length : 0, htmlLen: document.body ? document.body.innerHTML.trim().length : 0 })'
          )
          if (!isCurrent()) return
          if (htmlLen < 50 && textLen < 10) {
            log.info(`Empty page detected for ${url.hostname}, trying storage browser`)
            loadStorageBrowser(storage, view, url.hostname, isCurrent).catch(() => {
              log.debug('Not a storage bag or no files available')
            })
          }
        }
      } catch (err) {
        log.debug('Empty page detection failed:', err)
      }
    })
  )

  // Handle load failures
  store.add(
    onWebContents(
      view.webContents,
      'did-fail-load',
      (_event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => {
        if (!isMainFrame) return
        const isCurrent = deps.captureNavigation(tabId, view)
        if (!isCurrent()) return
        if (errorCode === -3 || errorCode === -2 || errorCode === 0) {
          return
        }

        if (validatedURL.startsWith('data:') || validatedURL.startsWith('file:')) {
          return
        }

        log.event('warn', 'page.load.failed', 'page load failed', { errorCode, errorDescription })

        try {
          const url = new URL(validatedURL)
          if (url.hostname.endsWith('.ton')) {
            loadStorageBrowser(storage, view, url.hostname, isCurrent).catch(() => {
              if (isCurrent()) loadErrorPage(view, `${errorDescription} (${errorCode})`, validatedURL)
            })
            return
          }
        } catch (err) {
          log.debug('URL parse failed in did-fail-load:', err)
        }

        loadErrorPage(view, `${errorDescription} (${errorCode})`, validatedURL)
      }
    )
  )

  // Context menu for web pages (overlay instead of native menu)
  store.add(
    onWebContents(view.webContents, 'context-menu', (_e: unknown, params: Electron.ContextMenuParams) => {
      const items: OverlayMenuItem[] = []

      // Text editing options
      if (params.isEditable) {
        items.push(
          { id: 'cut', label: 'Cut', disabled: !params.editFlags.canCut },
          { id: 'copy', label: 'Copy', disabled: !params.editFlags.canCopy },
          { id: 'paste', label: 'Paste', disabled: !params.editFlags.canPaste },
          { id: '_sep1', label: '', separator: true },
          { id: 'select-all', label: 'Select All' }
        )
      } else if (params.selectionText) {
        items.push({ id: 'copy', label: 'Copy' })
      }

      // Link options
      if (params.linkURL && BrowserUrlSchema.safeParse(params.linkURL).success) {
        if (items.length > 0) items.push({ id: '_sep2', label: '', separator: true })
        items.push(
          { id: 'open-link-new-tab', label: 'Open Link in New Tab', data: { url: params.linkURL } },
          { id: 'copy-link', label: 'Copy Link Address', data: { url: params.linkURL } }
        )
      }

      // Image options
      if (params.hasImageContents && params.srcURL) {
        if (items.length > 0) items.push({ id: '_sep3', label: '', separator: true })
        items.push({ id: 'copy-image-url', label: 'Copy Image Address', data: { url: params.srcURL } })
      }

      // Navigation options
      if (items.length > 0) items.push({ id: '_sep4', label: '', separator: true })
      items.push(
        { id: 'back', label: 'Back', disabled: !view.webContents.navigationHistory.canGoBack() },
        { id: 'forward', label: 'Forward', disabled: !view.webContents.navigationHistory.canGoForward() },
        { id: 'reload', label: 'Reload' }
      )

      if (items.length === 0) return

      // Calculate menu height: ~36px per item, 1px per separator, 8px padding
      const visibleItems = items.filter((i) => !i.separator).length
      const separators = items.filter((i) => i.separator).length
      const menuH = visibleItems * 36 + separators * 9 + 8
      const menuW = CONTEXT_MENU_WIDTH

      // Clamp to window bounds
      const winBounds = view.getBounds()
      const menuX = Math.max(0, Math.min(params.x, winBounds.width - menuW))
      const menuY = Math.max(0, Math.min(params.y, winBounds.height - menuH))

      // Offset by view position in window
      const offsetX = winBounds.x + menuX
      const offsetY = winBounds.y + menuY

      overlayManager.show(
        'page-context-menu',
        { x: offsetX, y: offsetY, width: menuW, height: menuH },
        { type: 'menu', items },
        (actionType, actionData) => {
          const d = actionData as Record<string, string>
          switch (actionType) {
            case 'cut':
              view.webContents.cut()
              break
            case 'copy':
              view.webContents.copy()
              break
            case 'paste':
              view.webContents.paste()
              break
            case 'select-all':
              view.webContents.selectAll()
              break
            case 'open-link-new-tab':
              if (BrowserUrlSchema.safeParse(d.url).success) emitContractToRenderer(contextOpenLinkContract, d.url)
              break
            case 'copy-link':
              clipboard.writeText(d.url)
              break
            case 'copy-image-url':
              clipboard.writeText(d.url)
              break
            case 'back':
              deps.cancelNavigation(tabId)
              view.webContents.navigationHistory.goBack()
              break
            case 'forward':
              deps.cancelNavigation(tabId)
              view.webContents.navigationHistory.goForward()
              break
            case 'reload':
              deps.cancelNavigation(tabId)
              view.webContents.reload()
              break
            case 'dismiss':
              break
          }
          overlayManager.hide('page-context-menu')
        }
      )
    })
  )

  // Log preload errors (moved from browser-view.ts for lifecycle management)
  store.add(
    onWebContents(view.webContents, 'preload-error', (_event: unknown, preloadPath: string, error: Error) => {
      log.error(`[preload-error] ${preloadPath}: ${error.message}`)
    })
  )

  return store
}
