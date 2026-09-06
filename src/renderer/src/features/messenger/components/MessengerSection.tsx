import { memo, useCallback, useEffect, useState } from 'react'
import { Check, Copy, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/logger'
import { useConfirmAction } from '@/hooks/useConfirmAction'
import type { OwnChatIdentity } from '@shared/types'
import { avatarColor, initial } from '@/features/messenger/components/chat/util'
import '@/features/settings/components/settings.css'
import { messengerClient } from '@/features/messenger/client'
import { AppIcon } from '@/components/ui/AppIcon'
import { DomainLink } from './DomainLink'

const log = createLogger('messenger-settings')

interface MessengerSectionProps {
  onIdentityChange?: (id: OwnChatIdentity | null) => void
}

export const MessengerSection = memo(function MessengerSection({ onIdentityChange }: MessengerSectionProps) {
  const [identity, setIdentity] = useState<OwnChatIdentity | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const resetConfirm = useConfirmAction()

  const applyIdentity = useCallback(
    (value: OwnChatIdentity | null) => {
      setIdentity(value)
      onIdentityChange?.(value)
    },
    [onIdentityChange]
  )

  useEffect(() => messengerClient.onIdentityChanged(applyIdentity), [applyIdentity])

  useEffect(() => {
    let active = true
    void messengerClient
      .getIdentity()
      .then((id) => {
        if (!active) return
        applyIdentity(id)
      })
      .catch((error) => log.error('Failed to load messenger identity:', error))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [applyIdentity])

  const copyIdentity = useCallback(() => {
    if (!identity) return
    void navigator.clipboard.writeText(identity.identityKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [identity])

  const resetIdentity = useCallback(async () => {
    if (!resetConfirm.trigger()) return
    try {
      applyIdentity(await messengerClient.resetIdentity())
    } catch (error) {
      log.error('Failed to reset messenger identity:', error)
    }
  }, [applyIdentity, resetConfirm])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const label = identity?.domain || identity?.name || (identity ? `#${identity.identityKey.slice(0, 10)}` : '...')
  const seed = identity?.domain || identity?.identityKey || '?'

  return (
    <div className="min-w-0 max-w-full overflow-x-hidden px-1 pb-4">
      <div className="flex flex-col items-center gap-3 pb-5 pt-3">
        <span
          className="grid h-16 w-16 place-items-center rounded-full text-[22px] font-semibold text-identity-foreground"
          style={{ backgroundColor: avatarColor(seed) }}
        >
          {initial(label)}
        </span>
        <div
          className={
            identity?.domain
              ? 'max-w-full break-all text-center text-[17px] font-medium lowercase text-foreground'
              : 'max-w-full break-all text-center font-mono text-[15px] text-foreground'
          }
        >
          {label}
        </div>
      </div>

      <div className="settings-group min-w-0 max-w-full overflow-hidden">
        <button
          type="button"
          onClick={copyIdentity}
          aria-label="Copy identity key"
          title={copied ? 'Copied' : 'Copy identity key'}
          className="flex min-w-0 w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center text-muted-foreground">
            <AppIcon name="messengerDevice" className="h-[17px] w-[17px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">Identity key</div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-foreground/80">{identity?.identityKey}</div>
          </div>
          {copied ? (
            <Check className="h-4 w-4 shrink-0 text-primary" />
          ) : (
            <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>
        {identity && (
          <DomainLink
            key={`${identity.identityKey}:${identity.domain ?? ''}`}
            identity={identity}
            onIdentityChange={applyIdentity}
          />
        )}
      </div>

      <Button
        variant={resetConfirm.isArmed() ? 'destructive' : 'ghost'}
        size="sm"
        className={
          resetConfirm.isArmed()
            ? 'mx-auto mt-5 flex'
            : 'mx-auto mt-5 flex text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
        }
        onClick={() => void resetIdentity()}
      >
        {resetConfirm.isArmed() ? 'Confirm new identity' : 'Reset identity'}
      </Button>
    </div>
  )
})
