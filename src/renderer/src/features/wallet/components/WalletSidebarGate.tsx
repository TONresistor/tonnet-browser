import { ExternalLink, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { Button } from '@/components/ui/button'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { WalletPasswordFields } from './WalletPasswordFields'
import { SecureLockIcon } from '@/components/ui/SecureLockIcon'
import { useEffect, useRef } from 'react'

type SidebarGateMode = 'unlock' | 'setup' | 'backup'

const COPY: Record<SidebarGateMode, { title: string; description: string; action?: string }> = {
  unlock: {
    title: 'Wallet locked',
    description: 'Enter your password to use the wallet here.',
    action: 'Unlock',
  },
  setup: {
    title: 'Protect wallet',
    description: 'Set an app password to continue.',
    action: 'Protect wallet',
  },
  backup: {
    title: 'Backup required',
    description: 'Open the full wallet to save and confirm your recovery phrase.',
  },
}

export function WalletSidebarGate({
  mode,
  password,
  confirmation,
  pending,
  error,
  onPassword,
  onConfirmation,
  onSubmit,
  onForgotPassword,
  onOpenFull,
  onClose,
}: {
  mode: SidebarGateMode
  password: string
  confirmation?: string
  pending: boolean
  error: string | null
  onPassword: (value: string) => void
  onConfirmation?: (value: string) => void
  onSubmit: () => void | Promise<void>
  onForgotPassword?: () => void
  onOpenFull: () => void
  onClose: () => void
}) {
  const { t } = useTranslation('wallet')
  const copy = COPY[mode]
  const ready = password.length >= 10 && (mode !== 'setup' || password === confirmation)
  const passwordInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!error) return
    passwordInputRef.current?.focus()
    passwordInputRef.current?.select()
  }, [error])

  return (
    <div className="flex h-full flex-col border-l border-border bg-[hsl(var(--elevation-1))]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <AppIcon name="wallet" className="h-4 w-4 text-icon" />
          <span className="text-sm font-semibold text-heading">{t('page.title')}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={onClose}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-xs space-y-4 text-center">
          <div>
            <h2 className="text-sm font-semibold text-heading">{copy.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
          </div>
          {mode !== 'backup' && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void onSubmit()
              }}
            >
              <WalletPasswordFields
                password={password}
                confirmation={confirmation}
                onPasswordChange={onPassword}
                onConfirmationChange={onConfirmation}
                disabled={pending}
                passwordInputRef={passwordInputRef}
                autoFocus={mode === 'unlock'}
              />
              <ActionButton
                type="submit"
                variant="filled"
                className="w-full"
                disabled={!ready || pending}
                icon={<SecureLockIcon className="h-4 w-4" />}
              >
                {pending ? 'Please wait…' : copy.action}
              </ActionButton>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              {mode === 'unlock' && onForgotPassword && (
                <button
                  type="button"
                  onClick={onForgotPassword}
                  className="w-full text-center text-xs font-medium text-primary hover:text-primary/80"
                >
                  Forgot password?
                </button>
              )}
            </form>
          )}
        </div>
      </div>

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
    </div>
  )
}
