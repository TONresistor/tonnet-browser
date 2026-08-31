import { useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { Button } from '@/components/ui/button'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { walletClient } from '@/features/wallet/client'
import { errorMessage } from '@shared/errors'
import { SecureLockIcon } from '@/components/ui/SecureLockIcon'

type WalletSystemStorageGateVariant = 'page' | 'sidebar' | 'settings'

interface WalletSystemStorageGateProps {
  variant?: WalletSystemStorageGateVariant
  onDismiss?: () => void
  onOpenFull?: () => void
  onClose?: () => void
}

export function WalletSystemStorageGate({
  variant = 'page',
  onDismiss,
  onOpenFull,
  onClose,
}: WalletSystemStorageGateProps) {
  const { t } = useTranslation('wallet')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRetry = async () => {
    setPending(true)
    setError(null)
    try {
      await walletClient.retrySystemStorage()
    } catch (retryError) {
      setPending(false)
      setError(errorMessage(retryError))
    }
  }

  const prompt = (
    <div className="w-full space-y-4 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-icon">
        <SecureLockIcon className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-sm font-semibold text-heading">
          {t('systemStorage.title', { defaultValue: 'Wallet access blocked' })}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('systemStorage.description', {
            defaultValue:
              'TON Browser could not access your system secure storage. Your wallet is still on this device.',
          })}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {t('systemStorage.retryDescription', {
            defaultValue: 'Try again to reopen TON Browser and allow access. Your wallet password comes next.',
          })}
        </p>
      </div>
      <ActionButton
        type="button"
        variant="filled"
        className="w-full"
        disabled={pending}
        icon={<SecureLockIcon className="h-4 w-4" />}
        onClick={() => void handleRetry()}
      >
        {pending
          ? t('systemStorage.retrying', { defaultValue: 'Reopening…' })
          : t('systemStorage.retry', { defaultValue: 'Try again' })}
      </ActionButton>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t('systemStorage.notNow', { defaultValue: 'Not now' })}
        </button>
      )}
    </div>
  )

  if (variant === 'settings') {
    return <div className="settings-group border-warning/20 px-5 py-5">{prompt}</div>
  }

  if (variant === 'sidebar') {
    return (
      <div className="flex h-full flex-col border-l border-border bg-[hsl(var(--elevation-1))]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <AppIcon name="wallet" className="h-4 w-4 text-icon" />
            <span className="text-sm font-semibold text-heading">{t('page.title')}</span>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={onClose}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-xs">{prompt}</div>
        </div>
        {onOpenFull && (
          <div className="border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={onOpenFull}
              className="flex w-full items-center justify-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              {t('page.openFull', { defaultValue: 'Open full wallet' })}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center bg-background-secondary p-6">
      <div className="w-full max-w-sm rounded-card border border-warning/20 bg-elevation-2 p-5">{prompt}</div>
    </div>
  )
}
