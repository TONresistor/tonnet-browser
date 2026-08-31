/**
 * IPC Handlers Tests
 * Tests for critical IPC handler security and functionality
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { mnemonicNew } from '@ton/crypto'
import { beginCell } from '@ton/core'

const tabsMocks = vi.hoisted(() => ({
  createTab: vi.fn(() => Promise.resolve(true)),
  closeTab: vi.fn(() => true),
  switchTab: vi.fn(() => true),
  getActiveView: vi.fn(),
  hideAllViews: vi.fn(),
  showActiveView: vi.fn(),
  navigateInTab: vi.fn(() => Promise.resolve(true)),
  loadBagFile: vi.fn(() => Promise.resolve()),
  getActiveTabId: vi.fn(() => 'tab-1'),
  cancelNavigation: vi.fn(),
}))
const loggingMocks = vi.hoisted(() => ({
  flushNativeLogs: vi.fn(() => Promise.resolve()),
  clipboardWriteText: vi.fn(),
}))
const settingsMocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
}))
const { createTab, closeTab, switchTab, getActiveView, hideAllViews, showActiveView, navigateInTab, getActiveTabId } =
  tabsMocks

// Store mock handlers
const mockHandlers = new Map<string, (...args: any[]) => any>()

// Store mock window reference
let mockMainWindow: any = null

// Mock Electron's ipcMain
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      mockHandlers.set(channel, handler)
    },
    on: vi.fn(),
    removeHandler: vi.fn((channel: string) => mockHandlers.delete(channel)),
  },
  BrowserWindow: vi.fn(),
  session: {
    fromPartition: vi.fn(() => ({
      clearCache: vi.fn(() => Promise.resolve()),
      clearStorageData: vi.fn(() => Promise.resolve()),
    })),
    defaultSession: {
      setProxy: vi.fn(),
    },
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
  },
  shell: {
    openPath: vi.fn(() => Promise.resolve('')),
    showItemInFolder: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/tonnet-test'),
    getVersion: vi.fn(() => '2.3.1'),
  },
  clipboard: { writeText: loggingMocks.clipboardWriteText },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  },
  net: {
    fetch: vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
  },
  IpcMainInvokeEvent: {},
}))

vi.mock('../../logging/native-log-router', () => ({ flushNativeLogs: loggingMocks.flushNativeLogs }))

// Mock proxy manager (class export only, singleton removed)
vi.mock('../../proxy/manager', () => ({
  ProxyManager: vi.fn(),
}))

// Mock storage manager (class export only, singleton removed)
vi.mock('../../storage/daemon', () => ({
  StorageManager: vi.fn(),
}))

// Mock storage bags

// Mock settings
vi.mock('../../settings', () => ({
  SettingsRuntimeApplyError: class SettingsRuntimeApplyError extends Error {},
  loadSettings: vi.fn(() => ({ general: {}, network: {}, storage: {} })),
  getSetting: settingsMocks.getSetting,
  setSetting: vi.fn(),
  resetSettings: vi.fn(),
  getDownloadPath: vi.fn(() => '/mock/downloads'),
  setDownloadPath: vi.fn(),
}))

// Mock windows/main with a factory that returns current mockMainWindow
vi.mock('../../windows/main', () => ({
  getMainWindow: () => mockMainWindow,
}))

// Mock tabs
vi.mock('../../windows/tabs', () => ({
  TabManager: vi.fn(),
  fileBrowserCache: new Map(),
}))

// Mock history manager
vi.mock('../../history/manager', () => ({
  historyManager: {
    changeMode: vi.fn(() => Promise.resolve({ success: true })),
    search: vi.fn(() => []),
    getRecent: vi.fn(() => []),
    getTopVisited: vi.fn(() => []),
    getByDateRange: vi.fn(() => []),
    deleteEntry: vi.fn(() => true),
    deleteByPattern: vi.fn(() => 0),
    clear: vi.fn(),
    getStats: vi.fn(() => ({ total: 0, mode: 'memory', isLocked: false })),
    hasPersistentFile: vi.fn(() => false),
  },
  HistoryMode: { MEMORY: 'memory', PERSISTENT: 'persistent' },
}))

vi.mock('../error-handler', () => ({
  ipcErrorHandler: {
    logError: vi.fn(),
  },
}))

// Mock validation
vi.mock('../validation', () => {
  class MockRateLimiter {
    check() {
      return true
    }
  }
  return {
    isValidNavigationUrl: vi.fn((url: string) => {
      try {
        const parsed = new URL(url)
        const blocked = ['javascript:', 'data:', 'file:', 'vbscript:']
        if (blocked.includes(parsed.protocol)) {
          return { valid: false, error: `Blocked scheme: ${parsed.protocol}` }
        }
        return { valid: true }
      } catch {
        return { valid: false, error: 'Invalid URL' }
      }
    }),
    isValidBagId: vi.fn((id: string) => /^[a-fA-F0-9]{64}$/.test(id)),
    isValidDownloadPath: vi.fn(() => ({ valid: true })),
    RateLimiter: MockRateLimiter,
  }
})

// Mock wallet manager
vi.mock('../../wallet/manager', () => ({
  WalletManager: vi.fn(),
}))

// Mock wallet history
vi.mock('../../wallet/history', () => ({
  WalletHistoryManager: vi.fn(),
}))

// Mock payment interceptor
vi.mock('../../wallet/payment-interceptor', () => ({
  PaymentInterceptor: vi.fn(),
}))

// Mock payment policy
vi.mock('../../wallet/payment-policy', () => ({
  PaymentPolicyStore: vi.fn(),
}))

// Mock overlay manager
vi.mock('../../windows/overlay-manager', () => ({
  OverlayManager: vi.fn(),
}))

// Mock bridge interceptor
vi.mock('../../bridge/permission-interceptor', () => ({
  BridgePermissionInterceptor: vi.fn(),
}))

// Mock bridge permission store
vi.mock('../../bridge/permission-store', () => ({
  BridgePermissionStore: vi.fn(),
}))

// Mock cocoon wallet module (used by new COCOON_WALLET_* handlers)
vi.mock('../../cocoon/wallet', () => ({
  hasCocoonWallet: vi.fn(() => Promise.resolve(false)),
  generateCocoonWallet: vi.fn(() => Promise.resolve({ ownerAddress: 'EQOwner', nodeAddress: 'EQNode', mnemonic: [] })),
  getCocoonWalletInfo: vi.fn(() => Promise.resolve(null)),
  exportCocoonMnemonic: vi.fn(() => Promise.resolve([])),
  deleteCocoonWallet: vi.fn(() => Promise.resolve()),
  loadCocoonWallet: vi.fn(() => Promise.resolve(null)),
  markSetupComplete: vi.fn(() => Promise.resolve()),
}))

// Mock cocoon setup module (used by COCOON_SETUP_* handlers)
vi.mock('../../cocoon/setup', () => ({
  getOwnerBalance: vi.fn(() => Promise.resolve(0n)),
  getCocoonWalletBalance: vi.fn(() => Promise.resolve(0n)),
  fundCocoonFromOwner: vi.fn(() => Promise.resolve({ bocHash: 'hash', seqno: 0, sentAmount: 0n })),
}))

// Mock cocoon platform (used by COCOON_AVAILABILITY handler)
vi.mock('../../cocoon/platform', () => ({
  checkCocoonAvailability: vi.fn(() => ({ available: false, reason: 'platform', message: 'Linux only' })),
}))

// Import after mocks
import { registerIpcHandlers, _resetHandlersForTesting } from '../handlers'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { getSetting, SettingsRuntimeApplyError } from '../../settings'
import type { ServiceRegistry } from '../../services'
import { DisposableStore } from '../../utils/disposable'
import { overlayIdB64ForRoom } from '../../chat/room'
import { broadcastId, parseBroadcast, sealBroadcast } from '../../chat/broadcast'
import { marshalEnvelope, parseEnvelope, signEnvelope } from '../../chat/envelope'
import { generateCocoonWallet, loadCocoonWallet, markSetupComplete } from '../../cocoon/wallet'
import { getOwnerBalance, getCocoonWalletBalance, fundCocoonFromOwner } from '../../cocoon/setup'
import { ChatSessionController } from '../../chat/session-controller'
import { AppSettingsSchema } from '../../../shared/types'

// Build mock service registry from the mock emitters
const mockProxyManager = (() => {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    getStatus: vi.fn(() => ({
      status: 'connected',
      connected: true,
      syncing: false,
      port: 8080,
    })),
    isRunning: vi.fn(() => false),
    applySettingsChange: vi.fn(() => Promise.resolve()),
    restart: vi.fn(() => Promise.resolve()),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  })
})()

const mockStorageManager = (() => {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    getStatus: vi.fn(() => ({
      running: true,
      port: 5555,
      storagePath: '/mock/downloads',
    })),
    addBag: vi.fn(() => Promise.resolve({ id: 'test-bag', status: 'downloading' })),
    removeBag: vi.fn(() => Promise.resolve(true)),
    listBags: vi.fn(() => Promise.resolve([])),
    pauseBag: vi.fn(() => Promise.resolve(true)),
    getBagDetails: vi.fn(() => Promise.resolve({ id: 'test-bag', files: [] })),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  })
})()

function createMockRegistry(): ServiceRegistry {
  return {
    ipcRegistrations: new DisposableStore(),
    lifecycleRegistrations: new DisposableStore(),
    secureStorage: { isAvailable: () => false, encrypt: vi.fn(), decrypt: vi.fn(), getBackendName: () => 'mock' },
    proxyManager: mockProxyManager as any,
    storageManager: mockStorageManager as any,
    walletManager: (() => {
      const emitter = new EventEmitter()
      return Object.assign(emitter, {
        getState: vi.fn(() => ({ isCreated: false })),
        getIdentitySnapshot: vi.fn(() => ({
          publicKey: '01'.repeat(32),
          addressRaw: `0:${'02'.repeat(32)}`,
          revision: 1,
        })),
        importWallet: vi.fn(() =>
          Promise.resolve({
            isCreated: true,
            address: 'UQImported',
            addressRaw: '0:imported',
            publicKey: '01',
            balance: '0',
          })
        ),
        authenticatePassword: vi.fn(() => Promise.resolve()),
        getForgetSnapshot: vi.fn(() => Promise.resolve({ fingerprint: 'wallet-fingerprint' })),
        forgetWallet: vi.fn(() =>
          Promise.resolve({ isCreated: false, address: '', addressRaw: '', publicKey: '', balance: '0' })
        ),
        deleteWallet: vi.fn(() =>
          Promise.resolve({ isCreated: false, address: '', addressRaw: '', publicKey: '', balance: '0' })
        ),
        resolveRecipient: vi.fn((input: string) => Promise.resolve({ address: input })),
        getBalance: vi.fn(() => Promise.resolve('100')),
        preflightTransfer: vi.fn(() =>
          Promise.resolve({ estimatedFee: '1', destinationStatus: 'active', walletBalance: '100' })
        ),
        prepareEncryptedComment: vi.fn(() => Promise.resolve(beginCell().storeUint(1, 1).endCell())),
        send: vi.fn(),
        setAutoLockMinutes: vi.fn(),
        fetchOnChainHistory: vi.fn(() => []),
      })
    })() as any,
    tonBridgeCoordinator: {
      whenReady: vi.fn(() => Promise.resolve()),
      waitUntilReady: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(() => Promise.resolve()),
    } as any,
    tonBridgeProviders: {
      wallet: { getBridge: vi.fn(() => null), onBridgeChanged: vi.fn() },
      ton: { getBridge: vi.fn(() => null), onBridgeChanged: vi.fn() },
      messenger: { getBridge: vi.fn(() => null), onBridgeChanged: vi.fn() },
    } as any,
    walletHistoryManager: {
      add: vi.fn(),
      getAll: vi.fn(() => []),
      reconcile: vi.fn((tx) => tx),
      clear: vi.fn(),
    } as any,
    tonIndexerClient: {
      isEnabled: vi.fn(() => false),
      getTransactions: vi.fn(() => Promise.resolve([])),
      getNftItems: vi.fn(() => Promise.resolve([])),
    } as any,
    paymentInterceptor: {
      approvePayment: vi.fn(),
      rejectPayment: vi.fn(),
      registerOnSession: vi.fn(),
      clearAccountState: vi.fn(),
    } as any,
    paymentPolicyStore: { destroy: vi.fn(), init: vi.fn() } as any,
    overlayManager: {
      show: vi.fn(),
      hide: vi.fn(),
      hideAll: vi.fn(),
      updateBounds: vi.fn(),
      isOverlayView: vi.fn(() => false),
      handleAction: vi.fn(() => false),
      getOverlayId: vi.fn(() => null),
      updateTheme: vi.fn(),
      destroy: vi.fn(),
      init: vi.fn(),
    } as any,
    bridgeInterceptor: { handleRequest: vi.fn(), init: vi.fn(), destroy: vi.fn() } as any,
    bridgePermissionStore: { getAllPermissions: vi.fn(() => []), revokePermission: vi.fn() } as any,
    tonConnectService: {
      init: vi.fn(),
      handleRequest: vi.fn(),
      getSessions: vi.fn(() => []),
      disconnectSession: vi.fn(),
      clearSessions: vi.fn(),
    } as any,
    tonConnectSessionStore: { init: vi.fn(), list: vi.fn(() => []) } as any,
    historyManager: {
      changeMode: vi.fn(() => Promise.resolve({ success: true })),
      search: vi.fn(() => []),
      getRecent: vi.fn(() => []),
      getTopVisited: vi.fn(() => []),
      getByDateRange: vi.fn(() => []),
      deleteEntry: vi.fn(() => true),
      deleteByPattern: vi.fn(() => 0),
      clear: vi.fn(),
      getStats: vi.fn(() => ({ total: 0, mode: 'memory', isLocked: false })),
      hasPersistentFile: vi.fn(() => false),
    } as any,
    cocoonManager: (() => {
      const emitter = new EventEmitter()
      return Object.assign(emitter, {
        getState: vi.fn(() => ({ kind: 'stopped' })),
        getHttpPort: vi.fn(() => 10000),
        start: vi.fn(() => Promise.resolve()),
        stop: vi.fn(() => Promise.resolve()),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
      })
    })() as any,
    withdrawDriver: (() => {
      const emitter = new EventEmitter()
      return Object.assign(emitter, {
        start: vi.fn(),
        stop: vi.fn(),
        triggerTick: vi.fn(),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
      })
    })() as any,
    recoveryDriver: (() => {
      const emitter = new EventEmitter()
      return Object.assign(emitter, {
        start: vi.fn(),
        stop: vi.fn(),
        triggerTick: vi.fn(),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
      })
    })() as any,
    tabManager: {
      sessions: {
        getAllSessions: vi.fn(() => []),
        onPrivacySettingsChanged: vi.fn(),
      },
      storage: {
        storageManager: mockStorageManager,
        storageBagCache: new Map(),
        storageBrowserLoading: new Set(),
        storageBrowserEpochs: new Map(),
        fileBrowserCache: new Map(),
      },
      createTab,
      closeTab,
      switchTab,
      navigateInTab,
      getActiveView,
      getActiveTabId,
      hideAllViews,
      showActiveView,
      loadBagFile: tabsMocks.loadBagFile,
      cancelNavigation: tabsMocks.cancelNavigation,
      updateSidebarWidth: vi.fn(),
      updateWalletSidebarWidth: vi.fn(),
      onAppearanceSettingsChanged: vi.fn(),
      updateProxyPort: vi.fn(() => Promise.resolve()),
      resolveSenderIdentity: vi.fn(() => null),
      initialize: vi.fn(),
      dispose: vi.fn(),
    } as any,
    chatSessionController: new ChatSessionController() as any,
    cocoonPersistence: {
      stakeCache: { getPendingWithdraw: vi.fn(() => Promise.resolve(null)) },
      consumedArchive: { list: vi.fn(() => Promise.resolve([])), getByArchivedAt: vi.fn(() => Promise.resolve(null)) },
      recoveryQueue: { list: vi.fn(() => Promise.resolve([])), remove: vi.fn(() => Promise.resolve()) },
    } as any,
    cocoonActivation: {
      cocoonManager: null as any,
      getBridge: vi.fn(() => null),
      getNativeIdentity: vi.fn(() => null),
      getNativeBalance: vi.fn(() => Promise.resolve('0')),
      sendNative: vi.fn(() => Promise.resolve()),
      persistence: null as any,
    },
    settingsCoordinator: {
      apply: vi.fn(() => Promise.resolve(AppSettingsSchema.parse({}))),
      reset: vi.fn(() => Promise.resolve(AppSettingsSchema.parse({}))),
    } as any,
  }
}

// Helper to create a mock IPC event that passes origin verification
const createMockEvent = () => {
  // Event sender must match mainWindow.webContents for origin check
  return { sender: mockMainWindow?.webContents } as any
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

let mockRegistry: ServiceRegistry

function resetHandlersTestEnv(): void {
  vi.clearAllMocks()
  mockHandlers.clear()
  mockProxyManager.removeAllListeners()
  mockStorageManager.removeAllListeners()
  _resetHandlersForTesting() // Reset guard to allow re-registration
  mockMainWindow = {
    webContents: { send: vi.fn() },
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1024, height: 768 })),
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 1024, height: 768 })),
    setTitle: vi.fn(),
  }
  settingsMocks.getSetting.mockImplementation((category: string) =>
    category === 'advanced' ? { tonConnectEnabled: false } : {}
  )
  mockRegistry = createMockRegistry()
  registerIpcHandlers(mockRegistry)
}

describe('IPC Handlers', () => {
  beforeEach(resetHandlersTestEnv)

  it('owns every handler and push listener in a disposable registration scope', () => {
    const handlerCount = mockHandlers.size
    expect(handlerCount).toBeGreaterThan(0)
    expect(mockProxyManager.listenerCount('status')).toBe(1)
    expect(mockStorageManager.listenerCount('bags-updated')).toBe(1)

    mockRegistry.ipcRegistrations.dispose()

    expect(mockHandlers.size).toBe(0)
    expect(mockProxyManager.listenerCount('status')).toBe(0)
    expect(mockStorageManager.listenerCount('bags-updated')).toBe(0)

    const replacement = createMockRegistry()
    registerIpcHandlers(replacement)
    expect(mockHandlers.size).toBe(handlerCount)
    expect(mockProxyManager.listenerCount('status')).toBe(1)
    expect(mockStorageManager.listenerCount('bags-updated')).toBe(1)
    replacement.ipcRegistrations.dispose()
  })

  describe('TON Connect experimental gate', () => {
    const tonsiteEvent = { sender: { id: 42 } } as any

    beforeEach(() => {
      vi.mocked(mockRegistry.tabManager.resolveSenderIdentity).mockReturnValue('webdom.ton')
    })

    it('reports the feature as disabled by default and blocks connect requests', async () => {
      const availability = mockHandlers.get(IPC_CHANNELS.TONCONNECT_AVAILABILITY)!
      const request = mockHandlers.get(IPC_CHANNELS.TONCONNECT_REQUEST)!

      await expect(availability(tonsiteEvent)).resolves.toEqual({ enabled: false })
      await expect(
        request(tonsiteEvent, {
          method: 'connect',
          protocolVersion: 2,
          request: { manifestUrl: 'https://webdom.ton/tonconnect-manifest.json', items: [{ name: 'ton_addr' }] },
        })
      ).resolves.toMatchObject({ event: 'connect_error', payload: { message: 'Experimental feature disabled' } })
      expect(mockRegistry.tonConnectService.handleRequest).not.toHaveBeenCalled()
    })

    it('forwards requests when the experimental feature is enabled', async () => {
      settingsMocks.getSetting.mockImplementation((category: string) =>
        category === 'advanced' ? { tonConnectEnabled: true } : {}
      )
      vi.mocked(mockRegistry.tonConnectService.handleRequest).mockResolvedValueOnce({
        event: 'connect_error',
        id: 0,
        payload: { code: 0, message: 'No wallet available' },
      })
      const request = mockHandlers.get(IPC_CHANNELS.TONCONNECT_REQUEST)!

      await request(tonsiteEvent, {
        method: 'connect',
        protocolVersion: 2,
        request: { manifestUrl: 'https://webdom.ton/tonconnect-manifest.json', items: [{ name: 'ton_addr' }] },
      })

      expect(mockRegistry.tonConnectService.handleRequest).toHaveBeenCalledOnce()
    })
  })

  describe('Proxy Handlers', () => {
    it('applies the effective proxy port when the runtime connects', async () => {
      vi.mocked(mockRegistry.proxyManager.getStatus).mockReturnValueOnce({
        status: 'connected',
        connected: true,
        syncing: false,
        port: 9090,
      } as never)

      mockProxyManager.emit('status', 'connected')
      await Promise.resolve()

      expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(9090)
    })

    it('does not publish a stale connected status after the runtime stops', async () => {
      const update = deferred<void>()
      vi.mocked(mockRegistry.tabManager.updateProxyPort).mockReturnValueOnce(update.promise)
      vi.mocked(mockRegistry.proxyManager.getStatus)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
        .mockReturnValueOnce({ status: 'stopped', connected: false, port: 9090 } as never)

      mockProxyManager.emit('status', 'connected')
      mockProxyManager.emit('status', 'stopped')
      update.resolve()
      await update.promise
      await Promise.resolve()

      const statusEvents = vi
        .mocked(mockMainWindow.webContents.send)
        .mock.calls.filter((call: unknown[]) => call[0] === IPC_CHANNELS.PROXY_STATUS)
      expect(statusEvents).toEqual([[IPC_CHANNELS.PROXY_STATUS, expect.objectContaining({ status: 'stopped' })]])
    })

    it('PROXY_CONNECT starts proxy and returns success', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_CONNECT)!
      expect(handler).toBeDefined()

      const result = await handler!(createMockEvent())

      expect(result.success).toBe(true)
      expect(mockRegistry.proxyManager.start).toHaveBeenCalled()
    })

    it('PROXY_CONNECT waits for the effective proxy port', async () => {
      const update = deferred<void>()
      vi.mocked(mockRegistry.tabManager.updateProxyPort).mockReturnValueOnce(update.promise)
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_CONNECT)!

      const result = handler(createMockEvent())
      await vi.waitFor(() => expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(8080))
      let settled = false
      void result.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      update.resolve()
      await expect(result).resolves.toMatchObject({ success: true })
    })

    it('PROXY_CONNECT follows proxy port changes before returning', async () => {
      const firstUpdate = deferred<void>()
      const secondUpdate = deferred<void>()
      vi.mocked(mockRegistry.tabManager.updateProxyPort)
        .mockReturnValueOnce(firstUpdate.promise)
        .mockReturnValueOnce(secondUpdate.promise)
      vi.mocked(mockRegistry.proxyManager.getStatus)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 8080 } as never)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_CONNECT)!

      const result = handler(createMockEvent())
      await vi.waitFor(() => expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(8080))
      firstUpdate.resolve()
      await vi.waitFor(() => expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(9090))
      secondUpdate.resolve()

      await expect(result).resolves.toMatchObject({ success: true, status: 'connected', port: 9090 })
    })

    it('PROXY_CONNECT handles errors gracefully', async () => {
      vi.mocked(mockRegistry.proxyManager.start).mockRejectedValueOnce(new Error('Proxy failed'))

      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_CONNECT)!
      const result = await handler!(createMockEvent())

      expect(result).toEqual({
        ok: false,
        error: { code: 'PROXY_START_FAILED', message: 'Operation failed', retryable: false },
      })
    })

    it('PROXY_DISCONNECT stops both storage and proxy', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_DISCONNECT)!
      const result = await handler!(createMockEvent())

      expect(mockRegistry.storageManager.stop).toHaveBeenCalled()
      expect(mockRegistry.proxyManager.stop).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('PROXY_STATUS returns current status', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_STATUS)!
      const result = await handler!(createMockEvent())

      expect(result.status).toBe('connected')
      expect(result.port).toBe(8080)
    })

    it('PROXY_STATUS waits for the effective proxy port', async () => {
      const update = deferred<void>()
      vi.mocked(mockRegistry.tabManager.updateProxyPort).mockReturnValueOnce(update.promise)
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_STATUS)!

      const result = handler(createMockEvent())
      await vi.waitFor(() => expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(8080))
      update.resolve()

      await expect(result).resolves.toMatchObject({ status: 'connected', port: 8080 })
    })

    it('PROXY_STATUS follows proxy port changes before returning', async () => {
      const firstUpdate = deferred<void>()
      const secondUpdate = deferred<void>()
      vi.mocked(mockRegistry.tabManager.updateProxyPort)
        .mockReturnValueOnce(firstUpdate.promise)
        .mockReturnValueOnce(secondUpdate.promise)
      vi.mocked(mockRegistry.proxyManager.getStatus)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 8080 } as never)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_STATUS)!

      const result = handler(createMockEvent())
      await vi.waitFor(() => expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(8080))
      firstUpdate.resolve()
      await vi.waitFor(() => expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(9090))
      secondUpdate.resolve()

      await expect(result).resolves.toMatchObject({ status: 'connected', port: 9090 })
    })
  })

  describe('Tab Handlers', () => {
    it('TAB_CREATE creates a new tab', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.TAB_CREATE)!
      const result = await handler!(createMockEvent(), 'new-tab-id', 'ton://start')

      expect(createTab).toHaveBeenCalledWith('new-tab-id', 'ton://start')
      expect(result.success).toBe(true)
    })

    it('TAB_CLOSE closes a tab', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.TAB_CLOSE)!
      const result = await handler!(createMockEvent(), 'tab-to-close')

      expect(closeTab).toHaveBeenCalledWith('tab-to-close')
      expect(result.success).toBe(true)
    })

    it('TAB_SWITCH switches to a tab', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.TAB_SWITCH)!
      const result = await handler!(createMockEvent(), 'tab-to-activate')

      expect(switchTab).toHaveBeenCalledWith('tab-to-activate')
      expect(result.success).toBe(true)
    })
  })

  describe('Wallet Handlers', () => {
    it('rejects wallet deletion before confirmation when the password is invalid', async () => {
      vi.mocked(mockRegistry.walletManager.getState).mockReturnValue({
        isCreated: true,
        address: 'UQCurrent',
        passwordProtected: true,
      } as never)
      vi.mocked(mockRegistry.walletManager.authenticatePassword).mockRejectedValueOnce(new Error('invalid password'))
      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_DELETE)!

      await expect(handler(createMockEvent(), 'definitely the wrong password')).resolves.toEqual({
        ok: false,
        error: { code: 'INVALID_PASSWORD', message: 'Invalid wallet password', retryable: false },
      })
      expect(mockRegistry.overlayManager.show).not.toHaveBeenCalled()
      expect(mockRegistry.walletManager.deleteWallet).not.toHaveBeenCalled()
    })

    it('revalidates the password and wallet identity after deletion confirmation', async () => {
      const identity = {
        publicKey: '01'.repeat(32),
        addressRaw: `0:${'02'.repeat(32)}`,
        revision: 1,
      }
      vi.mocked(mockRegistry.walletManager.getState).mockReturnValue({
        isCreated: true,
        address: 'UQCurrent',
        passwordProtected: true,
      } as never)
      vi.mocked(mockRegistry.walletManager.getIdentitySnapshot).mockReturnValue(identity)
      vi.mocked(mockRegistry.overlayManager.show).mockImplementation((_id, _bounds, _content, callback) => {
        callback?.('approve', {})
        return true
      })
      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_DELETE)!

      await expect(handler(createMockEvent(), 'correct horse battery staple')).resolves.toMatchObject({
        isCreated: false,
      })
      expect(mockRegistry.walletManager.authenticatePassword).toHaveBeenCalledWith('correct horse battery staple')
      expect(mockRegistry.walletManager.deleteWallet).toHaveBeenCalledWith('correct horse battery staple', identity)
    })

    it('forgets a locked wallet without its password after confirmation', async () => {
      vi.mocked(mockRegistry.walletManager.getState).mockReturnValue({
        isCreated: true,
        address: 'UQCurrent',
        passwordProtected: true,
        isLocked: true,
      } as never)
      vi.mocked(mockRegistry.overlayManager.show).mockImplementation((_id, _bounds, _content, callback) => {
        callback?.('approve', {})
        return true
      })
      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_FORGET)!

      await expect(handler(createMockEvent())).resolves.toMatchObject({ isCreated: false })
      expect(mockRegistry.walletManager.authenticatePassword).not.toHaveBeenCalled()
      expect(mockRegistry.walletManager.forgetWallet).toHaveBeenCalledWith('wallet-fingerprint')
      expect(mockRegistry.walletHistoryManager.clear).toHaveBeenCalledOnce()
    })

    it('forgets an unreadable wallet without requiring a loaded identity', async () => {
      vi.mocked(mockRegistry.walletManager.getState).mockReturnValue({
        isCreated: false,
        address: '',
        passwordProtected: false,
        decryptFailed: true,
      } as never)
      vi.mocked(mockRegistry.overlayManager.show).mockImplementation((_id, _bounds, _content, callback) => {
        callback?.('approve', {})
        return true
      })
      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_FORGET)!

      await expect(handler(createMockEvent())).resolves.toMatchObject({ isCreated: false })
      expect(mockRegistry.walletManager.getIdentitySnapshot).not.toHaveBeenCalled()
      expect(mockRegistry.walletManager.forgetWallet).toHaveBeenCalledWith('wallet-fingerprint')
    })

    it('clears account-scoped state after a wallet import succeeds', async () => {
      const mnemonic = await mnemonicNew(24)
      const password = 'correct horse battery staple'
      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_IMPORT)!

      const result = await handler(createMockEvent(), mnemonic, password, 'v5R1')

      expect(result).toMatchObject({ isCreated: true, address: 'UQImported' })
      expect(mockRegistry.walletManager.importWallet).toHaveBeenCalledWith(mnemonic, password, 'v5R1')
      expect(mockRegistry.walletHistoryManager.clear).toHaveBeenCalledOnce()
      expect(mockRegistry.tonConnectService.clearSessions).toHaveBeenCalledOnce()
      expect(mockRegistry.paymentInterceptor.clearAccountState).toHaveBeenCalledOnce()
      expect(vi.mocked(mockRegistry.walletManager.importWallet).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(mockRegistry.walletHistoryManager.clear).mock.invocationCallOrder[0]
      )
      expect(vi.mocked(mockRegistry.walletManager.importWallet).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(mockRegistry.tonConnectService.clearSessions).mock.invocationCallOrder[0]
      )
    })

    it('keeps account-scoped state when wallet import fails', async () => {
      vi.mocked(mockRegistry.walletManager.importWallet).mockRejectedValueOnce(new Error('Invalid mnemonic phrase'))
      const mnemonic = Array.from({ length: 24 }, (_, index) => `word${index + 1}`)
      const password = 'correct horse battery staple'
      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_IMPORT)!

      const result = await handler(createMockEvent(), mnemonic, password, 'v5R1')

      expect(result).toEqual({
        ok: false,
        error: { code: 'INVALID_MNEMONIC', message: 'Invalid mnemonic phrase', retryable: false },
      })
      expect(mockRegistry.walletHistoryManager.clear).not.toHaveBeenCalled()
      expect(mockRegistry.tonConnectService.clearSessions).not.toHaveBeenCalled()
    })

    it('requires native confirmation before replacing an existing wallet', async () => {
      vi.mocked(mockRegistry.walletManager.getState).mockReturnValue({ isCreated: true, address: 'UQCurrent' } as never)
      vi.mocked(mockRegistry.overlayManager.show).mockImplementation((_id, _bounds, _content, callback) => {
        callback?.('deny', {})
        return true
      })
      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_IMPORT)!
      const mnemonic = await mnemonicNew(24)
      await expect(handler(createMockEvent(), mnemonic, 'correct horse battery staple', 'v5R1')).resolves.toEqual({
        ok: false,
        error: { code: 'USER_CANCELLED', message: 'Wallet import cancelled', retryable: false },
      })
      expect(mockRegistry.overlayManager.show).toHaveBeenCalledWith(
        expect.stringContaining('wallet-replace-'),
        expect.any(Object),
        expect.objectContaining({
          rows: expect.arrayContaining([
            { label: 'Current wallet', value: 'UQCurrent' },
            expect.objectContaining({ label: 'New wallet' }),
            { label: 'New account type', value: 'v5R1 · TON' },
          ]),
        }),
        expect.any(Function),
        { autoDismiss: false }
      )
      expect(mockRegistry.walletManager.importWallet).not.toHaveBeenCalled()
    })

    it('reports an insufficient balance as a stable business failure', async () => {
      vi.mocked(mockRegistry.walletManager.getState).mockReturnValueOnce({
        isCreated: true,
        isLocked: false,
        needsPasswordSetup: false,
        backupVerified: true,
      } as never)
      vi.mocked(mockRegistry.tonBridgeProviders.wallet.getBridge).mockReturnValueOnce({} as never)
      vi.mocked(mockRegistry.walletManager.preflightTransfer).mockResolvedValueOnce({
        estimatedFee: '1',
        destinationStatus: 'active',
        walletBalance: '10',
      })
      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_SEND)!

      const result = await handler(createMockEvent(), 'EQRecipient', '11')

      expect(result).toEqual({
        ok: false,
        error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance', retryable: false },
      })
      expect(mockRegistry.walletManager.send).not.toHaveBeenCalled()
    })

    it('reserves network fees in the main-process balance check', async () => {
      vi.mocked(mockRegistry.walletManager.getState).mockReturnValueOnce({
        isCreated: true,
        isLocked: false,
        needsPasswordSetup: false,
        backupVerified: true,
      } as never)
      vi.mocked(mockRegistry.tonBridgeProviders.wallet.getBridge).mockReturnValueOnce({} as never)
      vi.mocked(mockRegistry.walletManager.preflightTransfer).mockResolvedValueOnce({
        estimatedFee: '10000000',
        destinationStatus: 'active',
        walletBalance: '10000009',
      })
      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_SEND)!
      await expect(handler(createMockEvent(), 'EQRecipient', '10')).resolves.toEqual({
        ok: false,
        error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance', retryable: false },
      })
      expect(mockRegistry.walletManager.send).not.toHaveBeenCalled()
    })

    it('requires a main-process approval before a renderer transfer', async () => {
      vi.mocked(mockRegistry.walletManager.getState).mockReturnValue({
        isCreated: true,
        isLocked: false,
        needsPasswordSetup: false,
        backupVerified: true,
      } as never)
      vi.mocked(mockRegistry.tonBridgeProviders.wallet.getBridge).mockReturnValue({} as never)
      vi.mocked(mockRegistry.walletManager.getBalance).mockResolvedValue('100000000')
      vi.mocked(mockRegistry.walletManager.resolveRecipient).mockResolvedValue({
        address: 'EQRecipient',
        domain: 'example.ton',
      })
      vi.mocked(mockRegistry.walletManager.send).mockResolvedValue({
        id: 'tx-1',
        type: 'send',
        amount: '10',
        address: 'EQRecipient',
        timestamp: 1,
        status: 'pending',
      })
      vi.mocked(mockRegistry.overlayManager.show).mockImplementation((_id, _bounds, _content, callback) => {
        callback?.('approve', {})
        return true
      })

      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_SEND)!
      await expect(handler(createMockEvent(), 'example.ton', '10')).resolves.toMatchObject({ id: 'tx-1' })
      expect(mockRegistry.overlayManager.show).toHaveBeenCalledWith(
        expect.stringContaining('wallet-transfer-'),
        expect.any(Object),
        expect.objectContaining({
          title: 'Confirm wallet transfer',
          amount: '0.00000001 GRAM',
          rows: expect.arrayContaining([
            expect.objectContaining({
              label: 'Memo',
              value: '',
              action: expect.objectContaining({ id: 'set-memo', label: 'Edit', editable: true }),
            }),
          ]),
        }),
        expect.any(Function),
        { autoDismiss: false }
      )
      expect(mockRegistry.walletManager.send).toHaveBeenCalledWith(
        'EQRecipient',
        '10',
        undefined,
        expect.objectContaining({ publicKey: expect.any(String), addressRaw: expect.any(String) })
      )
    })

    it('revalidates an edited memo before showing the final approval', async () => {
      vi.mocked(mockRegistry.walletManager.getState).mockReturnValue({
        isCreated: true,
        isLocked: false,
        needsPasswordSetup: false,
        backupVerified: true,
      } as never)
      vi.mocked(mockRegistry.tonBridgeProviders.wallet.getBridge).mockReturnValue({} as never)
      vi.mocked(mockRegistry.walletManager.resolveRecipient).mockResolvedValue({ address: 'EQRecipient' })
      vi.mocked(mockRegistry.walletManager.send).mockResolvedValue({
        id: 'tx-with-memo',
        type: 'send',
        amount: '10',
        address: 'EQRecipient',
        timestamp: 1,
        status: 'pending',
      })

      let approvalCount = 0
      vi.mocked(mockRegistry.overlayManager.show).mockImplementation((_id, _bounds, _content, callback) => {
        if (approvalCount++ === 0) callback?.('set-memo', { memo: 'Thanks' })
        else callback?.('approve', {})
        return true
      })

      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_SEND)!
      await expect(handler(createMockEvent(), 'EQRecipient', '10')).resolves.toMatchObject({ id: 'tx-with-memo' })

      expect(mockRegistry.walletManager.preflightTransfer).toHaveBeenNthCalledWith(
        1,
        'EQRecipient',
        '10',
        undefined,
        expect.any(Object),
        undefined
      )
      expect(mockRegistry.walletManager.preflightTransfer).toHaveBeenNthCalledWith(
        2,
        'EQRecipient',
        '10',
        'Thanks',
        expect.any(Object),
        undefined
      )
      expect(mockRegistry.walletManager.send).toHaveBeenCalledWith('EQRecipient', '10', 'Thanks', expect.any(Object))
      const approvalIds = vi.mocked(mockRegistry.overlayManager.show).mock.calls.map(([id]) => id)
      expect(new Set(approvalIds).size).toBe(1)
      expect(mockRegistry.overlayManager.show).toHaveBeenLastCalledWith(
        expect.stringContaining('wallet-transfer-'),
        expect.any(Object),
        expect.objectContaining({
          rows: expect.arrayContaining([{ label: 'Encrypted', toggle: { id: 'set-encryption', checked: false } }]),
        }),
        expect.any(Function),
        { autoDismiss: false }
      )
    })

    it('revalidates a memo after encryption is enabled from the approval', async () => {
      const encryptedBody = beginCell().storeUint(0x2167da4b, 32).endCell()
      vi.mocked(mockRegistry.walletManager.getState).mockReturnValue({
        isCreated: true,
        isLocked: false,
        needsPasswordSetup: false,
        backupVerified: true,
      } as never)
      vi.mocked(mockRegistry.tonBridgeProviders.wallet.getBridge).mockReturnValue({} as never)
      vi.mocked(mockRegistry.walletManager.resolveRecipient).mockResolvedValue({ address: 'EQRecipient' })
      vi.mocked(mockRegistry.walletManager.prepareEncryptedComment).mockResolvedValue(encryptedBody)
      vi.mocked(mockRegistry.walletManager.send).mockResolvedValue({
        id: 'tx-encrypted-from-approval',
        type: 'send',
        amount: '10',
        address: 'EQRecipient',
        timestamp: 1,
        status: 'pending',
      })

      let reviewCount = 0
      vi.mocked(mockRegistry.overlayManager.show).mockImplementation((_id, _bounds, _content, callback) => {
        if (reviewCount++ === 0) callback?.('set-encryption', { enabled: true })
        else callback?.('approve', {})
        return true
      })

      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_SEND)!
      await expect(handler(createMockEvent(), 'EQRecipient', '10', 'Thanks')).resolves.toMatchObject({
        id: 'tx-encrypted-from-approval',
      })

      expect(mockRegistry.walletManager.prepareEncryptedComment).toHaveBeenCalledWith(
        'EQRecipient',
        'Thanks',
        expect.any(Object)
      )
      expect(mockRegistry.walletManager.preflightTransfer).toHaveBeenLastCalledWith(
        'EQRecipient',
        '10',
        'Thanks',
        expect.any(Object),
        encryptedBody
      )
      expect(mockRegistry.walletManager.send).toHaveBeenCalledWith(
        'EQRecipient',
        '10',
        'Thanks',
        expect.any(Object),
        encryptedBody,
        true
      )
      expect(mockRegistry.overlayManager.show).toHaveBeenLastCalledWith(
        expect.stringContaining('wallet-transfer-'),
        expect.any(Object),
        expect.objectContaining({
          rows: expect.arrayContaining([{ label: 'Encrypted', toggle: { id: 'set-encryption', checked: true } }]),
        }),
        expect.any(Function),
        { autoDismiss: false }
      )
    })

    it('reuses the prepared encrypted comment for preflight and send', async () => {
      const encryptedBody = beginCell().storeUint(0x2167da4b, 32).endCell()
      vi.mocked(mockRegistry.walletManager.getState).mockReturnValue({
        isCreated: true,
        isLocked: false,
        needsPasswordSetup: false,
        backupVerified: true,
      } as never)
      vi.mocked(mockRegistry.tonBridgeProviders.wallet.getBridge).mockReturnValue({} as never)
      vi.mocked(mockRegistry.walletManager.resolveRecipient).mockResolvedValue({ address: 'EQRecipient' })
      vi.mocked(mockRegistry.walletManager.prepareEncryptedComment).mockResolvedValue(encryptedBody)
      vi.mocked(mockRegistry.walletManager.send).mockResolvedValue({
        id: 'tx-encrypted',
        type: 'send',
        amount: '10',
        address: 'EQRecipient',
        timestamp: 1,
        status: 'pending',
        comment: 'private memo',
        commentEncrypted: true,
      })
      vi.mocked(mockRegistry.overlayManager.show).mockImplementation((_id, _bounds, _content, callback) => {
        callback?.('approve', {})
        return true
      })

      const handler = mockHandlers.get(IPC_CHANNELS.WALLET_SEND)!
      await expect(handler(createMockEvent(), 'EQRecipient', '10', 'private memo', true)).resolves.toMatchObject({
        id: 'tx-encrypted',
      })

      const identity = expect.objectContaining({ publicKey: expect.any(String), addressRaw: expect.any(String) })
      expect(mockRegistry.walletManager.prepareEncryptedComment).toHaveBeenCalledWith(
        'EQRecipient',
        'private memo',
        identity
      )
      expect(mockRegistry.walletManager.preflightTransfer).toHaveBeenCalledWith(
        'EQRecipient',
        '10',
        'private memo',
        identity,
        encryptedBody
      )
      expect(mockRegistry.walletManager.send).toHaveBeenCalledWith(
        'EQRecipient',
        '10',
        'private memo',
        identity,
        encryptedBody,
        true
      )
      expect(mockRegistry.overlayManager.show).toHaveBeenCalledWith(
        expect.stringContaining('wallet-transfer-'),
        expect.any(Object),
        expect.objectContaining({
          rows: expect.arrayContaining([{ label: 'Encrypted', toggle: { id: 'set-encryption', checked: true } }]),
        }),
        expect.any(Function),
        { autoDismiss: false }
      )
    })
  })

  describe('Storage Handlers', () => {
    it('STORAGE_ADD_BAG forwards a valid bagId to addBag', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_ADD_BAG)!
      expect(handler).toBeDefined() // Skip if not registered

      // Valid 64-char hex
      const validBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      await handler(createMockEvent(), validBagId, 'Test Bag')

      expect(mockStorageManager.addBag).toHaveBeenCalledWith(validBagId)
    })

    it('STORAGE_ADD_BAG rejects invalid bagId', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_ADD_BAG)!
      expect(handler).toBeDefined()

      const invalidBagId = 'invalid-bag-id'
      const result = await handler(createMockEvent(), invalidBagId, 'Test')

      expect(result).toEqual({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid request payload', retryable: false },
      })
      expect(mockStorageManager.addBag).not.toHaveBeenCalled()
    })

    it('STORAGE_REMOVE_BAG removes bag by id', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_REMOVE_BAG)!
      expect(handler).toBeDefined()

      const validBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      await handler(createMockEvent(), validBagId)

      expect(mockStorageManager.removeBag).toHaveBeenCalledWith(validBagId)
    })
  })

  describe('Settings Handlers', () => {
    it('SETTINGS_SET updates a setting category', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_SET)!
      expect(handler).toBeDefined()

      await handler(createMockEvent(), 'network', { proxyPort: 9000 })

      expect(mockRegistry.settingsCoordinator.apply).toHaveBeenCalledWith({ network: { proxyPort: 9000 } })
    })

    it('SETTINGS_APPLY submits one multi-category transaction', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_APPLY)!
      const patch = { network: { proxyPort: 9000 }, privacy: { clearOnExit: false } }

      const result = await handler(createMockEvent(), patch)

      expect(mockRegistry.settingsCoordinator.apply).toHaveBeenCalledWith(patch)
      expect(result).toEqual(AppSettingsSchema.parse({}))
    })

    it('SETTINGS_SET reports runtime apply failures', async () => {
      vi.mocked(mockRegistry.settingsCoordinator.apply).mockRejectedValueOnce(
        new SettingsRuntimeApplyError(new Error('port unavailable'))
      )
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_SET)!

      const result = await handler(createMockEvent(), 'network', { proxyPort: 9000 })

      expect(result).toEqual({
        ok: false,
        error: { code: 'RUNTIME_APPLY_FAILED', message: 'Unable to apply settings', retryable: false },
      })
    })

    it('SETTINGS_RESET restores defaults', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_RESET)!
      expect(handler).toBeDefined()

      await handler(createMockEvent())

      expect(mockRegistry.settingsCoordinator.reset).toHaveBeenCalled()
    })

    it('flushes native logs before copying the diagnostic report', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_DIAGNOSTICS_COPY)!
      await handler(createMockEvent())

      expect(loggingMocks.flushNativeLogs).toHaveBeenCalledOnce()
      expect(loggingMocks.clipboardWriteText).toHaveBeenCalledOnce()
      expect(loggingMocks.flushNativeLogs.mock.invocationCallOrder[0]).toBeLessThan(
        loggingMocks.clipboardWriteText.mock.invocationCallOrder[0]
      )
    })
  })

  describe('Chat Handlers', () => {
    it('reports disabled Messenger networking without collapsing it to an internal error', async () => {
      vi.mocked(getSetting).mockImplementation(((category: string) => {
        if (category === 'messenger') return { networkEnabled: false, attachWalletIdentity: false }
        return {}
      }) as typeof getSetting)
      const handler = mockHandlers.get(IPC_CHANNELS.CHAT_CONNECT)!

      const result = await handler(createMockEvent(), 'tonnet:groupchat', undefined)

      expect(result).toEqual({
        ok: false,
        error: { code: 'MESSENGER_DISABLED', message: 'Messenger networking is disabled', retryable: false },
      })
    })

    it('rejects a candidate when its challenge-bearing presence cannot be sent', async () => {
      const room = 'tonnet:groupchat'
      const bootstrap = Buffer.alloc(32, 9).toString('base64')
      const bridge = {
        dhtFindValue: vi.fn(),
        dhtFindOverlayNodes: vi.fn(() => Promise.resolve({ nodes: [], count: 0 })),
        overlayConnectAndJoin: vi.fn(() => Promise.resolve('peer-id')),
        overlayQuery: vi.fn((_overlay: string, data: string) => {
          if (data === 'onDZSA==') {
            const response = Buffer.alloc(40)
            Buffer.from('4c34c713', 'hex').copy(response)
            Buffer.alloc(32, 0x42).copy(response, 4)
            response.writeInt32LE(Math.floor(Date.now() / 1000) + 60, 36)
            return Promise.resolve(response.toString('base64'))
          }
          const response = Buffer.alloc(8)
          Buffer.from('47a0c32f', 'hex').copy(response)
          response.writeInt32LE(Math.floor(Date.now() / 1000), 4)
          return Promise.resolve(response.toString('base64'))
        }),
        onOverlayMessage: vi.fn(() => vi.fn()),
        overlaySendRaw: vi.fn(() => Promise.reject(new Error('presence send failed'))),
        overlayLeaveAndDisconnect: vi.fn(() => Promise.resolve()),
        adnlPing: vi.fn(() => Promise.resolve()),
      }
      vi.mocked(getSetting).mockImplementation(((category: string) => {
        if (category === 'messenger') return { networkEnabled: true, attachWalletIdentity: false }
        return {}
      }) as typeof getSetting)
      vi.mocked(mockRegistry.tonBridgeProviders.messenger.getBridge).mockReturnValue(bridge as any)

      const connect = mockHandlers.get(IPC_CHANNELS.CHAT_CONNECT)!
      const result = await connect(createMockEvent(), room, bootstrap)

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'ROOM_UNAVAILABLE', retryable: true },
      })
      expect(bridge.overlayLeaveAndDisconnect).toHaveBeenCalledWith(overlayIdB64ForRoom(room), 'peer-id')
      expect(mockRegistry.chatSessionController.session).toBeNull()
    })

    it('returns the canonical public send id and emits replayed history inside the bounded window', async () => {
      const room = 'tonnet:groupchat'
      const overlayId = overlayIdB64ForRoom(room)
      const bootstrap = Buffer.alloc(32, 9).toString('base64')
      const history = ['first history message', 'second history message', 'third history message'].map(
        (text, index) => {
          const seed = Buffer.alloc(32, 19 + index)
          const secondsAgo = 180 - index * 30
          const env = signEnvelope(
            { type: 'msg', nick: 'alice', text, ts: Date.now() - secondsAgo * 1_000, room },
            seed
          )
          const wire = sealBroadcast(seed, marshalEnvelope(env), Math.floor(Date.now() / 1000) - secondsAgo)
          return { env, wire, text }
        }
      )
      let overlayMessage: ((data: { overlay_id: string; message: string }) => void) | null = null
      let replayed = false
      const bridge = {
        dhtFindValue: vi.fn(),
        dhtFindOverlayNodes: vi.fn(() => Promise.resolve({ nodes: [], count: 0 })),
        overlayConnectAndJoin: vi.fn(() => Promise.resolve('peer-id')),
        overlayQuery: vi.fn((_overlay: string, data: string) => {
          if (data === 'onDZSA==') {
            const response = Buffer.alloc(40)
            Buffer.from('4c34c713', 'hex').copy(response)
            Buffer.alloc(32, 0x42).copy(response, 4)
            response.writeInt32LE(Math.floor(Date.now() / 1000) + 60, 36)
            return Promise.resolve(response.toString('base64'))
          }
          const response = Buffer.alloc(8)
          Buffer.from('47a0c32f', 'hex').copy(response)
          response.writeInt32LE(Math.floor(Date.now() / 1000), 4)
          return Promise.resolve(response.toString('base64'))
        }),
        onOverlayMessage: vi.fn((cb: (data: { overlay_id: string; message: string }) => void) => {
          overlayMessage = cb
          return vi.fn()
        }),
        overlaySendRaw: vi.fn(() => {
          if (!replayed) {
            replayed = true
            for (const item of history) {
              overlayMessage!({ overlay_id: overlayId, message: item.wire.toString('base64') })
            }
          }
          return Promise.resolve()
        }),
        overlayLeaveAndDisconnect: vi.fn(() => Promise.resolve()),
        adnlPing: vi.fn(() => Promise.resolve()),
      }
      vi.mocked(getSetting).mockImplementation(((category: string) => {
        if (category === 'messenger') return { networkEnabled: true, attachWalletIdentity: false }
        return {}
      }) as typeof getSetting)
      vi.mocked(mockRegistry.tonBridgeProviders.messenger.getBridge).mockReturnValue(bridge as any)

      const connect = mockHandlers.get(IPC_CHANNELS.CHAT_CONNECT)!
      const send = mockHandlers.get(IPC_CHANNELS.CHAT_SEND)!
      const disconnect = mockHandlers.get(IPC_CHANNELS.CHAT_DISCONNECT)!
      await connect(createMockEvent(), room, bootstrap)
      await new Promise((resolve) => setImmediate(resolve))

      for (const item of history) {
        expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
          IPC_CHANNELS.CHAT_MESSAGE,
          expect.objectContaining({ room, text: item.text, deviceKey: item.env.key })
        )
      }

      bridge.overlaySendRaw.mockClear()
      const sent = await send(createMockEvent(), 'local message')
      const sentCall = bridge.overlaySendRaw.mock.calls[0] as unknown as [string, string]
      const sentWire = parseBroadcast(Buffer.from(sentCall[1], 'base64'))
      expect(sentWire).not.toBeNull()
      const sentEnvelope = parseEnvelope(sentWire!.data)
      expect(sent).toMatchObject({
        sent: true,
        id: broadcastId(sentWire!.src, sentWire!.data, sentWire!.flags).toString('hex'),
        ts: sentEnvelope.ts,
      })

      await disconnect(createMockEvent())
    })

    it('reconnects the active room after resetting the chat identity', async () => {
      const room = 'tonnet:groupchat'
      const bootstrap = Buffer.alloc(32, 9).toString('base64')
      const bridge = {
        dhtFindValue: vi.fn(),
        dhtFindOverlayNodes: vi.fn(() => Promise.resolve({ nodes: [], count: 0 })),
        overlayConnectAndJoin: vi.fn(() => Promise.resolve('new-peer-id')),
        overlayQuery: vi.fn((_overlay: string, data: string) => {
          if (data === 'onDZSA==') {
            const response = Buffer.alloc(40)
            Buffer.from('4c34c713', 'hex').copy(response)
            Buffer.alloc(32, 0x42).copy(response, 4)
            response.writeInt32LE(Math.floor(Date.now() / 1000) + 60, 36)
            return Promise.resolve(response.toString('base64'))
          }
          const response = Buffer.alloc(8)
          Buffer.from('47a0c32f', 'hex').copy(response)
          response.writeInt32LE(Math.floor(Date.now() / 1000), 4)
          return Promise.resolve(response.toString('base64'))
        }),
        onOverlayMessage: vi.fn(() => vi.fn()),
        overlaySendRaw: vi.fn(() => Promise.resolve()),
        overlayLeaveAndDisconnect: vi.fn(() => Promise.resolve()),
        adnlPing: vi.fn(() => Promise.resolve()),
      }
      vi.mocked(getSetting).mockImplementation(((category: string) => {
        if (category === 'messenger') return { networkEnabled: true, attachWalletIdentity: false }
        return {}
      }) as typeof getSetting)
      vi.mocked(mockRegistry.tonBridgeProviders.messenger.getBridge).mockReturnValue(bridge as any)

      const oldSession = {
        room,
        bootstrap,
        overlayId: overlayIdB64ForRoom(room),
        via: 'node',
        peerId: 'old-peer-id',
        clockOffsetSec: 0,
        bindingChallenge: '',
        gated: false,
        cert: null,
        dispose: vi.fn(() => Promise.resolve()),
      }
      await mockRegistry.chatSessionController.connect(room, async () => oldSession as any)

      const reset = mockHandlers.get(IPC_CHANNELS.CHAT_RESET_IDENTITY)!
      const result = await reset(createMockEvent())

      expect(result.deviceKey).toMatch(/^[0-9a-f]{64}$/)
      expect(oldSession.dispose).toHaveBeenCalledOnce()
      expect(mockRegistry.chatSessionController.session).toMatchObject({ room, bootstrap, peerId: 'new-peer-id' })
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('chat:connection', {
        room,
        status: 'reconnecting',
      })
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('chat:connection', {
        room,
        status: 'connected',
      })
    })

    it('keeps the new identity when reconnecting after reset fails', async () => {
      const room = 'tonnet:groupchat'
      vi.mocked(getSetting).mockImplementation(((category: string) => {
        if (category === 'messenger') return { networkEnabled: true, attachWalletIdentity: false }
        return {}
      }) as typeof getSetting)
      vi.mocked(mockRegistry.tonBridgeProviders.messenger.getBridge).mockReturnValue(null)

      const oldSession = {
        room,
        overlayId: overlayIdB64ForRoom(room),
        via: 'dht',
        peerId: 'old-peer-id',
        clockOffsetSec: 0,
        bindingChallenge: '',
        gated: false,
        cert: null,
        dispose: vi.fn(() => Promise.resolve()),
      }
      await mockRegistry.chatSessionController.connect(room, async () => oldSession as any)

      const reset = mockHandlers.get(IPC_CHANNELS.CHAT_RESET_IDENTITY)!
      const result = await reset(createMockEvent())

      expect(result.deviceKey).toMatch(/^[0-9a-f]{64}$/)
      expect(mockRegistry.chatSessionController.session).toBeNull()
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('chat:connection', {
        room,
        status: 'error',
      })
    })

    it('resets an idle identity without starting a chat connection', async () => {
      const reset = mockHandlers.get(IPC_CHANNELS.CHAT_RESET_IDENTITY)!

      const result = await reset(createMockEvent())

      expect(result.deviceKey).toMatch(/^[0-9a-f]{64}$/)
      expect(mockRegistry.chatSessionController.session).toBeNull()
      expect(mockRegistry.tonBridgeProviders.messenger.getBridge).not.toHaveBeenCalled()
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalledWith('chat:connection', expect.anything())
    })
  })

  describe('Event Forwarding', () => {
    it('forwards proxy status events to renderer', async () => {
      // Emit event on proxy manager
      ;(mockRegistry.proxyManager as EventEmitter).emit('status', 'connected')

      await vi.waitFor(() =>
        expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
          'proxy:status',
          expect.objectContaining({ status: 'connected' })
        )
      )
    })

    it('forwards storage bags-updated events to renderer', () => {
      const bags = [
        {
          id: 'bag1',
          name: 'Test',
          size: 100,
          downloaded: 50,
          uploadSpeed: 0,
          downloadSpeed: 10,
          peers: 1,
          filesCount: 2,
          status: 'downloading',
        },
      ]
      ;(mockRegistry.storageManager as EventEmitter).emit('bags-updated', bags)

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('storage:bags-updated', bags)
    })

    it('forwards storage started event to renderer', () => {
      ;(mockRegistry.storageManager as EventEmitter).emit('started')

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('storage:status', { running: true })
    })

    it('forwards storage stopped event to renderer', () => {
      ;(mockRegistry.storageManager as EventEmitter).emit('stopped')

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('storage:status', { running: false })
    })
  })
})

describe('Security - Input Validation', () => {
  beforeEach(resetHandlersTestEnv)

  it('supersedes pending navigation for the requested internal tab', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.NAVIGATE)!

    await handler(createMockEvent(), 'ton://settings', 'tab-2')

    expect(hideAllViews).toHaveBeenCalledWith('tab-2')
  })

  it('navigation handler rejects javascript: URLs', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.NAVIGATE)!
    expect(handler).toBeDefined()

    const result = await handler(createMockEvent(), 'javascript:alert(1)')

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_URL', message: 'Invalid navigation URL', retryable: false },
    })
    expect(navigateInTab).not.toHaveBeenCalled()
  })

  it('navigation handler rejects data: URLs', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.NAVIGATE)!
    expect(handler).toBeDefined()

    const result = await handler(createMockEvent(), 'data:text/html,<script>alert(1)</script>')

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_URL', retryable: false } })
    expect(navigateInTab).not.toHaveBeenCalled()
  })

  it('navigation handler rejects file: URLs', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.NAVIGATE)!
    expect(handler).toBeDefined()

    const result = await handler(createMockEvent(), 'file:///etc/passwd')

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_URL', retryable: false } })
    expect(navigateInTab).not.toHaveBeenCalled()
  })
})

// ─── Cocoon AI Handlers ──────────────────────────────────────────────────────

/**
 * Wallet data fixture reused across Cocoon handler tests.
 * nodeSecretBase64 maps to nodeWalletKeyBase64 in CocoonConfig (the field rename
 * happens inside the COCOON_START handler before calling cocoonManager.start()).
 */
const MOCK_COCOON_WALLET = {
  ownerMnemonic: ['word1', 'word2'],
  nodeSecretBase64: 'c2VjcmV0YmFzZTY0',
  nodePublicKeyHex: 'aabbccdd',
  ownerAddress: 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k',
  nodeAddress: 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k',
  createdAt: 1_700_000_000_000,
}
const MOCK_COCOON_MNEMONIC = Array.from({ length: 24 }, (_, index) => `word${index + 1}`)

const COCOON_ROOT_MAINNET = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'

describe('Cocoon AI Handlers', () => {
  beforeEach(resetHandlersTestEnv)

  it('reports a missing archive entry with its declared business code', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.COCOON_ARCHIVE_EXPORT_MNEMONIC)!

    const result = await handler(createMockEvent(), { archivedAt: 1_700_000_000_000 })

    expect(result).toEqual({
      ok: false,
      error: { code: 'ARCHIVE_NOT_FOUND', message: 'Archive entry not found', retryable: false },
    })
  })

  // ── COCOON_START ────────────────────────────────────────────────────────────

  describe('COCOON_START', () => {
    it('reads wallet from disk and calls cocoonManager.start with correct params', async () => {
      vi.mocked(loadCocoonWallet).mockResolvedValueOnce(MOCK_COCOON_WALLET)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_START)!

      const result = await handler(createMockEvent())

      expect(result.success).toBe(true)
      expect(result.httpPort).toBe(10000)
      expect(mockRegistry.cocoonManager.start).toHaveBeenCalledWith({
        ownerAddress: MOCK_COCOON_WALLET.ownerAddress,
        nodeWalletKeyBase64: MOCK_COCOON_WALLET.nodeSecretBase64,
        rootContractAddress: COCOON_ROOT_MAINNET,
      })
    })

    it('does not expose any secret values in the success envelope', async () => {
      vi.mocked(loadCocoonWallet).mockResolvedValueOnce(MOCK_COCOON_WALLET)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_START)!

      const result = await handler(createMockEvent())

      expect(result).not.toHaveProperty('ownerMnemonic')
      expect(result).not.toHaveProperty('nodeSecretBase64')
      expect(result).not.toHaveProperty('nodeWalletKeyBase64')
    })

    it('returns error when wallet is not initialized', async () => {
      // loadCocoonWallet returns null by default (factory mock)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_START)!

      const result = await handler(createMockEvent())

      expect(result).toEqual({
        ok: false,
        error: { code: 'START_FAILED', message: 'Operation failed', retryable: false },
      })
      expect(mockRegistry.cocoonManager.start).not.toHaveBeenCalled()
    })

    it('is idempotent when manager is already in ready state', async () => {
      // Manager already running: don't re-spawn, just return current port.
      vi.mocked(mockRegistry.cocoonManager.getState).mockReturnValueOnce({
        kind: 'ready',
        httpPort: 10000,
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_START)!

      const result = await handler(createMockEvent())

      expect(result.success).toBe(true)
      expect(result.httpPort).toBe(10000)
      expect(mockRegistry.cocoonManager.start).not.toHaveBeenCalled()
      // loadCocoonWallet is also skipped — no reason to read secrets when
      // we're not starting anything.
      expect(loadCocoonWallet).not.toHaveBeenCalled()
    })

    it('returns error without calling start() when manager is already starting', async () => {
      vi.mocked(mockRegistry.cocoonManager.getState).mockReturnValueOnce({
        kind: 'starting',
        phase: 'client-runner',
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_START)!

      const result = await handler(createMockEvent())

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'ALREADY_STARTING', message: 'Cocoon is already starting', retryable: true },
      })
      expect(mockRegistry.cocoonManager.start).not.toHaveBeenCalled()
      expect(loadCocoonWallet).not.toHaveBeenCalled()
    })

    it('calls stop() to reset then calls start() when manager is in crashed state', async () => {
      vi.mocked(mockRegistry.cocoonManager.getState).mockReturnValueOnce({
        kind: 'crashed',
        error: 'runner exited (code=1)',
      })
      vi.mocked(loadCocoonWallet).mockResolvedValueOnce(MOCK_COCOON_WALLET)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_START)!

      const result = await handler(createMockEvent())

      expect(mockRegistry.cocoonManager.stop).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(true)
      expect(mockRegistry.cocoonManager.start).toHaveBeenCalledTimes(1)
    })
  })

  // ── COCOON_WALLET_CREATE ────────────────────────────────────────────────────

  describe('COCOON_WALLET_CREATE', () => {
    it('returns ownerAddress, nodeAddress, and mnemonic for one-time display', async () => {
      vi.mocked(generateCocoonWallet).mockResolvedValueOnce({
        ownerAddress: 'EQOwner',
        nodeAddress: 'EQNode',
        mnemonic: MOCK_COCOON_MNEMONIC,
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_CREATE)!

      const result = await handler(createMockEvent())

      expect(result).toEqual({
        ownerAddress: 'EQOwner',
        nodeAddress: 'EQNode',
        mnemonic: MOCK_COCOON_MNEMONIC,
      })
      expect(generateCocoonWallet).toHaveBeenCalledTimes(1)
    })

    it('does not include raw secrets in the result envelope', async () => {
      vi.mocked(generateCocoonWallet).mockResolvedValueOnce({
        ownerAddress: 'EQOwner',
        nodeAddress: 'EQNode',
        mnemonic: MOCK_COCOON_MNEMONIC,
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_CREATE)!

      const result = await handler(createMockEvent())

      expect(result).not.toHaveProperty('nodeSecretBase64')
      expect(result).not.toHaveProperty('nodePublicKeyHex')
    })
  })

  // ── COCOON_WALLET_MARK_SETUP_COMPLETE ───────────────────────────────────────

  describe('COCOON_WALLET_MARK_SETUP_COMPLETE', () => {
    it('surfaces underlying errors as IPC envelope', async () => {
      vi.mocked(markSetupComplete).mockRejectedValueOnce(new Error('storage unavailable'))
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_MARK_SETUP_COMPLETE)!

      const result = await handler(createMockEvent())

      expect(result).toEqual({
        ok: false,
        error: { code: 'WALLET_WRITE_FAILED', message: 'Operation failed', retryable: false },
      })
    })
  })

  // ── COCOON_SETUP_OWNER_BALANCE ──────────────────────────────────────────────

  describe('COCOON_SETUP_OWNER_BALANCE', () => {
    it('returns the balance as a decimal nano-TON string', async () => {
      const mockBridge = { getBalance: vi.fn() }
      vi.mocked(mockRegistry.tonBridgeProviders.ton.getBridge).mockReturnValueOnce(mockBridge as any)
      vi.mocked(getOwnerBalance).mockResolvedValueOnce(1_000_000_000n)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_OWNER_BALANCE)!

      const result = await handler(createMockEvent())

      expect(result).toBe('1000000000')
      expect(getOwnerBalance).toHaveBeenCalledWith(mockBridge)
    })

    it('returns error when bridge is not connected', async () => {
      // The shared Bridge runtime returns null by default.
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_OWNER_BALANCE)!

      const result = await handler(createMockEvent())

      expect(result).toEqual({
        ok: false,
        error: { code: 'BRIDGE_DISCONNECTED', message: 'Bridge not connected', retryable: false },
      })
    })
  })

  // ── COCOON_SETUP_COCOON_BALANCE ─────────────────────────────────────────────

  describe('COCOON_SETUP_COCOON_BALANCE', () => {
    it('returns the cocoon node wallet balance as a decimal nano-TON string', async () => {
      const mockBridge = { getBalance: vi.fn() }
      vi.mocked(mockRegistry.tonBridgeProviders.ton.getBridge).mockReturnValueOnce(mockBridge as any)
      vi.mocked(getCocoonWalletBalance).mockResolvedValueOnce(19_500_000_000n)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_COCOON_BALANCE)!

      const result = await handler(createMockEvent())

      expect(result).toBe('19500000000')
      expect(getCocoonWalletBalance).toHaveBeenCalledWith(mockBridge)
    })

    it('returns error when bridge is not connected', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_COCOON_BALANCE)!

      const result = await handler(createMockEvent())

      expect(result).toEqual({
        ok: false,
        error: { code: 'BRIDGE_DISCONNECTED', message: 'Bridge not connected', retryable: false },
      })
    })
  })

  // ── COCOON_SETUP_FUND_COCOON ────────────────────────────────────────────────

  describe('COCOON_SETUP_FUND_COCOON', () => {
    it("'max' branch: passes 'max' to fundCocoonFromOwner and stringifies sentAmount", async () => {
      const mockBridge = {}
      vi.mocked(mockRegistry.tonBridgeProviders.ton.getBridge).mockReturnValueOnce(mockBridge as any)
      vi.mocked(fundCocoonFromOwner).mockResolvedValueOnce({
        bocHash: 'abc123',
        seqno: 5,
        sentAmount: 1_500_000_000n,
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON)!

      const result = await handler(createMockEvent(), { amount: 'max' })

      expect(result).toEqual({ bocHash: 'abc123', seqno: 5, sentAmount: '1500000000' })
      expect(fundCocoonFromOwner).toHaveBeenCalledWith(mockBridge, 'max')
    })

    it('explicit amount: converts decimal string to BigInt before delegating', async () => {
      const mockBridge = {}
      vi.mocked(mockRegistry.tonBridgeProviders.ton.getBridge).mockReturnValueOnce(mockBridge as any)
      vi.mocked(fundCocoonFromOwner).mockResolvedValueOnce({
        bocHash: 'def456',
        seqno: 3,
        sentAmount: 15_000_000_000n,
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON)!

      const result = await handler(createMockEvent(), { amount: '15000000000' })

      expect(result).toEqual({ bocHash: 'def456', seqno: 3, sentAmount: '15000000000' })
      expect(fundCocoonFromOwner).toHaveBeenCalledWith(mockBridge, 15_000_000_000n)
    })

    it('returns error for a non-numeric amount string', async () => {
      const mockBridge = {}
      vi.mocked(mockRegistry.tonBridgeProviders.ton.getBridge).mockReturnValueOnce(mockBridge as any)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON)!

      const result = await handler(createMockEvent(), { amount: 'not-a-number' })

      expect(result).toEqual({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid request payload', retryable: false },
      })
    })

    it('returns error when bridge is not connected', async () => {
      // The shared Bridge runtime returns null by default.
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON)!

      const result = await handler(createMockEvent(), { amount: 'max' })

      expect(result).toEqual({
        ok: false,
        error: { code: 'BRIDGE_DISCONNECTED', message: 'Bridge not connected', retryable: false },
      })
    })
  })
})
