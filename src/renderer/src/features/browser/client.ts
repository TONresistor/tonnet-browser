import type { IpcEventMap, IpcEventChannel } from '@shared/ipc-events'

/** Electron capabilities owned by browser chrome and tab orchestration. */
export const browserClient = {
  navigate: (url: string, tabId?: string) => window.electron.navigate(url, tabId),
  goBack: () => window.electron.goBack(),
  goForward: () => window.electron.goForward(),
  reload: () => window.electron.reload(),
  stop: () => window.electron.stop(),
  getZoom: () => window.electron.zoom.get(),
  setZoom: (percent: number) => window.electron.zoom.set(percent),
  createTab: (tabId: string, initialUrl: string) => window.electron.tabs.create(tabId, initialUrl),
  closeTab: (tabId: string) => window.electron.tabs.close(tabId),
  switchTab: (tabId: string) => window.electron.tabs.switch(tabId),
  hideView: () => window.electron.view.hide(),
  setSidebarWidth: (width: number) => window.electron.updateSidebarWidth(width),
  minimizeWindow: () => window.electron.window.minimize(),
  maximizeWindow: () => window.electron.window.maximize(),
  closeWindow: () => window.electron.window.close(),
  connectProxy: () => window.electron.proxy.connect(),
  showOverlay: (...args: Parameters<typeof window.electron.overlay.show>) => window.electron.overlay.show(...args),
  hideOverlay: (id: string) => window.electron.overlay.hide(id),
  on: <K extends IpcEventChannel>(channel: K, listener: (...args: IpcEventMap[K]) => void) =>
    window.electron.on(channel, listener),
}
