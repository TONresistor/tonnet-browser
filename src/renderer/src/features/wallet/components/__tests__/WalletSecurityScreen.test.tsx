// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletSecurityScreen } from '../WalletSecurityScreen'

describe('WalletSecurityScreen', () => {
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

  it('submits unlock through the form and renders the error below the button', async () => {
    const onSubmit = vi.fn()
    await act(async () => {
      root.render(
        <WalletSecurityScreen
          mode="unlock"
          password="wrong password"
          error="Invalid wallet password"
          onPasswordChange={vi.fn()}
          onSubmit={onSubmit}
        />
      )
    })

    const form = container.querySelector('form')
    const button = container.querySelector('button[type="submit"]')
    const error = container.querySelector('[role="alert"]')
    expect(form).not.toBeNull()
    expect(button).not.toBeNull()
    expect(button?.querySelector('[data-ui-icon="secure-lock"]')).not.toBeNull()
    expect(error).not.toBeNull()
    if (!form || !button || !error) throw new Error('Expected unlock form, submit button, and error message')
    expect(button.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await act(async () => form.requestSubmit())
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('opens password recovery and can reveal the wallet password', async () => {
    const onForgotPassword = vi.fn()
    await act(async () => {
      root.render(
        <WalletSecurityScreen
          mode="unlock"
          password="secret password"
          onPasswordChange={vi.fn()}
          onSubmit={vi.fn()}
          onForgotPassword={onForgotPassword}
        />
      )
    })

    const input = container.querySelector('input')
    const reveal = container.querySelector('button[aria-label="Show wallet password"]')
    const forgot = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Forgot password?'
    )
    expect(input?.type).toBe('password')
    expect(reveal).not.toBeNull()
    expect(forgot).toBeDefined()

    await act(async () => reveal?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(input?.type).toBe('text')

    await act(async () => forgot?.click())
    expect(onForgotPassword).toHaveBeenCalledOnce()
  })
})
