import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  sessions,
  createBrowserView,
  extractDomain,
  initStorageListener,
  setupSecurityHandlers,
  emitContractToRenderer,
  firstStorageDispose,
  secondStorageDispose,
} = vi.hoisted(() => ({
  sessions: {
    initialize: vi.fn(),
    detachWindow: vi.fn(),
    dispose: vi.fn(),
    updateProxyPort: vi.fn(() => Promise.resolve()),
    getSessionForDomain: vi.fn(),
    updateDomainActivity: vi.fn(),
    setTabDomain: vi.fn(),
    getTabDomain: vi.fn(),
    cleanupDomainForTab: vi.fn(),
    getAllSessions: vi.fn(() => []),
    onPrivacySettingsChanged: vi.fn(),
  },
  createBrowserView: vi.fn(),
  extractDomain: vi.fn((url: string) => new URL(url).hostname),
  initStorageListener: vi.fn(),
  setupSecurityHandlers: vi.fn((_view: unknown, _tabId: string, _handoff?: (url: string) => boolean) => ({
    dispose: vi.fn(),
  })),
  emitContractToRenderer: vi.fn(),
  firstStorageDispose: vi.fn(),
  secondStorageDispose: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: class {},
}))
vi.mock('../browser-view', () => ({ createBrowserView, extractFavicon: vi.fn(async () => null) }))
vi.mock('../tabs-session', () => ({
  extractDomain,
  TabSessionManager: vi.fn(function () {
    return sessions
  }),
}))
vi.mock('../tabs-storage', () => ({
  loadStorageBag: vi.fn(),
  loadErrorPage: vi.fn(),
  createTabStorageState: vi.fn(() => ({
    storageManager: null,
    storageBagCache: new Map(),
    storageBrowserLoading: new Set(),
    storageBrowserEpochs: new Map(),
    fileBrowserCache: new Map(),
  })),
  disposeTabStorageState: vi.fn(),
  initStorageListener,
  resolveBagFilePath: vi.fn(),
  cancelStorageBrowserLoad: vi.fn(),
}))
vi.mock('../tabs-bounds', () => ({
  updateViewBounds: vi.fn(),
  updateSidebarBounds: vi.fn(),
  invalidateAppearanceCache: vi.fn(),
}))
vi.mock('../tabs-security', () => ({
  setupSecurityHandlers,
  ALLOWED_SCHEMES: ['http:', 'https:'],
}))
vi.mock('../tabs-events', () => ({ setupViewEventListeners: vi.fn(() => ({ dispose: vi.fn() })) }))
vi.mock('../../events/renderer-events', () => ({ emitContractToRenderer }))

import { TabManager } from '../tabs'
import { DisposableStore } from '../../utils/disposable'
import { ensureViewIdentity } from '../tabs-view-lifecycle'
import { loadErrorPage } from '../tabs-storage'

class WindowMock extends EventEmitter {
  contentView = {
    children: [] as unknown[],
    addChildView: vi.fn((view: unknown) => this.contentView.children.push(view)),
    removeChildView: vi.fn((view: unknown) => {
      this.contentView.children = this.contentView.children.filter((candidate) => candidate !== view)
    }),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createView(id: number) {
  const webContents = Object.assign(new EventEmitter(), {
    id,
    close: vi.fn(),
    stop: vi.fn(),
    getURL: vi.fn(() => ''),
    getTitle: vi.fn(() => 'Retained page'),
    isLoading: vi.fn(() => false),
    navigationHistory: { canGoBack: vi.fn(() => false), canGoForward: vi.fn(() => false) },
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(() => Promise.resolve()),
    getZoomFactor: vi.fn(() => 1),
    setZoomFactor: vi.fn(),
  })
  return { webContents }
}

const deps = {
  overlayManager: { hideAll: vi.fn() },
  proxyManager: {},
  storageManager: {},
  historyManager: {},
  paymentInterceptor: {},
} as never

describe('TabManager lifecycle ownership', () => {
  it('reveals a retained document without destroying native forward history', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    manager.attachWindow(window as never, 8080, deps)
    await manager.createTab('tab-1', 'http://first.ton')
    const view = manager.getActiveView()!
    vi.mocked(view.webContents.getURL).mockReturnValue('http://first.ton/')
    vi.mocked(view.webContents.navigationHistory.canGoForward).mockReturnValue(true)
    sessions.getTabDomain.mockReturnValue('first.ton')
    manager.hideAllViews('tab-1')
    await manager.navigateInTab('tab-1', 'http://first.ton')
    expect(view.webContents.loadURL).not.toHaveBeenCalled()
    expect(emitContractToRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'page:title' }),
      'Retained page',
      'tab-1'
    )
    expect(window.contentView.children).toContain(view)
    expect(emitContractToRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'page:navigate' }),
      expect.objectContaining({ canGoForward: true })
    )
    manager.dispose()
  })

  it('reattaches after did-start-navigation followed by same-domain handoff, and after Stop', async () => {
    vi.useFakeTimers()
    const window = new WindowMock()
    const manager = new TabManager()
    manager.attachWindow(window as never, 8080, deps)
    await manager.createTab('tab-1', 'http://first.ton')
    const view = manager.getActiveView()!
    sessions.getTabDomain.mockReturnValue('first.ton')
    const navigation = { url: 'http://first.ton/next', isMainFrame: true, isSameDocument: false }
    view.webContents.emit('did-start-navigation', navigation)
    expect(window.contentView.children).not.toContain(view)
    const handoff = setupSecurityHandlers.mock.calls.at(-1)?.[2]
    expect(handoff?.(navigation.url)).toBe(false)
    view.webContents.emit('dom-ready')
    vi.advanceTimersByTime(150)
    expect(window.contentView.children).toContain(view)
    view.webContents.emit('did-start-navigation', navigation)
    expect(window.contentView.children).not.toContain(view)
    expect(manager.stopActivePage()).toBe(true)
    expect(window.contentView.children).toContain(view)
    manager.hideAllViews('tab-1')
    expect(manager.stopActivePage()).toBe(false)
    expect(window.contentView.children).not.toContain(view)
    manager.dispose()
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    sessions.getSessionForDomain.mockReset()
    sessions.updateProxyPort.mockReset().mockResolvedValue(undefined)
    createBrowserView.mockReset()
    setupSecurityHandlers.mockReset()
    initStorageListener.mockReset()
    sessions.getTabDomain.mockReturnValue(undefined)
    sessions.getSessionForDomain.mockResolvedValue({})
    createBrowserView.mockImplementation(() => createView(1))
    setupSecurityHandlers.mockImplementation((_view, _tabId, _handoff) => ({ dispose: vi.fn() }))
    initStorageListener
      .mockReturnValueOnce({ dispose: firstStorageDispose })
      .mockReturnValueOnce({ dispose: secondStorageDispose })
  })

  it.each(['ERR_ABORTED (-3)', 'ERR_CONNECTION_REFUSED'])('ignores obsolete load rejection: %s', async (message) => {
    const manager = new TabManager()
    manager.attachWindow(new WindowMock() as never, 8080, deps)
    manager.registerTab('tab-1')
    const view = createView(1)
    let reject!: (error: Error) => void
    view.webContents.loadURL.mockReturnValueOnce(
      new Promise<void>((_resolve, fail) => {
        reject = fail
      })
    )
    manager.views.add('tab-1', view as never, new DisposableStore())
    sessions.getTabDomain.mockReturnValue('first.ton')
    await manager.navigateInTab('tab-1', 'http://first.ton/old')
    await manager.navigateInTab('tab-1', 'http://first.ton/new')
    reject(new Error(message))
    await Promise.resolve()
    expect(loadErrorPage).not.toHaveBeenCalled()
    manager.dispose()
  })

  it('invalidates pending load recovery on Stop and on tab close', async () => {
    const manager = new TabManager()
    manager.attachWindow(new WindowMock() as never, 8080, deps)
    manager.registerTab('tab-1')
    const view = createView(1)
    manager.views.add('tab-1', view as never, new DisposableStore())
    const owns = manager.captureNavigation('tab-1', view as never)
    expect(owns()).toBe(true)
    manager.cancelNavigation('tab-1')
    expect(owns()).toBe(false)
    const afterStop = manager.captureNavigation('tab-1', view as never)
    manager.closeTab('tab-1')
    expect(afterStop()).toBe(false)
    manager.dispose()
  })

  it('reattaches without retaining views or listeners from the previous window', () => {
    const firstWindow = new WindowMock()
    const secondWindow = new WindowMock()
    const manager = new TabManager()
    const close = vi.fn()

    manager.attachWindow(firstWindow as never, 8080, deps)
    manager.views.add('first-tab', { webContents: { close, id: 1 } } as never, new DisposableStore())
    expect(firstWindow.listenerCount('resize')).toBe(1)

    manager.attachWindow(secondWindow as never, 8081, deps)
    expect(firstWindow.listenerCount('resize')).toBe(0)
    expect(secondWindow.listenerCount('resize')).toBe(1)
    expect(firstStorageDispose).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(manager.views.size).toBe(0)
    expect(manager.port).toBe(8081)

    manager.detachWindow(firstWindow as never)
    expect(manager.window).toBe(secondWindow)

    manager.detachWindow(secondWindow as never)
    expect(secondWindow.listenerCount('resize')).toBe(0)
    expect(secondStorageDispose).toHaveBeenCalledOnce()
    expect(manager.window).toBeNull()
  })

  it('keeps attach and detach idempotent and supports a fresh window', () => {
    const window = new WindowMock()
    const nextWindow = new WindowMock()
    const manager = new TabManager()
    manager.attachWindow(window as never, 8080, deps)
    manager.detachWindow(window as never)
    manager.detachWindow(window as never)
    manager.attachWindow(nextWindow as never, 8081, deps)

    expect(window.listenerCount('resize')).toBe(0)
    expect(nextWindow.listenerCount('resize')).toBe(1)
    expect(sessions.initialize).toHaveBeenCalledTimes(2)
    expect(sessions.detachWindow).toHaveBeenCalledOnce()
    expect(sessions.dispose).not.toHaveBeenCalled()
  })

  it('does not create a tab in a replacement window after deferred session creation', async () => {
    const firstWindow = new WindowMock()
    const secondWindow = new WindowMock()
    const manager = new TabManager()
    const session = deferred<object>()
    sessions.getSessionForDomain.mockReturnValueOnce(session.promise)

    manager.attachWindow(firstWindow as never, 8080, deps)
    const creation = manager.createTab('tab-1', 'http://first.ton')
    manager.detachWindow(firstWindow as never)
    manager.attachWindow(secondWindow as never, 8080, deps)
    session.resolve({})

    await expect(creation).resolves.toBe(false)
    expect(createBrowserView).not.toHaveBeenCalled()
    expect(manager.views.size).toBe(0)
    expect(secondWindow.contentView.addChildView).not.toHaveBeenCalled()
  })

  it('does not complete a deferred domain navigation in a replacement window', async () => {
    const firstWindow = new WindowMock()
    const secondWindow = new WindowMock()
    const manager = new TabManager()
    const oldView = createView(1)
    const session = deferred<object>()
    sessions.getTabDomain.mockReturnValue('first.ton')
    sessions.getSessionForDomain.mockReturnValueOnce(session.promise)

    manager.attachWindow(firstWindow as never, 8080, deps)
    manager.registerTab('tab-1')
    manager.views.add('tab-1', oldView as never, new DisposableStore())
    manager.switchTab('tab-1')
    const navigation = manager.navigateInTab('tab-1', 'http://second.ton')
    manager.detachWindow(firstWindow as never)
    manager.attachWindow(secondWindow as never, 8080, deps)
    session.resolve({})

    await expect(navigation).resolves.toBe(false)
    expect(createBrowserView).not.toHaveBeenCalled()
    expect(manager.views.size).toBe(0)
    expect(secondWindow.contentView.addChildView).not.toHaveBeenCalled()
  })

  it('hands page navigation to a target-domain session before replacing the old view', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    const oldView = createView(1)
    const newView = createView(2)
    const targetSession = deferred<object>()
    const firstSession = { id: 'first' }
    const secondSession = { id: 'second' }
    sessions.getSessionForDomain.mockResolvedValueOnce(firstSession).mockReturnValueOnce(targetSession.promise)
    createBrowserView.mockReturnValueOnce(oldView).mockReturnValueOnce(newView)
    manager.attachWindow(window as never, 8080, deps)
    await expect(manager.createTab('tab-1', 'http://first.ton')).resolves.toBe(true)
    sessions.getTabDomain.mockReturnValue('first.ton')

    const handoff = setupSecurityHandlers.mock.calls[0]?.[2] as ((url: string) => boolean) | undefined
    expect(handoff?.('http://second.ton/page')).toBe(true)
    await vi.waitFor(() => expect(sessions.getSessionForDomain).toHaveBeenCalledTimes(2))
    expect(oldView.webContents.close).not.toHaveBeenCalled()

    targetSession.resolve(secondSession)
    await vi.waitFor(() => expect(createBrowserView).toHaveBeenCalledTimes(2))

    expect(createBrowserView).toHaveBeenLastCalledWith(secondSession, 100)
    expect(manager.views.get('tab-1')).toBe(newView)
    expect(sessions.setTabDomain).toHaveBeenLastCalledWith('tab-1', 'second.ton')
    expect(oldView.webContents.close).toHaveBeenCalledOnce()
    expect(emitContractToRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'tab:history-reset' }),
      'tab-1',
      'http://second.ton/page'
    )
  })

  it('keeps the old view when target session creation fails', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    const oldView = createView(1)
    sessions.getTabDomain.mockReturnValue('first.ton')
    sessions.getSessionForDomain.mockRejectedValueOnce(new Error('session failed'))
    manager.attachWindow(window as never, 8080, deps)
    manager.registerTab('tab-1')
    manager.views.add('tab-1', oldView as never, new DisposableStore())
    manager.switchTab('tab-1')

    await expect(manager.navigateInTab('tab-1', 'http://second.ton')).resolves.toBe(false)

    expect(manager.views.get('tab-1')).toBe(oldView)
    expect(oldView.webContents.close).not.toHaveBeenCalled()
    expect(createBrowserView).not.toHaveBeenCalled()
  })

  it('lets only the latest deferred cross-domain navigation replace the view', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    const oldView = createView(1)
    const newView = createView(2)
    const secondSession = deferred<object>()
    const thirdSession = deferred<object>()
    sessions.getTabDomain.mockReturnValue('first.ton')
    sessions.getSessionForDomain.mockReturnValueOnce(secondSession.promise).mockReturnValueOnce(thirdSession.promise)
    createBrowserView.mockReturnValueOnce(newView)
    manager.attachWindow(window as never, 8080, deps)
    manager.registerTab('tab-1')
    manager.views.add('tab-1', oldView as never, new DisposableStore())
    manager.switchTab('tab-1')

    const secondNavigation = manager.navigateInTab('tab-1', 'http://second.ton')
    const thirdNavigation = manager.navigateInTab('tab-1', 'http://third.ton')
    secondSession.resolve({ id: 'second' })
    await expect(secondNavigation).resolves.toBe(false)
    expect(createBrowserView).not.toHaveBeenCalled()

    const latestSession = { id: 'third' }
    thirdSession.resolve(latestSession)
    await expect(thirdNavigation).resolves.toBe(true)

    expect(createBrowserView).toHaveBeenCalledOnce()
    expect(createBrowserView).toHaveBeenCalledWith(latestSession, 100)
    expect(sessions.setTabDomain).toHaveBeenLastCalledWith('tab-1', 'third.ton')
    expect(oldView.webContents.close).toHaveBeenCalledOnce()
  })

  it('does not replace a view changed during deferred identity resolution', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    const oldView = createView(1)
    const navigatedView = createView(2)
    const identityView = createView(3)
    const identitySession = deferred<object>()
    let identity = 'first.ton'
    sessions.getTabDomain.mockImplementation(() => identity)
    sessions.setTabDomain.mockImplementation((_tabId, nextIdentity) => {
      identity = nextIdentity
    })
    sessions.getSessionForDomain.mockReturnValueOnce(identitySession.promise).mockResolvedValueOnce({})
    createBrowserView.mockReturnValueOnce(navigatedView).mockReturnValueOnce(identityView)
    manager.attachWindow(window as never, 8080, deps)
    manager.registerTab('tab-1')
    manager.views.add('tab-1', oldView as never, new DisposableStore())
    manager.switchTab('tab-1')

    const identityChange = ensureViewIdentity(manager, 'tab-1', 'bag:abc')
    await expect(manager.navigateInTab('tab-1', 'http://second.ton')).resolves.toBe(true)
    identitySession.resolve({})

    await expect(identityChange).rejects.toThrow('Tab changed during identity resolution')
    expect(manager.views.get('tab-1')).toBe(navigatedView)
    expect(navigatedView.webContents.close).not.toHaveBeenCalled()
    expect(identityView.webContents.close).not.toHaveBeenCalled()
  })

  it('cancels a deferred handoff when a later same-domain navigation starts', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    const oldView = createView(1)
    const targetSession = deferred<object>()
    sessions.getSessionForDomain.mockResolvedValueOnce({}).mockReturnValueOnce(targetSession.promise)
    createBrowserView.mockReturnValueOnce(oldView)
    manager.attachWindow(window as never, 8080, deps)
    await manager.createTab('tab-1', 'http://first.ton')
    sessions.getTabDomain.mockReturnValue('first.ton')
    const handoff = setupSecurityHandlers.mock.calls[0][2]
    const navigate = vi.spyOn(manager, 'navigateInTab')

    expect(handoff?.('http://second.ton')).toBe(true)
    await vi.waitFor(() => expect(sessions.getSessionForDomain).toHaveBeenCalledTimes(2))
    const pendingNavigation = navigate.mock.results[0].value
    expect(handoff?.('http://first.ton/latest')).toBe(false)
    targetSession.resolve({})
    await expect(pendingNavigation).resolves.toBe(false)

    expect(manager.views.get('tab-1')).toBe(oldView)
    expect(createBrowserView).toHaveBeenCalledOnce()
  })

  it('cancels a deferred handoff when an internal page supersedes it', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    const oldView = createView(1)
    const targetSession = deferred<object>()
    sessions.getTabDomain.mockReturnValue('first.ton')
    sessions.getSessionForDomain.mockReturnValueOnce(targetSession.promise)
    manager.attachWindow(window as never, 8080, deps)
    manager.registerTab('tab-1')
    manager.views.add('tab-1', oldView as never, new DisposableStore())
    manager.switchTab('tab-1')

    const navigation = manager.navigateInTab('tab-1', 'http://second.ton')
    manager.hideAllViews('tab-1')
    targetSession.resolve({})

    await expect(navigation).resolves.toBe(false)
    expect(manager.views.get('tab-1')).toBe(oldView)
    expect(oldView.webContents.close).not.toHaveBeenCalled()
    expect(createBrowserView).not.toHaveBeenCalled()
  })

  it('keeps the old view when replacement listener setup fails', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    const oldView = createView(1)
    const newView = createView(2)
    sessions.getTabDomain.mockReturnValue('first.ton')
    sessions.getSessionForDomain.mockResolvedValueOnce({})
    createBrowserView.mockReturnValueOnce(newView)
    setupSecurityHandlers.mockImplementationOnce(() => {
      throw new Error('listener setup failed')
    })
    manager.attachWindow(window as never, 8080, deps)
    manager.registerTab('tab-1')
    manager.views.add('tab-1', oldView as never, new DisposableStore())
    manager.switchTab('tab-1')

    await expect(manager.navigateInTab('tab-1', 'http://second.ton')).resolves.toBe(false)

    expect(manager.views.get('tab-1')).toBe(oldView)
    expect(oldView.webContents.close).not.toHaveBeenCalled()
    expect(newView.webContents.close).toHaveBeenCalledOnce()
  })

  it('attaches a replacement when its tab becomes active during session creation', async () => {
    vi.useFakeTimers()
    try {
      const window = new WindowMock()
      const manager = new TabManager()
      const oldView = createView(1)
      const otherView = createView(2)
      const newView = createView(3)
      const targetSession = deferred<object>()
      sessions.getTabDomain.mockReturnValue('first.ton')
      sessions.getSessionForDomain.mockReturnValueOnce(targetSession.promise)
      createBrowserView.mockReturnValueOnce(newView)
      manager.attachWindow(window as never, 8080, deps)
      manager.registerTab('tab-1')
      manager.registerTab('tab-2')
      manager.views.add('tab-1', oldView as never, new DisposableStore())
      manager.views.add('tab-2', otherView as never, new DisposableStore())
      manager.switchTab('tab-2')

      const navigation = manager.navigateInTab('tab-1', 'http://second.ton')
      manager.switchTab('tab-1')
      targetSession.resolve({})
      await expect(navigation).resolves.toBe(true)
      newView.webContents.emit('dom-ready')
      await vi.advanceTimersByTimeAsync(150)

      expect(window.contentView.children).toContain(newView)
      expect(window.contentView.children).not.toContain(oldView)
    } finally {
      vi.useRealTimers()
    }
  })

  it('updates the runtime proxy port without reattaching or destroying the window', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    const view = createView(1)

    manager.attachWindow(window as never, 8080, deps)
    manager.views.add('tab-1', view as never, new DisposableStore())

    await manager.updateProxyPort(9090)

    expect(manager.port).toBe(9090)
    expect(sessions.updateProxyPort).toHaveBeenCalledWith(9090)
    expect(manager.window).toBe(window)
    expect(window.listenerCount('resize')).toBe(1)
    expect(view.webContents.close).not.toHaveBeenCalled()
    expect(firstStorageDispose).not.toHaveBeenCalled()
  })

  it('does not release a session while its proxy port update is pending', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    const session = deferred<object>()
    const portUpdate = deferred<void>()
    sessions.getSessionForDomain.mockReturnValueOnce(session.promise)
    sessions.updateProxyPort.mockReturnValueOnce(portUpdate.promise)
    manager.attachWindow(window as never, 8080, deps)

    const pendingSession = manager.getSessionForDomain('first.ton')
    await vi.waitFor(() => expect(sessions.getSessionForDomain).toHaveBeenCalledOnce())
    const firstUpdate = manager.updateProxyPort(9090)
    const sharedUpdate = manager.updateProxyPort(9090)
    session.resolve({})
    await vi.waitFor(() => expect(sessions.updateProxyPort).toHaveBeenCalledWith(9090))

    let released = false
    void pendingSession.then(() => {
      released = true
    })
    await Promise.resolve()
    expect(released).toBe(false)
    expect(sharedUpdate).toBe(firstUpdate)

    portUpdate.resolve()
    await firstUpdate
    await expect(pendingSession).resolves.toEqual({})
  })

  it('propagates a proxy port update failure and allows a retry', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    sessions.updateProxyPort.mockRejectedValueOnce(new Error('proxy update failed'))
    manager.attachWindow(window as never, 8080, deps)

    await expect(manager.updateProxyPort(9090)).rejects.toThrow('proxy update failed')
    await expect(manager.updateProxyPort(9090)).resolves.toBeUndefined()

    expect(sessions.updateProxyPort).toHaveBeenCalledTimes(2)
  })
})
