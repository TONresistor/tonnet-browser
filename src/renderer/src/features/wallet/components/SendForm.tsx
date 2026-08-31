/**
 * Send TON form with confirmation step.
 * NEVER uses parseFloat — all amounts handled via BigInt.
 */

import { errorMessage } from '@shared/errors'
import { useState, useEffect, memo } from 'react'
import { UI_NOTIFICATION_TIMEOUT_MS, WALLET_MAX_COMMENT_BYTES } from '@shared/constants'
import { ArrowLeft, LoaderCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { tonToNano, formatTonAmount } from '@/lib/ton-utils'
import { walletClient } from '@/features/wallet/client'
import { isValidTonAddress, isValidRecipientInput, TX_FEE_RESERVE_NANO, utf8ByteLength } from '@/lib/ton-utils'
import { useTranslation } from 'react-i18next'
import { Toggle } from '@/features/settings/components/shared/Toggle'
import { SendActionIcon } from '@/features/wallet/components/SendActionIcon'
import { SecureLockIcon } from '@/components/ui/SecureLockIcon'

type ResolveState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'resolved'; address: string; domain: string }
  | { status: 'error'; message: string }

function truncateAddress(addr: string | undefined): string {
  if (!addr) return ''
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

interface SendFormProps {
  onSend: (to: string, amount: string, comment?: string, encryptedComment?: boolean) => Promise<void>
  isSending: boolean
  error: string | null
  balance: string // nanoTON
}

// Validates a TON amount string (non-zero, positive, valid decimal)
function isValidAmount(val: string): boolean {
  if (!val || val === '0' || val === '0.') return false
  if (!/^\d+(\.\d{0,9})?$/.test(val)) return false
  try {
    const nano = tonToNano(val)
    return BigInt(nano) > 0n
  } catch {
    return false
  }
}

export const SendForm = memo(function SendForm({ onSend, isSending, error, balance }: SendFormProps) {
  const { t } = useTranslation('wallet')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')
  const [encryptedComment, setEncryptedComment] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [success, setSuccess] = useState(false)
  const [resolve, setResolve] = useState<ResolveState>({ status: 'idle' })
  const [debouncedTo, setDebouncedTo] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setDebouncedTo(to), 400)
    return () => clearTimeout(id)
  }, [to])

  useEffect(() => {
    const v = debouncedTo.trim()
    if (!v || !v.toLowerCase().endsWith('.ton')) {
      setResolve({ status: 'idle' })
      return
    }
    if (!isValidRecipientInput(v)) {
      setResolve({ status: 'error', message: 'Invalid domain format' })
      return
    }
    let cancelled = false
    setResolve({ status: 'loading' })
    walletClient
      .resolveRecipient(v)
      .then((r) => {
        if (cancelled) return
        if (!r || typeof (r as { address?: string }).address !== 'string') {
          setResolve({ status: 'error', message: 'Wallet not found' })
          return
        }
        setResolve({ status: 'resolved', address: (r as { address: string }).address, domain: v.toLowerCase() })
      })
      .catch((e) => {
        if (!cancelled) setResolve({ status: 'error', message: errorMessage(e) })
      })
    return () => {
      cancelled = true
    }
  }, [debouncedTo])

  const toEndsWithTon = to.toLowerCase().endsWith('.ton')
  const toValid = isValidTonAddress(to) || (resolve.status === 'resolved' && resolve.domain === to.trim().toLowerCase())
  const amountValid = isValidAmount(amount)
  const exceedsBalance = amountValid && BigInt(tonToNano(amount)) > BigInt(balance || '0')
  // Count and gate on the trimmed value — that is what actually gets sent and
  // validated downstream, so leading/trailing whitespace never blocks a valid memo.
  const trimmedComment = comment.trim()
  const commentBytes = utf8ByteLength(trimmedComment)
  const commentTooLong = commentBytes > WALLET_MAX_COMMENT_BYTES
  const canProceed = toValid && amountValid && !exceedsBalance && !commentTooLong

  const handleMax = () => {
    const balanceBig = BigInt(balance || '0')
    const maxNano = balanceBig > TX_FEE_RESERVE_NANO ? balanceBig - TX_FEE_RESERVE_NANO : 0n
    if (maxNano > 0n) {
      // Convert nanoTON to TON display string
      setAmount(formatTonAmount(maxNano.toString()))
    }
  }

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    // Allow only digits and one dot
    if (/^(\d*\.?\d*)$/.test(val)) {
      setAmount(val)
    }
  }

  const handleConfirm = () => {
    if (canProceed) setConfirming(true)
  }

  const handleSend = async () => {
    try {
      const nanoAmount = tonToNano(amount)
      await onSend(to, nanoAmount, trimmedComment || undefined, encryptedComment && Boolean(trimmedComment))
      setSuccess(true)
      setConfirming(false)
      setTo('')
      setAmount('')
      setComment('')
      setEncryptedComment(false)
      setTimeout(() => setSuccess(false), UI_NOTIFICATION_TIMEOUT_MS)
    } catch {
      setConfirming(false)
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-4 gap-2">
        <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
        <p className="text-base font-medium text-foreground">{t('send.success')}</p>
        <p className="text-sm text-muted-foreground">{t('send.successDesc')}</p>
      </div>
    )
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-4">
        <div className="bg-muted rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-heading">{t('send.confirm')}</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('send.to')}</span>
              <span className="font-mono text-foreground text-xs break-all max-w-[200px]">{to}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('send.amount')}</span>
              <span className="font-medium text-foreground">{amount} GRAM</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('send.fee')}</span>
              <span className="text-muted-foreground">{t('send.estimatedFee')}</span>
            </div>
            {trimmedComment && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground shrink-0">{t('send.comment')}</span>
                <span className="text-foreground text-xs break-words text-right max-w-[200px]">{trimmedComment}</span>
              </div>
            )}
            {trimmedComment && encryptedComment && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground shrink-0">{t('send.privacy')}</span>
                <span className="inline-flex items-center gap-1 text-xs text-foreground">
                  <SecureLockIcon className="h-3 w-3" />
                  {t('send.encryptedLabel')}
                </span>
              </div>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => setConfirming(false)}
            disabled={isSending}
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {t('send.back')}
          </Button>
          <Button type="button" className="flex-1" onClick={handleSend} disabled={isSending}>
            {isSending ? (
              <LoaderCircle className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <SendActionIcon className="h-4 w-4 mr-1.5" />
            )}
            {isSending ? t('send.sending') : t('send.confirm')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground" htmlFor="send-to">
          {t('send.recipientLabel')}
        </label>
        <Input
          id="send-to"
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          placeholder={t('send.recipientPlaceholder')}
          className={cn(
            to && !isValidTonAddress(to) && !toEndsWithTon && 'border-destructive focus-visible:ring-destructive'
          )}
          aria-invalid={to ? !isValidTonAddress(to) && !toEndsWithTon : undefined}
        />
        {to && !isValidTonAddress(to) && !toEndsWithTon && (
          <p className="text-xs text-destructive">{t('send.invalidAddress')}</p>
        )}
        {toEndsWithTon && resolve.status === 'loading' && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
            Resolving domain...
          </p>
        )}
        {toEndsWithTon && resolve.status === 'resolved' && (
          <p className="text-xs text-muted-foreground font-mono">{truncateAddress(resolve.address)}</p>
        )}
        {toEndsWithTon && resolve.status === 'error' && <p className="text-xs text-destructive">{resolve.message}</p>}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground" htmlFor="send-amount">
          {t('send.amountLabel')}
        </label>
        <div className="relative">
          <Input
            id="send-amount"
            value={amount}
            onChange={handleAmountChange}
            placeholder="0.0"
            inputMode="decimal"
            className={cn('pr-24', amount && !amountValid && 'border-destructive focus-visible:ring-destructive')}
            aria-invalid={amount ? !amountValid : undefined}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleMax}
              className="text-xs text-primary hover:text-primary/80 font-medium"
            >
              {t('send.max')}
            </button>
            <span className="text-sm text-foreground pointer-events-none">GRAM</span>
          </div>
        </div>
        {amount && !amountValid && <p className="text-xs text-destructive">{t('send.invalidAmount')}</p>}
        {exceedsBalance && <p className="text-xs text-destructive">{t('send.insufficientBalance')}</p>}
        <p className="text-xs text-muted-foreground">{t('send.feeNote', { fee: '~0.01' })}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-medium text-foreground" htmlFor="send-comment">
            {t('send.commentLabel')}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('send.encryptedLabel')}</span>
            <Toggle checked={encryptedComment} onChange={setEncryptedComment} ariaLabel={t('send.encryptedAria')} />
          </div>
        </div>
        <textarea
          id="send-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('send.commentPlaceholder')}
          rows={2}
          spellCheck={false}
          autoComplete="off"
          className={cn(
            'w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground',
            'shadow-sm transition-colors placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            commentTooLong && 'border-destructive focus-visible:ring-destructive'
          )}
          aria-invalid={commentTooLong || undefined}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {t(encryptedComment ? 'send.encryptedNote' : 'send.commentNote')}
          </p>
          <span
            className={cn(
              'text-xs tabular-nums shrink-0',
              commentTooLong ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {commentBytes}/{WALLET_MAX_COMMENT_BYTES}
          </span>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="button" onClick={handleConfirm} disabled={!canProceed} className="w-full">
        <SendActionIcon className="h-4 w-4 mr-1.5" />
        {t('send.reviewButton')}
      </Button>
    </div>
  )
})
