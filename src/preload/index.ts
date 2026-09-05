/**
 * Preload script - bridge between main and renderer.
 * Exposes safe IPC methods to the renderer process.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { MAIN_RENDERER_EVENT_CHANNELS } from '../shared/ipc-contract/channels'
import type { IpcEventMap } from '../shared/ipc-events'
import type { AppSettings } from '../shared/types'
import type { BridgeConfig } from '../shared/bridge-config'
import type { bookmarksLoadContract, bookmarksSaveContract, BookmarksData } from '../shared/ipc-contract/bookmarks'
import type { IpcRequestContract, RequestArgs, RequestResult } from '../shared/ipc-contract/definition'
import type {
  dnsResolveContract,
  walletApprovePaymentContract,
  walletClearHistoryContract,
  walletCreateContract,
  walletDeleteContract,
  walletForgetContract,
  walletExportKeyContract,
  walletExportMnemonicContract,
  walletGetBalanceContract,
  walletGetHistoryContract,
  walletGetStateContract,
  walletRetrySystemStorageContract,
  walletImportContract,
  walletDiscoverAccountsContract,
  walletLockContract,
  walletMarkBackupVerifiedContract,
  walletCreateBackupChallengeContract,
  walletChangePasswordContract,
  walletSensitiveDisplayContract,
  walletRejectPaymentContract,
  walletResolveRecipientContract,
  walletSendContract,
  walletSetupPasswordContract,
  walletUnlockContract,
} from '../shared/ipc-contract/wallet'
import type {
  tonConnectDisconnectSessionContract,
  tonConnectGetSessionsContract,
} from '../shared/ipc-contract/tonconnect'
import type {
  clearBrowsingDataContract,
  settingsGetAllContract,
  settingsGetContract,
  settingsDiagnosticsGetContract,
  settingsDiagnosticsEnableContract,
  settingsDiagnosticsDisableContract,
  settingsDiagnosticsCopyContract,
  settingsApplyContract,
  settingsResetContract,
  settingsSetContract,
  SettingsCategory,
  SettingsPatch,
} from '../shared/ipc-contract/settings'
import type {
  historyChangeModeContract,
  historyClearContract,
  historyDeleteByDateContract,
  historyDeleteContract,
  historyDeletePatternContract,
  historyGetByDateContract,
  historyGetRecentContract,
  historyGetStatsContract,
  historyGetTopContract,
  historyHasPersistentFileContract,
  historySearchContract,
} from '../shared/ipc-contract/history'
import type { proxyConnectContract, proxyDisconnectContract, proxyStatusContract } from '../shared/ipc-contract/proxy'
import type {
  goBackContract,
  goForwardContract,
  navigateContract,
  reloadContract,
  stopContract,
  tabCloseContract,
  tabCreateContract,
  tabSwitchContract,
  viewHideContract,
  viewShowContract,
  zoomGetContract,
  zoomSetContract,
} from '../shared/ipc-contract/browsing'
import type {
  storageAddBagContract,
  storageGetDownloadPathContract,
  storageGetDetailsContract,
  storageListBagsContract,
  storageOpenFolderContract,
  storagePauseBagContract,
  storageReadFileContract,
  storageRemoveBagContract,
  storageShowFileContract,
  storageSetDownloadPathContract,
  storageSelectDownloadFolderContract,
} from '../shared/ipc-contract/storage'
import type {
  bridgeGetConfigContract,
  bridgeGetPermissionsContract,
  bridgeRestartContract,
  bridgeRevokePermissionContract,
  bridgeSetConfigContract,
} from '../shared/ipc-contract/bridge'
import type {
  sidebarWidthContract,
  walletSidebarWidthContract,
  windowCloseContract,
  windowMaximizeContract,
  windowMinimizeContract,
} from '../shared/ipc-contract/window'
import type {
  chatClaimDomainContract,
  chatClearDomainContract,
  chatConnectContract,
  chatDetectDomainsContract,
  chatDisconnectContract,
  chatDmSendContract,
  chatMutateContract,
  chatTimelineBeforeContract,
  chatIdentityContract,
  chatLinkIdentityContract,
  chatResetIdentityContract,
  chatSendContract,
} from '../shared/ipc-contract/chat'
import type {
  overlayHideAllContract,
  overlayHideContract,
  overlayShowContract,
  overlayUpdateBoundsContract,
} from '../shared/ipc-contract/overlay'
import type {
  cocoonArchiveExportMnemonicContract,
  cocoonArchiveListContract,
  cocoonAvailabilityContract,
  cocoonCashoutContract,
  cocoonFlowPendingContract,
  cocoonFlowStakeContract,
  cocoonFlowUnstakeContract,
  cocoonFundContract,
  cocoonNodeBalanceContract,
  cocoonOwnerBalanceContract,
  cocoonRecoveryAllContract,
  cocoonRecoveryEnqueueContract,
  cocoonRecoveryListContract,
  cocoonRecoveryRemoveContract,
  cocoonStakeInfoContract,
  cocoonStartContract,
  cocoonStatusContract,
  cocoonStopContract,
  cocoonUnstakeContract,
  cocoonWalletCreateContract,
  cocoonWalletDeleteContract,
  cocoonWalletExistsContract,
  cocoonWalletExportMnemonicContract,
  cocoonWalletInfoContract,
  cocoonWalletMarkSetupCompleteContract,
} from '../shared/ipc-contract/cocoon'
import type { updaterCheckContract, updaterOpenDownloadPageContract } from '../shared/ipc-contract/updater'
import { IpcClientError, isIpcFailure } from '../shared/ipc-failure'

export { IpcClientError } from '../shared/ipc-failure'

async function invokeChannel<TContract extends IpcRequestContract<readonly unknown[], unknown>>(
  channel: string,
  ...args: RequestArgs<TContract>
): Promise<RequestResult<TContract>> {
  const result: unknown = await ipcRenderer.invoke(channel, ...args)
  if (isIpcFailure(result)) {
    throw new IpcClientError(result.error.code, result.error.message, result.error.retryable)
  }
  return result as RequestResult<TContract>
}

// Custom APIs for renderer - exposed as window.electron
const electronAPI = {
  // Process versions
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  // Proxy
  proxy: {
    connect: () => invokeChannel<typeof proxyConnectContract>(IPC_CHANNELS.PROXY_CONNECT),
    disconnect: () => invokeChannel<typeof proxyDisconnectContract>(IPC_CHANNELS.PROXY_DISCONNECT),
    status: () => invokeChannel<typeof proxyStatusContract>(IPC_CHANNELS.PROXY_STATUS),
  },

  // Tabs
  tabs: {
    create: (tabId: string, initialUrl: string) =>
      invokeChannel<typeof tabCreateContract>(IPC_CHANNELS.TAB_CREATE, tabId, initialUrl),
    close: (tabId: string) => invokeChannel<typeof tabCloseContract>(IPC_CHANNELS.TAB_CLOSE, tabId),
    switch: (tabId: string) => invokeChannel<typeof tabSwitchContract>(IPC_CHANNELS.TAB_SWITCH, tabId),
  },

  // View (WebContentsView visibility)
  view: {
    hide: () => invokeChannel<typeof viewHideContract>(IPC_CHANNELS.VIEW_HIDE),
    show: () => invokeChannel<typeof viewShowContract>(IPC_CHANNELS.VIEW_SHOW),
  },

  // Overlay (floating UI above WebContentsView)
  overlay: {
    show: (
      id: string,
      bounds: { x: number; y: number; width: number; height: number },
      content: { type: string; [key: string]: unknown },
      options?: { autoDismiss?: boolean }
    ) => invokeChannel<typeof overlayShowContract>(IPC_CHANNELS.OVERLAY_SHOW, id, bounds, content, options),
    hide: (id: string) => invokeChannel<typeof overlayHideContract>(IPC_CHANNELS.OVERLAY_HIDE, id),
    hideAll: () => invokeChannel<typeof overlayHideAllContract>(IPC_CHANNELS.OVERLAY_HIDE_ALL),
    updateBounds: (id: string, bounds: { x: number; y: number; width: number; height: number }) =>
      invokeChannel<typeof overlayUpdateBoundsContract>(IPC_CHANNELS.OVERLAY_UPDATE_BOUNDS, id, bounds),
  },

  // Navigation
  navigate: (url: string, tabId?: string) => invokeChannel<typeof navigateContract>(IPC_CHANNELS.NAVIGATE, url, tabId),
  goBack: () => invokeChannel<typeof goBackContract>(IPC_CHANNELS.GO_BACK),
  goForward: () => invokeChannel<typeof goForwardContract>(IPC_CHANNELS.GO_FORWARD),
  reload: () => invokeChannel<typeof reloadContract>(IPC_CHANNELS.RELOAD),
  stop: () => invokeChannel<typeof stopContract>(IPC_CHANNELS.STOP),
  zoom: {
    get: () => invokeChannel<typeof zoomGetContract>(IPC_CHANNELS.ZOOM_GET),
    set: (percent: number) => invokeChannel<typeof zoomSetContract>(IPC_CHANNELS.ZOOM_SET, percent),
  },

  // Storage
  storage: {
    addBag: (bagId: string, name?: string) =>
      invokeChannel<typeof storageAddBagContract>(IPC_CHANNELS.STORAGE_ADD_BAG, bagId, name),
    removeBag: (bagId: string) =>
      invokeChannel<typeof storageRemoveBagContract>(IPC_CHANNELS.STORAGE_REMOVE_BAG, bagId),
    listBags: () => invokeChannel<typeof storageListBagsContract>(IPC_CHANNELS.STORAGE_LIST_BAGS),
    pauseBag: (bagId: string) => invokeChannel<typeof storagePauseBagContract>(IPC_CHANNELS.STORAGE_PAUSE_BAG, bagId),
    getBagDetails: (bagId: string) =>
      invokeChannel<typeof storageGetDetailsContract>(IPC_CHANNELS.STORAGE_GET_DETAILS, bagId),
    readFile: (bagId: string, relPath: string) =>
      invokeChannel<typeof storageReadFileContract>(IPC_CHANNELS.STORAGE_READ_FILE, bagId, relPath),
    getDownloadPath: () => invokeChannel<typeof storageGetDownloadPathContract>(IPC_CHANNELS.STORAGE_GET_DOWNLOAD_PATH),
    setDownloadPath: (path: string) =>
      invokeChannel<typeof storageSetDownloadPathContract>(IPC_CHANNELS.STORAGE_SET_DOWNLOAD_PATH, path),
    selectDownloadFolder: () =>
      invokeChannel<typeof storageSelectDownloadFolderContract>(IPC_CHANNELS.STORAGE_SELECT_DOWNLOAD_FOLDER),
    openFolder: (bagId: string) =>
      invokeChannel<typeof storageOpenFolderContract>(IPC_CHANNELS.STORAGE_OPEN_FOLDER, bagId),
    showFile: (bagId: string, fileName: string) =>
      invokeChannel<typeof storageShowFileContract>(IPC_CHANNELS.STORAGE_SHOW_FILE, bagId, fileName),
  },

  // Window controls
  window: {
    minimize: () => invokeChannel<typeof windowMinimizeContract>(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () => invokeChannel<typeof windowMaximizeContract>(IPC_CHANNELS.WINDOW_MAXIMIZE),
    close: () => invokeChannel<typeof windowCloseContract>(IPC_CHANNELS.WINDOW_CLOSE),
  },

  // Immediate sidebar width update (for real-time resize)
  updateSidebarWidth: (width: number) =>
    invokeChannel<typeof sidebarWidthContract>(IPC_CHANNELS.UPDATE_SIDEBAR_WIDTH, width),
  updateWalletSidebarWidth: (width: number) =>
    invokeChannel<typeof walletSidebarWidthContract>(IPC_CHANNELS.UPDATE_WALLET_SIDEBAR_WIDTH, width),

  // Settings
  clearBrowsingData: () => invokeChannel<typeof clearBrowsingDataContract>(IPC_CHANNELS.CLEAR_BROWSING_DATA),

  // App Settings
  settings: {
    getAll: () => invokeChannel<typeof settingsGetAllContract>(IPC_CHANNELS.SETTINGS_GET_ALL),
    get: <K extends SettingsCategory>(category: K): Promise<AppSettings[K]> =>
      invokeChannel<typeof settingsGetContract>(IPC_CHANNELS.SETTINGS_GET, category) as Promise<AppSettings[K]>,
    set: (category: SettingsCategory, values: Record<string, unknown>) =>
      invokeChannel<typeof settingsSetContract>(IPC_CHANNELS.SETTINGS_SET, category, values),
    apply: (patch: SettingsPatch) => invokeChannel<typeof settingsApplyContract>(IPC_CHANNELS.SETTINGS_APPLY, patch),
    reset: () => invokeChannel<typeof settingsResetContract>(IPC_CHANNELS.SETTINGS_RESET),
    diagnostics: {
      get: () => invokeChannel<typeof settingsDiagnosticsGetContract>(IPC_CHANNELS.SETTINGS_DIAGNOSTICS_GET),
      enable: () => invokeChannel<typeof settingsDiagnosticsEnableContract>(IPC_CHANNELS.SETTINGS_DIAGNOSTICS_ENABLE),
      disable: () =>
        invokeChannel<typeof settingsDiagnosticsDisableContract>(IPC_CHANNELS.SETTINGS_DIAGNOSTICS_DISABLE),
      copy: () => invokeChannel<typeof settingsDiagnosticsCopyContract>(IPC_CHANNELS.SETTINGS_DIAGNOSTICS_COPY),
    },
  },

  // Bookmarks persistence
  bookmarks: {
    load: () => invokeChannel<typeof bookmarksLoadContract>(IPC_CHANNELS.BOOKMARKS_LOAD),
    save: (data: BookmarksData) => invokeChannel<typeof bookmarksSaveContract>(IPC_CHANNELS.BOOKMARKS_SAVE, data),
  },

  // History
  history: {
    changeMode: (mode: 'memory' | 'persistent') =>
      invokeChannel<typeof historyChangeModeContract>(IPC_CHANNELS.HISTORY_CHANGE_MODE, mode),
    search: (query: string, limit?: number) =>
      invokeChannel<typeof historySearchContract>(IPC_CHANNELS.HISTORY_SEARCH, query, limit),
    getRecent: (limit?: number) =>
      invokeChannel<typeof historyGetRecentContract>(IPC_CHANNELS.HISTORY_GET_RECENT, limit),
    getTop: (limit?: number) => invokeChannel<typeof historyGetTopContract>(IPC_CHANNELS.HISTORY_GET_TOP, limit),
    getByDate: (startDate: number, endDate: number) =>
      invokeChannel<typeof historyGetByDateContract>(IPC_CHANNELS.HISTORY_GET_BY_DATE, startDate, endDate),
    delete: (id: string) => invokeChannel<typeof historyDeleteContract>(IPC_CHANNELS.HISTORY_DELETE, id),
    deleteByDate: (startDate: number, endDate: number) =>
      invokeChannel<typeof historyDeleteByDateContract>(IPC_CHANNELS.HISTORY_DELETE_BY_DATE, startDate, endDate),
    deletePattern: (pattern: string) =>
      invokeChannel<typeof historyDeletePatternContract>(IPC_CHANNELS.HISTORY_DELETE_PATTERN, pattern),
    clear: () => invokeChannel<typeof historyClearContract>(IPC_CHANNELS.HISTORY_CLEAR),
    getStats: () => invokeChannel<typeof historyGetStatsContract>(IPC_CHANNELS.HISTORY_GET_STATS),
    hasPersistentFile: () =>
      invokeChannel<typeof historyHasPersistentFileContract>(IPC_CHANNELS.HISTORY_HAS_PERSISTENT_FILE),
  },

  // Wallet
  wallet: {
    create: (options: { password?: string }) =>
      invokeChannel<typeof walletCreateContract>(IPC_CHANNELS.WALLET_CREATE, options),
    getState: () => invokeChannel<typeof walletGetStateContract>(IPC_CHANNELS.WALLET_GET_STATE),
    retrySystemStorage: () =>
      invokeChannel<typeof walletRetrySystemStorageContract>(IPC_CHANNELS.WALLET_RETRY_SYSTEM_STORAGE),
    getBalance: () => invokeChannel<typeof walletGetBalanceContract>(IPC_CHANNELS.WALLET_GET_BALANCE),
    send: (to: string, amount: string, comment?: string, encryptedComment?: boolean) =>
      invokeChannel<typeof walletSendContract>(IPC_CHANNELS.WALLET_SEND, to, amount, comment, encryptedComment),
    resolveRecipient: (input: string) =>
      invokeChannel<typeof walletResolveRecipientContract>(IPC_CHANNELS.WALLET_RESOLVE_RECIPIENT, input),
    getHistory: (limit?: number) =>
      invokeChannel<typeof walletGetHistoryContract>(IPC_CHANNELS.WALLET_GET_HISTORY, limit),
    clearHistory: () => invokeChannel<typeof walletClearHistoryContract>(IPC_CHANNELS.WALLET_CLEAR_HISTORY),
    exportKey: () => invokeChannel<typeof walletExportKeyContract>(IPC_CHANNELS.WALLET_EXPORT_KEY),
    approvePayment: (paymentId: string) =>
      invokeChannel<typeof walletApprovePaymentContract>(IPC_CHANNELS.WALLET_APPROVE_PAYMENT, paymentId),
    rejectPayment: (paymentId: string) =>
      invokeChannel<typeof walletRejectPaymentContract>(IPC_CHANNELS.WALLET_REJECT_PAYMENT, paymentId),
    discoverAccounts: (mnemonic: string[]) =>
      invokeChannel<typeof walletDiscoverAccountsContract>(IPC_CHANNELS.WALLET_DISCOVER_ACCOUNTS, mnemonic),
    importWallet: (mnemonic: string[], password: string, walletVersion: 'v3R1' | 'v3R2' | 'v4R2' | 'v5R1') =>
      invokeChannel<typeof walletImportContract>(IPC_CHANNELS.WALLET_IMPORT, mnemonic, password, walletVersion),
    exportMnemonic: (password?: string) =>
      invokeChannel<typeof walletExportMnemonicContract>(IPC_CHANNELS.WALLET_EXPORT_MNEMONIC, password),
    deleteWallet: (password: string) =>
      invokeChannel<typeof walletDeleteContract>(IPC_CHANNELS.WALLET_DELETE, password),
    forgetWallet: () => invokeChannel<typeof walletForgetContract>(IPC_CHANNELS.WALLET_FORGET),
    unlock: (password: string) => invokeChannel<typeof walletUnlockContract>(IPC_CHANNELS.WALLET_UNLOCK, password),
    lock: () => invokeChannel<typeof walletLockContract>(IPC_CHANNELS.WALLET_LOCK),
    setupPassword: (password: string) =>
      invokeChannel<typeof walletSetupPasswordContract>(IPC_CHANNELS.WALLET_SETUP_PASSWORD, password),
    createBackupChallenge: (password?: string) =>
      invokeChannel<typeof walletCreateBackupChallengeContract>(IPC_CHANNELS.WALLET_CREATE_BACKUP_CHALLENGE, password),
    markBackupVerified: (challengeId: string, password: string | undefined, answers: string[]) =>
      invokeChannel<typeof walletMarkBackupVerifiedContract>(
        IPC_CHANNELS.WALLET_MARK_BACKUP_VERIFIED,
        challengeId,
        password,
        answers
      ),
    changePassword: (currentPassword: string, nextPassword: string) =>
      invokeChannel<typeof walletChangePasswordContract>(
        IPC_CHANNELS.WALLET_CHANGE_PASSWORD,
        currentPassword,
        nextPassword
      ),
    setSensitiveDisplay: (active: boolean) =>
      invokeChannel<typeof walletSensitiveDisplayContract>(IPC_CHANNELS.WALLET_SENSITIVE_DISPLAY, active),
  },

  // Bridge
  bridge: {
    getPermissions: () => invokeChannel<typeof bridgeGetPermissionsContract>(IPC_CHANNELS.BRIDGE_GET_PERMISSIONS),
    revokePermission: (domain: string, scope: 'blockchain' | 'p2p' | 'write') =>
      invokeChannel<typeof bridgeRevokePermissionContract>(IPC_CHANNELS.BRIDGE_REVOKE_PERMISSION, domain, scope),
    getConfig: () =>
      invokeChannel<typeof bridgeGetConfigContract>(IPC_CHANNELS.BRIDGE_GET_CONFIG) as Promise<BridgeConfig | null>,
    setConfig: (config: Record<string, unknown>) =>
      invokeChannel<typeof bridgeSetConfigContract>(IPC_CHANNELS.BRIDGE_SET_CONFIG, config),
    restart: () => invokeChannel<typeof bridgeRestartContract>(IPC_CHANNELS.BRIDGE_RESTART),
  },

  tonconnect: {
    getSessions: () => invokeChannel<typeof tonConnectGetSessionsContract>(IPC_CHANNELS.TONCONNECT_GET_SESSIONS),
    disconnectSession: (domain: string) =>
      invokeChannel<typeof tonConnectDisconnectSessionContract>(IPC_CHANNELS.TONCONNECT_DISCONNECT_SESSION, domain),
  },

  // DNS
  dns: {
    resolve: (domain: string) => invokeChannel<typeof dnsResolveContract>(IPC_CHANNELS.DNS_RESOLVE, domain),
  },

  chat: {
    connect: (room?: string, node?: string) =>
      invokeChannel<typeof chatConnectContract>(IPC_CHANNELS.CHAT_CONNECT, room, node),
    send: (text: string) => invokeChannel<typeof chatSendContract>(IPC_CHANNELS.CHAT_SEND, text),
    dmSend: (peerKey: string, text: string) =>
      invokeChannel<typeof chatDmSendContract>(IPC_CHANNELS.CHAT_DM_SEND, peerKey, text),
    mutate: (mutation: {
      action: 'metadata' | 'pin' | 'unpin' | 'moderator-grant' | 'moderator-revoke' | 'write-policy'
      name?: string
      description?: string
      messageId?: string
      subjectKey?: string
      anyoneCanWrite?: boolean
    }) => invokeChannel<typeof chatMutateContract>(IPC_CHANNELS.CHAT_MUTATE, mutation),
    timelineBefore: (beforeSeqno: number, limit?: number) =>
      invokeChannel<typeof chatTimelineBeforeContract>(IPC_CHANNELS.CHAT_TIMELINE_BEFORE, beforeSeqno, limit),
    disconnect: () => invokeChannel<typeof chatDisconnectContract>(IPC_CHANNELS.CHAT_DISCONNECT),
    identity: () => invokeChannel<typeof chatIdentityContract>(IPC_CHANNELS.CHAT_IDENTITY),
    linkIdentity: () => invokeChannel<typeof chatLinkIdentityContract>(IPC_CHANNELS.CHAT_IDENTITY_LINK),
    claimDomain: (domain: string) =>
      invokeChannel<typeof chatClaimDomainContract>(IPC_CHANNELS.CHAT_CLAIM_DOMAIN, domain),
    clearDomain: () => invokeChannel<typeof chatClearDomainContract>(IPC_CHANNELS.CHAT_CLEAR_DOMAIN),
    detectDomains: () => invokeChannel<typeof chatDetectDomainsContract>(IPC_CHANNELS.CHAT_DETECT_DOMAINS),
    resetIdentity: () => invokeChannel<typeof chatResetIdentityContract>(IPC_CHANNELS.CHAT_RESET_IDENTITY),
  },

  // Cocoon AI
  cocoon: {
    availability: () => invokeChannel<typeof cocoonAvailabilityContract>(IPC_CHANNELS.COCOON_AVAILABILITY),
    status: () => invokeChannel<typeof cocoonStatusContract>(IPC_CHANNELS.COCOON_STATUS),
    // No params: secrets are read from disk in the main process.
    start: () => invokeChannel<typeof cocoonStartContract>(IPC_CHANNELS.COCOON_START),
    stop: () => invokeChannel<typeof cocoonStopContract>(IPC_CHANNELS.COCOON_STOP),
    // Wallet management
    walletExists: () => invokeChannel<typeof cocoonWalletExistsContract>(IPC_CHANNELS.COCOON_WALLET_EXISTS),
    walletCreate: () => invokeChannel<typeof cocoonWalletCreateContract>(IPC_CHANNELS.COCOON_WALLET_CREATE),
    walletInfo: () => invokeChannel<typeof cocoonWalletInfoContract>(IPC_CHANNELS.COCOON_WALLET_INFO),
    walletExportMnemonic: () =>
      invokeChannel<typeof cocoonWalletExportMnemonicContract>(IPC_CHANNELS.COCOON_WALLET_EXPORT_MNEMONIC),
    walletDelete: () => invokeChannel<typeof cocoonWalletDeleteContract>(IPC_CHANNELS.COCOON_WALLET_DELETE),
    walletMarkSetupComplete: () =>
      invokeChannel<typeof cocoonWalletMarkSetupCompleteContract>(IPC_CHANNELS.COCOON_WALLET_MARK_SETUP_COMPLETE),
    // Setup wizard
    getOwnerBalance: () => invokeChannel<typeof cocoonOwnerBalanceContract>(IPC_CHANNELS.COCOON_SETUP_OWNER_BALANCE),
    getCocoonWalletBalance: () =>
      invokeChannel<typeof cocoonNodeBalanceContract>(IPC_CHANNELS.COCOON_SETUP_COCOON_BALANCE),
    fundCocoon: (amount: string | 'max') =>
      invokeChannel<typeof cocoonFundContract>(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON, { amount }),
    // Stake lifecycle (atomic primitives)
    stakeInfo: () => invokeChannel<typeof cocoonStakeInfoContract>(IPC_CHANNELS.COCOON_STAKE_INFO),
    unstake: () => invokeChannel<typeof cocoonUnstakeContract>(IPC_CHANNELS.COCOON_STAKE_UNSTAKE),
    cashout: () => invokeChannel<typeof cocoonCashoutContract>(IPC_CHANNELS.COCOON_STAKE_CASHOUT),
    // Composite flows (single user actions). flowStake = activate: rotates
    // wallet (archives old, regens fresh) before staking, because the upstream
    // proxy worker permanently caches identity status.
    flowStake: () => invokeChannel<typeof cocoonFlowStakeContract>(IPC_CHANNELS.COCOON_FLOW_STAKE),
    flowUnstake: () => invokeChannel<typeof cocoonFlowUnstakeContract>(IPC_CHANNELS.COCOON_FLOW_UNSTAKE),
    flowPending: () => invokeChannel<typeof cocoonFlowPendingContract>(IPC_CHANNELS.COCOON_FLOW_PENDING),
    // Archive of consumed wallets (rotated out; kept for upstream-restart recovery)
    archiveList: () => invokeChannel<typeof cocoonArchiveListContract>(IPC_CHANNELS.COCOON_ARCHIVE_LIST),
    archiveExportMnemonic: (archivedAt: number) =>
      invokeChannel<typeof cocoonArchiveExportMnemonicContract>(IPC_CHANNELS.COCOON_ARCHIVE_EXPORT_MNEMONIC, {
        archivedAt,
      }),
    // Recovery: drain TON locked in archived-wallet client SCs back to native.
    recoveryEnqueue: (params: { archivedAt: number; clientSCAddress: string }) =>
      invokeChannel<typeof cocoonRecoveryEnqueueContract>(IPC_CHANNELS.COCOON_RECOVERY_ENQUEUE, params),
    recoveryList: () => invokeChannel<typeof cocoonRecoveryListContract>(IPC_CHANNELS.COCOON_RECOVERY_LIST),
    recoveryRemove: (archivedAt: number) =>
      invokeChannel<typeof cocoonRecoveryRemoveContract>(IPC_CHANNELS.COCOON_RECOVERY_REMOVE, { archivedAt }),
    recoveryAll: () => invokeChannel<typeof cocoonRecoveryAllContract>(IPC_CHANNELS.COCOON_RECOVERY_ALL),
  },

  // Updater
  updater: {
    check: () => invokeChannel<typeof updaterCheckContract>(IPC_CHANNELS.UPDATER_CHECK),
    openDownloadPage: () =>
      invokeChannel<typeof updaterOpenDownloadPageContract>(IPC_CHANNELS.UPDATER_OPEN_DOWNLOAD_PAGE),
  },

  // Event listeners - returns unsubscribe function for proper cleanup
  on: <K extends keyof IpcEventMap>(channel: K, callback: (...args: IpcEventMap[K]) => void): (() => void) => {
    if ((MAIN_RENDERER_EVENT_CHANNELS as readonly string[]).includes(channel)) {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...(args as IpcEventMap[K]))
      ipcRenderer.on(channel, listener)
      // Return unsubscribe function that removes only THIS listener
      return () => ipcRenderer.removeListener(channel, listener)
    }
    return () => {} // No-op for invalid channels
  },
}

/** Renderer declaration derives from the actual exposed object; no parallel API signature. */
export type ElectronAPI = typeof electronAPI

// Use `contextBridge` APIs to expose Electron APIs to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error(error)
  }
}
