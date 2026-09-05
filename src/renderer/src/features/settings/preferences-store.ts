/**
 * App preferences store.
 * Runtime UI preferences (non-persisted).
 */

import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { ThemeType } from '@shared/defaults'
import type { AppSettings } from '@shared/types'
import type { SettingsPatch } from '@shared/ipc-contract/settings'
import { createLogger } from '@/logger'
import { settingsClient } from '@/features/settings/client'

const log = createLogger('preferences')

export type { ThemeType }

export interface AppPreferences {
  // General
  homepage: string
  resolveEth: boolean
  ethRpc: string
  resolveSol: boolean
  solRpc: string

  // Network
  proxyPort: number
  storagePort: number
  autoConnect: boolean
  connectionTimeout: number
  anonymousMode: boolean
  tunnelMode: 'standard' | 'maximum'

  // Storage
  downloadPath: string
  storagePollingInterval: number
  seedingEnabled: boolean
  downloadSpeedLimit: number
  uploadSpeedLimit: number

  // Appearance
  theme: ThemeType
  language: string
  defaultZoom: number
  showBookmarksBar: boolean
  showStatusBar: boolean
  tabOrientation: 'horizontal' | 'vertical'
  sidebarWidth: number

  // Privacy
  clearOnExit: boolean
  disableCache: boolean
  firstPartyIsolation: boolean
  cookieAutoDelete: boolean
  cookieAutoDeleteMinutes: number
  historyMode: 'memory' | 'persistent'
  historyMaxEntries: number

  // Advanced
  proxyVerbosity: number
  storageVerbosity: number
  displayUnicodeDomains: boolean
  tonConnectEnabled: boolean

  // Cocoon AI
  cocoonAutostart: boolean

  messengerAutostart: boolean
}

interface PreferencesState {
  // Saved preferences (from main process)
  saved: AppPreferences
  // Draft preferences (current UI state)
  draft: AppPreferences
  // State flags
  isLoaded: boolean
  hasChanges: boolean
  isSaving: boolean

  // Actions
  loadFromMain: () => Promise<void>
  setDraft: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void
  save: () => Promise<void>
  discard: () => void
  resetToDefaults: () => Promise<void>
}

export const defaultPreferences: AppPreferences = {
  // General
  homepage: DEFAULT_SETTINGS.homepage,
  resolveEth: DEFAULT_SETTINGS.resolveEth,
  ethRpc: DEFAULT_SETTINGS.ethRpc,
  resolveSol: DEFAULT_SETTINGS.resolveSol,
  solRpc: DEFAULT_SETTINGS.solRpc,

  // Network
  proxyPort: DEFAULT_SETTINGS.proxyPort,
  storagePort: DEFAULT_SETTINGS.storagePort,
  autoConnect: DEFAULT_SETTINGS.autoConnect,
  connectionTimeout: DEFAULT_SETTINGS.connectionTimeout,
  anonymousMode: DEFAULT_SETTINGS.anonymousMode,
  tunnelMode: DEFAULT_SETTINGS.tunnelMode,

  // Storage
  downloadPath: DEFAULT_SETTINGS.downloadPath, // Will be loaded from main
  storagePollingInterval: DEFAULT_SETTINGS.pollingInterval,
  seedingEnabled: DEFAULT_SETTINGS.seedingEnabled,
  downloadSpeedLimit: DEFAULT_SETTINGS.downloadSpeedLimit,
  uploadSpeedLimit: DEFAULT_SETTINGS.uploadSpeedLimit,

  // Appearance
  theme: DEFAULT_SETTINGS.theme,
  language: DEFAULT_SETTINGS.language,
  defaultZoom: DEFAULT_SETTINGS.defaultZoom,
  showBookmarksBar: DEFAULT_SETTINGS.showBookmarksBar,
  showStatusBar: DEFAULT_SETTINGS.showStatusBar,
  tabOrientation: DEFAULT_SETTINGS.tabOrientation,
  sidebarWidth: DEFAULT_SETTINGS.sidebarWidth,

  // Privacy
  clearOnExit: DEFAULT_SETTINGS.clearOnExit,
  disableCache: DEFAULT_SETTINGS.disableCache,
  firstPartyIsolation: DEFAULT_SETTINGS.firstPartyIsolation,
  historyMode: DEFAULT_SETTINGS.historyMode,
  historyMaxEntries: DEFAULT_SETTINGS.historyMaxEntries,
  cookieAutoDelete: DEFAULT_SETTINGS.cookieAutoDelete,
  cookieAutoDeleteMinutes: DEFAULT_SETTINGS.cookieAutoDeleteMinutes,

  // Advanced
  proxyVerbosity: DEFAULT_SETTINGS.proxyVerbosity,
  storageVerbosity: DEFAULT_SETTINGS.storageVerbosity,
  displayUnicodeDomains: DEFAULT_SETTINGS.displayUnicodeDomains,
  tonConnectEnabled: DEFAULT_SETTINGS.tonConnectEnabled,

  // Cocoon AI
  cocoonAutostart: DEFAULT_SETTINGS.cocoon.autostart,

  messengerAutostart: DEFAULT_SETTINGS.messenger.autostart,
}

// Map flat preferences to categorized main process structure
type PreferenceMapping = {
  category: string
  field: string
  fromMain?: (value: unknown) => unknown
  toMain?: (value: unknown) => unknown
}

const prefToCategory: Record<keyof AppPreferences, PreferenceMapping> = {
  homepage: { category: 'general', field: 'homepage' },
  resolveEth: { category: 'general', field: 'resolveEth' },
  ethRpc: { category: 'general', field: 'ethRpc' },
  resolveSol: { category: 'general', field: 'resolveSol' },
  solRpc: { category: 'general', field: 'solRpc' },
  proxyPort: { category: 'network', field: 'proxyPort' },
  storagePort: { category: 'network', field: 'storagePort' },
  autoConnect: { category: 'network', field: 'autoConnect' },
  connectionTimeout: { category: 'network', field: 'connectionTimeout' },
  anonymousMode: { category: 'network', field: 'anonymousMode' },
  tunnelMode: { category: 'network', field: 'tunnelMode' },
  downloadPath: { category: 'storage', field: 'downloadPath' },
  storagePollingInterval: { category: 'storage', field: 'pollingInterval' },
  seedingEnabled: { category: 'storage', field: 'seedingEnabled' },
  downloadSpeedLimit: { category: 'storage', field: 'downloadSpeedLimit' },
  uploadSpeedLimit: { category: 'storage', field: 'uploadSpeedLimit' },
  theme: { category: 'appearance', field: 'theme' },
  language: { category: 'appearance', field: 'language' },
  defaultZoom: { category: 'appearance', field: 'defaultZoom' },
  showBookmarksBar: { category: 'appearance', field: 'showBookmarksBar' },
  showStatusBar: { category: 'appearance', field: 'showStatusBar' },
  tabOrientation: { category: 'appearance', field: 'tabOrientation' },
  sidebarWidth: { category: 'appearance', field: 'sidebarWidth' },
  clearOnExit: { category: 'privacy', field: 'clearOnExit' },
  disableCache: { category: 'privacy', field: 'disableCache' },
  firstPartyIsolation: { category: 'privacy', field: 'firstPartyIsolation' },
  cookieAutoDelete: { category: 'privacy', field: 'cookieAutoDelete' },
  cookieAutoDeleteMinutes: { category: 'privacy', field: 'cookieAutoDeleteMinutes' },
  historyMode: { category: 'privacy', field: 'historyMode' },
  historyMaxEntries: { category: 'privacy', field: 'historyMaxEntries' },
  proxyVerbosity: { category: 'advanced', field: 'proxyVerbosity' },
  storageVerbosity: { category: 'advanced', field: 'storageVerbosity' },
  displayUnicodeDomains: { category: 'advanced', field: 'displayUnicodeDomains' },
  tonConnectEnabled: { category: 'advanced', field: 'tonConnectEnabled' },
  cocoonAutostart: { category: 'cocoon', field: 'autostart' },
  messengerAutostart: { category: 'messenger', field: 'autostart' },
}

// Convert main process settings to flat preferences. Derived from the single
// prefToCategory mapping (+ defaultPreferences for fallbacks) so the
// settings->prefs wiring is declared once rather than re-spelled per field.
function mainSettingsToPrefs(settings: AppSettings): AppPreferences {
  const result = {} as Record<keyof AppPreferences, unknown>
  for (const key of Object.keys(prefToCategory) as (keyof AppPreferences)[]) {
    const { category, field } = prefToCategory[key]
    const categoryValues = settings[category as keyof AppSettings] as Record<string, unknown> | undefined
    const value = categoryValues?.[field] ?? defaultPreferences[key]
    result[key] = prefToCategory[key].fromMain?.(value) ?? value
  }
  return result as AppPreferences
}

function prefValueChanged(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) !== JSON.stringify(b)
  }
  return a !== b
}

// Check if two preferences objects are different
function hasPreferencesChanged(a: AppPreferences, b: AppPreferences): boolean {
  for (const key of Object.keys(a) as (keyof AppPreferences)[]) {
    if (prefValueChanged(a[key], b[key])) return true
  }
  return false
}

// Selector to get current applied preferences (from saved)
export const usePreferences = () => {
  const saved = usePreferencesStore((state) => state.saved)
  return saved
}

export const usePreferencesStore = create<PreferencesState>()((set, get) => ({
  saved: { ...defaultPreferences },
  draft: { ...defaultPreferences },
  isLoaded: false,
  hasChanges: false,
  isSaving: false,

  loadFromMain: async () => {
    // Reset isLoaded to show loading state while fetching
    set({ isLoaded: false })
    try {
      const settings = await settingsClient.getAll()
      const prefs = mainSettingsToPrefs(settings)
      set({ saved: prefs, draft: { ...prefs }, isLoaded: true, hasChanges: false })
    } catch (error) {
      log.error('Failed to load from main:', error)
      set({ isLoaded: true })
    }
  },

  setDraft: (key, value) => {
    const { saved, draft } = get()
    const newDraft = { ...draft, [key]: value }
    set({
      draft: newDraft,
      hasChanges: hasPreferencesChanged(saved, newDraft),
    })
  },

  save: async () => {
    const { draft, saved } = get()
    const submittedDraft = { ...draft }
    set({ isSaving: true })

    // Find changed values and group by category
    const categoryUpdates: Record<string, Record<string, unknown>> = {}
    for (const key of Object.keys(draft) as (keyof AppPreferences)[]) {
      if (prefValueChanged(draft[key], saved[key])) {
        const { category, field, toMain } = prefToCategory[key]
        if (!categoryUpdates[category]) {
          categoryUpdates[category] = {}
        }
        categoryUpdates[category][field] = toMain ? toMain(draft[key]) : draft[key]
      }
    }

    try {
      if (Object.keys(categoryUpdates).length === 0) {
        set({ hasChanges: false, isSaving: false })
        return
      }
      const settings = await settingsClient.apply(categoryUpdates as SettingsPatch)
      const preferences = mainSettingsToPrefs(settings)
      set((state) => {
        const nextDraft = { ...preferences }
        for (const key of Object.keys(state.draft) as Array<keyof AppPreferences>) {
          if (prefValueChanged(state.draft[key], submittedDraft[key])) {
            ;(nextDraft as Record<keyof AppPreferences, unknown>)[key] = state.draft[key]
          }
        }
        return {
          saved: preferences,
          draft: nextDraft,
          hasChanges: hasPreferencesChanged(preferences, nextDraft),
          isSaving: false,
        }
      })
    } catch (error) {
      log.error('Failed to save:', error)
      set({ isSaving: false })
      throw error
    }
  },

  discard: () => {
    const { saved } = get()
    set({ draft: { ...saved }, hasChanges: false })
  },

  resetToDefaults: async () => {
    set({ isSaving: true })
    try {
      const result = await settingsClient.reset()
      const preferences = mainSettingsToPrefs(result.settings)
      set({
        saved: preferences,
        draft: { ...preferences },
        hasChanges: false,
        isSaving: false,
      })
    } catch (error) {
      log.error('Failed to reset:', error)
      set({ isSaving: false })
      throw error
    }
  },
}))

// Listen for settings changes from main process
if (settingsClient.isAvailable()) {
  const unsubscribe = settingsClient.onChanged((data) => {
    if (!data.settings) {
      void usePreferencesStore.getState().loadFromMain()
      return
    }
    const incoming = mainSettingsToPrefs(data.settings)
    if (data.reset) {
      usePreferencesStore.setState({ saved: incoming, draft: { ...incoming }, hasChanges: false })
      return
    }
    usePreferencesStore.setState((state) => {
      const draft = { ...incoming }
      for (const key of Object.keys(state.draft) as Array<keyof AppPreferences>) {
        if (prefValueChanged(state.draft[key], state.saved[key])) {
          ;(draft as Record<keyof AppPreferences, unknown>)[key] = state.draft[key]
        }
      }
      return { saved: incoming, draft, hasChanges: hasPreferencesChanged(incoming, draft) }
    })
  })

  // Cleanup listener on HMR module replacement
  const hot = import.meta.hot
  if (hot) {
    hot.dispose(() => unsubscribe())
  }
}
