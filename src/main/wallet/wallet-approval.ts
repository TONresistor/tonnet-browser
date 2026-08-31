import type { OverlayManager } from '../windows/overlay-manager'
import { getMainWindow } from '../windows/main'
import { WALLET_MAX_COMMENT_BYTES } from '../../shared/constants'
import { normalizeComment } from './comment'

function formatGram(nano: string): string {
  const value = BigInt(nano)
  const whole = value / 1_000_000_000n
  const fraction = (value % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

type WalletTransferApprovalResult =
  | { action: 'approve' | 'cancel' }
  | { action: 'set-memo'; comment?: string }
  | { action: 'set-encryption'; encrypted: boolean }

export function requestWalletTransferApproval(
  overlayManager: OverlayManager,
  transfer: {
    address: string
    amount: string
    domain?: string
    comment?: string
    commentEncrypted?: boolean
    estimatedFee: string
  },
  id = `wallet-transfer-${crypto.randomUUID()}`
): Promise<WalletTransferApprovalResult> {
  return new Promise((resolve) => {
    const window = getMainWindow()
    if (!window) return resolve({ action: 'cancel' })
    const bounds = window.getContentBounds()
    let settled = false

    const finish = (result: WalletTransferApprovalResult, hide = true): void => {
      if (settled) return
      settled = true
      if (hide) overlayManager.hide(id)
      resolve(result)
    }

    const showReview = (memoDraft?: string, memoError?: string): void => {
      const shown = overlayManager.show(
        id,
        { x: 0, y: 0, width: bounds.width, height: bounds.height },
        {
          type: 'approval',
          iconTon: true,
          title: 'Confirm wallet transfer',
          subtitle: transfer.domain ? `Resolved from ${transfer.domain}` : 'TON Browser Wallet',
          amount: `${formatGram(transfer.amount)} GRAM`,
          rows: [
            { label: 'To', value: transfer.address },
            { label: 'Estimated fee', value: `~${formatGram(transfer.estimatedFee)} GRAM` },
            {
              label: 'Memo',
              value: transfer.comment ?? '',
              action: {
                id: 'set-memo',
                label: 'Edit',
                editable: true,
                field: 'memo',
                value: memoDraft ?? transfer.comment ?? '',
                placeholder: 'Add a memo',
                maxBytes: WALLET_MAX_COMMENT_BYTES,
                error: memoError,
                autoEdit: memoDraft !== undefined,
              },
            },
            ...(transfer.comment
              ? [
                  {
                    label: 'Encrypted',
                    toggle: { id: 'set-encryption', checked: Boolean(transfer.commentEncrypted) },
                  },
                ]
              : []),
          ],
          actions: [
            { id: 'deny', label: 'Cancel' },
            { id: 'approve', label: 'Send', primary: true },
          ],
        },
        (actionType, actionData) => {
          if (actionType === 'set-memo') {
            const rawComment =
              actionData &&
              typeof actionData === 'object' &&
              typeof (actionData as { memo?: unknown }).memo === 'string'
                ? (actionData as { memo: string }).memo
                : ''
            try {
              finish({ action: 'set-memo', comment: normalizeComment(rawComment) }, false)
            } catch {
              showReview(rawComment, `Memo must be ${WALLET_MAX_COMMENT_BYTES} bytes or less.`)
            }
            return
          }
          if (actionType === 'set-encryption') {
            const encrypted =
              actionData &&
              typeof actionData === 'object' &&
              typeof (actionData as { enabled?: unknown }).enabled === 'boolean'
                ? (actionData as { enabled: boolean }).enabled
                : null
            if (encrypted === null) {
              showReview()
              return
            }
            finish({ action: 'set-encryption', encrypted }, false)
            return
          }
          finish({ action: actionType === 'approve' ? 'approve' : 'cancel' })
        },
        { autoDismiss: false }
      )
      if (!shown) finish({ action: 'cancel' })
    }

    showReview()
  })
}

export function requestWalletReplacementApproval(
  overlayManager: OverlayManager,
  currentAddress: string,
  replacement: { address: string; version: string }
): Promise<boolean> {
  return new Promise((resolve) => {
    const window = getMainWindow()
    if (!window) return resolve(false)
    const id = `wallet-replace-${crypto.randomUUID()}`
    const bounds = window.getContentBounds()
    const shown = overlayManager.show(
      id,
      { x: 0, y: 0, width: bounds.width, height: bounds.height },
      {
        type: 'approval',
        iconTon: true,
        title: 'Replace active wallet?',
        warning: 'The current encrypted wallet will be preserved as a local recovery backup.',
        rows: [
          { label: 'Current wallet', value: currentAddress || 'Unreadable wallet file' },
          { label: 'New wallet', value: replacement.address },
          { label: 'New account type', value: `${replacement.version} · TON` },
        ],
        actions: [
          { id: 'deny', label: 'Cancel' },
          { id: 'approve', label: 'Replace', primary: true },
        ],
      },
      (actionType) => {
        overlayManager.hide(id)
        resolve(actionType === 'approve')
      },
      { autoDismiss: false }
    )
    if (!shown) resolve(false)
  })
}

export function requestWalletDeletionApproval(overlayManager: OverlayManager, address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const window = getMainWindow()
    if (!window) return resolve(false)
    const id = `wallet-delete-${crypto.randomUUID()}`
    const bounds = window.getContentBounds()
    const shown = overlayManager.show(
      id,
      { x: 0, y: 0, width: bounds.width, height: bounds.height },
      {
        type: 'approval',
        iconTon: true,
        title: 'Permanently delete wallet?',
        warning: 'The active wallet and all local recovery backups will be deleted.',
        rows: [{ label: 'Wallet', value: address || 'Unreadable wallet file' }],
        actions: [
          { id: 'deny', label: 'Cancel' },
          { id: 'approve', label: 'Delete', primary: true },
        ],
      },
      (actionType) => {
        overlayManager.hide(id)
        resolve(actionType === 'approve')
      },
      { autoDismiss: false }
    )
    if (!shown) resolve(false)
  })
}

export function requestWalletForgetApproval(overlayManager: OverlayManager, address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const window = getMainWindow()
    if (!window) return resolve(false)
    const id = `wallet-forget-${crypto.randomUUID()}`
    const bounds = window.getContentBounds()
    const shown = overlayManager.show(
      id,
      { x: 0, y: 0, width: bounds.width, height: bounds.height },
      {
        type: 'approval',
        iconTon: true,
        title: 'Remove wallet from this device?',
        warning: 'You may permanently lose access to its funds without the password or recovery phrase.',
        rows: [
          { label: 'Wallet', value: address || 'Unreadable wallet file' },
          { label: 'Recovery', value: 'Encrypted local copy will be preserved' },
        ],
        actions: [
          { id: 'deny', label: 'Cancel' },
          { id: 'approve', label: 'Remove', primary: true },
        ],
      },
      (actionType) => {
        overlayManager.hide(id)
        resolve(actionType === 'approve')
      },
      { autoDismiss: false }
    )
    if (!shown) resolve(false)
  })
}
