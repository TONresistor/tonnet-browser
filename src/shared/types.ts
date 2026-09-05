/**
 * Shared types.
 * Used by both main and renderer processes.
 */

export interface Tab {
  id: string
  url: string
  title: string
  favicon?: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface Bookmark {
  id: string
  url: string
  title: string
  favicon?: string
  createdAt: number
}

export interface TonConnectSession {
  domain: string
  appName: string
  appIconUrl?: string
  url: string
  grantedAt: number
}

export interface OverlayMenuItem {
  id: string
  label: string
  separator?: boolean
  disabled?: boolean
  destructive?: boolean
  data?: Record<string, string>
}

export interface ProxyStatus {
  connected: boolean
  port: number
  error?: string
}

export type { StorageBag, BagDetails } from './ipc-contract/storage'

export type { HistoryEntry, HistoryStats } from './ipc-contract/history'

// --- Wallet types ---

export type PaymentMode = 'off' | 'manual' | 'auto'
export type NotificationStyle = 'popup' | 'addressbar'

export type { WalletState, WalletTransaction } from './ipc-contract/wallet'

export interface PaymentRequirements {
  scheme: string
  network: string
  asset: string
  amount: string
  payTo: string
  maxTimeoutSeconds: number
  extra?: {
    relayAddress?: string
    maxRelayCommission?: string
    assetDecimals: number
    assetSymbol: string
  }
}

export interface ExactTonPayload {
  signedBoc: string
  walletPublicKey: string
  walletAddress: string
  seqno: number
  validUntil: number
}

export type PaymentNotificationData = import('./ipc-contract/wallet').PaymentNotification
export type DnsResolveResult = import('./ipc-contract/wallet').DnsResolveResult

export interface ChatIdentityInfo {
  tier: 'domain' | 'identity'
  name: string
  domain?: string
  fingerprint?: string
}

export interface OwnChatIdentity {
  identityKey: string
  name: string
  domain?: string
}

// Re-export schemas and IPC channels for backward compatibility
// Use `export type` for schema inferred types to prevent Zod runtime from leaking into renderer bundle
export type {
  GeneralSettings,
  NetworkSettings,
  StorageSettings,
  AppearanceSettings,
  PrivacySettings,
  AdvancedSettings,
  AppSettings,
  ThemeColors,
  CustomTheme,
  BridgePermission,
  BridgeSettings,
  CocoonSettings,
  SpendingLimits,
  SitePolicy,
  WalletSettings,
  MessengerSettings,
} from './schemas'
export {
  GeneralSettingsSchema,
  NetworkSettingsSchema,
  StorageSettingsSchema,
  AppearanceSettingsSchema,
  PrivacySettingsSchema,
  AdvancedSettingsSchema,
  WalletSettingsSchema,
  BridgeSettingsSchema,
  AppSettingsSchema,
  ThemeTypeSchema,
  ThemeColorsSchema,
  CustomThemeSchema,
  GeneralSettingsPartialSchema,
  NetworkSettingsPartialSchema,
  StorageSettingsPartialSchema,
  AppearanceSettingsPartialSchema,
  PrivacySettingsPartialSchema,
  AdvancedSettingsPartialSchema,
  WalletSettingsPartialSchema,
  BridgeSettingsPartialSchema,
  CocoonSettingsSchema,
  CocoonSettingsPartialSchema,
  MessengerSettingsSchema,
  MessengerSettingsPartialSchema,
  type BridgeScope,
  type BridgeDecision,
} from './schemas'
