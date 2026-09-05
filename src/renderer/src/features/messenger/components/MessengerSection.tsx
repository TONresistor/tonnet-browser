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

const log = createLogger('messenger-settings')

interface MessengerSectionProps {
  onIdentityChange?: (id: OwnChatIdentity | null) => void
}

export const MessengerSection = memo(function MessengerSection({ onIdentityChange }: MessengerSectionProps) {
  const [identity, setIdentity] = useState<OwnChatIdentity | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [domainInput, setDomainInput] = useState('')
  const [domainBusy, setDomainBusy] = useState(false)
  const [domainError, setDomainError] = useState<string | null>(null)
  const resetConfirm = useConfirmAction()

  const applyIdentity = useCallback(
    (value: OwnChatIdentity | null) => {
      setIdentity(value)
      onIdentityChange?.(value)
    },
    [onIdentityChange]
  )

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

  const confirmDomain = useCallback(async () => {
    const domain = domainInput.trim().toLowerCase()
    if (!domain) return
    setDomainBusy(true)
    setDomainError(null)
    try {
      const result = await messengerClient.claimDomain(domain)
      if (!result.ok) throw new Error(result.reason ?? 'The msg_id record does not match this identity')
      applyIdentity(result.identity)
      setDomainInput('')
    } catch (error) {
      setDomainError(error instanceof Error ? error.message : 'Unable to verify domain')
    } finally {
      setDomainBusy(false)
    }
  }, [applyIdentity, domainInput])

  const clearDomain = useCallback(async () => {
    try {
      applyIdentity(await messengerClient.clearDomain())
    } catch (error) {
      log.error('Failed to clear identity domain:', error)
    }
  }, [applyIdentity])

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
    <div className="px-1">
      <div className="flex flex-col items-center gap-2.5 py-3">
        <span
          className="grid h-16 w-16 place-items-center rounded-full text-[22px] font-semibold text-identity-foreground"
          style={{ backgroundColor: avatarColor(seed) }}
        >
          {initial(label)}
        </span>
        <div
          className={
            identity?.domain
              ? 'text-[15px] font-medium lowercase text-foreground'
              : 'font-mono text-[15px] text-foreground'
          }
        >
          {label}
        </div>
      </div>

      <div className="settings-group">
        <button type="button" onClick={copyIdentity} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
          <span className="grid h-[29px] w-[29px] place-items-center rounded-control bg-secondary text-secondary-foreground">
            <AppIcon name="messengerDevice" className="h-[17px] w-[17px] text-identity-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-foreground">Identity key</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">{identity?.identityKey}</div>
          </div>
          {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
        </button>
      </div>

      <div className="mt-3 settings-group p-3">
        <div className="mb-2 text-[13px] font-medium text-foreground">TON DNS identity</div>
        {identity?.domain ? (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm lowercase text-foreground">{identity.domain}</span>
            <Button variant="ghost" size="sm" onClick={() => void clearDomain()}>
              Remove
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={domainInput}
              onChange={(event) => setDomainInput(event.target.value)}
              placeholder="alice.ton"
              className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-foreground"
            />
            <Button size="sm" disabled={domainBusy || !domainInput.trim()} onClick={() => void confirmDomain()}>
              {domainBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'Verify'}
            </Button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          The domain must contain msg_id={identity?.identityKey ?? 'your identity key'}.
        </p>
        {domainError && <p className="mt-1 text-[11px] text-destructive">{domainError}</p>}
      </div>

      <Button
        variant={resetConfirm.isArmed() ? 'destructive' : 'ghost'}
        className="mt-3 w-full"
        onClick={() => void resetIdentity()}
      >
        {resetConfirm.isArmed() ? 'Confirm new identity' : 'Reset identity'}
      </Button>
    </div>
  )
})
