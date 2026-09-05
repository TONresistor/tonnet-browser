/**
 * Integration test for services.ts composition root.
 * Verifies createServices() wires all dependencies and
 * destroyServices() tears down without errors.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// ---------------------------------------------------------------------------
// Module mocks (declared before any import that touches them)
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-services'),
    getAppPath: vi.fn(() => '/tmp/test-app'),
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from('ENC:' + s)),
    decryptString: vi.fn((b: Buffer) => {
      const str = b.toString()
      return str.startsWith('ENC:') ? str.slice(4) : str
    }),
    getSelectedStorageBackend: vi.fn(() => 'test-backend'),
  },
  BrowserWindow: vi.fn(),
  WebContentsView: vi.fn(() => ({
    webContents: {
      loadURL: vi.fn(),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      session: { webRequest: { onBeforeRequest: vi.fn() } },
    },
    setBounds: vi.fn(),
    setVisible: vi.fn(),
  })),
  webContents: {
    getAllWebContents: vi.fn(() => []),
  },
}))

vi.mock('child_process', () => {
  const makeProc = (): EventEmitter & { kill: ReturnType<typeof vi.fn>; pid: number } => {
    const proc = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn>; pid: number }
    proc.kill = vi.fn()
    proc.pid = 12345
    return proc
  }
  return {
    spawn: vi.fn(() => makeProc()),
    execFile: vi.fn(),
  }
})

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    promises: {
      writeFile: vi.fn(),
      readFile: vi.fn(() => Promise.resolve('{}')),
      access: vi.fn(() => Promise.reject(new Error('ENOENT'))),
      unlink: vi.fn(),
      mkdir: vi.fn(),
    },
  }
})

vi.mock('@ton/crypto', () => ({
  mnemonicNew: vi.fn(() => Promise.resolve(Array(24).fill('test'))),
  mnemonicToPrivateKey: vi.fn(() =>
    Promise.resolve({
      publicKey: Buffer.alloc(32, 1),
      secretKey: Buffer.alloc(64, 2),
    })
  ),
  mnemonicValidate: vi.fn((words: string[]) => Promise.resolve(words.length === 24)),
  keyPairFromSeed: vi.fn(() => ({
    publicKey: Buffer.alloc(32, 1),
    secretKey: Buffer.alloc(64, 2),
  })),
}))

vi.mock('@ton/ton', () => ({
  WalletContractV5R1: {
    create: vi.fn(() => ({
      address: {
        toString: () => 'UQTest...',
        toRawString: () => '0:test...',
      },
    })),
  },
}))

vi.mock('@ton/core', () => ({
  Address: {
    parseRaw: vi.fn(() => ({
      toString: () => 'UQTest...',
    })),
  },
  internal: vi.fn(),
  beginCell: vi.fn(() => ({ store: vi.fn().mockReturnThis(), endCell: vi.fn() })),
  storeMessage: vi.fn(),
  SendMode: { PAY_GAS_SEPARATELY: 1 },
  Cell: { fromBase64: vi.fn() },
}))

vi.mock('ws', () => {
  const MockWebSocket = vi.fn(() => {
    const ws = new EventEmitter()
    Object.assign(ws, {
      send: vi.fn(),
      close: vi.fn(),
      ping: vi.fn(),
      readyState: 1,
      OPEN: 1,
    })
    return ws
  })
  Object.assign(MockWebSocket, { OPEN: 1, CLOSED: 3 })
  return { default: MockWebSocket, WebSocket: MockWebSocket }
})

// Mock settings module to return valid defaults
vi.mock('../settings', () => ({
  getSetting: vi.fn((key: string) => {
    const defaults: Record<string, unknown> = {
      network: { proxyPort: 8080, wsPort: 8081, storagePort: 9090 },
      storage: { downloadPath: '/tmp/downloads' },
      advanced: { verbosity: 0 },
      privacy: { historyMode: 'memory' },
      wallet: { paymentMode: 'manual' },
      bridge: { permissions: [] },
    }
    return defaults[key] ?? {}
  }),
  setSetting: vi.fn(),
  getDownloadPath: vi.fn(() => '/tmp/downloads'),
  getDefaultSettings: vi.fn(),
  mergeSettingsPatch: vi.fn(),
  transactSettings: vi.fn(),
}))

vi.mock('../settings/validation', () => ({
  SETTINGS_CATEGORIES: {},
}))

vi.mock('../windows/main', () => ({
  getMainWindow: vi.fn(() => null),
  setMainWindow: vi.fn(),
}))

vi.mock('../utils/paths', () => ({
  getBinaryPath: vi.fn((name: string) => `/tmp/bin/${name}`),
  getStoragePath: vi.fn(() => '/tmp/storage'),
  getConfigPath: vi.fn(() => '/tmp/config'),
}))

// ---------------------------------------------------------------------------
// Import under test (after all mocks)
// ---------------------------------------------------------------------------

import { createServices, destroyServices, type ServiceRegistry } from '../services'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('services composition root', () => {
  let registry: ServiceRegistry

  beforeEach(() => {
    registry = createServices()
  })

  it('destroyServices tears down every service in the registry', async () => {
    // The composition root's only real contract: shutdown releases every
    // service. A missed teardown call (resource/handle leak) fails this.
    const spies = [
      vi.spyOn(registry.historyManager, 'onAppExit'),
      vi.spyOn(registry.overlayManager, 'destroy'),
      vi.spyOn(registry.bridgeInterceptor, 'destroy'),
      vi.spyOn(registry.paymentInterceptor, 'destroy'),
      vi.spyOn(registry.paymentPolicyStore, 'destroy'),
      vi.spyOn(registry.proxyManager, 'stop'),
      vi.spyOn(registry.storageManager, 'stop'),
      vi.spyOn(registry.walletManager, 'destroy'),
      vi.spyOn(registry.tonBridgeCoordinator, 'destroy'),
      vi.spyOn(registry.withdrawDriver, 'stop'),
      vi.spyOn(registry.recoveryDriver, 'stop'),
      vi.spyOn(registry.cocoonManager, 'stop'),
    ]

    await destroyServices(registry)

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledOnce()
    }
  })
})
