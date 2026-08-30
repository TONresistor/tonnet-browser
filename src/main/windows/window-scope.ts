import type { BrowserWindow } from 'electron'
import { onWebContents, type IDisposable } from '../utils/disposable'
import type { OverlayManager } from './overlay-manager'
import type { TabManager, TabManagerDeps } from './tabs'
import { setupMainContextMenu } from './main-context-menu'
import { BrowserShortcutController } from './browser-shortcut-controller'
import { PageFindController } from './page-find'

export interface WindowScopeDeps {
  overlayManager: OverlayManager
  tabManager: TabManager
  tabDeps: TabManagerDeps
}

export function attachWindowScope(window: BrowserWindow, proxyPort: number, deps: WindowScopeDeps): IDisposable {
  let disposed = false
  const shortcuts = new BrowserShortcutController(
    window,
    deps.tabManager,
    new PageFindController(window, deps.tabManager, deps.overlayManager)
  )
  const windowInput = shortcuts.createInputHandler('window')
  const tabInput = shortcuts.createInputHandler('tab')
  const overlayInput = shortcuts.createInputHandler('overlay')

  deps.overlayManager.attachWindow(window, overlayInput)
  deps.tabManager.attachWindow(window, proxyPort, deps.tabDeps, tabInput)
  const inputListener = onWebContents(window.webContents, 'before-input-event', windowInput)
  const contextMenu = setupMainContextMenu(window, deps.overlayManager)

  const scope: IDisposable = {
    dispose(): void {
      if (disposed) return
      disposed = true
      window.off('closed', onClosed)
      inputListener.dispose()
      shortcuts.dispose()
      try {
        deps.tabManager.detachWindow(window)
      } finally {
        try {
          deps.overlayManager.detachWindow(window)
        } finally {
          contextMenu.dispose()
        }
      }
    },
  }
  const onClosed = (): void => scope.dispose()
  window.once('closed', onClosed)
  return scope
}
