import type { AppSettings } from '../../shared/types'
import { settingsChangedContract } from '../../shared/ipc-contract/settings'
import { emitContractToRenderer } from '../events/renderer-events'
import type { ProxyManager } from '../proxy/manager'
import type { StorageManager } from '../storage/daemon'
import type { HistoryManager } from '../history/manager'
import type { WalletManager } from '../wallet/manager'
import type { TonBridgeCoordinator } from '../ton-bridge/coordinator'
import type { TonConnectService } from '../tonconnect/service'
import type { BridgePermissionStore } from '../bridge/permission-store'
import type { TabManager } from '../windows/tabs'
import type { ChatRuntimeSession, ChatSessionController } from '../chat/session-controller'
import { getDefaultSettings, mergeSettingsPatch, transactSettings, type SettingsPatch } from './index'

export interface SettingsRuntimeDependencies {
  proxyManager: ProxyManager
  storageManager: StorageManager
  historyManager: HistoryManager
  walletManager: WalletManager
  tonBridgeCoordinator: TonBridgeCoordinator
  tonConnectService: TonConnectService
  bridgePermissionStore: BridgePermissionStore
  tabManager: TabManager
  chatSessionController: ChatSessionController<ChatRuntimeSession>
}

function fieldsChanged<T extends object>(previous: T, current: T, fields: ReadonlyArray<keyof T>): boolean {
  return fields.some((field) => previous[field] !== current[field])
}

function categoryChanged<K extends keyof AppSettings>(
  previous: AppSettings,
  current: AppSettings,
  category: K
): boolean {
  return JSON.stringify(previous[category]) !== JSON.stringify(current[category])
}

function bridgeRestartRequired(previous: AppSettings, current: AppSettings): boolean {
  return (
    fieldsChanged(previous.network, current.network, ['proxyPort', 'wsPort', 'anonymousMode', 'tunnelMode']) ||
    fieldsChanged(previous.general, current.general, ['resolveEth', 'ethRpc', 'resolveSol', 'solRpc']) ||
    previous.advanced.proxyVerbosity !== current.advanced.proxyVerbosity ||
    previous.messenger.networkEnabled !== current.messenger.networkEnabled
  )
}

export class SettingsCoordinator {
  constructor(private readonly dependencies: SettingsRuntimeDependencies) {}

  async apply(patch: SettingsPatch, options: { reconcileHistory?: boolean } = {}): Promise<AppSettings> {
    const settings = await transactSettings(
      (current) => {
        const next = mergeSettingsPatch(current, patch)
        return next
      },
      (previous, current) => this.reconcile(previous, current),
      (previous, current) => this.finalize(previous, current, false, options.reconcileHistory),
      (previous, current, operation) => this.guardChat(previous, current, operation),
      { applyUnchanged: options.reconcileHistory === true }
    )
    for (const category of Object.keys(patch) as Array<keyof AppSettings>) {
      emitContractToRenderer(settingsChangedContract, {
        category,
        values: patch[category] as Record<string, unknown>,
        settings,
      })
    }
    return settings
  }

  async reset(): Promise<AppSettings> {
    const settings = await transactSettings(
      () => getDefaultSettings(),
      (previous, current) => this.reconcile(previous, current, true),
      (previous, current) => this.finalize(previous, current, true),
      (previous, current, operation) => {
        this.assertPortTransition(previous, current)
        return this.dependencies.chatSessionController.runDisconnected(operation)
      },
      { applyUnchanged: true }
    )
    emitContractToRenderer(settingsChangedContract, { reset: true, settings })
    return settings
  }

  private async reconcile(previous: AppSettings, current: AppSettings, force = false): Promise<void> {
    const { proxyManager, storageManager, tabManager, walletManager, tonBridgeCoordinator } = this.dependencies
    const proxyChanged =
      force ||
      fieldsChanged(previous.network, current.network, ['proxyPort', 'wsPort', 'anonymousMode', 'tunnelMode']) ||
      fieldsChanged(previous.general, current.general, ['resolveEth', 'ethRpc', 'resolveSol', 'solRpc']) ||
      previous.advanced.proxyVerbosity !== current.advanced.proxyVerbosity ||
      previous.messenger.networkEnabled !== current.messenger.networkEnabled
    const storageChanged =
      force ||
      previous.network.storagePort !== current.network.storagePort ||
      fieldsChanged(previous.storage, current.storage, [
        'downloadPath',
        'pollingInterval',
        'seedingEnabled',
        'downloadSpeedLimit',
        'uploadSpeedLimit',
      ]) ||
      previous.advanced.storageVerbosity !== current.advanced.storageVerbosity
    let bridgeRestarted = false
    const operations: Promise<void>[] = []
    if (proxyChanged) {
      operations.push(
        (async () => {
          const result = await proxyManager.applySettingsChange(current)
          bridgeRestarted = result.bridgeRestarted
          const status = proxyManager.getStatus()
          if (status.status === 'connected') await tabManager.updateProxyPort(status.port)
        })()
      )
    }
    if (storageChanged) operations.push(storageManager.applySettingsChange(current))
    const results = await Promise.allSettled(operations)
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason))

    if (bridgeRestarted && proxyManager.isRunning()) {
      await tonBridgeCoordinator.waitUntilReady(current.network.wsPort)
    }
    if (force || categoryChanged(previous, current, 'wallet')) {
      walletManager.setAutoLockMinutes(current.wallet.autoLockMinutes)
    }
    if (force || categoryChanged(previous, current, 'appearance')) {
      tabManager.onAppearanceSettingsChanged(current.appearance)
    }
    if (force || previous.appearance.defaultZoom !== current.appearance.defaultZoom) {
      tabManager.applyDefaultZoom(current.appearance.defaultZoom)
    }
    if (force || categoryChanged(previous, current, 'privacy')) {
      await tabManager.onPrivacySettingsChanged(previous.privacy, current.privacy)
    }
  }

  private async finalize(
    previous: AppSettings,
    current: AppSettings,
    force = false,
    reconcileHistory = false
  ): Promise<void> {
    if (
      force ||
      reconcileHistory ||
      fieldsChanged(previous.privacy, current.privacy, ['historyMode', 'historyMaxEntries'])
    ) {
      await this.dependencies.historyManager.applySettings(current.privacy)
    }
    if (force) this.dependencies.bridgePermissionStore.clearSessionGrants()
    if (previous.advanced.tonConnectEnabled && !current.advanced.tonConnectEnabled) {
      await this.dependencies.tonConnectService.clearSessions()
    }
  }

  private guardChat(
    previous: AppSettings,
    current: AppSettings,
    operation: () => Promise<AppSettings>
  ): Promise<AppSettings> {
    this.assertPortTransition(previous, current)
    if (previous.messenger.networkEnabled && !current.messenger.networkEnabled) {
      return this.dependencies.chatSessionController.runDisconnected(operation)
    }
    return bridgeRestartRequired(previous, current)
      ? this.dependencies.chatSessionController.runWhenIdle(operation)
      : operation()
  }

  private assertPortTransition(previous: AppSettings, current: AppSettings): void {
    const proxyActive = this.dependencies.proxyManager.isActive()
    const storageActive = this.dependencies.storageManager.isActive()
    const storageMovesOntoProxy =
      current.network.storagePort !== previous.network.storagePort &&
      [previous.network.proxyPort, previous.network.wsPort].includes(current.network.storagePort)
    const proxyMovesOntoStorage = [current.network.proxyPort, current.network.wsPort].some(
      (port, index) =>
        port !== [previous.network.proxyPort, previous.network.wsPort][index] && port === previous.network.storagePort
    )
    if ((storageMovesOntoProxy && proxyActive) || (proxyMovesOntoStorage && storageActive)) {
      throw new Error('Disconnect Proxy and Storage before swapping native service ports')
    }
  }
}
