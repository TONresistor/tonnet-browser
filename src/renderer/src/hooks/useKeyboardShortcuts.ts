import { useEffect } from 'react'
import { useTabsStore } from '@/stores/tabs'
import { browserClient } from '@/features/browser/client'
import { IPC_CHANNELS } from '@shared/ipc-channels'

export function useKeyboardShortcuts(openOrSwitchToTab: (url: string) => void): void {
  useEffect(() => {
    return browserClient.on(IPC_CHANNELS.BROWSER_SHORTCUT, (command) => {
      const tabs = useTabsStore.getState()
      switch (command.action) {
        case 'new-tab':
          void tabs.addTab()
          break
        case 'close-tab':
          if (tabs.activeTabId) void tabs.closeTab(tabs.activeTabId)
          break
        case 'reopen-tab':
          void tabs.reopenLastClosedTab()
          break
        case 'next-tab':
          void tabs.nextTab()
          break
        case 'previous-tab':
          void tabs.previousTab()
          break
        case 'select-tab':
          void tabs.goToTabByIndex(command.index)
          break
        case 'history':
          openOrSwitchToTab('ton://history')
          break
        case 'focus-address': {
          const input = document.getElementById('address-bar-input') as HTMLInputElement | null
          input?.focus()
          input?.select()
          break
        }
        case 'back':
          void tabs.goBack()
          break
        case 'forward':
          void tabs.goForward()
          break
      }
    })
  }, [openOrSwitchToTab])
}
