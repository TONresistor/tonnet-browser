import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { PageFindController } from '../page-find'

describe('PageFindController', () => {
  it('searches the active TON Site and keeps the overlay result state current', () => {
    const contents = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      findInPage: vi.fn(() => 7),
      stopFindInPage: vi.fn(),
    })
    const view = {
      webContents: contents,
      getBounds: vi.fn(() => ({ x: 100, y: 80, width: 900, height: 600 })),
    }
    const overlayManager = {
      show: vi.fn(() => true),
      hide: vi.fn(),
    }
    const controller = new PageFindController(
      { getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 1200, height: 800 })) } as never,
      { getActiveView: vi.fn(() => view) } as never,
      overlayManager as never
    )

    expect(controller.show()).toBe(true)
    const firstShow = overlayManager.show.mock.calls[0] as unknown as [
      string,
      object,
      object,
      (action: string, data: unknown) => void,
    ]
    const handleAction = firstShow[3]
    handleAction('query', { query: 'privacy' })

    expect(contents.findInPage).toHaveBeenCalledExactlyOnceWith('privacy', { forward: true, findNext: false })

    contents.emit('found-in-page', {}, { requestId: 7, activeMatchOrdinal: 2, matches: 5, finalUpdate: true })
    expect(overlayManager.show).toHaveBeenLastCalledWith(
      'page-find',
      expect.any(Object),
      expect.objectContaining({ query: 'privacy', activeMatch: 2, matches: 5 }),
      handleAction,
      { autoDismiss: false, focus: true, persistentActions: true }
    )

    handleAction('next', {})
    expect(contents.findInPage).toHaveBeenLastCalledWith('privacy', { forward: true, findNext: true })

    handleAction('close', {})
    expect(contents.stopFindInPage).toHaveBeenCalledWith('keepSelection')
    expect(overlayManager.hide).toHaveBeenCalledWith('page-find')
  })
})
