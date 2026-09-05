/**
 * Main application component.
 * Browser chrome with tabs, navigation, and content area.
 */

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavigationButtons } from '@/components/browser/NavigationButtons'
import { AddressBar } from '@/components/browser/AddressBar'
import { WindowControls } from '@/components/browser/WindowControls'
import { TabBar } from '@/components/browser/TabBar'
import { BookmarksBar } from '@/components/browser/BookmarksBar'
import { StatusBar } from '@/components/browser/StatusBar'
import { ResizablePanel } from '@/components/browser/ResizablePanel'
const LandingPage = lazy(() => import('@/components/pages/LandingPage').then((m) => ({ default: m.LandingPage })))
import { useBrowserStore } from '@/stores/browser'
import { useTabsStore } from '@/stores/tabs'
import {
  useSavedSidebarWidth,
  useSetPreferenceDraft,
  useShowBookmarksBar,
  useShowStatusBar,
  useTabOrientation,
} from '@/features/settings/public'
import { useLocaleEffects } from '@/features/settings/useLocaleEffects'
import { useThemeEffects } from '@/features/themes/public'
const WalletSidebar = lazy(() =>
  import('@/features/wallet/components/WalletSidebar').then((m) => ({ default: m.WalletSidebar }))
)
const CocoonSidebar = lazy(() =>
  import('@/features/cocoon/components/CocoonSidebar').then((m) => ({ default: m.CocoonSidebar }))
)
import { Button } from '@/components/ui/button'
import { AppIcon } from '@/components/ui/AppIcon'
import { useTranslation } from 'react-i18next'
import { createLogger } from '@/logger'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useIpcEvents } from '@/hooks/useIpcEvents'
import { usePaymentApprovals } from '@/hooks/usePaymentApprovals'
import { resolveInternalRoute } from '@/app-shell/internal-routes'
import { InternalRouteContent } from '@/app-shell/InternalRouteContent'
import { useApplicationBootstrap } from '@/app-shell/useApplicationBootstrap'
import { appShellClient } from '@/app-shell/client'
import { TON_WALLET_PAGE, WALLET_SYSTEM_STORAGE_RETRY_TOKEN } from '@shared/constants'

const log = createLogger('app')

function App() {
  const { t } = useTranslation('common')
  const currentUrl = useBrowserStore((s) => s.currentUrl)
  const proxyConnected = useBrowserStore((s) => s.proxyConnected)
  const updateTab = useTabsStore((s) => s.updateTab)
  const openOrSwitchToTab = useTabsStore((s) => s.openOrSwitchToTab)
  const ensureDefaultTab = useTabsStore((s) => s.ensureDefaultTab)
  const showBookmarksBar = useShowBookmarksBar()
  const showStatusBar = useShowStatusBar()
  const tabOrientation = useTabOrientation()
  const savedSidebarWidth = useSavedSidebarWidth()
  const setDraft = useSetPreferenceDraft()

  // Track current sidebar width in real-time during resize
  const [currentSidebarWidth, setCurrentSidebarWidth] = useState(savedSidebarWidth)
  const [walletSidebarOpen, setWalletSidebarOpen] = useState(false)
  const [walletSidebarWidth, setWalletSidebarWidth] = useState(320)
  const [cocoonSidebarOpen, setCocoonSidebarOpen] = useState(false)
  const [cocoonSidebarWidth, setCocoonSidebarWidth] = useState(320)
  const walletSystemStorageRetry = useRef(
    new URLSearchParams(window.location.search).has(WALLET_SYSTEM_STORAGE_RETRY_TOKEN)
  )

  // Debounce timer for settings save
  const settingsSaveTimer = useRef<NodeJS.Timeout | null>(null)

  useApplicationBootstrap()
  useLocaleEffects()
  useThemeEffects()

  useEffect(() => {
    if (!walletSystemStorageRetry.current) return
    walletSystemStorageRetry.current = false
    void openOrSwitchToTab(TON_WALLET_PAGE)
  }, [openOrSwitchToTab])

  // Sync current sidebar width with saved value when preferences load
  useEffect(() => {
    setCurrentSidebarWidth(savedSidebarWidth)
  }, [savedSidebarWidth])

  // Sync right sidebar width with main process. Wallet and Cocoon are mutually
  // exclusive in the same right slot, so the WebContentsView only needs whichever
  // one is currently open.
  useEffect(() => {
    const width = walletSidebarOpen ? walletSidebarWidth : cocoonSidebarOpen ? cocoonSidebarWidth : 0
    appShellClient.setContentSidebarWidth(width)
  }, [walletSidebarOpen, walletSidebarWidth, cocoonSidebarOpen, cocoonSidebarWidth])

  useEffect(() => {
    return () => {
      appShellClient.setContentSidebarWidth(0)
    }
  }, [])

  useEffect(() => {
    if (proxyConnected) {
      ensureDefaultTab()
    }
  }, [proxyConnected, ensureDefaultTab])

  // Keyboard shortcuts (extracted to hook)
  useKeyboardShortcuts(openOrSwitchToTab)

  // IPC events from main process (extracted to hook)
  useIpcEvents(updateTab)

  // Manual-mode HTTP 402 approval overlay
  usePaymentApprovals()

  const internalRoute = resolveInternalRoute(currentUrl)

  const loadingContent: ReactNode = (
    <div className="w-full h-full flex flex-col items-center justify-center bg-background-secondary">
      <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  )

  const renderContent = () => {
    // Show landing page if not connected
    if (!proxyConnected && (internalRoute?.kind === 'start' || !internalRoute)) {
      return <LandingPage />
    }

    if (!internalRoute) {
      // External page - WebContentsView handles this, this is just a background
      return loadingContent
    }
    return <InternalRouteContent route={internalRoute} loading={loadingContent} />
  }

  // Vertical tabs: sidebar only affects content area, not full window
  const isVertical = tabOrientation === 'vertical'

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Tab Bar Row - Only in horizontal mode */}
      {!isVertical && (
        <div className="flex items-center bg-background drag-region min-h-[44px]">
          {proxyConnected && <TabBar />}
          <div className="flex-1" />
          <WindowControls />
        </div>
      )}

      {/* Navigation Bar - Full width */}
      <div className={`flex items-center px-2 py-1.5 gap-2 bg-background ${isVertical ? 'drag-region' : ''}`}>
        <div className="no-drag">
          <NavigationButtons />
        </div>
        <div className="no-drag flex-1">
          <AddressBar />
        </div>
        <div className="flex items-center gap-1">
          <div className="no-drag flex items-center gap-0.5 rounded-full px-1 py-0.5 glass-surface">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-icon hover:text-icon"
              onClick={() => {
                setWalletSidebarOpen((v) => !v)
                setCocoonSidebarOpen(false)
              }}
              title={t('tooltips.wallet')}
              aria-label={t('tooltips.wallet')}
            >
              <AppIcon name="wallet" className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-icon hover:text-icon"
              onClick={() => {
                setCocoonSidebarOpen((v) => !v)
                setWalletSidebarOpen(false)
              }}
              title={t('tooltips.cocoon')}
              aria-label={t('tooltips.cocoon')}
            >
              <AppIcon name="cocoon" className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-icon hover:text-icon"
              onClick={() => openOrSwitchToTab('ton://chat')}
              title={t('tooltips.messenger')}
              aria-label={t('tooltips.messenger')}
            >
              <AppIcon name="messenger" className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-icon hover:text-icon"
              onClick={() => openOrSwitchToTab('ton://storage')}
              title={t('tooltips.storage')}
              aria-label={t('tooltips.storage')}
            >
              <AppIcon name="storage" className="h-4 w-4" />
            </Button>
          </div>
          <div className="no-drag flex items-center gap-0.5 rounded-full px-1 py-0.5 glass-surface">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-icon hover:text-icon"
              onClick={() => openOrSwitchToTab('ton://settings')}
              title={t('tooltips.settings')}
              aria-label={t('tooltips.settings')}
            >
              <AppIcon name="settings" className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* Window Controls in nav bar - Only in vertical/sidebar mode */}
        {isVertical && (
          <div className="no-drag">
            <WindowControls />
          </div>
        )}
      </div>

      {/* Bookmarks Bar - Full width */}
      {showBookmarksBar && <BookmarksBar />}

      {/* Main Content Area - Sidebar + Content */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar (vertical tabs) - Resizable in vertical mode */}
        {isVertical && proxyConnected && (
          <ResizablePanel
            defaultWidth={savedSidebarWidth}
            minWidth={64}
            maxWidth={400}
            onResize={(width) => {
              // Update local state immediately for real-time UI updates
              setCurrentSidebarWidth(width)
              setDraft('sidebarWidth', width)
              appShellClient.setTabSidebarWidth(width)

              // Debounce settings save to avoid excessive disk writes
              if (settingsSaveTimer.current) {
                clearTimeout(settingsSaveTimer.current)
              }
              settingsSaveTimer.current = setTimeout(() => {
                appShellClient
                  .saveTabSidebarWidth(width)
                  .catch((err) => log.error('Failed to save sidebar width:', err))
              }, 300)
            }}
            className="flex flex-col bg-background border-r border-border"
          >
            <TabBar sidebarWidth={currentSidebarWidth} />
          </ResizablePanel>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-auto min-h-0">
          <Suspense
            fallback={
              <div className="w-full h-full flex flex-col items-center justify-center bg-background-secondary">
                <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            }
          >
            {renderContent()}
          </Suspense>
        </div>

        {/* Right sidebar (wallet) */}
        {walletSidebarOpen && (
          <ResizablePanel
            side="right"
            defaultWidth={walletSidebarWidth}
            minWidth={280}
            maxWidth={420}
            onResize={(width) => {
              setWalletSidebarWidth(width)
            }}
            className="border-l border-border"
          >
            <Suspense fallback={null}>
              <WalletSidebar onClose={() => setWalletSidebarOpen(false)} />
            </Suspense>
          </ResizablePanel>
        )}

        {/* Right sidebar (cocoon) — mutually exclusive with wallet */}
        {cocoonSidebarOpen && (
          <ResizablePanel
            side="right"
            defaultWidth={cocoonSidebarWidth}
            minWidth={280}
            maxWidth={420}
            onResize={(width) => {
              setCocoonSidebarWidth(width)
            }}
            className="border-l border-border"
          >
            <Suspense fallback={null}>
              <CocoonSidebar onClose={() => setCocoonSidebarOpen(false)} />
            </Suspense>
          </ResizablePanel>
        )}
      </div>

      {/* Status Bar - Full width */}
      {showStatusBar && <StatusBar />}
    </div>
  )
}

export default App
