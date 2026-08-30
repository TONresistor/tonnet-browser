import type { BrowserWindow } from 'electron'
import { browserShortcutContract, type BrowserShortcutCommand } from '../../shared/ipc-contract/browsing'
import { emitContractToRenderer } from '../events/renderer-events'
import { matchBrowserShortcut, type BrowserShortcut, type WebContentsInputHandler } from './browser-shortcuts'
import { resolveDevToolsTarget, toggleDevTools } from './devtools'
import type { PageFindController } from './page-find'
import type { TabManager } from './tabs'

export type BrowserInputContext = 'window' | 'tab' | 'overlay'
type RendererShortcut = Extract<BrowserShortcut, { action: BrowserShortcutCommand['action'] }>

export class BrowserShortcutController {
  constructor(
    private readonly window: BrowserWindow,
    private readonly tabManager: TabManager,
    private readonly pageFind: PageFindController
  ) {}

  createInputHandler(context: BrowserInputContext): WebContentsInputHandler {
    return (event, input) => {
      const shortcut = matchBrowserShortcut(input)
      if (!shortcut || !this.dispatch(shortcut, context)) return
      event.preventDefault()
    }
  }

  dispatch(shortcut: BrowserShortcut, context: BrowserInputContext = 'window'): boolean {
    switch (shortcut.action) {
      case 'reload':
        this.pageFind.close()
        this.tabManager.reloadActivePage(false)
        return true
      case 'hard-reload':
        this.pageFind.close()
        this.tabManager.reloadActivePage(true)
        return true
      case 'stop':
        if (context === 'overlay') return false
        return this.tabManager.stopActivePage()
      case 'zoom-in':
        this.tabManager.pageZoom.zoomIn()
        return true
      case 'zoom-out':
        this.tabManager.pageZoom.zoomOut()
        return true
      case 'zoom-reset':
        this.tabManager.pageZoom.reset()
        return true
      case 'find':
        return this.pageFind.show()
      case 'devtools':
        toggleDevTools(resolveDevToolsTarget(this.window, this.tabManager.getActiveView()))
        return true
      default:
        this.emitRendererCommand(shortcut)
        return true
    }
  }

  dispose(): void {
    this.pageFind.dispose()
  }

  private emitRendererCommand(shortcut: RendererShortcut): void {
    const command: BrowserShortcutCommand =
      shortcut.action === 'select-tab' ? { action: 'select-tab', index: shortcut.index } : { action: shortcut.action }
    emitContractToRenderer(browserShortcutContract, command)
  }
}
