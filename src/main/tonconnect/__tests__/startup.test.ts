import { describe, expect, it, vi } from 'vitest'
import { initializeTonConnect } from '../startup'
import { TonConnectService } from '../service'

describe('TON Connect startup isolation', () => {
  it.each([true, false])('allows window creation after an init failure (enabled=%s)', async (enabled) => {
    const error = new Error('EACCES')
    const init = vi.fn().mockRejectedValue(error)
    const report = vi.fn()
    const createWindow = vi.fn()
    await initializeTonConnect({ init }, enabled, report)
    createWindow()
    expect(createWindow).toHaveBeenCalledOnce()
    expect(init).toHaveBeenCalledWith(!enabled)
    expect(report).toHaveBeenCalledWith(error)
  })

  it.each(['read', 'clear'])('blocks capabilities after a failed %s', async (failure) => {
    const store = {
      init: vi.fn().mockImplementation(async () => {
        if (failure === 'read') throw new Error('EACCES')
      }),
      clear: vi.fn().mockImplementation(async () => {
        if (failure === 'clear') throw new Error('disk full')
      }),
      list: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
    }
    const wallet = {
      getTonConnectAccount: vi.fn(),
      signTonProof: vi.fn(),
      signTonConnectTransaction: vi.fn(),
      signData: vi.fn(),
    }
    const approval = { request: vi.fn() }
    const service = new TonConnectService(wallet, store as never, approval, {} as never, {} as never)
    expect(service.isAvailable()).toBe(false)
    expect(await initializeTonConnect(service, false, vi.fn())).toBe(false)
    expect(service.isAvailable()).toBe(false)
    for (const method of ['connect', 'restore', 'send', 'disconnect'] as const) {
      const response = await service.handleRequest('app.ton', {} as never, { method })
      expect(response).toMatchObject(
        method === 'send' || method === 'disconnect'
          ? { error: { message: 'TON Connect is unavailable' } }
          : { event: 'connect_error', payload: { message: 'TON Connect is unavailable' } }
      )
    }
    expect(() => service.getSessions()).toThrow('unavailable')
    await expect(service.disconnectSession('app.ton')).rejects.toThrow('unavailable')
    await service.clearSessions()
    expect(store.clear).toHaveBeenCalledTimes(failure === 'clear' ? 1 : 0)
    expect(store.list).not.toHaveBeenCalled()
    expect(wallet.getTonConnectAccount).not.toHaveBeenCalled()
    expect(approval.request).not.toHaveBeenCalled()
  })

  it('becomes available only after disabled-feature cleanup succeeds', async () => {
    let finish!: () => void
    const store = {
      init: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      ),
    }
    const service = new TonConnectService({} as never, store as never, {} as never, {} as never, {} as never)
    const startup = initializeTonConnect(service, false, vi.fn())
    await vi.waitFor(() => expect(store.clear).toHaveBeenCalledOnce())
    expect(service.isAvailable()).toBe(false)
    finish()
    await startup
    expect(service.isAvailable()).toBe(true)
  })
})
