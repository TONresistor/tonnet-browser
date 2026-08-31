import { ActionButton } from '@/components/ui/ios/ActionButton'
import { SecureLockIcon } from '@/components/ui/SecureLockIcon'
import { WalletPasswordFields } from './WalletPasswordFields'
import { useEffect, useRef } from 'react'

type SecurityMode = 'setup' | 'unlock' | 'backup'

interface WalletSecurityScreenProps {
  mode: SecurityMode
  password: string
  confirmation?: string
  error?: string | null
  onPasswordChange: (value: string) => void
  onConfirmationChange?: (value: string) => void
  onSubmit: () => void | Promise<void>
  showPassword?: boolean
  onForgotPassword?: () => void
}

const COPY: Record<SecurityMode, { title: string; description: string; action: string; warning?: boolean }> = {
  setup: {
    title: 'Protect your existing wallet',
    description: 'Set an application password before this wallet can sign transactions.',
    action: 'Protect wallet',
  },
  unlock: {
    title: 'Unlock wallet',
    description: 'The private key remains encrypted until you unlock it.',
    action: 'Unlock',
  },
  backup: {
    title: 'Verify wallet backup',
    description: 'Continue to save and confirm your recovery phrase.',
    action: 'Continue',
    warning: true,
  },
}

export function WalletSecurityScreen({
  mode,
  password,
  confirmation,
  error,
  onPasswordChange,
  onConfirmationChange,
  onSubmit,
  showPassword = true,
  onForgotPassword,
}: WalletSecurityScreenProps) {
  const copy = COPY[mode]
  const passwordInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!error) return
    passwordInputRef.current?.focus()
    passwordInputRef.current?.select()
  }, [error])
  return (
    <div className="flex h-full items-center justify-center bg-background-secondary p-6">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void onSubmit()
        }}
        className={`w-full max-w-sm space-y-4 rounded-card border bg-elevation-2 p-5 ${
          copy.warning ? 'border-warning/20' : 'border-border-subtle'
        }`}
      >
        <div>
          <h2 className="font-semibold text-heading">{copy.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
        </div>
        {showPassword && (
          <WalletPasswordFields
            password={password}
            confirmation={confirmation}
            onPasswordChange={onPasswordChange}
            onConfirmationChange={onConfirmationChange}
            passwordInputRef={passwordInputRef}
            autoFocus={mode === 'unlock'}
          />
        )}
        <ActionButton
          type="submit"
          variant="filled"
          className="w-full"
          icon={showPassword ? <SecureLockIcon className="h-4 w-4" /> : undefined}
        >
          {copy.action}
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
    </div>
  )
}
