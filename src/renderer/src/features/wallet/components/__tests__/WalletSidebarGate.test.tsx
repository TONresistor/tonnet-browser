// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletSidebarGate } from '../WalletSidebarGate'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}))

describe('WalletSidebarGate', () => {
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

  it('unlocks inline and keeps a full-page footer action', async () => {
    const onOpenFull = vi.fn()
    const onSubmit = vi.fn()
    const onForgotPassword = vi.fn()
    await act(async () => {
      root.render(
        <WalletSidebarGate
          mode="unlock"
          password="wrong password"
          pending={false}
          error="Invalid wallet password"
          onPassword={vi.fn()}
          onSubmit={onSubmit}
          onForgotPassword={onForgotPassword}
          onOpenFull={onOpenFull}
          onClose={vi.fn()}
        />
      )
    })

    expect(container.querySelector('input[type="password"]')).not.toBeNull()
    expect(container.textContent).toContain('Unlock')
    const form = container.querySelector('form')
    const unlockButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Unlock'
    )
    const error = container.querySelector('[role="alert"]')
    expect(form).not.toBeNull()
    expect(unlockButton?.type).toBe('submit')
    expect(unlockButton?.querySelector('[data-ui-icon="secure-lock"]')).not.toBeNull()
    expect(error).not.toBeNull()
    if (!form || !unlockButton || !error) throw new Error('Expected unlock form, submit button, and error message')
    expect(unlockButton.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await act(async () => form.requestSubmit())
    expect(onSubmit).toHaveBeenCalledOnce()

    const forgotPassword = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Forgot password?'
    )
    expect(forgotPassword).toBeDefined()
    await act(async () => forgotPassword?.click())
    expect(onForgotPassword).toHaveBeenCalledOnce()

    const fullPage = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open full wallet')
    )
    expect(fullPage).toBeDefined()
    await act(async () => fullPage?.click())
    expect(onOpenFull).toHaveBeenCalledOnce()
  })
})
