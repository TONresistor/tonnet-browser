import type { BrowserWindow, WebContentsView } from 'electron'
import type { IDisposable } from '../utils/disposable'
import { DisposableStore, onWebContents } from '../utils/disposable'
import { createLogger } from '../../shared/logger'
import { updateViewBounds } from './tabs-bounds'

const log = createLogger('tabs')
const MIN_HOLD_MS = 150
const MAX_WAIT_MS = 5000

interface AttachManager {
  readonly window: BrowserWindow | null
  readonly sidebarWidth: number
  readonly pendingAttachments: Map<WebContentsView, IDisposable>
  readonly views: {
    readonly activeViewId: string | null
    get(tabId: string): WebContentsView | null
  }
  captureWindowGeneration(): number
  ownsWindowGeneration(generation: number): boolean
  captureNavigation(tabId: string, view: WebContentsView): () => boolean
}

export function setupNavAwareAttach(manager: AttachManager, view: WebContentsView, tabId: string): IDisposable {
  const store = new DisposableStore()
  store.add(
    onWebContents(
      view.webContents,
      'did-start-navigation',
      (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
        const { url, isSameDocument, isMainFrame } = details
        if (!isMainFrame || isSameDocument) return
        if (!url || !(url.startsWith('http:') || url.startsWith('https:'))) return
        if (!manager.window || manager.views.get(tabId) !== view || manager.views.activeViewId !== tabId) return
        try {
          if (manager.window.contentView.children.includes(view)) {
            manager.window.contentView.removeChildView(view)
          }
          attachViewWhenReady(manager, view, tabId, manager.captureWindowGeneration())
        } catch (error) {
          log.debug(`did-start-navigation detach failed for tab ${tabId}:`, error)
        }
      }
    )
  )
  store.add({ dispose: () => manager.pendingAttachments.get(view)?.dispose() })
  return store
}

export function attachViewWhenReady(
  manager: AttachManager,
  view: WebContentsView,
  tabId: string,
  generation: number
): void {
  if (!manager.window) return
  manager.pendingAttachments.get(view)?.dispose()
  const isCurrent = manager.captureNavigation(tabId, view)
  const startedAt = Date.now()
  let decided = false
  let hold: ReturnType<typeof setTimeout> | undefined
  const cleanup = (): void => {
    decided = true
    clearTimeout(timeout)
    clearTimeout(hold)
    view.webContents.removeListener('dom-ready', decide)
    view.webContents.removeListener('did-fail-load', onFailure)
    if (manager.pendingAttachments.get(view) === disposable) manager.pendingAttachments.delete(view)
  }
  const disposable = { dispose: cleanup }

  const performAttach = (): void => {
    if (!isCurrent() || !manager.ownsWindowGeneration(generation) || !manager.window) return
    if (manager.views.get(tabId) !== view) return
    const webContents = view.webContents
    if (!webContents || webContents.isDestroyed() || manager.views.activeViewId !== tabId) return
    try {
      if (!manager.window.contentView.children.includes(view)) {
        manager.window.contentView.addChildView(view)
        updateViewBounds(view, manager.window, manager.sidebarWidth)
      }
    } catch (error) {
      log.debug(`Deferred attach failed for tab ${tabId}:`, error)
    }
  }

  const decide = (): void => {
    if (decided) return
    decided = true
    clearTimeout(timeout)
    view.webContents.removeListener('dom-ready', decide)
    view.webContents.removeListener('did-fail-load', onFailure)
    const delay = Math.max(0, MIN_HOLD_MS - (Date.now() - startedAt))
    const finish = (): void => {
      cleanup()
      performAttach()
    }
    if (delay === 0) finish()
    else hold = setTimeout(finish, delay)
  }

  const onFailure = (
    _event: unknown,
    _code: number,
    _description: string,
    _url: string,
    isMainFrame: boolean
  ): void => {
    if (isMainFrame) decide()
  }

  manager.pendingAttachments.set(view, disposable)
  view.webContents.once('dom-ready', decide)
  view.webContents.on('did-fail-load', onFailure)
  const timeout = setTimeout(decide, MAX_WAIT_MS)
}
