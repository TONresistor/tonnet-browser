/**
 * Section Advanced
 */

import { memo, useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { Segmented } from '@/components/ui/ios/Segmented'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'
import { Http402ExperimentalPanel } from './Http402ExperimentalPanel'
import type { Http402SectionHandle } from './Http402ExperimentalPanel'
import { settingsClient } from '@/features/settings/client'

interface AdvancedSectionProps extends SectionProps {
  onResetAll: () => void
  pendingReset?: boolean
  onHttp402DirtyChange?: (dirty: boolean) => void
  http402SectionRef?: React.RefObject<Http402SectionHandle | null>
}

export const AdvancedSection = memo(function AdvancedSection({
  draft,
  setDraft,
  onResetAll,
  pendingReset,
  onHttp402DirtyChange,
  http402SectionRef,
}: AdvancedSectionProps) {
  const { t } = useTranslation('settings')
  const [diagnostics, setDiagnostics] = useState<{ enabled: boolean; until: number | null }>({
    enabled: false,
    until: null,
  })
  const [reportCopied, setReportCopied] = useState(false)

  useEffect(() => {
    let active = true
    settingsClient.diagnostics
      .get()
      .then((status) => {
        if (active) setDiagnostics(status)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!diagnostics.until) return
    const timeout = window.setTimeout(
      () => setDiagnostics({ enabled: false, until: null }),
      Math.max(0, diagnostics.until - Date.now())
    )
    return () => window.clearTimeout(timeout)
  }, [diagnostics.until])

  useEffect(() => {
    if (!reportCopied) return
    const timeout = window.setTimeout(() => setReportCopied(false), 2_000)
    return () => window.clearTimeout(timeout)
  }, [reportCopied])

  const toggleDiagnostics = async () => {
    try {
      const status = diagnostics.enabled
        ? await settingsClient.diagnostics.disable()
        : await settingsClient.diagnostics.enable()
      setDiagnostics(status)
    } catch {
      // The setting is diagnostic-only; failure must not destabilize Settings.
    }
  }

  const copyDiagnosticReport = async () => {
    try {
      await settingsClient.diagnostics.copy()
      setReportCopied(true)
    } catch {
      setReportCopied(false)
    }
  }

  return (
    <div>
      <SectionHeader title={t('advanced.title')} description={t('advanced.description')} />
      <div className="settings-group px-4">
        <div className="border-b border-border-subtle py-3.5">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('advanced.diagnostics.title')}
          </p>
        </div>
        <SettingRow label={t('advanced.proxyVerbosity')} description={t('advanced.proxyVerbosityDesc')}>
          <Segmented
            value={String(draft.proxyVerbosity)}
            onChange={(v) => setDraft('proxyVerbosity', Number(v))}
            ariaLabel={t('advanced.proxyVerbosity')}
            options={[
              { value: '0', label: t('advanced.silent') },
              { value: '1', label: t('advanced.errorsOnly') },
              { value: '2', label: t('advanced.normal') },
              { value: '3', label: t('advanced.verbose') },
            ]}
          />
        </SettingRow>
        <SettingRow label={t('advanced.storageVerbosity')} description={t('advanced.storageVerbosityDesc')}>
          <Segmented
            value={String(draft.storageVerbosity)}
            onChange={(v) => setDraft('storageVerbosity', Number(v))}
            ariaLabel={t('advanced.storageVerbosity')}
            options={[
              { value: '0', label: t('advanced.silent') },
              { value: '1', label: t('advanced.errorsOnly') },
              { value: '2', label: t('advanced.normal') },
              { value: '3', label: t('advanced.verbose') },
            ]}
          />
        </SettingRow>
        <SettingRow label={t('advanced.diagnosticLogging')} description={t('advanced.diagnosticLoggingDesc')}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copyDiagnosticReport()}
              className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              {reportCopied ? t('advanced.diagnosticsCopied') : t('advanced.copyDiagnostics')}
            </button>
            <button
              type="button"
              onClick={() => void toggleDiagnostics()}
              className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              {diagnostics.enabled ? t('advanced.disableDiagnostics') : t('advanced.enableDiagnostics')}
            </button>
          </div>
        </SettingRow>
      </div>

      <div className="mt-6 settings-group px-4">
        <div className="border-b border-border-subtle py-3.5">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('advanced.experimental.title')}
          </p>
        </div>
        <SettingRow label={t('advanced.experimental.messenger')} description={t('advanced.experimental.messengerDesc')}>
          <Toggle
            checked={draft.messengerAutostart}
            onChange={(v) => setDraft('messengerAutostart', v)}
            ariaLabel={t('advanced.experimental.messenger')}
          />
        </SettingRow>
        <SettingRow
          label={t('advanced.experimental.unicodeDomains')}
          description={t('advanced.experimental.unicodeDomainsDesc')}
        >
          <Toggle
            checked={draft.displayUnicodeDomains}
            onChange={(v) => setDraft('displayUnicodeDomains', v)}
            ariaLabel={t('advanced.experimental.unicodeDomains')}
          />
        </SettingRow>
        <SettingRow
          label={t('advanced.experimental.tonConnect')}
          description={t('advanced.experimental.tonConnectDesc')}
        >
          <Toggle
            checked={draft.tonConnectEnabled}
            onChange={(v) => setDraft('tonConnectEnabled', v)}
            ariaLabel={t('advanced.experimental.tonConnect')}
          />
        </SettingRow>
        <Http402ExperimentalPanel onDirtyChange={onHttp402DirtyChange} sectionRef={http402SectionRef} />
      </div>

      <div className="mt-6 settings-group border-destructive/30 bg-destructive/5 px-4">
        <div className="flex items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-destructive">{t('advanced.danger.title')}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{t('advanced.danger.description')}</p>
          </div>
          <button
            onClick={onResetAll}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium text-destructive-foreground shadow-sm transition-all duration-200 ${
              pendingReset
                ? 'border-destructive bg-destructive/90'
                : 'border-destructive bg-destructive hover:bg-destructive/90'
            }`}
          >
            <RotateCcw className="h-4 w-4" />
            {pendingReset ? t('advanced.resetAllConfirm') : t('advanced.resetAll')}
          </button>
        </div>
      </div>
    </div>
  )
})
