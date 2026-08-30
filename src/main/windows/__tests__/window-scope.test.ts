import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const contextMenuDispose = vi.fn()

vi.mock('../main-context-menu', () => ({
  setupMainContextMenu: vi.fn(() => ({ dispose: contextMenuDispose })),
}))

import { attachWindowScope } from '../window-scope'

class WindowMock extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    isDevToolsOpened: vi.fn(() => false),
    openDevTools: vi.fn(),
    closeDevTools: vi.fn(),
  })
  contentView = { children: [] as unknown[] }
  getContentBounds = vi.fn(() => ({ x: 0, y: 0, width: 1200, height: 800 }))
}

function overlayManagerMock(order?: string[]) {
  return {
    attachWindow: vi.fn(),
    detachWindow: vi.fn(() => order?.push('overlay')),
    hide: vi.fn(),
  }
}

function tabManagerMock(view: unknown = null, order?: string[]) {
  return {
    attachWindow: vi.fn(),
    detachWindow: vi.fn(() => order?.push('tabs')),
    getActiveView: vi.fn(() => view),
    reloadActivePage: vi.fn(() => true),
    stopActivePage: vi.fn(() => true),
    pageZoom: { zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn() },
  }
}

describe('window scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('attaches and disposes only window-owned resources', () => {
    const order: string[] = []
    const window = new WindowMock()
    const overlayManager = overlayManagerMock(order)
    const tabManager = tabManagerMock(null, order)
    contextMenuDispose.mockImplementation(() => order.push('menu'))

    const scope = attachWindowScope(window as never, 8080, {
      overlayManager: overlayManager as never,
      tabManager: tabManager as never,
      tabDeps: {} as never,
    })

    expect(overlayManager.attachWindow).toHaveBeenCalledWith(window, expect.any(Function))
    expect(tabManager.attachWindow).toHaveBeenCalledWith(window, 8080, {}, expect.any(Function))
    expect(window.listenerCount('closed')).toBe(1)

    window.emit('closed')
    scope.dispose()

    expect(order).toEqual(['tabs', 'overlay', 'menu'])
    expect(window.listenerCount('closed')).toBe(0)
  })

  it('can attach a fresh window after the previous scope closes', () => {
    const firstWindow = new WindowMock()
    const secondWindow = new WindowMock()
    const overlayManager = overlayManagerMock()
    const tabManager = tabManagerMock()
    const deps = {
      overlayManager: overlayManager as never,
      tabManager: tabManager as never,
      tabDeps: {} as never,
    }

    const firstScope = attachWindowScope(firstWindow as never, 8080, deps)
    firstWindow.emit('closed')
    const secondScope = attachWindowScope(secondWindow as never, 9090, deps)

    expect(tabManager.attachWindow).toHaveBeenNthCalledWith(2, secondWindow, 9090, {}, expect.any(Function))
    expect(firstWindow.listenerCount('closed')).toBe(0)
    expect(secondWindow.listenerCount('closed')).toBe(1)

    firstScope.dispose()
    secondScope.dispose()
    expect(tabManager.detachWindow).toHaveBeenCalledTimes(2)
    expect(overlayManager.detachWindow).toHaveBeenCalledTimes(2)
  })

  it('routes chrome and overlay input to the visible target and disposes the chrome listener', () => {
    const window = new WindowMock()
    const tabContents = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      isDevToolsOpened: vi.fn(() => false),
      openDevTools: vi.fn(),
      closeDevTools: vi.fn(),
    })
    const view = { webContents: tabContents }
    window.contentView.children = [view]
    const overlayManager = overlayManagerMock()
    const tabManager = tabManagerMock(view)
    const scope = attachWindowScope(window as never, 8080, {
      overlayManager: overlayManager as never,
      tabManager: tabManager as never,
      tabDeps: {} as never,
    })
    const overlayInput = overlayManager.attachWindow.mock.calls[0]?.[1] as
      | ((event: Electron.Event, input: Electron.Input) => void)
      | undefined
    const tabInput = tabManager.attachWindow.mock.calls[0]?.[3] as
      | ((event: Electron.Event, input: Electron.Input) => void)
      | undefined
    const input = {
      type: 'keyDown',
      key: 'F12',
      code: 'F12',
      isAutoRepeat: false,
      isComposing: false,
      control: false,
      shift: false,
      alt: false,
      meta: false,
      location: 0,
      modifiers: [],
    } as Electron.Input

    window.webContents.emit('before-input-event', { preventDefault: vi.fn() }, input)
    expect(tabContents.openDevTools).toHaveBeenCalledOnce()

    const hardReload = { ...input, key: 'F5', code: 'F5', control: true }
    tabInput?.({ preventDefault: vi.fn() } as never, hardReload)
    expect(tabManager.reloadActivePage).toHaveBeenCalledExactlyOnceWith(true)

    window.contentView.children = []
    overlayInput?.({ preventDefault: vi.fn() } as never, input)
    expect(window.webContents.openDevTools).toHaveBeenCalledOnce()

    expect(window.webContents.listenerCount('before-input-event')).toBe(1)
    scope.dispose()
    expect(window.webContents.listenerCount('before-input-event')).toBe(0)
  })
})
