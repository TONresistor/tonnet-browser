/**
 * Security handlers for tab WebContentsViews.
 * Intercepts navigation and popup creation to validate URLs and enforce scheme restrictions.
 */

import { resolve, sep } from 'path'
import { realpath } from 'fs/promises'
import { WebContentsView } from 'electron'
import { normalizeUrl } from '../../shared/utils/url'
import { loadErrorPage } from './tabs-storage'
import { createLogger } from '../../shared/logger'
import { emitContractToRenderer } from '../events/renderer-events'
import { BrowserUrlSchema, contextOpenLinkContract, pageNavigateContract } from '../../shared/ipc-contract/browsing'
import { DisposableStore, onWebContents } from '../utils/disposable'
import { isAbortedNavigation } from './navigation-failure'

const log = createLogger('tabs-security')

/** Allowed URL schemes for navigation. */
export const ALLOWED_SCHEMES = ['http:']

type TopLevelNavigationHandler = (url: string) => boolean
type NavigationDetails = Electron.Event<Electron.WebContentsWillNavigateEventParams>

async function openValidatedBagFile(
  view: WebContentsView,
  tabId: string,
  basePath: string,
  filePath: string,
  isCurrent: () => boolean
): Promise<void> {
  const fullPath = resolve(`${basePath}/${filePath}`)
  const safeBasePath = resolve(basePath)
  let realFullPath: string
  let realSafeBasePath: string
  try {
    ;[realFullPath, realSafeBasePath] = await Promise.all([realpath(fullPath), realpath(safeBasePath)])
  } catch (error) {
    log.event('warn', 'security.bagfile.unresolvable', 'blocked unresolvable bag file path', { error })
    return
  }
  if (!realFullPath.startsWith(realSafeBasePath + sep) && realFullPath !== realSafeBasePath) {
    log.event('warn', 'security.bagfile.path_traversal', 'blocked bag file path traversal')
    return
  }
  try {
    if (!isCurrent()) return
    await view.webContents.loadFile(realFullPath)
    if (!isCurrent()) return
    emitContractToRenderer(pageNavigateContract, {
      tabId,
      url: `file://${fullPath}`,
      canGoBack: true,
      canGoForward: false,
    })
  } catch (error) {
    log.event('error', 'storage.bagfile.load_failed', 'failed to load bag file', { error })
  }
}

function handleNavigation(
  view: WebContentsView,
  details: NavigationDetails,
  onTopLevelNavigation: TopLevelNavigationHandler | undefined,
  captureNavigation: () => () => boolean
): void {
  const { url } = details
  try {
    const normalized = normalizeUrl(url)
    if (!BrowserUrlSchema.safeParse(normalized).success) {
      log.event('warn', 'security.navigation.invalid', 'blocked invalid navigation URL')
      details.preventDefault()
      return
    }
    const parsed = new URL(normalized)

    if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
      log.event('warn', 'security.navigation.blocked', 'blocked navigation to unsafe scheme', {
        scheme: parsed.protocol,
      })
      details.preventDefault()
      return
    }

    if (!details.isMainFrame || details.isSameDocument) return
    if (onTopLevelNavigation?.(normalized)) {
      details.preventDefault()
      return
    }

    if (normalized !== url) {
      details.preventDefault()
      log.debug(`Normalizing URL: ${url} -> ${normalized}`)
      const isCurrent = captureNavigation()
      view.webContents.loadURL(normalized).catch((error) => {
        if (isAbortedNavigation(error) || !isCurrent()) return
        log.error('loadURL failed (normalization):', error)
        loadErrorPage(view, error.message, normalized)
      })
    }
  } catch (error) {
    log.debug('URL validation failed:', error)
    log.event('warn', 'security.navigation.invalid', 'blocked invalid navigation URL')
    details.preventDefault()
  }
}

/** Set up security event handlers on a view (will-navigate, setWindowOpenHandler, did-create-window). */
export function setupSecurityHandlers(
  view: WebContentsView,
  tabId: string,
  onTopLevelNavigation?: TopLevelNavigationHandler,
  captureNavigation: () => () => boolean = () => () => !view.webContents.isDestroyed()
): DisposableStore {
  const store = new DisposableStore()

  // Security: Intercept navigation to validate URLs
  store.add(
    onWebContents(
      view.webContents,
      'will-navigate',
      (details: Electron.Event<Electron.WebContentsWillNavigateEventParams>) => {
        const { url } = details
        if (url.startsWith('bagfile://')) {
          details.preventDefault()
          if (!details.isMainFrame) return
          const currentPageUrl = view.webContents.getURL()
          if (!currentPageUrl.startsWith('data:text/html')) {
            log.warn('Blocked bagfile:// from non-file-browser page')
            return
          }
          const withoutScheme = url.slice('bagfile://'.length)
          const slashIdx = withoutScheme.indexOf('/')
          if (slashIdx !== -1) {
            const bp = decodeURIComponent(withoutScheme.slice(0, slashIdx))
            const fp = decodeURIComponent(withoutScheme.slice(slashIdx + 1))
            void openValidatedBagFile(view, tabId, bp, fp, captureNavigation())
          }
          return
        }

        handleNavigation(view, details, onTopLevelNavigation, captureNavigation)
      }
    )
  )

  store.add(
    onWebContents(
      view.webContents,
      'will-redirect',
      (details: Electron.Event<Electron.WebContentsWillRedirectEventParams>) => {
        handleNavigation(view, details, onTopLevelNavigation, captureNavigation)
      }
    )
  )

  // Security: Control popup windows - open in new tab instead
  view.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const targetUrl = normalizeUrl(url)
      const parsed = new URL(targetUrl)

      if (ALLOWED_SCHEMES.includes(parsed.protocol)) {
        if (targetUrl !== url) {
          log.debug(`Normalizing popup URL: ${url} -> ${targetUrl}`)
        }
        emitContractToRenderer(contextOpenLinkContract, targetUrl)
      } else {
        log.event('warn', 'security.popup.blocked', 'blocked popup to unsafe scheme', { scheme: parsed.protocol })
      }
    } catch (err) {
      log.debug('URL validation failed in popup handler:', err)
      log.event('warn', 'security.popup.invalid', 'blocked popup with invalid URL')
    }
    return { action: 'deny' }
  })

  // Fallback: Close any window that somehow gets created
  store.add(
    onWebContents(
      view.webContents,
      'did-create-window',
      (childWindow: Electron.BrowserWindow, { url }: { url: string }) => {
        log.event('warn', 'security.child_window.unexpected', 'unexpected child window closed')
        childWindow.close()
        if (url && url !== 'about:blank') {
          try {
            const targetUrl = normalizeUrl(url)
            const parsed = new URL(targetUrl)

            if (ALLOWED_SCHEMES.includes(parsed.protocol)) {
              emitContractToRenderer(contextOpenLinkContract, targetUrl)
            }
          } catch {
            log.debug(`Invalid URL in child window: ${url}`)
          }
        }
      }
    )
  )

  return store
}
