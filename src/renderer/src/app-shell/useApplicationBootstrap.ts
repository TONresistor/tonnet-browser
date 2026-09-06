import { useEffect } from 'react'
import { loadBookmarksFromMain } from '@/features/bookmarks/store'
import { usePreferencesStore } from '@/features/settings/preferences-store'
import { useThemeStore } from '@/features/themes/public'
import { useWalletStore } from '@/features/wallet/store'
import { useProxyRuntimeStatus } from '@/features/proxy/useProxyRuntimeStatus'
import { useMessengerRuntime } from '@/features/messenger/useMessengerRuntime'

/** Composition-only startup: each feature store retains ownership of its initialization. */
export function useApplicationBootstrap(): void {
  useProxyRuntimeStatus()
  useMessengerRuntime()
  useEffect(() => {
    void usePreferencesStore.getState().loadFromMain()
    void useThemeStore.getState().load()
    void useWalletStore.getState().init()
    void loadBookmarksFromMain()
  }, [])
}
