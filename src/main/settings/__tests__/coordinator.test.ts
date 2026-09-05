import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSettingsSchema, type AppSettings } from '../../../shared/types'

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  transact: vi.fn(),
}))

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/ton-browser') } }))
vi.mock('../../events/renderer-events', () => ({ emitContractToRenderer: mocks.emit }))
vi.mock('../index', async () => {
  const actual = await vi.importActual<typeof import('../index')>('../index')
  return { ...actual, transactSettings: mocks.transact }
})

import { SettingsCoordinator, type SettingsRuntimeDependencies } from '../coordinator'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createDependencies() {
  return {
    proxyManager: {
      applySettingsChange: vi.fn(() => Promise.resolve({ bridgeRestarted: false })),
      getStatus: vi.fn(() => ({ status: 'connected', port: 8080 })),
      isRunning: vi.fn(() => true),
      isActive: vi.fn(() => true),
      restartBridge: vi.fn(() => Promise.resolve()),
    },
    storageManager: {
      applySettingsChange: vi.fn(() => Promise.resolve()),
      getStatus: vi.fn(() => ({ running: true })),
      isActive: vi.fn(() => true),
    },
    historyManager: { applySettings: vi.fn(() => Promise.resolve()) },
    walletManager: { setAutoLockMinutes: vi.fn() },
    tonBridgeCoordinator: { waitUntilReady: vi.fn(() => Promise.resolve()) },
    tonConnectService: { clearSessions: vi.fn(() => Promise.resolve()) },
    bridgePermissionStore: { clearSessionGrants: vi.fn() },
    tabManager: {
      updateProxyPort: vi.fn(() => Promise.resolve()),
      onAppearanceSettingsChanged: vi.fn(),
      applyDefaultZoom: vi.fn(),
      onPrivacySettingsChanged: vi.fn(() => Promise.resolve()),
    },
  } as unknown as SettingsRuntimeDependencies
}

describe('SettingsCoordinator', () => {
  let current: AppSettings

  beforeEach(() => {
    vi.clearAllMocks()
    current = AppSettingsSchema.parse({})
    mocks.transact.mockImplementation(
      async (
        transform: (settings: AppSettings) => AppSettings,
        reconcile: (previous: AppSettings, next: AppSettings) => Promise<void>,
        finalize?: (previous: AppSettings, next: AppSettings) => Promise<void>,
        guard?: (
          previous: AppSettings,
          next: AppSettings,
          operation: () => Promise<AppSettings>
        ) => Promise<AppSettings>
      ) => {
        const previous = current
        const next = transform(previous)
        const operation = async () => {
          try {
            await reconcile(previous, next)
            await finalize?.(previous, next)
            current = next
            return next
          } catch (error) {
            await reconcile(next, previous)
            throw error
          }
        }
        return guard ? guard(previous, next, operation) : operation()
      }
    )
  })

  it('applies a changed default zoom to existing page views', async () => {
    const dependencies = createDependencies()
    const coordinator = new SettingsCoordinator(dependencies)

    await coordinator.apply({ appearance: { defaultZoom: 150 } })

    expect(dependencies.tabManager.applyDefaultZoom).toHaveBeenCalledWith(150)
  })

  it('forces only history reconciliation on explicit retry of the configured mode', async () => {
    current = AppSettingsSchema.parse({ privacy: { historyMode: 'persistent' } })
    const dependencies = createDependencies()
    const coordinator = new SettingsCoordinator(dependencies)
    await coordinator.apply({ privacy: { historyMode: 'persistent' } }, { reconcileHistory: true })
    expect(mocks.transact).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      { applyUnchanged: true }
    )
    expect(dependencies.historyManager.applySettings).toHaveBeenCalledWith(current.privacy)
    expect(dependencies.proxyManager.applySettingsChange).not.toHaveBeenCalled()
    expect(dependencies.storageManager.applySettingsChange).not.toHaveBeenCalled()
    expect(dependencies.tonConnectService.clearSessions).not.toHaveBeenCalled()
  })

  it('clears custom TON Connect sessions when the experimental feature is disabled', async () => {
    current = AppSettingsSchema.parse({ advanced: { tonConnectEnabled: true } })
    const dependencies = createDependencies()
    const coordinator = new SettingsCoordinator(dependencies)

    await coordinator.apply({ advanced: { tonConnectEnabled: false } })

    expect(dependencies.tonConnectService.clearSessions).toHaveBeenCalledOnce()
  })

  it('waits for every runtime before publishing a batch', async () => {
    const dependencies = createDependencies()
    const proxyApply = deferred<{ bridgeRestarted: boolean }>()
    vi.mocked(dependencies.proxyManager.applySettingsChange).mockReturnValueOnce(proxyApply.promise)
    const coordinator = new SettingsCoordinator(dependencies)

    const result = coordinator.apply({
      network: { proxyPort: 9000, storagePort: 6000 },
      privacy: { historyMaxEntries: 200 },
    })
    await vi.waitFor(() => expect(dependencies.proxyManager.applySettingsChange).toHaveBeenCalledOnce())
    expect(dependencies.storageManager.applySettingsChange).toHaveBeenCalledOnce()
    expect(dependencies.historyManager.applySettings).not.toHaveBeenCalled()
    expect(mocks.emit).not.toHaveBeenCalled()

    proxyApply.resolve({ bridgeRestarted: false })
    await expect(result).resolves.toMatchObject({ network: { proxyPort: 9000, storagePort: 6000 } })
    expect(dependencies.historyManager.applySettings).toHaveBeenCalledOnce()
    expect(mocks.emit).toHaveBeenCalledTimes(2)
    expect(mocks.emit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        category: 'privacy',
        settings: expect.objectContaining({ network: expect.objectContaining({ proxyPort: 9000 }) }),
      })
    )
  })

  it('restores every changed runtime and publishes nothing after failure', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.proxyManager.applySettingsChange).mockRejectedValueOnce(new Error('port unavailable'))
    const coordinator = new SettingsCoordinator(dependencies)

    await expect(coordinator.apply({ network: { proxyPort: 9000, storagePort: 6000 } })).rejects.toThrow()

    expect(dependencies.proxyManager.applySettingsChange).toHaveBeenCalledTimes(2)
    expect(dependencies.storageManager.applySettingsChange).toHaveBeenCalledTimes(2)
    expect(dependencies.historyManager.applySettings).not.toHaveBeenCalled()
    expect(current.network.proxyPort).toBe(8080)
    expect(current.network.storagePort).toBe(5555)
    expect(mocks.emit).not.toHaveBeenCalled()
  })

  it('reconciles reset values and publishes the canonical dynamic path', async () => {
    current = AppSettingsSchema.parse({
      privacy: { historyMode: 'persistent', historyMaxEntries: 900 },
      storage: { downloadPath: '/custom' },
    })
    const dependencies = createDependencies()
    const coordinator = new SettingsCoordinator(dependencies)

    const settings = await coordinator.reset()

    expect(dependencies.historyManager.applySettings).toHaveBeenCalledWith(
      expect.objectContaining({ historyMode: 'memory' })
    )
    expect(settings.storage.downloadPath).toBe('/tmp/ton-browser/storage')
    expect(mocks.emit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reset: true, settings }))
  })

  it('rejects reset while active native services occupy the default ports', async () => {
    current = AppSettingsSchema.parse({ network: { proxyPort: 5555, storagePort: 8080 } })
    const dependencies = createDependencies()
    const coordinator = new SettingsCoordinator(dependencies)

    await expect(coordinator.reset()).rejects.toThrow(
      'Disconnect Proxy and Storage before swapping native service ports'
    )

    expect(dependencies.proxyManager.applySettingsChange).not.toHaveBeenCalled()
    expect(dependencies.storageManager.applySettingsChange).not.toHaveBeenCalled()
  })

  it('applies download folder changes to the storage runtime', async () => {
    const dependencies = createDependencies()
    const coordinator = new SettingsCoordinator(dependencies)

    await coordinator.apply({ storage: { downloadPath: '/new-downloads' } })

    expect(dependencies.storageManager.applySettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ storage: expect.objectContaining({ downloadPath: '/new-downloads' }) })
    )
  })

  it('rejects duplicate native service ports before changing runtimes', async () => {
    const dependencies = createDependencies()
    const coordinator = new SettingsCoordinator(dependencies)

    await expect(coordinator.apply({ network: { storagePort: 8080 } })).rejects.toThrow(
      'Proxy, Storage and Bridge ports must be distinct'
    )

    expect(dependencies.proxyManager.applySettingsChange).not.toHaveBeenCalled()
    expect(dependencies.storageManager.applySettingsChange).not.toHaveBeenCalled()
  })

  it('rejects live native service port swaps before changing runtimes', async () => {
    const dependencies = createDependencies()
    const coordinator = new SettingsCoordinator(dependencies)

    await expect(coordinator.apply({ network: { proxyPort: 5555, storagePort: 8080 } })).rejects.toThrow(
      'Disconnect Proxy and Storage before swapping native service ports'
    )

    expect(dependencies.proxyManager.applySettingsChange).not.toHaveBeenCalled()
    expect(dependencies.storageManager.applySettingsChange).not.toHaveBeenCalled()
  })

  it('allows native service port swaps while both runtimes are stopped', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.proxyManager.isActive).mockReturnValue(false)
    vi.mocked(dependencies.storageManager.isActive).mockReturnValue(false)
    const coordinator = new SettingsCoordinator(dependencies)

    await expect(coordinator.apply({ network: { proxyPort: 5555, storagePort: 8080 } })).resolves.toMatchObject({
      network: { proxyPort: 5555, storagePort: 8080 },
    })
  })

  it('clears session-only bridge permissions only after reset finalization succeeds', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.historyManager.applySettings).mockRejectedValueOnce(new Error('history write failed'))
    const coordinator = new SettingsCoordinator(dependencies)

    await expect(coordinator.reset()).rejects.toThrow('history write failed')
    expect(dependencies.bridgePermissionStore.clearSessionGrants).not.toHaveBeenCalled()

    await coordinator.reset()
    expect(dependencies.bridgePermissionStore.clearSessionGrants).toHaveBeenCalledOnce()
  })
})
