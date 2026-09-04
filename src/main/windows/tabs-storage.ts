/**
 * Storage bag loading and error page rendering.
 * Extracted from tabs.ts to separate TON Storage concerns from tab lifecycle.
 */

import { WebContentsView } from 'electron'
import { EventEmitter } from 'events'
import { realpath } from 'fs/promises'
import { resolve as resolvePath, sep } from 'path'
import { generateFileBrowserPage, generateLoadingPage } from './file-browser'
import { escapeHtml, loadDataHtml } from './page-templates'
import { renderLottieBoot } from './lottie'
import type { StorageManager } from '../storage/daemon'
import { createLogger } from '../../shared/logger'
import type { BagDetails } from '../../shared/types'
import type { IDisposable } from '../utils/disposable'

const log = createLogger('tabs-storage')

/** Mutable TON Storage presentation state owned by one TabManager instance. */
export interface TabStorageState {
  storageManager: StorageManager | null
  readonly storageBagCache: Map<string, string>
  readonly storageBrowserLoading: Set<number>
  readonly storageBrowserEpochs: Map<number, number>
  nextStorageBrowserEpoch: number
  readonly fileBrowserCache: Map<number, string>
}

export function createTabStorageState(): TabStorageState {
  return {
    storageManager: null,
    storageBagCache: new Map(),
    storageBrowserLoading: new Set(),
    storageBrowserEpochs: new Map(),
    nextStorageBrowserEpoch: 0,
    fileBrowserCache: new Map(),
  }
}

export function disposeTabStorageState(state: TabStorageState): void {
  state.storageManager = null
  state.storageBagCache.clear()
  state.storageBrowserLoading.clear()
  state.storageBrowserEpochs.clear()
  state.fileBrowserCache.clear()
}

export function cancelStorageBrowserLoad(state: TabStorageState, webContentsId: number): void {
  state.storageBrowserEpochs.delete(webContentsId)
  state.storageBrowserLoading.delete(webContentsId)
}

function getStorageManager(state: TabStorageState): StorageManager {
  if (!state.storageManager) throw new Error('StorageManager not initialized for this tab manager.')
  return state.storageManager
}

/** Initialize the storage-bag-detected listener on the proxy manager. Returns a disposable to remove it. */
export function initStorageListener(state: TabStorageState, proxyMgr: EventEmitter): IDisposable {
  const handler = ({ bagId, domain }: { bagId: string; domain: string }): void => {
    state.storageBagCache.set(domain, bagId)
  }
  proxyMgr.on('storage-bag-detected', handler)
  return {
    dispose(): void {
      proxyMgr.removeListener('storage-bag-detected', handler)
    },
  }
}

// --- Helpers ---

export function sanitizeDirName(raw: string): string {
  const trimmed = raw.replace(/\/$/, '')
  return trimmed.replace(/\.\./g, '').replace(/[/\\]/g, '')
}

/**
 * Resolve a file inside a bag to its real on-disk path, validating that it
 * stays within the bag directory (no traversal). Used to open a bag file
 * inline in a browser tab. Throws on invalid path / missing bag.
 */
export async function resolveBagFilePath(state: TabStorageState, bagId: string, relPath: string): Promise<string> {
  if (!relPath || relPath.includes('\0') || relPath.startsWith('/') || relPath.startsWith('\\')) {
    throw new Error('Invalid file path')
  }
  if (relPath.split(/[/\\]/).includes('..')) {
    throw new Error('Invalid file path')
  }
  const details = await getStorageManager(state).getBagDetails(bagId)
  if (!details?.path) throw new Error('Bag path not found')

  const dirName = sanitizeDirName(details.dir_name || '')
  const basePath = dirName ? `${details.path}/${dirName}` : details.path
  const [realBase, realFull] = await Promise.all([
    realpath(resolvePath(basePath)),
    realpath(resolvePath(`${basePath}/${relPath}`)),
  ])
  if (!realFull.startsWith(realBase + sep) && realFull !== realBase) {
    throw new Error('Path traversal blocked')
  }
  return realFull
}

// --- Error page ---

export function loadErrorPage(view: WebContentsView, errorMessage: string, failedUrl: string): void {
  const wc = view?.webContents
  if (!wc || wc.isDestroyed()) {
    log.debug('loadErrorPage skipped: view missing or destroyed')
    return
  }
  const safeError = escapeHtml(errorMessage)
  const safeUrl = escapeHtml(failedUrl)
  const encodedUrl = encodeURIComponent(failedUrl)

  const errorHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page Load Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #17212b;
      color: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .error-container {
      max-width: 480px;
      text-align: center;
      background: rgba(255, 255, 255, 0.07);
      backdrop-filter: blur(12px) saturate(1.4);
      -webkit-backdrop-filter: blur(12px) saturate(1.4);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      padding: 40px 32px 32px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }
    .lottie-wrapper {
      width: 180px;
      height: 180px;
      margin: 0 auto 24px;
    }
    h1 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #f5f5f5;
    }
    .error-message {
      font-size: 14px;
      line-height: 1.6;
      color: #708499;
      margin-bottom: 20px;
    }
    .error-details {
      background: #0e1621;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 24px;
      text-align: left;
    }
    .error-code {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
      color: #ec3942;
      word-break: break-all;
      line-height: 1.5;
    }
    .url {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
      color: #708499;
      margin-top: 6px;
      word-break: break-all;
      line-height: 1.5;
    }
    .actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    button {
      padding: 10px 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 14px;
      font-weight: 500;
      border: none;
      border-radius: 1000px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #0098ea;
      color: #fff;
      box-shadow: 0 2px 8px rgba(0, 152, 234, 0.3);
    }
    .btn-primary:hover {
      background: #007bc7;
      box-shadow: 0 4px 12px rgba(0, 152, 234, 0.4);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.06);
      color: #f5f5f5;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div id="lottie" class="lottie-wrapper"></div>
    <h1>Unable to Load Page</h1>
    <p class="error-message">The page could not be loaded. Check your connection to the TON network.</p>
    <div class="error-details">
      <div class="error-code">Error: ${safeError}</div>
      <div class="url">URL: ${safeUrl}</div>
    </div>
    <div class="actions">
      <button class="btn-primary" data-url="${encodedUrl}" onclick="location.href=decodeURIComponent(this.dataset.url)">Retry</button>
      <button class="btn-secondary" onclick="history.back()">Go Back</button>
    </div>
  </div>
  ${renderLottieBoot()}
</body>
</html>`

  loadDataHtml(wc, errorHtml).catch((err) => {
    log.error('Failed to load error page:', err)
  })
}

// --- Storage bag loading ---

interface LoadStorageBagOptions {
  /** Direct bag ID (for ton://storage explicit loads) */
  bagId?: string
  /** Domain to look up bag ID from proxy cache */
  domain?: string
  /** Display label for loading page */
  label: string
  /** Max seconds to wait for bag files (default: 30) */
  timeout?: number
  /** Check fileBrowserCache before loading (default: false) */
  useCache?: boolean
  /** Try loading index.html if present (default: false) */
  checkIndexHtml?: boolean
  isCurrent?: () => boolean
}

/**
 * Load a TON Storage bag into a WebContentsView.
 * Handles both explicit bag ID loads (ton://storage) and domain-based loads (proxy cache).
 * Shows loading page, downloads bag if needed, then shows file browser or index.html.
 */
/**
 * Ensure the bag is registered in the daemon, then poll up to `timeout` seconds
 * for its files to appear. Returns the details once it has at least one file, or
 * null if it never does (no files / download timed out).
 */
async function resolveBagDetails(
  state: TabStorageState,
  bagId: string,
  timeout: number,
  isCurrent: () => boolean
): Promise<BagDetails | null> {
  if (!isCurrent()) return null
  let details: BagDetails | null = null
  try {
    details = await getStorageManager(state).getBagDetails(bagId)
  } catch {
    if (!isCurrent()) return null
    log.debug(`Bag ${bagId} not in daemon, adding`)
    await getStorageManager(state).addBag(bagId)
  }

  // Wait for files
  if (!details || details.files.length === 0) {
    for (let i = 0; i < timeout; i++) {
      if (!isCurrent()) return null
      await new Promise((r) => setTimeout(r, 1000))
      if (!isCurrent()) return null
      try {
        details = await getStorageManager(state).getBagDetails(bagId)
        if (details.files.length > 0) break
      } catch {
        log.debug(`Waiting for bag ${bagId} files (${i + 1}/${timeout})`)
      }
    }
  }

  return details && details.files.length > 0 ? details : null
}

/**
 * Render resolved bag details into the view: load index.html directly when the
 * caller wants website mode and one exists, otherwise the file-browser page
 * (cached for back-navigation).
 */
async function renderBag(
  state: TabStorageState,
  view: WebContentsView,
  details: BagDetails,
  bagId: string,
  opts: { domain?: string; checkIndexHtml?: boolean }
): Promise<void> {
  const dirName = sanitizeDirName(details.dir_name || '')
  const basePath = dirName ? `${details.path}/${dirName}` : details.path

  // If index.html exists and caller wants website mode, load it
  if (opts.checkIndexHtml && details.files.some((f) => f.name === 'index.html')) {
    log.info('Bag has index.html, loading as website')
    await view.webContents.loadFile(`${basePath}/index.html`)
    return
  }

  // Show file browser
  const displayName = opts.domain ?? details.description ?? bagId.slice(0, 16)
  const html = generateFileBrowserPage(displayName, bagId, details.files, '/', basePath)
  state.fileBrowserCache.set(view.webContents.id, html)
  await loadDataHtml(view.webContents, html)
}

export async function loadStorageBag(
  state: TabStorageState,
  view: WebContentsView,
  opts: LoadStorageBagOptions
): Promise<void> {
  const { label, timeout = 30, useCache = false, checkIndexHtml = false } = opts
  const isCurrent = opts.isCurrent ?? (() => true)
  if (!isCurrent()) return

  // Check cache first (for back navigation)
  if (useCache) {
    const cached = state.fileBrowserCache.get(view.webContents.id)
    if (cached) {
      await loadDataHtml(view.webContents, cached)
      return
    }
  }

  // Resolve bag ID
  const bagId = opts.bagId ?? state.storageBagCache.get(opts.domain ?? '')
  if (!bagId) throw new Error('No storage bag detected for this domain')

  // Show loading page
  const loadingHtml = generateLoadingPage(label)
  await loadDataHtml(view.webContents, loadingHtml)
  if (!isCurrent()) return

  const details = await resolveBagDetails(state, bagId, timeout, isCurrent)
  if (!isCurrent()) return
  if (!details) {
    if (opts.domain) {
      throw new Error('Bag has no files or failed to load')
    }
    loadErrorPage(view, 'Bag has no files or download timed out', `${bagId}.bag`)
    return
  }

  await renderBag(state, view, details, bagId, { domain: opts.domain, checkIndexHtml })
}

/**
 * Attempt to load a TON Storage file browser for a .ton domain.
 * Guards against concurrent calls for the same webContents.
 */
export async function loadStorageBrowser(
  state: TabStorageState,
  view: WebContentsView,
  domain: string,
  ownsNavigation: () => boolean = () => true
): Promise<void> {
  if (!ownsNavigation()) return
  const wcId = view.webContents.id
  if (state.storageBrowserLoading.has(wcId)) return
  state.storageBrowserLoading.add(wcId)
  const epoch = ++state.nextStorageBrowserEpoch
  state.storageBrowserEpochs.set(wcId, epoch)
  const isCurrent = (): boolean =>
    ownsNavigation() && !view.webContents.isDestroyed() && state.storageBrowserEpochs.get(wcId) === epoch

  try {
    await loadStorageBag(state, view, { domain, label: domain, timeout: 30, isCurrent })
  } finally {
    if (state.storageBrowserEpochs.get(wcId) === epoch) {
      state.storageBrowserLoading.delete(wcId)
      state.storageBrowserEpochs.delete(wcId)
    }
  }
}
