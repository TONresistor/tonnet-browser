/**
 * Settings validation functions - extracted for testing without Electron dependencies
 */

import { z } from 'zod'
import type { AppSettings } from '../../shared/types'
import {
  AppSettingsSchema,
  GeneralSettingsPartialSchema,
  NetworkSettingsPartialSchema,
  StorageSettingsPartialSchema,
  AppearanceSettingsPartialSchema,
  PrivacySettingsPartialSchema,
  AdvancedSettingsPartialSchema,
  WalletSettingsPartialSchema,
  BridgeSettingsPartialSchema,
  CocoonSettingsPartialSchema,
  MessengerSettingsPartialSchema,
} from '../../shared/types'
import { hasExplicitUndefined } from '../../shared/schemas'
import { createLogger } from '../../shared/logger'
const log = createLogger('settings')

/** Valid settings category names, derived from the AppSettings type */
export const SETTINGS_CATEGORIES: ReadonlyArray<keyof AppSettings> = [
  'general',
  'network',
  'storage',
  'appearance',
  'privacy',
  'advanced',
  'wallet',
  'bridge',
  'cocoon',
  'messenger',
]

/**
 * Validate a full settings object using Zod.
 * Returns parsed (and defaulted) data on success, or an error message on failure.
 */
export function validateSettings(data: unknown): { valid: true; data: AppSettings } | { valid: false; error: string } {
  const result = AppSettingsSchema.safeParse(data)
  if (result.success) {
    return { valid: true, data: result.data }
  }
  return { valid: false, error: result.error.message }
}

/**
 * Validate values for a specific settings category using Zod (partial schema).
 * Used by the SETTINGS_SET IPC handler to validate incoming updates.
 */
export function validateCategoryValues<K extends keyof AppSettings>(
  category: K,
  values: unknown
): { valid: true; data: Partial<AppSettings[K]> } | { valid: false; error: string } {
  if (hasExplicitUndefined(values)) {
    return { valid: false, error: 'Settings values must be defined' }
  }
  // Use partial schemas WITHOUT defaults so Zod only validates/strips provided fields.
  // This preserves the partial update semantics: only the supplied keys are returned.
  const schemas: Record<string, z.ZodSchema> = {
    general: GeneralSettingsPartialSchema,
    network: NetworkSettingsPartialSchema,
    storage: StorageSettingsPartialSchema,
    appearance: AppearanceSettingsPartialSchema,
    privacy: PrivacySettingsPartialSchema,
    advanced: AdvancedSettingsPartialSchema,
    wallet: WalletSettingsPartialSchema,
    bridge: BridgeSettingsPartialSchema,
    cocoon: CocoonSettingsPartialSchema,
    messenger: MessengerSettingsPartialSchema,
  }
  const schema = schemas[category]
  if (!schema) {
    return { valid: false, error: `Unknown category: ${category}` }
  }
  const result = schema.safeParse(values)
  if (result.success) {
    return { valid: true, data: result.data as Partial<AppSettings[K]> }
  }
  return { valid: false, error: result.error.message }
}

/**
 * Security: Validate parsed settings structure (structural/type check only, no range checks).
 * Kept for backward compatibility with existing tests and callers.
 * For full validation with Zod, use validateSettings() instead.
 */
export function isValidSettingsObject(obj: unknown): obj is Partial<AppSettings> {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false
  }

  const settings = obj as Record<string, unknown>
  const categories: readonly string[] = SETTINGS_CATEGORIES

  for (const key of Object.keys(settings)) {
    // Only warn for unknown categories, but allow them
    if (!categories.includes(key)) {
      log.warn(`Unknown category: ${key}`)
      continue
    }
    // Each known category must be an object
    if (typeof settings[key] !== 'object' || settings[key] === null || Array.isArray(settings[key])) {
      log.warn(`Invalid category format: ${key}`)
      return false
    }
  }

  // Validate specific field types and values if present
  const network = settings.network as Record<string, unknown> | undefined
  if (network) {
    if (network.proxyPort !== undefined) {
      if (typeof network.proxyPort !== 'number') return false
      if (network.proxyPort < 1024 || network.proxyPort > 65535) return false
    }
    if (network.storagePort !== undefined) {
      if (typeof network.storagePort !== 'number') return false
      if (network.storagePort < 1024 || network.storagePort > 65535) return false
    }
    if (network.autoConnect !== undefined && typeof network.autoConnect !== 'boolean') return false
    if (network.anonymousMode !== undefined && typeof network.anonymousMode !== 'boolean') return false
  }

  const privacy = settings.privacy as Record<string, unknown> | undefined
  if (privacy) {
    if (privacy.clearOnExit !== undefined && typeof privacy.clearOnExit !== 'boolean') return false
    if (privacy.disableCache !== undefined && typeof privacy.disableCache !== 'boolean') return false
    if (privacy.firstPartyIsolation !== undefined && typeof privacy.firstPartyIsolation !== 'boolean') return false
    if (privacy.cookieAutoDelete !== undefined && typeof privacy.cookieAutoDelete !== 'boolean') return false
    if (privacy.cookieAutoDeleteMinutes !== undefined && typeof privacy.cookieAutoDeleteMinutes !== 'number')
      return false
  }

  const appearance = settings.appearance as Record<string, unknown> | undefined
  if (appearance) {
    // Accept built-in themes, old legacy names, and custom theme IDs (custom:xxx)
    if (appearance.theme !== undefined) {
      const theme = appearance.theme as string
      const isBuiltIn = ['resistance-dog', 'utya-duck', 'midnight-blue', 'canard-yellow'].includes(theme)
      const isCustom = typeof theme === 'string' && theme.startsWith('custom:')
      if (!isBuiltIn && !isCustom) return false
    }
    if (appearance.defaultZoom !== undefined && typeof appearance.defaultZoom !== 'number') return false
    // customThemes must be an array if present
    if (appearance.customThemes !== undefined && !Array.isArray(appearance.customThemes)) return false
  }

  const advanced = settings.advanced as Record<string, unknown> | undefined
  if (advanced) {
    if (advanced.displayUnicodeDomains !== undefined && typeof advanced.displayUnicodeDomains !== 'boolean')
      return false
    if (advanced.tonConnectEnabled !== undefined && typeof advanced.tonConnectEnabled !== 'boolean') return false
  }

  const messenger = settings.messenger as Record<string, unknown> | undefined
  if (messenger) {
    if (messenger.autostart !== undefined && typeof messenger.autostart !== 'boolean') return false
  }

  return true
}

/**
 * Get default settings without Electron dependencies.
 * Uses fixed paths suitable for testing.
 */
export function getDefaultSettingsBase(): AppSettings {
  const defaults = AppSettingsSchema.parse({})
  defaults.storage.downloadPath = '/tmp/tonnet-storage'
  return defaults
}
