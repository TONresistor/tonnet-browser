/**
 * Application settings management.
 * Load, save, and access user preferences.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { VersionedJsonRepository } from '../persistence/versioned-json-repository'
import { UnsupportedSchemaVersionError } from '../persistence/schema-version'
import type { ThemeType } from '../../shared/defaults'
import type {
  GeneralSettings,
  NetworkSettings,
  StorageSettings,
  AppearanceSettings,
  PrivacySettings,
  AdvancedSettings,
  AppSettings,
} from '../../shared/types'
import { AppSettingsSchema, NetworkSettingsSchema } from '../../shared/types'
import { hasExplicitUndefined } from '../../shared/schemas'
import { PAGE_ZOOM } from '../../shared/constants'
import { createLogger } from '../../shared/logger'
const log = createLogger('settings')
const SETTINGS_SCHEMA_VERSION = 4

// Re-export settings types for consumers that import from this module
export type {
  GeneralSettings,
  NetworkSettings,
  StorageSettings,
  AppearanceSettings,
  PrivacySettings,
  AdvancedSettings,
  AppSettings,
  ThemeType,
}

// File paths
const getSettingsDir = () => join(app.getPath('userData'))
const getSettingsFile = () => join(getSettingsDir(), 'app-settings.json')
const getDefaultStoragePath = () => join(app.getPath('userData'), 'storage')

// Default settings, derived from the Zod schema's field-level `.default()`s
// (single source of truth). Only the platform-specific download path is
// applied on top, since the schema cannot know it.
export function getDefaultSettings(): AppSettings {
  const defaults = AppSettingsSchema.parse({})
  defaults.storage.downloadPath = getDefaultStoragePath()
  return defaults
}

// In-memory cache
let settingsCache: AppSettings | null = null
let settingsRepository: VersionedJsonRepository<AppSettings> | null = null
let settingsMutationChain: Promise<void> = Promise.resolve()
let settingsWritesBlocked: UnsupportedSchemaVersionError | null = null

function freezeValue<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freezeValue(child)
  return Object.freeze(value)
}

function cacheSettings(settings: AppSettings): AppSettings {
  settingsCache = freezeValue(settings)
  return settingsCache
}

export type SettingsValuePatch<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: SettingsValuePatch<T[K]> }
    : T

export type SettingsPatch = { [K in keyof AppSettings]?: SettingsValuePatch<AppSettings[K]> }

export class SettingsRuntimeApplyError extends Error {
  constructor(
    readonly applyError: unknown,
    readonly rollbackError?: unknown
  ) {
    super(rollbackError ? 'Runtime settings apply and rollback failed' : 'Runtime settings apply failed')
    this.name = 'SettingsRuntimeApplyError'
  }
}

function getRepository(): VersionedJsonRepository<AppSettings> {
  if (!settingsRepository) {
    settingsRepository = new VersionedJsonRepository({
      filePath: getSettingsFile(),
      version: SETTINGS_SCHEMA_VERSION,
      schema: AppSettingsSchema,
      defaults: getDefaultSettings,
      migrate: (raw) => migrateAll(raw).data,
      mode: 0o600,
      corruption: 'reset-with-backup',
      onCorrupt: (error, backupPath) => log.error(`Corrupt settings quarantined at ${backupPath}: ${String(error)}`),
    })
  }
  return settingsRepository
}

/**
 * Migrate legacy notificationStyle values (banner/modal/toast/panel) to the
 * two-value set introduced in v1.7: 'popup' | 'addressbar'.
 * Map: banner → addressbar, modal/toast/panel → popup.
 * Already-valid values are left unchanged (idempotent).
 */
export function migrateNotificationStyle(raw: unknown): { migrated: boolean; data: unknown } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { migrated: false, data: raw }
  }

  const obj = raw as Record<string, unknown>
  const wallet = obj['wallet']

  if (typeof wallet !== 'object' || wallet === null || Array.isArray(wallet)) {
    return { migrated: false, data: raw }
  }

  const w = wallet as Record<string, unknown>
  const current = w['notificationStyle']
  const legacyMap: Record<string, string> = {
    banner: 'addressbar',
    modal: 'popup',
    toast: 'popup',
    panel: 'popup',
  }

  if (typeof current !== 'string' || !(current in legacyMap)) {
    return { migrated: false, data: raw }
  }

  return {
    migrated: true,
    data: { ...obj, wallet: { ...w, notificationStyle: legacyMap[current] } },
  }
}

/**
 * Migrate v1.5.3 network settings to v1.6.0 shape.
 *
 * v1.5.3 had `circuitRotation: boolean` and `rotateInterval: string` under `network`.
 * v1.6.0 replaces them with `tunnelMode: 'standard' | 'maximum'` (hop count, not rotation
 * frequency). Since the two concepts are not directly equivalent and `anonymousMode` already
 * controls whether tunnelling is active at all, both old field combinations map to the
 * conservative default `'standard'` (2 hops). If `tunnelMode` is already present the object
 * is returned unchanged (idempotent).
 *
 * @param raw - The parsed-but-unvalidated JSON object from disk.
 * @returns A new object with legacy keys removed from `network` and `tunnelMode` populated,
 *          or the original object if no migration was needed.
 */
export function migrateSettings(raw: unknown): { migrated: boolean; data: unknown } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { migrated: false, data: raw }
  }

  const obj = raw as Record<string, unknown>
  const network = obj['network']

  if (typeof network !== 'object' || network === null || Array.isArray(network)) {
    return { migrated: false, data: raw }
  }

  const net = network as Record<string, unknown>
  const hasLegacy = 'circuitRotation' in net || 'rotateInterval' in net
  const hasCurrent = 'tunnelMode' in net

  if (!hasLegacy) {
    return { migrated: false, data: raw }
  }

  // Strip legacy keys and inject tunnelMode if absent
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { circuitRotation: _cr, rotateInterval: _ri, ...restNet } = net
  const migratedNet: Record<string, unknown> = {
    ...restNet,
    ...(hasCurrent ? {} : { tunnelMode: 'standard' }),
  }

  return {
    migrated: true,
    data: { ...obj, network: migratedNet },
  }
}

// Migrate legacy theme names to current ones (pre-Zod; the schema still accepts
// the legacy literals, so rewriting here removes them from disk on next persist).
const LEGACY_THEME_MAP: Record<string, string> = {
  'midnight-blue': 'resistance-dog',
  'canard-yellow': 'utya-duck',
}
export function migrateTheme(raw: unknown): { migrated: boolean; data: unknown } {
  if (!raw || typeof raw !== 'object') return { migrated: false, data: raw }
  const obj = raw as Record<string, unknown>
  const appearance = obj.appearance as Record<string, unknown> | undefined
  const theme = appearance?.theme
  if (typeof theme === 'string' && LEGACY_THEME_MAP[theme]) {
    return {
      migrated: true,
      data: { ...obj, appearance: { ...appearance, theme: LEGACY_THEME_MAP[theme] } },
    }
  }
  return { migrated: false, data: raw }
}

export function migrateThemeColors(raw: unknown): { migrated: boolean; data: unknown } {
  if (!isPlainObject(raw) || !isPlainObject(raw.appearance) || !Array.isArray(raw.appearance.customThemes)) {
    return { migrated: false, data: raw }
  }

  let migrated = false
  const customThemes = raw.appearance.customThemes.map((theme) => {
    if (!isPlainObject(theme) || !isPlainObject(theme.colors)) return theme

    const { foreground, mutedForeground, ...currentColors } = theme.colors
    if (!foreground && !mutedForeground) return theme

    const textPrimary = currentColors.textPrimary ?? foreground
    const textSecondary = currentColors.textSecondary ?? mutedForeground
    if (typeof textPrimary !== 'string' || typeof textSecondary !== 'string') return theme
    migrated = true
    return {
      ...theme,
      colors: {
        ...currentColors,
        textPrimary,
        textSecondary,
        heading: currentColors.heading ?? textPrimary,
        chromeForeground: currentColors.chromeForeground ?? textPrimary,
        icon: currentColors.icon ?? textPrimary,
      },
    }
  })

  if (!migrated) return { migrated: false, data: raw }
  return { migrated: true, data: { ...raw, appearance: { ...raw.appearance, customThemes } } }
}

function migrateDuplicatePorts(raw: unknown): { migrated: boolean; data: unknown } {
  if (!isPlainObject(raw) || !isPlainObject(raw.network)) return { migrated: false, data: raw }
  const parsed = NetworkSettingsSchema.safeParse(raw.network)
  if (!parsed.success) return { migrated: false, data: raw }
  const keys = ['proxyPort', 'storagePort', 'wsPort'] as const
  const effectivePorts = keys.map((key) => parsed.data[key])
  if (new Set(effectivePorts).size === effectivePorts.length) return { migrated: false, data: raw }

  const defaults = NetworkSettingsSchema.parse({})
  const explicitKeys = keys.filter((key) => Object.prototype.hasOwnProperty.call(raw.network, key))
  const missingKeys = keys.filter((key) => !explicitKeys.includes(key))
  const used = new Set<number>()
  const network = { ...raw.network }

  for (const key of [...explicitKeys, ...missingKeys]) {
    const preferred = parsed.data[key]
    const port = used.has(preferred)
      ? [defaults[key], defaults.proxyPort, defaults.storagePort, defaults.wsPort].find((value) => !used.has(value))
      : preferred
    if (port === undefined) return { migrated: false, data: raw }
    network[key] = port
    used.add(port)
  }

  return { migrated: true, data: { ...raw, network } }
}

export function migratePageZoom(raw: unknown): { migrated: boolean; data: unknown } {
  if (!isPlainObject(raw) || !isPlainObject(raw.appearance)) return { migrated: false, data: raw }
  const current = raw.appearance.defaultZoom
  if (typeof current !== 'number') return { migrated: false, data: raw }
  const defaultZoom = Math.min(Math.max(current, PAGE_ZOOM.MIN_PERCENT), PAGE_ZOOM.MAX_PERCENT)
  if (defaultZoom === current) return { migrated: false, data: raw }
  return {
    migrated: true,
    data: { ...raw, appearance: { ...raw.appearance, defaultZoom } },
  }
}

/** Preserve the former Messenger opt-in as the new startup preference. */
export function migrateMessengerAutostart(raw: unknown): { migrated: boolean; data: unknown } {
  if (!isPlainObject(raw) || !isPlainObject(raw.messenger) || !('networkEnabled' in raw.messenger)) {
    return { migrated: false, data: raw }
  }
  const { networkEnabled, ...messenger } = raw.messenger
  return {
    migrated: true,
    data: {
      ...raw,
      messenger: {
        ...messenger,
        ...(typeof messenger.autostart === 'boolean'
          ? {}
          : { autostart: typeof networkEnabled === 'boolean' ? networkEnabled : false }),
      },
    },
  }
}

function assertSettingsVersion(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const version = (raw as { schemaVersion?: unknown }).schemaVersion
  if (typeof version === 'number' && Number.isInteger(version) && version > SETTINGS_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(version, SETTINGS_SCHEMA_VERSION, getSettingsFile())
  }
}

/** Run all pre-validation migrations in sequence, reporting if any changed the data. */
function migrateAll(raw: unknown): { migrated: boolean; data: unknown } {
  const r1 = migrateSettings(raw)
  const r2 = migrateNotificationStyle(r1.data)
  const r3 = migrateTheme(r2.data)
  const r4 = migrateThemeColors(r3.data)
  const r5 = migrateDuplicatePorts(r4.data)
  const r6 = migratePageZoom(r5.data)
  const r7 = migrateMessengerAutostart(r6.data)
  return {
    migrated: r1.migrated || r2.migrated || r3.migrated || r4.migrated || r5.migrated || r6.migrated || r7.migrated,
    data: r7.data,
  }
}

/** Persist during load without letting a transient write failure abort startup. */
function persistBestEffort(settings: AppSettings): void {
  void persistSettings(settings).catch(() => {
    /* saveSettings already logged; in-memory settings are still usable */
  })
}

// Load settings from disk
export function loadSettings(): AppSettings {
  if (settingsCache) {
    return settingsCache
  }

  const settingsFile = getSettingsFile()
  const defaults = getDefaultSettings()

  if (!existsSync(settingsFile)) {
    const settings = cacheSettings(defaults)
    persistBestEffort(settings)
    return settings
  }

  try {
    const raw: unknown = JSON.parse(readFileSync(settingsFile, 'utf-8'))
    assertSettingsVersion(raw)

    const { migrated, data: parsed } = migrateAll(raw)
    if (migrated) {
      log.info('Migrated legacy settings to current schema')
    }

    // Use Zod to validate and apply defaults for missing fields
    const result = AppSettingsSchema.safeParse(parsed)
    if (!result.success) {
      log.warn(`Invalid settings file format: ${result.error.message}, using defaults`)
      const settings = cacheSettings(defaults)
      persistBestEffort(settings)
      return settings
    }

    const settings = result.data

    // Apply dynamic default for downloadPath if not set (in-memory only)
    if (!settings.storage.downloadPath) {
      settings.storage.downloadPath = getDefaultStoragePath()
    }

    const cached = cacheSettings(settings)

    // Persist once if any migration rewrote the data, so legacy keys leave disk
    if (migrated) {
      persistBestEffort(cached)
    }

    return cached
  } catch (error) {
    if (error instanceof UnsupportedSchemaVersionError) settingsWritesBlocked = error
    log.error(`Failed to load settings: ${String(error)}`)
    return cacheSettings(defaults)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeObjects(current: unknown, patch: unknown): unknown {
  if (!isPlainObject(current) || !isPlainObject(patch)) return patch
  const merged: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = mergeObjects(merged[key], value)
  }
  return merged
}

export function mergeSettingsPatch(settings: AppSettings, patch: SettingsPatch): AppSettings {
  if (hasExplicitUndefined(patch)) throw new TypeError('Settings patch values must be defined')
  const merged: Record<string, unknown> = { ...settings }
  for (const category of Object.keys(patch) as Array<keyof AppSettings>) {
    merged[category] = mergeObjects(settings[category], patch[category])
  }
  return AppSettingsSchema.parse(merged)
}

function enqueueSettingsMutation<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  const result = settingsMutationChain
    .catch(() => undefined)
    .then(() => {
      assertSettingsWritable()
      return operation()
    })
  settingsMutationChain = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function assertSettingsWritable(): void {
  if (settingsWritesBlocked) throw settingsWritesBlocked
  if (settingsCache || !existsSync(getSettingsFile())) return
  try {
    const raw: unknown = JSON.parse(readFileSync(getSettingsFile(), 'utf-8'))
    assertSettingsVersion(raw)
  } catch (error) {
    if (!(error instanceof UnsupportedSchemaVersionError)) return
    settingsWritesBlocked = error
    throw error
  }
}

async function writeSettings(settings: AppSettings): Promise<AppSettings> {
  if (settingsWritesBlocked) throw settingsWritesBlocked
  const normalized = AppSettingsSchema.parse(settings)
  try {
    await getRepository().save(normalized)
    return normalized
  } catch (error) {
    log.error(`Failed to save settings: ${String(error)}`)
    throw error
  }
}

async function persistSettings(settings: AppSettings): Promise<AppSettings> {
  const normalized = await writeSettings(settings)
  return cacheSettings(normalized)
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await enqueueSettingsMutation(() => persistSettings(settings))
}

export async function transactSettings(
  transform: (current: AppSettings) => AppSettings,
  reconcile: (previous: AppSettings, current: AppSettings) => Promise<void>,
  finalize?: (previous: AppSettings, current: AppSettings) => Promise<void>,
  guard?: (previous: AppSettings, current: AppSettings, operation: () => Promise<AppSettings>) => Promise<AppSettings>,
  options?: { applyUnchanged?: boolean }
): Promise<AppSettings> {
  return enqueueSettingsMutation(async () => {
    const previous = AppSettingsSchema.parse(loadSettings())
    const current = AppSettingsSchema.parse(transform(previous))
    if (!options?.applyUnchanged && JSON.stringify(previous) === JSON.stringify(current)) {
      return cacheSettings(previous)
    }
    const operation = async (): Promise<AppSettings> => {
      try {
        await reconcile(previous, current)
      } catch (applyError) {
        const rollback = await Promise.allSettled([reconcile(current, previous)])
        cacheSettings(previous)
        const failures = rollback.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        const rollbackError =
          failures.length > 0 ? new AggregateError(failures.map((failure) => failure.reason)) : undefined
        throw new SettingsRuntimeApplyError(applyError, rollbackError)
      }
      try {
        await writeSettings(current)
      } catch (writeError) {
        const rollback = await Promise.allSettled([reconcile(current, previous)])
        cacheSettings(previous)
        const failures = rollback.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failures.length > 0) {
          throw new SettingsRuntimeApplyError(writeError, new AggregateError(failures.map((failure) => failure.reason)))
        }
        throw writeError
      }
      try {
        await finalize?.(previous, current)
      } catch (finalizeError) {
        try {
          await writeSettings(previous)
        } catch (persistenceError) {
          cacheSettings(current)
          throw new SettingsRuntimeApplyError(finalizeError, new AggregateError([persistenceError]))
        }
        const rollback = await Promise.allSettled([reconcile(current, previous)])
        cacheSettings(previous)
        const failures = rollback.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        const rollbackError =
          failures.length > 0 ? new AggregateError(failures.map((failure) => failure.reason)) : undefined
        throw new SettingsRuntimeApplyError(finalizeError, rollbackError)
      }
      return cacheSettings(current)
    }
    return guard ? guard(previous, current, operation) : operation()
  })
}

// Get a specific category
export function getSetting<K extends keyof AppSettings>(category: K): AppSettings[K] {
  const settings = loadSettings()
  return settings[category]
}

// Update a specific category
export async function setSetting<K extends keyof AppSettings>(
  category: K,
  values: SettingsValuePatch<AppSettings[K]>
): Promise<void> {
  await enqueueSettingsMutation(async () => {
    await persistSettings(mergeSettingsPatch(loadSettings(), { [category]: values } as SettingsPatch))
  })
}

// Reset to defaults
export async function resetSettings(): Promise<void> {
  await enqueueSettingsMutation(async () => {
    await persistSettings(getDefaultSettings())
  })
}

// Convenience getters for commonly used settings
export function getDownloadPath(): string {
  return getSetting('storage').downloadPath
}

export async function setDownloadPath(path: string): Promise<void> {
  await setSetting('storage', { downloadPath: path })
}
