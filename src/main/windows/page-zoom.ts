import type { WebContentsView } from 'electron'
import { PAGE_ZOOM } from '../../shared/constants'

export class PageZoomController {
  private defaultZoomPercent: number

  constructor(
    defaultZoom: number,
    private readonly getActiveView: () => WebContentsView | null,
    private readonly getActiveTabId: () => string | null,
    private readonly onChange: (zoom: number, tabId: string) => void
  ) {
    this.defaultZoomPercent = this.clamp(defaultZoom)
  }

  get defaultZoom(): number {
    return this.defaultZoomPercent
  }

  applyDefault(defaultZoom: number, views: Iterable<WebContentsView>): void {
    this.defaultZoomPercent = this.clamp(defaultZoom)
    for (const view of views) view.webContents.setZoomFactor(this.defaultZoomPercent / 100)
    this.emit()
  }

  get(): number | null {
    const view = this.getActiveView()
    if (!view) return null
    return this.clamp(Math.round(view.webContents.getZoomFactor() * 100))
  }

  set(percent: number): number | null {
    const view = this.getActiveView()
    if (!view) return null
    const zoom = this.clamp(percent)
    view.webContents.setZoomFactor(zoom / 100)
    this.emit(zoom)
    return zoom
  }

  zoomIn(): boolean {
    return this.adjust(PAGE_ZOOM.STEP_PERCENT)
  }

  zoomOut(): boolean {
    return this.adjust(-PAGE_ZOOM.STEP_PERCENT)
  }

  reset(): boolean {
    return this.set(this.defaultZoomPercent) !== null
  }

  emit(zoom = this.get()): void {
    const tabId = this.getActiveTabId()
    if (tabId && zoom !== null) this.onChange(zoom, tabId)
  }

  private adjust(deltaPercent: number): boolean {
    const currentPercent = this.get()
    if (currentPercent === null) return false
    return this.set(currentPercent + deltaPercent) !== null
  }

  private clamp(percent: number): number {
    return Math.min(Math.max(percent, PAGE_ZOOM.MIN_PERCENT), PAGE_ZOOM.MAX_PERCENT)
  }
}
