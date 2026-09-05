/**
 * Default settings values.
 * Shared between main and renderer processes.
 */

import type { CustomTheme, SitePolicy } from './types'
import { UI_DIMENSIONS } from './constants'

export type BuiltInTheme = 'resistance-dog' | 'utya-duck'
export type ThemeType = BuiltInTheme | `custom:${string}`

/**
 * Default values for all settings.
 * Main process may override downloadPath with platform-specific path.
 */
export const DEFAULT_SETTINGS = {
  // General
  homepage: 'ton://start',
  resolveEth: false,
  ethRpc: '',
  resolveSol: false,
  solRpc: '',

  // Network
  proxyPort: 8080,
  storagePort: 5555,
  wsPort: 8081,
  autoConnect: false,
  connectionTimeout: 30,
  anonymousMode: false,
  tunnelMode: 'standard' as const,

  // Storage
  downloadPath: '', // Main process will set actual path
  pollingInterval: 2000,
  seedingEnabled: false, // Seeding disabled by default, download-only
  downloadSpeedLimit: 0, // 0 = unlimited bytes/sec
  uploadSpeedLimit: 0, // 0 = unlimited bytes/sec

  // Appearance
  theme: 'resistance-dog' as ThemeType,
  customThemes: [] as CustomTheme[],
  language: 'en',
  defaultZoom: 100,
  showBookmarksBar: true,
  showStatusBar: true,
  tabOrientation: 'horizontal' as 'horizontal' | 'vertical',
  sidebarWidth: UI_DIMENSIONS.DEFAULT_SIDEBAR_WIDTH, // Default sidebar width in pixels

  // Privacy
  clearOnExit: true, // Privacy-first: clear data on exit by default
  disableCache: false, // Disable HTTP cache for maximum privacy (slower)
  firstPartyIsolation: true, // Isolate cookies/localStorage per domain (Tier S)
  cookieAutoDelete: true, // Auto-delete cookies after inactivity (Tier A)
  cookieAutoDeleteMinutes: 30, // Minutes of inactivity before auto-delete
  historyMode: 'memory' as const, // History mode: 'memory' (RAM only) | 'persistent' (auto-encrypted disk)
  historyMaxEntries: 100, // Maximum history entries

  // Advanced
  proxyVerbosity: 2,
  storageVerbosity: 2,
  displayUnicodeDomains: false,
  tonConnectEnabled: false,

  // Wallet
  wallet: {
    paymentMode: 'off' as const,
    notificationStyle: 'popup' as const,
    limits: {
      perRequest: '0',
      perDay: '0',
      perSitePerMonth: '0',
    },
    sitePolicies: [] as SitePolicy[],
    autoPayDomains: [] as string[],
    autoLockMinutes: 5,
  },

  // Cocoon AI
  cocoon: {
    autostart: false,
  },

  messenger: {
    autostart: false,
  },
} as const
