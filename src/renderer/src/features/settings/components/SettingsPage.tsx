/**
 * Page Settings principale
 * Container qui orchestre toutes les sections
 */

import { errorMessage } from '@shared/errors'
import type { HistoryStats } from '@shared/types'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createLogger } from '@/logger'
import { UI_NOTIFICATION_TIMEOUT_MS, UI_ERROR_TIMEOUT_MS } from '@shared/constants'
import { usePreferencesStore } from '@/features/settings/preferences-store'
import { useUIStore } from '@/features/settings/ui-store'
import { storageClient } from '@/features/storage/client'
import { historyClient } from '@/features/history/client'
import { settingsClient } from '@/features/settings/client'
import { useTranslation } from 'react-i18next'
import { useConfirmAction } from '@/hooks/useConfirmAction'

const log = createLogger('settings')
import { SettingsLayout } from '@/features/settings/components/SettingsLayout'
import { SettingsSidebar } from '@/features/settings/components/SettingsSidebar'
import { SettingsActions } from '@/features/settings/components/SettingsActions'
import { LoadingState } from '@/features/settings/components/shared/LoadingState'

// Import sections
import { GeneralSection } from '@/features/settings/components/sections/GeneralSection'
import { NetworkSection } from '@/features/settings/components/sections/NetworkSection'
import { StorageSection } from '@/features/settings/components/sections/StorageSection'
import { AppearanceSection } from '@/features/settings/components/sections/AppearanceSection'
import { PrivacySection } from '@/features/settings/components/sections/PrivacySection'
import { NameServicesSection } from '@/features/settings/components/sections/NameServicesSection'
import { AdvancedSection } from '@/features/settings/components/sections/AdvancedSection'
import { AboutSection } from '@/features/settings/components/sections/AboutSection'
import { WalletSection } from '@/features/settings/components/sections/WalletSection'
import { BridgeSection } from '@/features/settings/components/sections/BridgeSection'
import { CocoonSection } from '@/features/cocoon/components/CocoonSection'
import type { WalletSectionHandle } from '@/features/settings/components/sections/WalletSection'
import type { BridgeSectionHandle } from '@/features/settings/components/sections/BridgeSection'
import type { Http402SectionHandle } from '@/features/settings/components/sections/Http402ExperimentalPanel'

export function SettingsPage() {
  const { t } = useTranslation('settings')

  // State
  const activeSection = useUIStore((s) => s.settingsActiveSection)
  const setActiveSection = useUIStore((s) => s.setSettingsActiveSection)
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [changingHistoryMode, setChangingHistoryMode] = useState(false)
  const resetConfirm = useConfirmAction()
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [persistenceError, setPersistenceError] = useState<HistoryStats['persistenceError']>()
  const [walletDirty, setWalletDirty] = useState(false)
  const [bridgeDirty, setBridgeDirty] = useState(false)
  const [http402Dirty, setHttp402Dirty] = useState(false)

  // Refs
  const clearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const walletSectionRef = useRef<WalletSectionHandle | null>(null)
  const bridgeSectionRef = useRef<BridgeSectionHandle | null>(null)
  const http402SectionRef = useRef<Http402SectionHandle | null>(null)

  // Stores
  const {
    draft,
    isLoaded,
    hasChanges: prefsHasChanges,
    isSaving,
    loadFromMain,
    setDraft,
    save,
    discard,
    resetToDefaults,
  } = usePreferencesStore()
  const hasChanges = prefsHasChanges || walletDirty || bridgeDirty || http402Dirty

  useEffect(() => {
    if (activeSection !== 'privacy') return
    let current = true
    void historyClient
      .getStats()
      .then((stats) => {
        if (current) setPersistenceError(stats.persistenceError)
      })
      .catch((error) => log.error('Failed to read history persistence status:', error))
    return () => {
      current = false
    }
  }, [activeSection, draft.historyMode, changingHistoryMode])

  // Load settings on mount
  useEffect(() => {
    loadFromMain()
  }, [loadFromMain])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (clearTimeoutRef.current) clearTimeout(clearTimeoutRef.current)
      if (historyErrorTimerRef.current) clearTimeout(historyErrorTimerRef.current)
    }
  }, [])

  // Handlers
  const handleSelectFolder = async () => {
    try {
      const result = await storageClient.selectDownloadFolder()
      if (result.success && result.path) {
        setDraft('downloadPath', result.path)
      }
    } catch (error) {
      log.error('Failed to select folder:', error)
    }
  }

  const handleClearData = async () => {
    setClearing(true)
    setCleared(false)
    try {
      await settingsClient.clearBrowsingData()
      setCleared(true)
      clearTimeoutRef.current = setTimeout(() => setCleared(false), UI_NOTIFICATION_TIMEOUT_MS)
    } finally {
      setClearing(false)
    }
  }

  const handleResetAll = () => {
    if (resetConfirm.trigger()) {
      void resetToDefaults().catch((error) => log.error('Failed to reset settings:', error))
    }
  }

  const handleSave = async () => {
    try {
      await save()
      if (walletSectionRef.current?.hasChanges) {
        await walletSectionRef.current.save()
      }
      if (bridgeSectionRef.current?.hasChanges) {
        await bridgeSectionRef.current.save()
      }
      if (http402SectionRef.current?.hasChanges) {
        await http402SectionRef.current.save()
      }
    } catch (error) {
      log.error('Failed to save settings:', error)
    }
  }

  const handleDiscard = () => {
    discard()
    walletSectionRef.current?.discard()
    bridgeSectionRef.current?.discard()
    http402SectionRef.current?.discard()
  }

  const handleHistoryModeChange = useCallback(
    async (newMode: 'memory' | 'persistent') => {
      setChangingHistoryMode(true)
      try {
        const result = await historyClient.changeMode(newMode)
        if (result.success) {
          setDraft('historyMode', newMode as 'memory' | 'persistent')
        } else {
          setHistoryError(t('errors.historyModeChangeFailed', { error: 'Operation declined' }))
          if (historyErrorTimerRef.current) clearTimeout(historyErrorTimerRef.current)
          historyErrorTimerRef.current = setTimeout(() => setHistoryError(null), UI_ERROR_TIMEOUT_MS)
        }
      } catch (error) {
        setHistoryError(t('errors.historyModeChangeError', { error: errorMessage(error) }))
        if (historyErrorTimerRef.current) clearTimeout(historyErrorTimerRef.current)
        historyErrorTimerRef.current = setTimeout(() => setHistoryError(null), UI_ERROR_TIMEOUT_MS)
      } finally {
        setChangingHistoryMode(false)
      }
    },
    [setDraft, t]
  )

  // Render content based on active section
  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return <GeneralSection draft={draft} setDraft={setDraft} />

      case 'network':
        return <NetworkSection draft={draft} setDraft={setDraft} />

      case 'nameServices':
        return <NameServicesSection draft={draft} setDraft={setDraft} />

      case 'storage':
        return (
          <StorageSection draft={draft} setDraft={setDraft} isLoaded={isLoaded} onSelectFolder={handleSelectFolder} />
        )

      case 'appearance':
        return <AppearanceSection draft={draft} setDraft={setDraft} />

      case 'privacy':
        return (
          <div>
            <PrivacySection
              draft={draft}
              setDraft={setDraft}
              clearing={clearing}
              cleared={cleared}
              onClearData={handleClearData}
              changingHistoryMode={changingHistoryMode}
              onHistoryModeChange={handleHistoryModeChange}
            />
            {(historyError || persistenceError) && (
              <p className="mt-2 text-sm text-destructive px-1">
                {historyError || t('history.persistenceUnavailable')}
              </p>
            )}
          </div>
        )

      case 'advanced':
        return (
          <AdvancedSection
            draft={draft}
            setDraft={setDraft}
            onResetAll={handleResetAll}
            pendingReset={resetConfirm.isArmed()}
            onHttp402DirtyChange={setHttp402Dirty}
            http402SectionRef={http402SectionRef}
          />
        )

      case 'wallet':
        return <WalletSection onDirtyChange={setWalletDirty} sectionRef={walletSectionRef} />

      case 'bridge':
        return <BridgeSection onDirtyChange={setBridgeDirty} sectionRef={bridgeSectionRef} />

      case 'cocoon':
        return <CocoonSection draft={draft} setDraft={setDraft} />

      case 'about':
        return <AboutSection />

      default:
        return null
    }
  }

  return (
    <SettingsLayout
      sidebar={<SettingsSidebar activeSection={activeSection} onSectionChange={setActiveSection} />}
      content={isLoaded ? renderContent() : <LoadingState />}
      actions={
        <SettingsActions hasChanges={hasChanges} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
      }
    />
  )
}
