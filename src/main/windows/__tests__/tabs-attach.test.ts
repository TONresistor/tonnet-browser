import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContentsView } from 'electron'
import { attachViewWhenReady, setupNavAwareAttach } from '../tabs-attach'
import type { IDisposable } from '../../utils/disposable'

vi.mock('../tabs-bounds', () => ({ updateViewBounds: vi.fn() }))

function fixture() {
  const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false })
  const view = { webContents } as unknown as WebContentsView
  let current = true
  const window = { contentView: { children: [], addChildView: vi.fn(), removeChildView: vi.fn() } }
  const manager = {
    window: window as never,
    sidebarWidth: 0,
    views: { activeViewId: 'tab', get: () => view },
    pendingAttachments: new Map<WebContentsView, IDisposable>(),
    captureWindowGeneration: () => 1,
    ownsWindowGeneration: () => true,
    captureNavigation: () => () => current,
  }
  return {
    manager,
    view,
    webContents,
    window,
    supersede: () => {
      current = false
    },
  }
}

afterEach(() => vi.useRealTimers())

describe('navigation attachment ownership', () => {
  it('ignores subframe failures and removes both listeners and timers once ready', () => {
    vi.useFakeTimers()
    const { manager, view, webContents, window } = fixture()
    attachViewWhenReady(manager, view, 'tab', 1)
    webContents.emit('did-fail-load', {}, -105, 'failed', 'http://frame.ton', false)
    vi.advanceTimersByTime(150)
    expect(window.contentView.addChildView).not.toHaveBeenCalled()
    webContents.emit('dom-ready')
    expect(window.contentView.addChildView).toHaveBeenCalledOnce()
    expect(webContents.listenerCount('did-fail-load')).toBe(0)
    expect(webContents.listenerCount('dom-ready')).toBe(0)
    expect(manager.pendingAttachments.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('replaces pending attachments and disposes them with the view listeners', () => {
    vi.useFakeTimers()
    const { manager, view, webContents } = fixture()
    const registration = setupNavAwareAttach(manager, view, 'tab')
    attachViewWhenReady(manager, view, 'tab', 1)
    attachViewWhenReady(manager, view, 'tab', 1)
    expect(webContents.listenerCount('dom-ready')).toBe(1)
    expect(vi.getTimerCount()).toBe(1)
    registration.dispose()
    expect(manager.pendingAttachments.size).toBe(0)
    expect(webContents.listenerCount('dom-ready')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not attach a superseded navigation after the hold delay', () => {
    vi.useFakeTimers()
    const { manager, view, webContents, window, supersede } = fixture()
    attachViewWhenReady(manager, view, 'tab', 1)
    webContents.emit('dom-ready')
    supersede()
    vi.runAllTimers()
    expect(window.contentView.addChildView).not.toHaveBeenCalled()
    expect(manager.pendingAttachments.size).toBe(0)
  })
})
