import { WebContentsView } from 'electron'
import { createBrowserView } from './browser-view'
import { updateViewBounds } from './tabs-bounds'
import { loadErrorPage } from './tabs-storage'
import { setupSecurityHandlers } from './tabs-security'
import { setupViewEventListeners, type TabEventDeps } from './tabs-events'
import { setupNavAwareAttach } from './tabs-attach'
import { extractDomain, type TabSessionManager } from './tabs-session'
import { DisposableStore, type IDisposable } from '../utils/disposable'
import { isAbortedNavigation } from './navigation-failure'
import { createLogger } from '../../shared/logger'
import type { BrowserWindow } from 'electron'
import type { TabStorageState } from './tabs-storage'
import type { ViewRegistry } from './view-registry'

const log = createLogger('tabs')

export interface TabViewLifecycleManager {
  readonly window: BrowserWindow | null
  readonly sidebarWidth: number
  readonly sessions: TabSessionManager
  readonly storage: TabStorageState
  readonly views: ViewRegistry<WebContentsView>
  readonly pendingAttachments: Map<WebContentsView, IDisposable>
  readonly eventDependencies: TabEventDeps
  readonly defaultZoom: number
  captureWindowGeneration(): number
  ownsWindowGeneration(generation: number): boolean
  getSessionForDomain(domain: string, firstPartyIsolation?: boolean): Promise<Electron.Session>
  getActiveTabId(): string | null
  hasTab(tabId: string): boolean
  cancelNavigation(tabId: string): void
  ownsNavigation(tabId: string, epoch: number): boolean
  captureNavigation(tabId: string, view: WebContentsView): () => boolean
  navigateInTab(tabId: string, url: string): Promise<boolean>
  emitActiveZoom(): void
}

function createViewEventStore(manager: TabViewLifecycleManager, view: WebContentsView, tabId: string): DisposableStore {
  const store = new DisposableStore()
  try {
    store.add(setupViewEventListeners(view, tabId, manager.eventDependencies))
    store.add(
      setupSecurityHandlers(
        view,
        tabId,
        (url) => {
          if (manager.views.get(tabId) !== view) return true
          const currentDomain = manager.sessions.getTabDomain(tabId)
          if (!currentDomain) return false
          if (currentDomain === extractDomain(url)) {
            manager.cancelNavigation(tabId)
            return false
          }
          void manager.navigateInTab(tabId, url).catch((error) => log.error('Cross-domain navigation failed:', error))
          return true
        },
        () => manager.captureNavigation(tabId, view)
      )
    )
    store.add(setupNavAwareAttach(manager, view, tabId))
    return store
  } catch (error) {
    store.dispose()
    throw error
  }
}

export function loadViewUrl(manager: TabViewLifecycleManager, view: WebContentsView, tabId: string, url: string): void {
  const isCurrent = manager.captureNavigation(tabId, view)
  void view.webContents.loadURL(url).catch((error: Error) => {
    if (isAbortedNavigation(error) || !isCurrent()) return
    log.error('loadURL failed:', error)
    loadErrorPage(view, error.message, url)
  })
}

export function setupViewEvents(manager: TabViewLifecycleManager, view: WebContentsView, tabId: string): void {
  const store = createViewEventStore(manager, view, tabId)
  if (manager.views.has(tabId)) manager.views.replace(tabId, view, store)
  else manager.views.add(tabId, view, store)
}

export function safeDetach(manager: TabViewLifecycleManager, view: WebContentsView, context?: string): void {
  if (!manager.window) return
  try {
    manager.window.contentView.removeChildView(view)
  } catch {
    if (context) log.debug(`View not attached during ${context}`)
  }
}

export async function rebuildViewsForIsolation(
  manager: TabViewLifecycleManager,
  firstPartyIsolation: boolean
): Promise<void> {
  const generation = manager.captureWindowGeneration()
  const prepared: Array<{
    tabId: string
    previous: WebContentsView
    next: WebContentsView
    events: DisposableStore
    url: string
  }> = []

  try {
    for (const [tabId, { view: previous }] of manager.views.entries()) {
      const identity = manager.sessions.getTabDomain(tabId)
      if (!identity) continue
      const session = await manager.getSessionForDomain(identity, firstPartyIsolation)
      const next = createBrowserView(session, manager.defaultZoom)
      const events = createViewEventStore(manager, next, tabId)
      prepared.push({ tabId, previous, next, events, url: previous.webContents.getURL() })
    }
    if (!manager.ownsWindowGeneration(generation)) throw new Error('Browser window changed during session rebuild')
    if (prepared.some((item) => manager.views.get(item.tabId) !== item.previous)) {
      throw new Error('Browser tabs changed during session rebuild')
    }

    for (const item of prepared) {
      manager.views.replace(item.tabId, item.next, item.events)
      const cachedBrowser = manager.storage.fileBrowserCache.get(item.previous.webContents.id)
      manager.storage.fileBrowserCache.delete(item.previous.webContents.id)
      if (cachedBrowser) manager.storage.fileBrowserCache.set(item.next.webContents.id, cachedBrowser)
      safeDetach(manager, item.previous, 'privacy isolation change')
      item.previous.webContents.close()
      if (manager.getActiveTabId() === item.tabId && manager.window) {
        manager.window.contentView.addChildView(item.next)
        updateViewBounds(item.next, manager.window, manager.sidebarWidth)
        manager.views.activate(item.tabId)
        manager.emitActiveZoom()
      }
      if (item.url) {
        loadViewUrl(manager, item.next, item.tabId, item.url)
      }
    }
  } catch (error) {
    for (const item of prepared) {
      if (manager.views.get(item.tabId) !== item.next) item.events.dispose()
      if (manager.views.get(item.tabId) !== item.next && !item.next.webContents.isDestroyed()) {
        item.next.webContents.close()
      }
    }
    throw error
  }
}

export async function ensureViewIdentity(
  manager: TabViewLifecycleManager,
  tabId: string,
  identity: string,
  navigationEpoch?: number
): Promise<WebContentsView> {
  if (!manager.hasTab(tabId)) throw new Error(`Tab not found: ${tabId}`)
  if (navigationEpoch !== undefined && !manager.ownsNavigation(tabId, navigationEpoch)) {
    throw new Error(`Navigation superseded during identity resolution: ${tabId}`)
  }
  const currentView = manager.views.get(tabId)
  if (currentView && manager.sessions.getTabDomain(tabId) === identity) return currentView

  const generation = manager.captureWindowGeneration()
  const session = await manager.getSessionForDomain(identity)
  if (
    !manager.ownsWindowGeneration(generation) ||
    !manager.hasTab(tabId) ||
    manager.views.get(tabId) !== currentView ||
    (navigationEpoch !== undefined && !manager.ownsNavigation(tabId, navigationEpoch))
  ) {
    throw new Error(`Tab changed during identity resolution: ${tabId}`)
  }

  const nextView = createBrowserView(session, manager.defaultZoom)
  try {
    setupViewEvents(manager, nextView, tabId)
    if (currentView) {
      manager.storage.fileBrowserCache.delete(currentView.webContents.id)
      safeDetach(manager, currentView, 'identity change')
      currentView.webContents.close()
      manager.sessions.cleanupDomainForTab(tabId)
    }
    manager.sessions.setTabDomain(tabId, identity)
    manager.sessions.updateDomainActivity(identity)
    if (manager.getActiveTabId() === tabId && manager.window) {
      manager.window.contentView.addChildView(nextView)
      updateViewBounds(nextView, manager.window, manager.sidebarWidth)
      manager.views.activate(tabId)
      manager.emitActiveZoom()
    }
    return nextView
  } catch (error) {
    if (manager.views.get(tabId) === nextView) manager.views.remove(tabId)
    if (!nextView.webContents.isDestroyed()) nextView.webContents.close()
    throw error
  }
}
