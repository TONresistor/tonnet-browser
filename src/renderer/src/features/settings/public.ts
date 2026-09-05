import { usePreferencesStore } from './preferences-store'
import { useUIStore } from './ui-store'

export function openStorageSettings() {
  useUIStore.getState().setSettingsActiveSection('storage')
}

export function openWalletRecoverySettings() {
  const state = useUIStore.getState()
  state.setSettingsActiveSection('wallet')
  state.setWalletManagementIntent('import')
}

export const useSeedingEnabled = () => usePreferencesStore((state) => state.draft.seedingEnabled)
export const useSetPreferenceDraft = () => usePreferencesStore((state) => state.setDraft)
export const useSavePreferences = () => usePreferencesStore((state) => state.save)
export const useShowBookmarksBar = () => usePreferencesStore((state) => state.saved.showBookmarksBar)
export const useShowStatusBar = () => usePreferencesStore((state) => state.saved.showStatusBar)
export const useTabOrientation = () => usePreferencesStore((state) => state.saved.tabOrientation)
export const useSavedSidebarWidth = () => usePreferencesStore((state) => state.saved.sidebarWidth)
