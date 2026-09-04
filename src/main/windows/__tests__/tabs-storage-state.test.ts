import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ WebContentsView: class {} }))
vi.mock('../file-browser', () => ({ generateLoadingPage: () => 'loading', generateFileBrowserPage: () => 'browser' }))

import {
  cancelStorageBrowserLoad,
  createTabStorageState,
  disposeTabStorageState,
  initStorageListener,
  loadStorageBrowser,
} from '../tabs-storage'
import type { BagDetails } from '../../../shared/types'

describe('tab storage state ownership', () => {
  it('lets a new fallback replace a canceled one without the old finally clearing its ownership', async () => {
    const state = createTabStorageState()
    state.storageBagCache.set('example.ton', 'a'.repeat(64))
    let firstResolve!: (details: BagDetails) => void
    let secondResolve!: (details: BagDetails) => void
    const getBagDetails = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          firstResolve = resolve
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          secondResolve = resolve
        })
      )
    state.storageManager = { getBagDetails } as never
    const loadURL = vi.fn().mockResolvedValue(undefined)
    const view = { webContents: { id: 7, isDestroyed: () => false, loadURL } } as never
    const first = loadStorageBrowser(state, view, 'example.ton')
    await vi.waitFor(() => expect(getBagDetails).toHaveBeenCalledTimes(1))
    cancelStorageBrowserLoad(state, 7)
    const second = loadStorageBrowser(state, view, 'example.ton')
    await vi.waitFor(() => expect(getBagDetails).toHaveBeenCalledTimes(2))
    const epoch = state.storageBrowserEpochs.get(7)
    const details = { path: '/test', files: [{ name: 'file.txt' }] } as BagDetails
    firstResolve(details)
    await first
    expect(state.storageBrowserLoading.has(7)).toBe(true)
    expect(state.storageBrowserEpochs.get(7)).toBe(epoch)
    expect(state.fileBrowserCache.size).toBe(0)
    secondResolve(details)
    await second
    expect(state.fileBrowserCache.get(7)).toBe('browser')
    expect(loadURL).toHaveBeenCalledTimes(3)
    expect(state.storageBrowserLoading.size).toBe(0)
    expect(state.storageBrowserEpochs.size).toBe(0)
  })

  it('isolates proxy discoveries and caches between tab-manager instances', () => {
    const first = createTabStorageState()
    const second = createTabStorageState()
    const proxy = new EventEmitter()
    const registration = initStorageListener(first, proxy)

    proxy.emit('storage-bag-detected', { bagId: 'a'.repeat(64), domain: 'example.ton' })
    first.fileBrowserCache.set(7, '<html>first</html>')

    expect(first.storageBagCache.get('example.ton')).toBe('a'.repeat(64))
    expect(second.storageBagCache.size).toBe(0)
    expect(second.fileBrowserCache.size).toBe(0)

    registration.dispose()
    proxy.emit('storage-bag-detected', { bagId: 'b'.repeat(64), domain: 'other.ton' })
    expect(first.storageBagCache.has('other.ton')).toBe(false)
  })

  it('drops every owned reference during disposal', () => {
    const state = createTabStorageState()
    state.storageManager = {} as never
    state.storageBagCache.set('example.ton', 'a'.repeat(64))
    state.storageBrowserLoading.add(7)
    state.fileBrowserCache.set(7, '<html></html>')

    disposeTabStorageState(state)

    expect(state.storageManager).toBeNull()
    expect(state.storageBagCache.size).toBe(0)
    expect(state.storageBrowserLoading.size).toBe(0)
    expect(state.fileBrowserCache.size).toBe(0)
  })
})
