// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TransactionDetailView } from '../TransactionDetailView'
import type { WalletTransaction } from '@shared/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}))

const transaction: WalletTransaction = {
  id: 'tx-1',
  type: 'send',
  amount: '1250000000',
  address: `0:${'11'.repeat(32)}`,
  timestamp: 1_750_000_000_000,
  status: 'confirmed',
  hash: 'transaction-hash',
}

describe('TransactionDetailView', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('renders inside its wallet container instead of a document-level modal', async () => {
    await act(async () => {
      root.render(
        <TransactionDetailView transaction={transaction} selfAddress={`0:${'22'.repeat(32)}`} onBack={vi.fn()} />
      )
    })

    expect(container.textContent).toContain('1.25')
    expect(container.textContent).not.toContain('View on Tonviewer')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it.each([
    { type: 'send' as const, from: `0:${'22'.repeat(32)}`, to: transaction.address },
    { type: 'receive' as const, from: transaction.address, to: `0:${'22'.repeat(32)}` },
    { type: 'x402' as const, from: `0:${'22'.repeat(32)}`, to: transaction.address },
  ])('renders the correct direction for $type transactions', async ({ type, from, to }) => {
    const current = { ...transaction, type, x402Domain: type === 'x402' ? 'example.ton' : undefined }
    await act(async () => {
      root.render(<TransactionDetailView transaction={current} selfAddress={`0:${'22'.repeat(32)}`} onBack={vi.fn()} />)
    })

    const addresses = Array.from(container.querySelectorAll<HTMLButtonElement>('button[title]')).map(
      (button) => button.title
    )
    expect(addresses.slice(0, 2)).toEqual([from, to])
    if (type === 'x402') expect(container.textContent).toContain('example.ton')
  })

  it('returns on Escape', async () => {
    const onBack = vi.fn()
    await act(async () => {
      root.render(
        <TransactionDetailView transaction={transaction} selfAddress={`0:${'22'.repeat(32)}`} onBack={onBack} />
      )
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(onBack).toHaveBeenCalledOnce()
  })

  it('uses the encrypted-comment asset for private comments', async () => {
    await act(async () => {
      root.render(
        <TransactionDetailView
          transaction={{ ...transaction, comment: 'private memo', commentEncrypted: true }}
          selfAddress={`0:${'22'.repeat(32)}`}
          onBack={vi.fn()}
        />
      )
    })

    expect(container.querySelector('[data-ui-icon="secure-lock"]')).not.toBeNull()
  })
})
