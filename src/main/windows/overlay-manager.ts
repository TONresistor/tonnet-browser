/**
 * Overlay manager for native WebContentsView overlays.
 * Manages a pool of transparent views stacked above web content.
 */

import { WebContentsView, BrowserWindow } from 'electron'
import { join } from 'path'
import { OVERLAY_SETUP_DELAY_MS, OVERLAY_DISMISS_DEBOUNCE_MS, OVERLAY_POOL_SIZE } from './constants'
import {
  overlayActionEventContract,
  overlayContentEventContract,
  overlayThemeEventContract,
} from '../../shared/ipc-contract/overlay'
import { createLogger } from '../../shared/logger'
import { onWebContents, type IDisposable } from '../utils/disposable'
import type { WebContentsInputHandler } from './browser-shortcuts'

const log = createLogger('overlay')

type OverlayActionHandler = (actionType: string, actionData: unknown) => void

interface OverlayOptions {
  autoDismiss?: boolean
  focus?: boolean
  persistentActions?: boolean
}

interface OverlayInstance {
  view: WebContentsView
  id: string
  onAction?: OverlayActionHandler
  handlesActions: boolean
  autoDismiss: boolean
  persistentActions: boolean
}

interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

type OverlayContent = { type: string; [key: string]: unknown }

export class OverlayManager {
  private mainWindow: BrowserWindow | null = null
  private pool: WebContentsView[] = []
  private active = new Map<string, OverlayInstance>()
  private readonly POOL_SIZE = OVERLAY_POOL_SIZE
  private resizeHandler: (() => void) | null = null
  private clickOutsideHandlers = new Map<string, () => void>()
  private inputHandler: WebContentsInputHandler | null = null
  private inputListeners = new Map<WebContentsView, IDisposable>()

  attachWindow(win: BrowserWindow, inputHandler: WebContentsInputHandler): void {
    this.detachWindow()
    this.mainWindow = win
    this.inputHandler = inputHandler

    for (let i = 0; i < this.POOL_SIZE; i++) {
      this.pool.push(this.createOverlayView())
    }

    // Hide all overlays on window resize (bounds become invalid)
    this.resizeHandler = () => this.hideAll()
    this.mainWindow.on('resize', this.resizeHandler)

    log.info(`Overlay manager initialized with pool of ${this.POOL_SIZE}`)
  }

  private createOverlayView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../../resources/overlay/overlay-preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    if (this.inputHandler) {
      this.inputListeners.set(view, onWebContents(view.webContents, 'before-input-event', this.inputHandler))
    }

    view.setBackgroundColor('#00000000')

    view.webContents.loadURL('app://overlay/overlay.html').catch((err) => {
      log.error('Failed to load overlay HTML:', err)
    })

    return view
  }

  show(
    id: string,
    bounds: OverlayBounds,
    content: OverlayContent,
    onAction?: OverlayActionHandler,
    options?: OverlayOptions
  ): boolean {
    if (!this.mainWindow) return false
    const autoDismiss = options?.autoDismiss !== false
    const shouldFocus = options?.focus ?? autoDismiss
    const persistentActions = options?.persistentActions === true

    // Reuse existing overlay with same id (transitions like menu -> form)
    const existing = this.active.get(id)
    if (existing) {
      existing.view.setBounds(bounds)
      const payload = overlayContentEventContract.payload.parse([content])
      existing.view.webContents.send(overlayContentEventContract.channel, ...payload)
      existing.onAction = onAction
      existing.handlesActions = Boolean(onAction)
      existing.persistentActions = persistentActions
      if (existing.autoDismiss !== autoDismiss) {
        this.clickOutsideHandlers.get(id)?.()
        this.clickOutsideHandlers.delete(id)
        existing.autoDismiss = autoDismiss
        if (autoDismiss) this.setupClickOutside(id)
      }
      try {
        this.mainWindow.contentView.addChildView(existing.view)
      } catch {
        // Already attached
      }
      if (shouldFocus) existing.view.webContents.focus()
      return true
    }

    // Get a view from pool or create one
    let view = this.pool.pop()
    if (!view) {
      view = this.createOverlayView()
      log.warn('Pool empty, created overlay on-demand')
    }

    view.setBounds(bounds)
    this.mainWindow.contentView.addChildView(view)
    const contentPayload = overlayContentEventContract.payload.parse([content])
    view.webContents.send(overlayContentEventContract.channel, ...contentPayload)

    this.active.set(id, {
      view,
      id,
      onAction,
      handlesActions: Boolean(onAction),
      autoDismiss,
      persistentActions,
    })

    if (shouldFocus) view.webContents.focus()
    if (autoDismiss) this.setupClickOutside(id)

    log.debug(`Overlay shown: ${id}`)
    return true
  }

  private setupClickOutside(id: string): void {
    const instance = this.active.get(id)
    if (!instance) return

    let dismissTimer: ReturnType<typeof setTimeout> | null = null

    const handler = (): void => {
      dismissTimer = setTimeout(() => {
        dismissTimer = null
        if (this.active.has(id)) {
          this.dismiss(id)
        }
      }, OVERLAY_DISMISS_DEBOUNCE_MS)
    }

    // Delay listener registration to let focus stabilize after show+focus
    const setupTimer = setTimeout(() => {
      if (!this.active.has(id)) return
      instance.view.webContents.on('blur', handler)
    }, OVERLAY_SETUP_DELAY_MS)

    this.clickOutsideHandlers.set(id, () => {
      clearTimeout(setupTimer)
      if (dismissTimer !== null) clearTimeout(dismissTimer)
      instance.view.webContents.removeListener('blur', handler)
    })
  }

  private dismiss(id: string): void {
    const instance = this.active.get(id)
    if (!instance) return
    const handler = instance.onAction
    instance.onAction = undefined
    const forwardToRenderer = !instance.handlesActions
    this.hide(id)
    if (handler) {
      try {
        handler('dismiss', {})
      } catch (error) {
        log.error(`Overlay dismiss handler failed: ${id}`, error)
      }
      return
    }
    if (!forwardToRenderer || !this.mainWindow) return
    try {
      const payload = overlayActionEventContract.payload.parse([id, 'dismiss', {}])
      this.mainWindow.webContents.send(overlayActionEventContract.channel, ...payload)
    } catch (error) {
      log.debug(`Overlay dismiss event unavailable: ${id}`, error)
    }
  }

  hide(id: string): void {
    const instance = this.active.get(id)
    if (!instance || !this.mainWindow) return

    // Cleanup click-outside handler
    const cleanupHandler = this.clickOutsideHandlers.get(id)
    if (cleanupHandler) {
      cleanupHandler()
      this.clickOutsideHandlers.delete(id)
    }

    try {
      this.mainWindow.contentView.removeChildView(instance.view)
    } catch {
      // View may already be detached
    }

    // Clear content and return to pool
    const payload = overlayContentEventContract.payload.parse([null])
    instance.view.webContents.send(overlayContentEventContract.channel, ...payload)
    this.pool.push(instance.view)
    this.active.delete(id)
    log.debug(`Overlay hidden: ${id}`)
  }

  hideAll(): void {
    for (const id of [...this.active.keys()]) {
      this.dismiss(id)
    }
  }

  updateBounds(id: string, bounds: OverlayBounds): void {
    const instance = this.active.get(id)
    if (!instance) return
    instance.view.setBounds(bounds)
  }

  updateTheme(cssVariables: Record<string, string>): void {
    const allViews = [...this.pool, ...[...this.active.values()].map((i) => i.view)]
    for (const view of allViews) {
      const payload = overlayThemeEventContract.payload.parse([cssVariables])
      view.webContents.send(overlayThemeEventContract.channel, ...payload)
    }
  }

  isOverlayView(sender: Electron.WebContents): boolean {
    for (const instance of this.active.values()) {
      if (instance.view.webContents === sender) return true
    }
    for (const view of this.pool) {
      if (view.webContents === sender) return true
    }
    return false
  }

  /** Handle an action from an overlay. Returns true if handled by main-process callback. */
  handleAction(sender: Electron.WebContents, actionType: string, actionData: unknown): boolean {
    for (const [, instance] of this.active) {
      if (instance.view.webContents === sender && instance.onAction) {
        const handler = instance.onAction
        if (!instance.persistentActions) instance.onAction = undefined
        try {
          handler(actionType, actionData)
        } catch (error) {
          log.error(`Overlay action handler failed: ${instance.id}`, error)
          this.hide(instance.id)
        }
        return true
      }
    }
    return false
  }

  getOverlayId(sender: Electron.WebContents): string | null {
    for (const [id, instance] of this.active) {
      if (instance.view.webContents === sender) return id
    }
    return null
  }

  detachWindow(win?: BrowserWindow): void {
    if (!this.mainWindow || (win && this.mainWindow !== win)) return
    if (this.resizeHandler && this.mainWindow) {
      this.mainWindow.off('resize', this.resizeHandler)
      this.resizeHandler = null
    }

    this.hideAll()

    for (const listener of this.inputListeners.values()) listener.dispose()
    this.inputListeners.clear()

    for (const view of this.pool) {
      view.webContents.close()
    }
    this.pool = []
    this.active.clear()
    this.clickOutsideHandlers.clear()
    this.inputHandler = null
    this.mainWindow = null
    log.info('Overlay manager destroyed')
  }

  destroy(): void {
    this.detachWindow()
  }
}

// Singleton removed: use ServiceRegistry from services.ts
