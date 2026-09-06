import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElectronAPI } from '../index'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
  },
}))

async function loadPreload() {
  await import('../index')
  const exposed = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'electron')
  if (!exposed) throw new Error('Preload did not expose the renderer API')
  return exposed[1] as ElectronAPI
}

describe('main renderer preload boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
  })

  afterEach(() => {
    Reflect.deleteProperty(process, 'contextIsolated')
  })

  it('maps typed client calls to their canonical IPC channel and arguments', async () => {
    electron.invoke.mockResolvedValue({ language: 'en' })
    const api = await loadPreload()

    await api.settings.get('general')

    expect(electron.invoke).toHaveBeenCalledWith('settings:get', 'general')
  })

  it('exposes temporary diagnostic logging through canonical settings channels', async () => {
    electron.invoke.mockResolvedValue({ enabled: true, until: Date.now() + 1_000 })
    const api = await loadPreload()

    await api.settings.diagnostics.enable()
    await api.settings.diagnostics.disable()
    await api.settings.diagnostics.copy()

    expect(electron.invoke).toHaveBeenCalledWith('settings:diagnostics:enable')
    expect(electron.invoke).toHaveBeenCalledWith('settings:diagnostics:disable')
    expect(electron.invoke).toHaveBeenCalledWith('settings:diagnostics:copy')
  })

  it('exposes pending Messenger recovery through canonical channels', async () => {
    const api = await loadPreload()
    const room = 'R'.repeat(43)
    const eventId = 'E'.repeat(43)
    electron.invoke.mockResolvedValue({ pending: null })
    await api.chat.pending(room)
    electron.invoke.mockResolvedValue({ item: {} })
    await api.chat.retryPending(room, eventId)
    electron.invoke.mockResolvedValue({ discarded: true })
    await api.chat.discardPending(room, eventId)

    expect(electron.invoke).toHaveBeenCalledWith('chat:pending', room)
    expect(electron.invoke).toHaveBeenCalledWith('chat:pending:retry', room, eventId)
    expect(electron.invoke).toHaveBeenCalledWith('chat:pending:discard', room, eventId)
  })

  it('exposes domain transaction preparation and wallet opening', async () => {
    const api = await loadPreload()
    const txUrl = `ton://transfer/${'E'.repeat(48)}?bin=abc&amount=20000000`
    await api.chat.prepareDomainLink('alice.ton')
    await api.chat.openDomainLink(txUrl)
    expect(electron.invoke).toHaveBeenCalledWith('chat:identity:prepare-domain-link', 'alice.ton')
    expect(electron.invoke).toHaveBeenCalledWith('chat:identity:open-domain-link', txUrl)
  })

  it('turns a sanitized IPC failure envelope into a typed rejected client call', async () => {
    electron.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'HISTORY_READ_FAILED', message: 'Unable to read history', retryable: false },
    })
    const api = await loadPreload()

    await expect(api.history.getRecent()).rejects.toMatchObject({
      name: 'IpcClientError',
      code: 'HISTORY_READ_FAILED',
      message: 'Unable to read history',
      retryable: false,
    })
  })

  it('subscribes only to allowlisted renderer events and removes the exact listener', async () => {
    const api = await loadPreload()
    const callback = vi.fn()
    const unsubscribe = api.on('page:loading', callback)
    const listener = electron.on.mock.calls[0]?.[1] as
      | ((event: unknown, loading: boolean, tabId: string) => void)
      | undefined

    expect(electron.on).toHaveBeenCalledWith('page:loading', expect.any(Function))
    listener?.({}, true, 'tab-1')
    expect(callback).toHaveBeenCalledWith(true, 'tab-1')

    unsubscribe()
    expect(electron.removeListener).toHaveBeenCalledWith('page:loading', listener)
  })

  it('returns a no-op subscription for a channel outside the contract allowlist', async () => {
    const api = await loadPreload()
    const unsubscribe = api.on('not:allowlisted' as 'page:loading', vi.fn())

    expect(electron.on).not.toHaveBeenCalled()
    expect(() => unsubscribe()).not.toThrow()
  })
})
