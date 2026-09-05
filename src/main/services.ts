/**
 * Pure DI composition root.
 * Creates all service instances and wires dependencies via constructors.
 * IPC handlers and other consumers receive a ServiceRegistry instead of
 * importing module-level singletons.
 */

import { ElectronSafeStorageAdapter } from './adapters/electron-secure-storage'
import { ProxyManager } from './proxy/manager'
import { StorageManager } from './storage/daemon'
import { WalletManager } from './wallet/manager'
import { WalletHistoryManager } from './wallet/history'
import { PaymentInterceptor } from './wallet/payment-interceptor'
import { PaymentPolicyStore } from './wallet/payment-policy'
import { OverlayManager } from './windows/overlay-manager'
import { BridgePermissionInterceptor } from './bridge/permission-interceptor'
import { BridgePermissionStore } from './bridge/permission-store'
import { TonConnectService } from './tonconnect/service'
import { TonConnectSessionStore } from './tonconnect/session-store'
import { HistoryManager } from './history/manager'
import { CocoonManager } from './cocoon/manager'
import { WithdrawDriver } from './cocoon/withdraw-driver'
import { RecoveryDriver } from './cocoon/recovery-driver'
import type { ISecureStorage } from './ports/secure-storage'
import { emitContractToRenderer } from './events/renderer-events'
import type { CocoonActivationPorts } from './cocoon/activation'
import { TabManager } from './windows/tabs'
import { ConsumedArchive } from './cocoon/consumed-archive'
import { RecoveryQueueStore } from './cocoon/recovery-queue'
import { StakeCacheStore } from './cocoon/stake-cache'
import type { CocoonPersistence } from './cocoon/persistence'
import { TonConnectManifestLoader } from './tonconnect/manifest-loader'
import { ElectronTonConnectApproval } from './tonconnect/electron-approval'
import { ElectronTonConnectEventDelivery } from './tonconnect/electron-event-delivery'
import {
  walletPaymentFailedContract,
  walletPaymentMadeContract,
  walletPaymentRequestedContract,
} from '../shared/ipc-contract/wallet'
import { DisposableStore, onEmitter } from './utils/disposable'
import { SettingsCoordinator } from './settings/coordinator'
import { getSetting } from './settings'
import { TonIndexerClient } from './indexer/client'
import { TonBridgeRuntime } from './ton-bridge/runtime'
import { TonBridgeCoordinator } from './ton-bridge/coordinator'
import { mapBridgeProvider, type BridgeProvider } from './ports/bridge-provider'
import type { TonBridgePort } from './ports/ton-bridge'
import type { WalletBridgePort } from './wallet/bridge-port'
import { MessengerClientManager } from './messenger/client-manager'
import { createLogger } from '../shared/logger'

const log = createLogger('services')

export interface TonBridgeProviders {
  wallet: BridgeProvider<WalletBridgePort>
  ton: BridgeProvider<TonBridgePort>
}

export interface ServiceRegistry {
  ipcRegistrations: DisposableStore
  lifecycleRegistrations: DisposableStore
  secureStorage: ISecureStorage
  proxyManager: ProxyManager
  storageManager: StorageManager
  walletManager: WalletManager
  tonBridgeCoordinator: TonBridgeCoordinator
  tonBridgeProviders: TonBridgeProviders
  walletHistoryManager: WalletHistoryManager
  tonIndexerClient: TonIndexerClient
  paymentInterceptor: PaymentInterceptor
  paymentPolicyStore: PaymentPolicyStore
  overlayManager: OverlayManager
  bridgeInterceptor: BridgePermissionInterceptor
  bridgePermissionStore: BridgePermissionStore
  tonConnectService: TonConnectService
  tonConnectSessionStore: TonConnectSessionStore
  historyManager: HistoryManager
  cocoonManager: CocoonManager
  withdrawDriver: WithdrawDriver
  recoveryDriver: RecoveryDriver
  cocoonActivation: CocoonActivationPorts
  tabManager: TabManager
  messengerClientManager: MessengerClientManager
  cocoonPersistence: CocoonPersistence
  settingsCoordinator: SettingsCoordinator
}

export function createServices(): ServiceRegistry {
  const ipcRegistrations = new DisposableStore()
  const lifecycleRegistrations = new DisposableStore()
  const secureStorage = new ElectronSafeStorageAdapter()

  // Create all services -- NO async init here, just construction
  const proxyManager = new ProxyManager()
  const storageManager = new StorageManager()
  const overlayManager = new OverlayManager()
  const tabManager = new TabManager(getSetting('appearance').defaultZoom)
  const messengerClientManager = new MessengerClientManager()
  const cocoonPersistence: CocoonPersistence = {
    consumedArchive: new ConsumedArchive(undefined, secureStorage),
    recoveryQueue: new RecoveryQueueStore(undefined, secureStorage),
    stakeCache: new StakeCacheStore(),
  }
  const historyManager = new HistoryManager()
  const bridgePermissionStore = new BridgePermissionStore()
  const walletHistoryManager = new WalletHistoryManager()
  const tonIndexerClient = new TonIndexerClient(() => {
    const settings = getSetting('wallet')
    return {
      enabled: settings.indexerEnabled,
      endpoint: settings.indexerEndpoint,
      apiKey: settings.indexerApiKey,
    }
  })
  const bridgeInterceptor = new BridgePermissionInterceptor(bridgePermissionStore, overlayManager)
  const tonBridgeRuntime = new TonBridgeRuntime()
  const tonBridgeProviders: TonBridgeProviders = {
    wallet: mapBridgeProvider(tonBridgeRuntime, (bridge): WalletBridgePort => bridge),
    ton: mapBridgeProvider(tonBridgeRuntime, (bridge): TonBridgePort => bridge),
  }
  const tonBridgeCoordinator = new TonBridgeCoordinator(proxyManager, tonBridgeRuntime, bridgeInterceptor)
  const paymentPolicyStore = new PaymentPolicyStore()
  const walletManager = new WalletManager(secureStorage, tonBridgeProviders.wallet)
  const paymentInterceptor = new PaymentInterceptor(
    walletManager,
    paymentPolicyStore,
    walletHistoryManager,
    (notification) => {
      const contract =
        notification.status === 'pending'
          ? walletPaymentRequestedContract
          : notification.status === 'completed'
            ? walletPaymentMadeContract
            : walletPaymentFailedContract
      emitContractToRenderer(contract, notification)
    }
  )
  const tonConnectSessionStore = new TonConnectSessionStore()
  const tonConnectService = new TonConnectService(
    walletManager,
    tonConnectSessionStore,
    new ElectronTonConnectApproval(overlayManager),
    new TonConnectManifestLoader(),
    new ElectronTonConnectEventDelivery()
  )
  const cocoonManager = new CocoonManager()
  const withdrawDriver = new WithdrawDriver(
    cocoonManager,
    () => tonBridgeProviders.ton.getBridge(),
    () => walletManager.getIdentitySnapshot(),
    cocoonPersistence,
    async (nodeAddress, amountNano, expectedIdentity) => {
      await walletManager.send(nodeAddress, amountNano.toString(), undefined, expectedIdentity)
    }
  )
  // React to runner state changes so refundable transitions are picked up
  // immediately instead of waiting the full 30s tick. Startup waits for the
  // shared Bridge coordinator because the driver needs on-chain access.
  lifecycleRegistrations.add(onEmitter(cocoonManager, 'state-change', () => withdrawDriver.triggerTick()))

  // Recovery driver runs in parallel for ARCHIVED wallets whose client SC
  // still locks user TON. Startup also waits for the shared Bridge coordinator.
  const recoveryDriver = new RecoveryDriver(
    () => tonBridgeProviders.ton.getBridge(),
    () => walletManager.getState().address || null,
    cocoonPersistence.recoveryQueue,
    cocoonPersistence.consumedArchive
  )
  const cocoonActivation: CocoonActivationPorts = {
    cocoonManager,
    getBridge: () => tonBridgeProviders.ton.getBridge(),
    getNativeIdentity: () => walletManager.getIdentitySnapshot(),
    getNativeBalance: (expectedIdentity) => walletManager.getBalance(expectedIdentity),
    sendNative: (to, amount, expectedIdentity) => walletManager.send(to, amount, undefined, expectedIdentity),
    persistence: cocoonPersistence,
  }
  const settingsCoordinator = new SettingsCoordinator({
    proxyManager,
    storageManager,
    historyManager,
    walletManager,
    tonBridgeCoordinator,
    tonConnectService,
    bridgePermissionStore,
    tabManager,
  })

  lifecycleRegistrations.add(
    onEmitter(historyManager, 'persistence-failed', () => {
      // Settings mutations are queued: never await this from a failing history transition.
      void settingsCoordinator.apply({ privacy: { historyMode: 'memory' } }).catch((error) => {
        log.error('Failed to reconcile suspended history persistence:', error)
      })
    })
  )

  return {
    ipcRegistrations,
    lifecycleRegistrations,
    secureStorage,
    proxyManager,
    storageManager,
    walletManager,
    tonBridgeCoordinator,
    tonBridgeProviders,
    walletHistoryManager,
    tonIndexerClient,
    paymentInterceptor,
    paymentPolicyStore,
    overlayManager,
    bridgeInterceptor,
    bridgePermissionStore,
    tonConnectService,
    tonConnectSessionStore,
    historyManager,
    cocoonManager,
    withdrawDriver,
    recoveryDriver,
    cocoonActivation,
    tabManager,
    messengerClientManager,
    cocoonPersistence,
    settingsCoordinator,
  }
}

export async function destroyServices(registry: ServiceRegistry): Promise<void> {
  registry.ipcRegistrations.dispose()
  registry.lifecycleRegistrations.dispose()
  // Flush history before anything else (idempotent, safe if already called by before-quit)
  await registry.historyManager.onAppExit()

  registry.tabManager.dispose()
  await registry.messengerClientManager.stop()

  registry.paymentInterceptor.destroy()
  await registry.paymentPolicyStore.destroy()
  registry.withdrawDriver.stop()
  registry.recoveryDriver.stop()
  registry.walletManager.destroy()
  await registry.tonBridgeCoordinator.destroy()
  registry.bridgeInterceptor.destroy()
  registry.overlayManager.destroy()
  await registry.proxyManager.stop()
  await registry.storageManager.stop()
  await registry.cocoonManager.stop()
}
