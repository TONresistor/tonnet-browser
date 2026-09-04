/**
 * Tab manager for multi-tab browsing.
 * Creates, switches, and manages WebContentsViews.
 */

import { WebContentsView, BrowserWindow } from 'electron'
import { createBrowserView } from './browser-view'
import { extractDomain, TabSessionManager } from './tabs-session'
import {
  createTabStorageState,
  disposeTabStorageState,
  initStorageListener,
  cancelStorageBrowserLoad,
} from './tabs-storage'
import { updateViewBounds, updateSidebarBounds, invalidateAppearanceCache } from './tabs-bounds'
import type { AppearanceSettings, PrivacySettings } from '../../shared/types'
import { ALLOWED_SCHEMES } from './tabs-security'
import type { TabEventDeps } from './tabs-events'
import type { IDisposable } from '../utils/disposable'
import type { OverlayManager } from './overlay-manager'
import type { ProxyManager } from '../proxy/manager'
import type { StorageManager } from '../storage/daemon'
import type { HistoryManager } from '../history/manager'
import type { PaymentInterceptor } from '../wallet/payment-interceptor'

import { DEFAULT_SETTINGS } from '../../shared/defaults'
import { createLogger } from '../../shared/logger'
import { emitContractToRenderer } from '../events/renderer-events'
import { normalizeUrl } from '../../shared/utils/url'
import { BrowserUrlSchema, pageZoomContract, tabHistoryResetContract } from '../../shared/ipc-contract/browsing'
import { ViewRegistry } from './view-registry'
import { attachViewWhenReady } from './tabs-attach'
import { loadViewUrl, rebuildViewsForIsolation, safeDetach, setupViewEvents } from './tabs-view-lifecycle'
import { loadBagFileFor, loadStorageBagFor } from './tabs-storage-navigation'
import { PageZoomController } from './page-zoom'
import type { WebContentsInputHandler } from './browser-shortcuts'

const log = createLogger('tabs')

/** Owns every mutable resource in the main-process browsing lifecycle. */
export class TabManager {
  readonly sessions = new TabSessionManager()
  readonly storage = createTabStorageState()
  readonly views = new ViewRegistry<WebContentsView>()
  readonly pendingAttachments = new Map<WebContentsView, IDisposable>()
  private mainWindow: BrowserWindow | null = null
  private proxyPort: number = DEFAULT_SETTINGS.proxyPort
  private resizeHandler: (() => void) | null = null
  private storageListenerDisposable: IDisposable | null = null
  private tabEventDeps: TabEventDeps | null = null
  private walletSidebarWidth = 0
  private overlayManager: OverlayManager | null = null
  private sessionsActive = false
  private windowGeneration = 0
  private proxyPortBarrier: Promise<void> = Promise.resolve()
  private proxyPortUpdate: { port: number; flight: Promise<void> } | null = null
  private synchronizedProxyPort: number | null = null
  private readonly pendingSessionCreations = new Set<Promise<Electron.Session>>()
  private readonly navigationEpochByTab = new Map<string, number>()
  private readonly tabIds = new Set<string>()
  private activeTabId: string | null = null
  readonly pageZoom: PageZoomController

  constructor(defaultZoom: number = DEFAULT_SETTINGS.defaultZoom) {
    this.pageZoom = new PageZoomController(
      defaultZoom,
      () => this.getActiveView(),
      () => this.activeTabId,
      (zoom, tabId) => emitContractToRenderer(pageZoomContract, zoom, tabId)
    )
  }

  get window(): BrowserWindow | null {
    return this.mainWindow
  }

  get port(): number {
    return this.proxyPort
  }

  get sidebarWidth(): number {
    return this.walletSidebarWidth
  }

  get overlay(): OverlayManager | null {
    return this.overlayManager
  }

  get eventDependencies(): TabEventDeps {
    if (!this.tabEventDeps) throw new Error('Tab manager event dependencies are not initialized.')
    return this.tabEventDeps
  }

  get defaultZoom(): number {
    return this.pageZoom.defaultZoom
  }

  attachWindow(
    win: BrowserWindow,
    port: number,
    deps: TabManagerDeps,
    handleInput: WebContentsInputHandler = () => undefined
  ): void {
    this.detachWindow()
    this.windowGeneration += 1
    this.mainWindow = win
    this.proxyPort = port
    if (this.synchronizedProxyPort !== port) this.synchronizedProxyPort = null

    this.overlayManager = deps.overlayManager
    this.tabEventDeps = {
      historyManager: deps.historyManager,
      overlayManager: deps.overlayManager,
      storage: this.storage,
      cancelNavigation: (tabId) => this.cancelNavigation(tabId),
      captureNavigation: (tabId, view) => this.captureNavigation(tabId, view),
      handleInput,
    }
    this.sessions.initialize({
      paymentInterceptor: deps.paymentInterceptor,
    })
    this.sessionsActive = true
    this.storage.storageManager = deps.storageManager

    this.storageListenerDisposable?.dispose()
    this.storageListenerDisposable = initStorageListener(this.storage, deps.proxyManager)
    this.resizeHandler = () => {
      const activeView = this.views.getActive()
      if (this.mainWindow && activeView) {
        updateViewBounds(activeView, this.mainWindow, this.walletSidebarWidth)
      }
    }
    this.mainWindow.on('resize', this.resizeHandler)
  }

  captureWindowGeneration(): number {
    return this.windowGeneration
  }

  ownsWindowGeneration(generation: number): boolean {
    return this.mainWindow !== null && this.windowGeneration === generation
  }

  async getSessionForDomain(domain: string, firstPartyIsolation?: boolean): Promise<Electron.Session> {
    while (true) {
      let barrier = this.proxyPortBarrier
      await barrier
      if (barrier !== this.proxyPortBarrier) continue
      const creation = this.sessions.getSessionForDomain(domain, this.proxyPort, firstPartyIsolation)
      this.pendingSessionCreations.add(creation)
      try {
        const session = await creation
        while (barrier !== this.proxyPortBarrier) {
          barrier = this.proxyPortBarrier
          await barrier
        }
        return session
      } finally {
        this.pendingSessionCreations.delete(creation)
      }
    }
  }

  updateProxyPort(port: number): Promise<void> {
    if (this.proxyPortUpdate?.port === port) return this.proxyPortUpdate.flight
    if (!this.proxyPortUpdate && this.synchronizedProxyPort === port) return this.proxyPortBarrier
    this.proxyPort = port
    this.synchronizedProxyPort = null
    const update = this.proxyPortBarrier
      .catch(() => undefined)
      .then(async () => {
        await Promise.allSettled([...this.pendingSessionCreations])
        await this.sessions.updateProxyPort(port)
        this.synchronizedProxyPort = port
      })
    this.proxyPortBarrier = update
    this.proxyPortUpdate = { port, flight: update }
    update.then(
      () => {
        if (this.proxyPortUpdate?.flight === update) this.proxyPortUpdate = null
      },
      () => {
        if (this.proxyPortUpdate?.flight === update) this.proxyPortUpdate = null
      }
    )
    return update
  }

  updateSidebarWidth(width: number): void {
    const activeView = this.getActiveView()
    if (!activeView || !this.mainWindow) return
    updateSidebarBounds(activeView, this.mainWindow, width)
  }

  updateWalletSidebarWidth(width: number): void {
    this.walletSidebarWidth = width
    if (!this.mainWindow) return
    for (const view of this.mainWindow.contentView.children) {
      if (view instanceof WebContentsView) updateViewBounds(view, this.mainWindow, this.walletSidebarWidth)
    }
  }

  onAppearanceSettingsChanged(settings?: AppearanceSettings): void {
    invalidateAppearanceCache()
    const activeView = this.getActiveView()
    if (activeView && this.mainWindow) updateViewBounds(activeView, this.mainWindow, this.walletSidebarWidth, settings)
  }

  applyDefaultZoom(defaultZoom: number): void {
    this.pageZoom.applyDefault(defaultZoom, this.views.values())
  }

  emitActiveZoom(): void {
    this.pageZoom.emit()
  }

  async onPrivacySettingsChanged(previous: PrivacySettings, current: PrivacySettings): Promise<void> {
    if (previous.firstPartyIsolation !== current.firstPartyIsolation) {
      await rebuildViewsForIsolation(this, current.firstPartyIsolation ?? true)
    }
    this.sessions.onPrivacySettingsChanged(current)
  }

  createTab(tabId: string, initialUrl?: string): Promise<boolean> {
    return createTabFor(this, tabId, initialUrl)
  }

  hasTab(tabId: string): boolean {
    return this.tabIds.has(tabId)
  }

  registerTab(tabId: string): boolean {
    if (this.tabIds.has(tabId)) return false
    this.tabIds.add(tabId)
    return true
  }

  unregisterTab(tabId: string): void {
    this.tabIds.delete(tabId)
    if (this.activeTabId === tabId) this.activeTabId = null
  }

  activateTab(tabId: string): boolean {
    if (!this.tabIds.has(tabId)) return false
    this.activeTabId = tabId
    return true
  }

  clearTabs(): void {
    this.tabIds.clear()
    this.activeTabId = null
  }

  closeTab(tabId: string): boolean {
    return closeTabFor(this, tabId)
  }

  switchTab(tabId: string): boolean {
    return switchTabFor(this, tabId)
  }

  getActiveView(): WebContentsView | null {
    return this.activeTabId ? this.views.get(this.activeTabId) : null
  }

  getActiveTabId(): string | null {
    return this.activeTabId
  }

  reloadActivePage(ignoreCache: boolean): boolean {
    const view = this.getActiveView()
    if (!view || view.webContents.isDestroyed()) return false
    if (this.activeTabId) this.cancelNavigation(this.activeTabId)
    if (ignoreCache) view.webContents.reloadIgnoringCache()
    else view.webContents.reload()
    return true
  }

  stopActivePage(): boolean {
    const view = this.getActiveView()
    if (!view || view.webContents.isDestroyed()) return false
    if (this.activeTabId) this.cancelNavigation(this.activeTabId)
    view.webContents.stop()
    return true
  }

  resolveSenderIdentity(sender: Electron.WebContents): string | null {
    for (const [tabId, { view }] of this.views.entries()) {
      if (view.webContents === sender) return this.sessions.getTabDomain(tabId) ?? null
    }
    return null
  }

  hideAllViews(tabId?: string): void {
    hideAllViewsFor(this, tabId)
  }

  showActiveView(): void {
    showActiveViewFor(this)
  }

  navigateInTab(tabId: string, url: string): Promise<boolean> {
    return navigateInTabFor(this, tabId, url)
  }

  beginNavigation(tabId: string): number {
    const view = this.views.get(tabId)
    if (view) {
      this.pendingAttachments.get(view)?.dispose()
      cancelStorageBrowserLoad(this.storage, view.webContents.id)
    }
    const epoch = (this.navigationEpochByTab.get(tabId) ?? 0) + 1
    this.navigationEpochByTab.set(tabId, epoch)
    return epoch
  }

  ownsNavigation(tabId: string, epoch: number): boolean {
    return this.navigationEpochByTab.get(tabId) === epoch
  }

  captureNavigation(tabId: string, view: WebContentsView): () => boolean {
    const generation = this.captureWindowGeneration()
    const epoch = this.navigationEpochByTab.get(tabId)
    return () =>
      this.ownsWindowGeneration(generation) &&
      this.hasTab(tabId) &&
      this.views.get(tabId) === view &&
      !view.webContents.isDestroyed() &&
      this.navigationEpochByTab.get(tabId) === epoch
  }

  cancelNavigation(tabId: string): void {
    this.beginNavigation(tabId)
  }

  forgetNavigation(tabId?: string): void {
    if (tabId) this.navigationEpochByTab.delete(tabId)
    else this.navigationEpochByTab.clear()
  }

  loadStorageBag(tabId: string, bagId: string): Promise<void> {
    return loadStorageBagFor(this, tabId, bagId)
  }

  loadBagFile(tabId: string, bagId: string, relativePath: string): Promise<void> {
    return loadBagFileFor(this, tabId, bagId, relativePath)
  }

  dispose(): void {
    this.detachWindow()
    if (this.sessionsActive) {
      this.sessions.dispose()
      this.sessionsActive = false
    }
  }

  detachWindow(win?: BrowserWindow): void {
    if (!this.mainWindow || (win && this.mainWindow !== win)) return
    this.windowGeneration += 1
    cleanupTabViewsFor(this)
    this.storageListenerDisposable?.dispose()
    this.storageListenerDisposable = null
    this.detachResizeHandler()
    this.walletSidebarWidth = 0
    this.mainWindow = null
    this.overlayManager = null
    this.tabEventDeps = null
    this.sessions.detachWindow()
    disposeTabStorageState(this.storage)
  }

  private detachResizeHandler(): void {
    if (this.resizeHandler && this.mainWindow) this.mainWindow.off('resize', this.resizeHandler)
    this.resizeHandler = null
  }
}

/** Dependencies needed to initialize the tab manager */
export interface TabManagerDeps {
  overlayManager: OverlayManager
  proxyManager: ProxyManager
  storageManager: StorageManager
  historyManager: HistoryManager
  paymentInterceptor: PaymentInterceptor
}

async function createTabFor(manager: TabManager, tabId: string, initialUrl?: string): Promise<boolean> {
  if (!manager.window) return false
  if (!manager.registerTab(tabId)) return false
  if (!initialUrl || initialUrl.startsWith('ton://')) return manager.switchTab(tabId)
  const generation = manager.captureWindowGeneration()
  let createdView: WebContentsView | null = null

  try {
    const domain = initialUrl ? extractDomain(initialUrl) : 'default'
    const session = await manager.getSessionForDomain(domain)
    if (!manager.ownsWindowGeneration(generation) || !manager.hasTab(tabId) || manager.views.has(tabId)) return false

    createdView = createBrowserView(session, manager.defaultZoom)
    setupViewEvents(manager, createdView, tabId)
    manager.sessions.setTabDomain(tabId, domain)

    if (!manager.switchTab(tabId)) {
      manager.views.remove(tabId)
      createdView.webContents.close()
      manager.unregisterTab(tabId)
      return false
    }

    return true
  } catch (error) {
    log.error(`Failed to create tab ${tabId}:`, error)
    if (createdView && manager.views.get(tabId) === createdView) manager.views.remove(tabId)
    if (createdView && !createdView.webContents.isDestroyed()) createdView.webContents.close()
    manager.unregisterTab(tabId)
    return false
  }
}

function closeTabFor(manager: TabManager, tabId: string): boolean {
  const view = manager.views.get(tabId)
  if (!manager.hasTab(tabId)) return false

  if (view) {
    manager.storage.fileBrowserCache.delete(view.webContents.id)
    safeDetach(manager, view, 'closeTab')
    view.webContents.close()
    manager.views.remove(tabId)
  }

  manager.sessions.cleanupDomainForTab(tabId)
  manager.forgetNavigation(tabId)
  manager.unregisterTab(tabId)

  return true
}

function switchTabFor(manager: TabManager, tabId: string): boolean {
  if (!manager.window) return false
  manager.overlay?.hideAll()
  if (!manager.hasTab(tabId)) return false

  const view = manager.views.get(tabId)

  const currentView = manager.getActiveView()
  if (currentView) {
    safeDetach(manager, currentView, 'switchTab')
  }
  manager.activateTab(tabId)
  if (view) {
    manager.window.contentView.addChildView(view)
    updateViewBounds(view, manager.window, manager.sidebarWidth)
    manager.views.activate(tabId)
  } else {
    manager.views.deactivate()
  }
  manager.emitActiveZoom()

  return true
}

function hideAllViewsFor(manager: TabManager, tabId?: string): void {
  if (!manager.window) return
  const targetTabId = tabId ?? manager.getActiveTabId()
  if (targetTabId) manager.cancelNavigation(targetTabId)
  manager.overlay?.hideAll()

  const activeView = manager.views.getActive()
  if (activeView) {
    safeDetach(manager, activeView, 'hideAllViews')
  }
}

function showActiveViewFor(manager: TabManager): void {
  if (!manager.window) return
  const view = manager.getActiveView()
  if (view) {
    manager.window.contentView.addChildView(view)
    updateViewBounds(view, manager.window, manager.sidebarWidth)
  }
}

function cleanupTabViewsFor(manager: TabManager): void {
  manager.hideAllViews()

  for (const [, { view }] of manager.views.entries()) {
    safeDetach(manager, view)
    view.webContents.close()
  }
  manager.views.clear()
  manager.clearTabs()
  manager.forgetNavigation()
}

async function navigateInTabFor(manager: TabManager, tabId: string, url: string): Promise<boolean> {
  if (!manager.hasTab(tabId)) return false
  const generation = manager.captureWindowGeneration()

  let navigateUrl = url
  if (
    !url.startsWith('http://') &&
    !url.startsWith('https://') &&
    !url.startsWith('ton://') &&
    !url.startsWith('tonsite://')
  ) {
    navigateUrl = `http://${url}`
  }

  navigateUrl = normalizeUrl(navigateUrl)

  if (!BrowserUrlSchema.safeParse(navigateUrl).success) {
    log.error('Invalid navigation URL')
    return false
  }

  try {
    const parsed = new URL(navigateUrl)
    if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
      log.error(`Blocked navigation to unsafe scheme: ${parsed.protocol}`)
      return false
    }
  } catch {
    log.error(`Invalid URL: ${navigateUrl}`)
    return false
  }

  const navigationEpoch = manager.beginNavigation(tabId)

  const domain = extractDomain(navigateUrl)
  let view = manager.views.get(tabId)
  if (!view) {
    let session: Electron.Session
    try {
      session = await manager.getSessionForDomain(domain)
    } catch (error) {
      log.error(`Failed to create session for ${domain}:`, error)
      return false
    }
    if (
      !manager.ownsWindowGeneration(generation) ||
      !manager.ownsNavigation(tabId, navigationEpoch) ||
      !manager.hasTab(tabId)
    )
      return false
    try {
      view = createBrowserView(session, manager.defaultZoom)
      setupViewEvents(manager, view, tabId)
      manager.sessions.setTabDomain(tabId, domain)
      manager.sessions.updateDomainActivity(domain)
      if (manager.getActiveTabId() === tabId) {
        manager.views.activate(tabId)
        manager.emitActiveZoom()
        attachViewWhenReady(manager, view, tabId, generation)
      }
      loadViewUrl(manager, view, tabId, navigateUrl)
      return true
    } catch (error) {
      if (view && manager.views.get(tabId) === view) manager.views.remove(tabId)
      if (view && !view.webContents.isDestroyed()) view.webContents.close()
      log.error(`Failed to create view for ${domain}:`, error)
      return false
    }
  }
  const currentDomain = manager.sessions.getTabDomain(tabId)

  if (currentDomain && currentDomain !== domain) {
    log.debug('Domain changed, recreating view')

    let newSession: Electron.Session
    try {
      newSession = await manager.getSessionForDomain(domain)
    } catch (error) {
      log.error(`Failed to create session for ${domain}:`, error)
      return false
    }
    if (
      !manager.ownsWindowGeneration(generation) ||
      !manager.ownsNavigation(tabId, navigationEpoch) ||
      manager.views.get(tabId) !== view
    )
      return false

    let newView: WebContentsView | undefined
    try {
      newView = createBrowserView(newSession, manager.defaultZoom)
      setupViewEvents(manager, newView, tabId)
    } catch (error) {
      if (newView && !newView.webContents.isDestroyed()) newView.webContents.close()
      log.error(`Failed to create view for ${domain}:`, error)
      return false
    }
    safeDetach(manager, view, 'domain change')
    view.webContents.close()
    manager.sessions.setTabDomain(tabId, domain)
    manager.sessions.updateDomainActivity(domain)
    emitContractToRenderer(tabHistoryResetContract, tabId, navigateUrl)

    if (manager.views.activeViewId === tabId) {
      manager.emitActiveZoom()
      attachViewWhenReady(manager, newView, tabId, generation)
    }

    loadViewUrl(manager, newView, tabId, navigateUrl)
  } else {
    manager.sessions.setTabDomain(tabId, domain)
    manager.sessions.updateDomainActivity(domain)

    if (manager.views.activeViewId === tabId && manager.window) {
      safeDetach(manager, view, 'same-domain navigate')
      manager.window.contentView.addChildView(view)
      updateViewBounds(view, manager.window, manager.sidebarWidth)
    }

    loadViewUrl(manager, view, tabId, navigateUrl)
  }

  return true
}
