import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  views: [] as Array<{
    webContents: {
      close: ReturnType<typeof vi.fn>
      send: ReturnType<typeof vi.fn>
      focus: ReturnType<typeof vi.fn>
    } & EventEmitter
  }>,
}))

vi.mock('electron', () => {
  class WebContentsView {
    webContents = Object.assign(new EventEmitter(), {
      loadURL: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      send: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
    })
    setBackgroundColor = vi.fn()
    setBounds = vi.fn()

    constructor() {
      state.views.push(this)
    }
  }
  return { BrowserWindow: class {}, WebContentsView }
})

import { OverlayManager } from '../overlay-manager'

class WindowMock extends EventEmitter {
  contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
  webContents = { send: vi.fn() }
}

describe('OverlayManager window lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.views.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('replaces the pool and ignores stale window detaches', () => {
    const firstWindow = new WindowMock()
    const secondWindow = new WindowMock()
    const manager = new OverlayManager()

    manager.attachWindow(firstWindow as never, vi.fn())
    manager.show('menu', { x: 0, y: 0, width: 10, height: 10 }, { type: 'menu' })
    const firstViews = [...state.views]

    manager.attachWindow(secondWindow as never, vi.fn())
    const secondViews = state.views.slice(2)

    expect(firstViews).toHaveLength(2)
    expect(secondViews).toHaveLength(2)
    expect(firstViews.every((view) => view.webContents.close.mock.calls.length === 1)).toBe(true)
    expect(firstWindow.listenerCount('resize')).toBe(0)
    expect(secondWindow.listenerCount('resize')).toBe(1)

    manager.detachWindow(firstWindow as never)
    expect(secondWindow.listenerCount('resize')).toBe(1)
    expect(secondViews.every((view) => view.webContents.close.mock.calls.length === 0)).toBe(true)

    manager.detachWindow(secondWindow as never)
    manager.detachWindow(secondWindow as never)

    expect(secondWindow.listenerCount('resize')).toBe(0)
    expect(secondViews.every((view) => view.webContents.close.mock.calls.length === 1)).toBe(true)
  })

  it('resolves active callbacks once when all overlays are hidden', () => {
    const window = new WindowMock()
    const manager = new OverlayManager()
    const callback = vi.fn(() => manager.hide('approval'))
    manager.attachWindow(window as never, vi.fn())
    manager.show('approval', { x: 0, y: 0, width: 10, height: 10 }, { type: 'form' }, callback, { autoDismiss: false })

    manager.hideAll()
    manager.hideAll()
    manager.detachWindow(window as never)

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith('dismiss', {})
  })

  it('dismisses active callbacks on resize and detach', () => {
    const window = new WindowMock()
    const manager = new OverlayManager()
    const onResize = vi.fn()
    const onDetach = vi.fn()
    manager.attachWindow(window as never, vi.fn())
    manager.show('resize', { x: 0, y: 0, width: 10, height: 10 }, { type: 'form' }, onResize, {
      autoDismiss: false,
    })

    window.emit('resize')
    manager.show('detach', { x: 0, y: 0, width: 10, height: 10 }, { type: 'form' }, onDetach, {
      autoDismiss: false,
    })
    manager.detachWindow(window as never)

    expect(onResize).toHaveBeenCalledOnce()
    expect(onResize).toHaveBeenCalledWith('dismiss', {})
    expect(onDetach).toHaveBeenCalledOnce()
    expect(onDetach).toHaveBeenCalledWith('dismiss', {})
  })

  it('dismisses a blurred overlay once', () => {
    vi.useFakeTimers()
    const window = new WindowMock()
    const manager = new OverlayManager()
    const callback = vi.fn(() => manager.hide('blurred'))
    manager.attachWindow(window as never, vi.fn())
    manager.show('blurred', { x: 0, y: 0, width: 10, height: 10 }, { type: 'form' }, callback)
    vi.runAllTimers()
    const view = state.views.at(-1)!
    const blur = view.webContents.listeners('blur')[0] as (() => void) | undefined

    expect(blur).toBeTypeOf('function')
    blur?.()
    vi.runAllTimers()
    manager.hideAll()

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith('dismiss', {})
  })

  it('does not dismiss a callback after handling an explicit action', () => {
    const window = new WindowMock()
    const manager = new OverlayManager()
    const callback = vi.fn(() => manager.hide('action'))
    manager.attachWindow(window as never, vi.fn())
    manager.show('action', { x: 0, y: 0, width: 10, height: 10 }, { type: 'form' }, callback, {
      autoDismiss: false,
    })
    const view = state.views.at(-1)!

    expect(manager.handleAction(view.webContents as never, 'approve', {})).toBe(true)
    manager.hideAll()
    manager.detachWindow(window as never)

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith('approve', {})
  })

  it('keeps persistent callbacks active until the overlay closes', () => {
    const window = new WindowMock()
    const manager = new OverlayManager()
    const callback = vi.fn()
    manager.attachWindow(window as never, vi.fn())
    manager.show('find', { x: 0, y: 0, width: 10, height: 10 }, { type: 'find' }, callback, {
      autoDismiss: false,
      persistentActions: true,
    })
    const view = state.views.at(-1)!

    expect(manager.handleAction(view.webContents as never, 'query', { query: 'ton' })).toBe(true)
    expect(manager.handleAction(view.webContents as never, 'next', {})).toBe(true)
    manager.hideAll()

    expect(callback.mock.calls).toEqual([
      ['query', { query: 'ton' }],
      ['next', {}],
      ['dismiss', {}],
    ])
  })

  it('forwards input from pooled and on-demand views and removes every listener on detach', () => {
    const window = new WindowMock()
    const manager = new OverlayManager()
    const handleInput = vi.fn()
    manager.attachWindow(window as never, handleInput)

    manager.show('one', { x: 0, y: 0, width: 10, height: 10 }, { type: 'menu' }, undefined, {
      autoDismiss: false,
    })
    manager.show('two', { x: 0, y: 0, width: 10, height: 10 }, { type: 'menu' }, undefined, {
      autoDismiss: false,
    })
    manager.show('three', { x: 0, y: 0, width: 10, height: 10 }, { type: 'menu' }, undefined, {
      autoDismiss: false,
    })

    expect(state.views).toHaveLength(3)
    for (const view of state.views) {
      view.webContents.emit('before-input-event', { preventDefault: vi.fn() }, { code: 'F12' })
    }
    expect(handleInput).toHaveBeenCalledTimes(3)

    manager.detachWindow(window as never)
    expect(state.views.every((view) => view.webContents.listenerCount('before-input-event') === 0)).toBe(true)
  })
})
