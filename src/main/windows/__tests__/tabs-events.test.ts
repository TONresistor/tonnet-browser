import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  emitContractToRenderer: vi.fn(),
  extractFavicon: vi.fn<() => Promise<string | null>>(() => Promise.resolve(null)),
  loadStorageBrowser: vi.fn(() => Promise.resolve()),
  loadErrorPage: vi.fn(),
}))

vi.mock('electron', () => ({ WebContentsView: class {}, clipboard: { writeText: vi.fn() } }))
vi.mock('../../events/renderer-events', () => ({ emitContractToRenderer: mocks.emitContractToRenderer }))
vi.mock('../browser-view', () => ({ extractFavicon: mocks.extractFavicon }))
vi.mock('../tabs-storage', () => ({
  loadStorageBrowser: mocks.loadStorageBrowser,
  loadErrorPage: mocks.loadErrorPage,
}))
vi.mock('../../../shared/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), event: vi.fn() }),
}))

import { setupViewEventListeners } from '../tabs-events'

function createHarness() {
  const webContents = Object.assign(new EventEmitter(), {
    navigationHistory: {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
    },
    getTitle: vi.fn(() => 'Whitepaper'),
    getURL: vi.fn(() => 'http://whitepaper.ton'),
    isDestroyed: vi.fn(() => false),
    isDevToolsOpened: vi.fn(() => false),
    openDevTools: vi.fn(),
    closeDevTools: vi.fn(),
  })
  const historyManager = { addEntry: vi.fn() }
  const handleInput = vi.fn()
  let current = true
  const listeners = setupViewEventListeners({ webContents } as never, 'tab-1', {
    historyManager: historyManager as never,
    overlayManager: {} as never,
    storage: {} as never,
    cancelNavigation: vi.fn(),
    captureNavigation: () => () => current,
    handleInput,
  })
  return {
    handleInput,
    historyManager,
    listeners,
    webContents,
    supersede: () => {
      current = false
    },
  }
}

describe('tab navigation events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.emitContractToRenderer.mockImplementation(
      (contract: { payload: { parse(args: unknown[]): unknown } }, ...args: unknown[]) => contract.payload.parse(args)
    )
  })

  it('does not expose an oversized internal data page as the tab URL', () => {
    const { historyManager, listeners, webContents } = createHarness()
    const internalUrl = `data:text/html;charset=utf-8,${'x'.repeat(20_000)}`

    expect(() => webContents.emit('did-navigate', {}, internalUrl)).not.toThrow()
    expect(mocks.emitContractToRenderer).not.toHaveBeenCalled()
    expect(historyManager.addEntry).not.toHaveBeenCalled()

    listeners.dispose()
  })

  it('does not expose a local storage file path as the tab URL', () => {
    const { historyManager, listeners, webContents } = createHarness()

    webContents.emit('did-navigate', {}, 'file:///Users/example/TON_Technical_Whitepaper.pdf')

    expect(mocks.emitContractToRenderer).not.toHaveBeenCalled()
    expect(historyManager.addEntry).not.toHaveBeenCalled()

    listeners.dispose()
  })

  it('still publishes ordinary page navigations', () => {
    const { historyManager, listeners, webContents } = createHarness()

    webContents.emit('did-navigate', {}, 'http://whitepaper.ton')

    expect(mocks.emitContractToRenderer).toHaveBeenCalledOnce()
    expect(historyManager.addEntry).toHaveBeenCalledWith('http://whitepaper.ton', 'Whitepaper')

    listeners.dispose()
  })

  it.each(['did-navigate', 'did-navigate-in-page'])('rejects oversized URLs from %s without throwing', (event) => {
    const { historyManager, listeners, webContents } = createHarness()
    const url = `http://whitepaper.ton/#${'x'.repeat(20_000)}`
    webContents.getURL.mockReturnValue(url)
    expect(() => webContents.emit(event, {}, url, true)).not.toThrow()
    expect(() => webContents.emit('page-title-updated', {}, 'Page')).not.toThrow()
    expect(mocks.emitContractToRenderer).not.toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'page:navigate' }),
      expect.anything()
    )
    expect(historyManager.addEntry).not.toHaveBeenCalled()
    listeners.dispose()
  })

  it('accepts the exact URL limit and bounds titles for both IPC and history', () => {
    const { historyManager, listeners, webContents } = createHarness()
    const prefix = 'http://whitepaper.ton/#'
    const url = prefix + 'x'.repeat(16_384 - prefix.length)
    const title = 't'.repeat(20_000)
    webContents.getURL.mockReturnValue(url)
    webContents.getTitle.mockReturnValue(title)
    expect(() => webContents.emit('did-navigate', {}, url)).not.toThrow()
    expect(historyManager.addEntry).toHaveBeenCalledWith(url, title.slice(0, 4_096))
    expect(() => webContents.emit('page-title-updated', {}, title)).not.toThrow()
    expect(mocks.emitContractToRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: 'page:title' }),
      title.slice(0, 4_096),
      'tab-1'
    )
    listeners.dispose()
  })

  it('ignores in-page navigation from a subframe', () => {
    const { historyManager, listeners, webContents } = createHarness()
    webContents.emit('did-navigate-in-page', {}, 'http://embedded.ton/#changed', false)
    expect(mocks.emitContractToRenderer).not.toHaveBeenCalled()
    expect(historyManager.addEntry).not.toHaveBeenCalled()
    listeners.dispose()
  })

  it('does not replace the main page when a subframe fails', () => {
    const { listeners, webContents } = createHarness()
    webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'http://embedded.ton', false)
    expect(mocks.loadStorageBrowser).not.toHaveBeenCalled()
    expect(mocks.loadErrorPage).not.toHaveBeenCalled()
    listeners.dispose()
  })

  it('ignores an obsolete Storage fallback failure', async () => {
    const { listeners, webContents, supersede } = createHarness()
    let reject!: (error: Error) => void
    mocks.loadStorageBrowser.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail
      })
    )
    webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'http://old.ton', true)
    supersede()
    reject(new Error('Storage unavailable'))
    await Promise.resolve()
    expect(mocks.loadErrorPage).not.toHaveBeenCalled()
    listeners.dispose()
  })

  it('does not publish an obsolete favicon or start empty-page recovery', async () => {
    const { listeners, webContents, supersede } = createHarness()
    let resolve!: (value: string | null) => void
    mocks.extractFavicon.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    webContents.emit('did-finish-load')
    supersede()
    resolve('data:image/png;base64,AAA')
    await Promise.resolve()
    expect(mocks.emitContractToRenderer).not.toHaveBeenCalled()
    expect(mocks.loadStorageBrowser).not.toHaveBeenCalled()
    listeners.dispose()
  })
})

describe('tab shortcut input', () => {
  it('forwards input from the focused TON Site to the shared handler', () => {
    const { handleInput, listeners, webContents } = createHarness()
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      key: 'i',
      code: 'KeyI',
      isAutoRepeat: false,
      isComposing: false,
      control: true,
      shift: true,
      alt: false,
      meta: false,
      location: 0,
      modifiers: [],
    }

    webContents.emit('before-input-event', event, input)

    expect(handleInput).toHaveBeenCalledExactlyOnceWith(event, input)
    listeners.dispose()
    expect(webContents.listenerCount('before-input-event')).toBe(0)
  })
})
