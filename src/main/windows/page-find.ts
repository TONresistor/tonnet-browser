import type { BrowserWindow, WebContents } from 'electron'
import type { OverlayManager } from './overlay-manager'
import type { TabManager } from './tabs'

const OVERLAY_ID = 'page-find'
const OVERLAY_WIDTH = 360
const OVERLAY_HEIGHT = 48
const OVERLAY_MARGIN = 12

export class PageFindController {
  private target: WebContents | null = null
  private query = ''
  private requestId: number | null = null
  private activeMatch = 0
  private matches = 0

  constructor(
    private readonly window: BrowserWindow,
    private readonly tabManager: TabManager,
    private readonly overlayManager: OverlayManager
  ) {}

  show(): boolean {
    const view = this.tabManager.getActiveView()
    if (!view || view.webContents.isDestroyed()) return false

    if (this.target !== view.webContents) {
      this.close()
      this.target = view.webContents
      this.target.on('found-in-page', this.handleFoundInPage)
      this.target.on('did-start-navigation', this.handleNavigation)
      this.target.once('destroyed', this.handleDestroyed)
    }

    return this.render(true)
  }

  close(): void {
    const target = this.target
    this.target = null
    this.query = ''
    this.requestId = null
    this.activeMatch = 0
    this.matches = 0

    if (target) {
      target.off('found-in-page', this.handleFoundInPage)
      target.off('did-start-navigation', this.handleNavigation)
      target.off('destroyed', this.handleDestroyed)
      if (!target.isDestroyed()) {
        try {
          target.stopFindInPage('keepSelection')
        } catch {
          // The page may finish closing between the destroyed check and this call.
        }
      }
    }
    this.overlayManager.hide(OVERLAY_ID)
  }

  dispose(): void {
    this.close()
  }

  private readonly handleFoundInPage = (_event: Electron.Event, result: Electron.FoundInPageResult): void => {
    if (result.requestId !== this.requestId) return
    this.activeMatch = result.activeMatchOrdinal
    this.matches = result.matches
    this.render(false)
  }

  private readonly handleNavigation = (): void => this.close()
  private readonly handleDestroyed = (): void => this.close()

  private readonly handleAction = (action: string, data: unknown): void => {
    if (action === 'close' || action === 'dismiss') {
      this.close()
      return
    }

    if (action === 'query') {
      const query = typeof (data as { query?: unknown })?.query === 'string' ? (data as { query: string }).query : ''
      this.search(query, true, false)
      return
    }

    if (action === 'next') this.search(this.query, true, true)
    if (action === 'previous') this.search(this.query, false, true)
  }

  private search(query: string, forward: boolean, findNext: boolean): void {
    const target = this.target
    if (!target || target.isDestroyed()) return

    this.query = query.slice(0, 2_048)
    if (!this.query) {
      this.requestId = null
      this.activeMatch = 0
      this.matches = 0
      target.stopFindInPage('clearSelection')
      this.render(false)
      return
    }

    this.requestId = target.findInPage(this.query, { forward, findNext })
  }

  private render(selectAll: boolean): boolean {
    if (!this.target) return false
    const view = this.tabManager.getActiveView()
    if (!view || view.webContents !== this.target) return false

    const viewBounds = view.getBounds()
    const width = Math.max(1, Math.min(OVERLAY_WIDTH, viewBounds.width - OVERLAY_MARGIN * 2))
    const windowWidth = this.window.getContentBounds().width
    const x = Math.max(
      viewBounds.x,
      Math.min(viewBounds.x + viewBounds.width - width - OVERLAY_MARGIN, windowWidth - width)
    )
    const y = viewBounds.y + OVERLAY_MARGIN

    return this.overlayManager.show(
      OVERLAY_ID,
      { x, y, width, height: OVERLAY_HEIGHT },
      {
        type: 'find',
        query: this.query,
        activeMatch: this.activeMatch,
        matches: this.matches,
        selectAll,
      },
      this.handleAction,
      { autoDismiss: false, focus: true, persistentActions: true }
    )
  }
}
