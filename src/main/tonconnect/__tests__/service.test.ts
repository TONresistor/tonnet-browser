import { describe, expect, it, vi } from 'vitest'
import { TonConnectService } from '../service'

const firstAddress = `0:${'11'.repeat(32)}`
const secondAddress = `0:${'22'.repeat(32)}`

describe('TonConnectService wallet identity', () => {
  it('rejects a connection when the wallet changes during approval', async () => {
    let approve: (value: boolean) => void = () => {}
    const approval = new Promise<boolean>((resolve) => {
      approve = resolve
    })
    const wallet = {
      getTonConnectAccount: vi
        .fn()
        .mockReturnValueOnce({ addressRaw: firstAddress, publicKey: 'first', walletStateInit: 'first-state' })
        .mockReturnValueOnce({ addressRaw: secondAddress, publicKey: 'second', walletStateInit: 'second-state' }),
      signTonProof: vi.fn(),
      signTonConnectTransaction: vi.fn(),
      signData: vi.fn(),
    }
    const sessionStore = {
      init: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      list: vi.fn(() => []),
    }
    const service = new TonConnectService(
      wallet,
      sessionStore as never,
      { request: vi.fn(() => approval) },
      {
        load: vi.fn(async () => null),
        loadIcon: vi.fn(async () => null),
      } as never,
      { track: vi.fn(), emitDisconnect: vi.fn() }
    )
    await service.init()
    const request = service.handleRequest(
      'app.ton',
      {
        sender: {
          session: { fetch: vi.fn() },
          once: vi.fn(),
          isDestroyed: vi.fn(() => false),
          send: vi.fn(),
        },
      },
      {
        method: 'connect',
        request: { manifestUrl: 'http://app.ton/manifest.json', items: [{ name: 'ton_addr' }] },
      }
    )

    approve(true)

    await expect(request).resolves.toMatchObject({
      event: 'connect_error',
      payload: { message: 'Wallet changed while connection approval was pending' },
    })
    expect(sessionStore.set).not.toHaveBeenCalled()
  })

  it('does not recreate a session invalidated during approval', async () => {
    let approve: (value: boolean) => void = () => {}
    const approval = new Promise<boolean>((resolve) => {
      approve = resolve
    })
    const account = { addressRaw: firstAddress, publicKey: 'first', walletStateInit: 'first-state' }
    const wallet = {
      getTonConnectAccount: vi.fn(() => account),
      signTonProof: vi.fn(),
      signTonConnectTransaction: vi.fn(),
      signData: vi.fn(),
    }
    const sessionStore = {
      init: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      list: vi.fn(() => []),
    }
    const service = new TonConnectService(
      wallet,
      sessionStore as never,
      { request: vi.fn(() => approval) },
      {
        load: vi.fn(async () => null),
        loadIcon: vi.fn(async () => null),
      } as never,
      { track: vi.fn(), emitDisconnect: vi.fn() }
    )
    await service.init()
    const request = service.handleRequest(
      'app.ton',
      {
        sender: {
          session: { fetch: vi.fn() },
          once: vi.fn(),
          isDestroyed: vi.fn(() => false),
          send: vi.fn(),
        },
      },
      {
        method: 'connect',
        request: { manifestUrl: 'http://app.ton/manifest.json', items: [{ name: 'ton_addr' }] },
      }
    )

    await service.clearSessions()
    approve(true)

    await expect(request).resolves.toMatchObject({ event: 'connect_error' })
    expect(sessionStore.set).not.toHaveBeenCalled()
  })
})
