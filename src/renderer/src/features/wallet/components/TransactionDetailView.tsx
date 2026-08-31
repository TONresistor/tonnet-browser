import { useEffect } from 'react'
import { ArrowUp, ArrowDown, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTonAmount } from '@/lib/ton-utils'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { AddressChip } from '@/components/ui/ios/AddressChip'
import { useTranslation } from 'react-i18next'
import type { WalletTransaction } from '@shared/types'
import type { ReactNode } from 'react'
import { SecureLockIcon } from '@/components/ui/SecureLockIcon'

interface TransactionDetailViewProps {
  transaction: WalletTransaction
  selfAddress: string
  onBack: () => void
  density?: 'compact' | 'regular'
}

function DetailRow({ label, children, compact }: { label: string; children: ReactNode; compact: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-b border-border-subtle last:border-0',
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      )}
    >
      <span className={cn('shrink-0 text-muted-foreground', compact ? 'text-[12px]' : 'text-[13px]')}>{label}</span>
      <span className={cn('min-w-0 truncate text-right text-card-foreground', compact ? 'text-[13px]' : 'text-[14px]')}>
        {children}
      </span>
    </div>
  )
}

export function TransactionDetailView({
  transaction,
  selfAddress,
  onBack,
  density = 'regular',
}: TransactionDetailViewProps) {
  const { t, i18n } = useTranslation('wallet')
  const compact = density === 'compact'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const isReceive = transaction.type === 'receive'
  const isX402 = transaction.type === 'x402'
  const Icon = isX402 ? Globe : isReceive ? ArrowDown : ArrowUp
  const amountColor = isReceive ? 'text-success' : 'text-foreground'
  const amountPrefix = isReceive ? '+' : '-'
  const from = isReceive ? transaction.address : selfAddress
  const to = isReceive ? selfAddress : transaction.address

  return (
    <section className="min-w-0" aria-label={t(`history.types.${transaction.type}`)}>
      <div
        className={cn('flex flex-col items-center gap-2 text-center', compact ? 'px-1 pb-4 pt-1' : 'px-5 pb-5 pt-2')}
      >
        <div
          className={cn(
            'flex items-center justify-center rounded-full',
            compact ? 'h-10 w-10' : 'h-12 w-12',
            isReceive ? 'bg-success' : 'bg-primary'
          )}
        >
          <Icon
            className={cn('text-identity-foreground', compact ? 'h-5 w-5' : 'h-6 w-6')}
            strokeWidth={2.5}
            aria-hidden="true"
          />
        </div>
        <p className="text-[13px] font-medium text-muted-foreground">{t(`history.types.${transaction.type}`)}</p>
        <p
          className={cn(
            'max-w-full break-all font-bold leading-none tabular-nums',
            compact ? 'text-[26px]' : 'text-[32px]',
            amountColor
          )}
        >
          {amountPrefix}
          {formatTonAmount(transaction.amount)}
          <span className={cn('ml-1.5 font-semibold text-muted-foreground', compact ? 'text-base' : 'text-xl')}>
            GRAM
          </span>
        </p>
      </div>

      <div className="space-y-4">
        <InsetGroup>
          <DetailRow label={t('detail.from', { defaultValue: 'From' })} compact={compact}>
            <AddressChip address={from} startChars={8} endChars={6} className="bg-transparent px-0" />
          </DetailRow>
          <DetailRow label={t('detail.to', { defaultValue: 'To' })} compact={compact}>
            <AddressChip address={to} startChars={8} endChars={6} className="bg-transparent px-0" />
          </DetailRow>
          {isX402 && transaction.x402Domain && (
            <DetailRow label={t('detail.site', { defaultValue: 'Site' })} compact={compact}>
              {transaction.x402Domain}
            </DetailRow>
          )}
          {transaction.comment && (
            <DetailRow label={t('detail.comment', { defaultValue: 'Comment' })} compact={compact}>
              {transaction.comment}
            </DetailRow>
          )}
          {transaction.commentEncrypted && (
            <DetailRow label={t('detail.privacy', { defaultValue: 'Privacy' })} compact={compact}>
              <span className="inline-flex items-center gap-1">
                <SecureLockIcon className="h-3.5 w-3.5" />
                {t('send.encryptedLabel')}
              </span>
            </DetailRow>
          )}
        </InsetGroup>

        <InsetGroup>
          {transaction.fee && (
            <DetailRow label={t('detail.fee', { defaultValue: 'Network fee' })} compact={compact}>
              {formatTonAmount(transaction.fee)} GRAM
            </DetailRow>
          )}
          <DetailRow label={t('detail.date', { defaultValue: 'Date' })} compact={compact}>
            {new Date(transaction.timestamp).toLocaleString(i18n.language)}
          </DetailRow>
          <DetailRow label={t('detail.status', { defaultValue: 'Status' })} compact={compact}>
            {t(`history.status.${transaction.status}`)}
          </DetailRow>
          {transaction.hash && (
            <DetailRow label={t('detail.hash', { defaultValue: 'Hash' })} compact={compact}>
              <AddressChip
                address={transaction.hash}
                startChars={8}
                endChars={8}
                label={t('detail.copyHash', { defaultValue: 'Copy hash' })}
                className="bg-transparent px-0"
              />
            </DetailRow>
          )}
        </InsetGroup>
      </div>
    </section>
  )
}
