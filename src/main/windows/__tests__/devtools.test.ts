import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { isDevToolsShortcut, resolveDevToolsTarget, toggleDevTools } from '../devtools'

function keyDown(overrides: Partial<Electron.Input> = {}): Electron.Input {
  return {
    type: 'keyDown',
    key: 'i',
    code: 'KeyI',
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    location: 0,
    modifiers: [],
    ...overrides,
  }
}

function stubContents(devToolsOpen = false) {
  return Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    isDevToolsOpened: vi.fn(() => devToolsOpen),
    openDevTools: vi.fn(),
    closeDevTools: vi.fn(),
  })
}

describe('DevTools shortcut matching', () => {
  it('matches the supported physical-key combinations on each platform', () => {
    expect(isDevToolsShortcut(keyDown({ code: 'F12', key: 'F12' }), 'linux')).toBe(true)
    expect(isDevToolsShortcut(keyDown({ control: true, shift: true }), 'win32')).toBe(true)
    expect(isDevToolsShortcut(keyDown({ meta: true, alt: true }), 'darwin')).toBe(true)
  })

  it('is independent of the active keyboard layout', () => {
    expect(isDevToolsShortcut(keyDown({ key: 'ш', control: true, shift: true }), 'linux')).toBe(true)
    expect(isDevToolsShortcut(keyDown({ key: 'ˆ', meta: true, alt: true }), 'darwin')).toBe(true)
  })

  it('rejects releases, repeats, composition, and modified combinations', () => {
    expect(isDevToolsShortcut(keyDown({ type: 'keyUp', code: 'F12', key: 'F12' }), 'linux')).toBe(false)
    expect(isDevToolsShortcut(keyDown({ isAutoRepeat: true, code: 'F12', key: 'F12' }), 'linux')).toBe(false)
    expect(isDevToolsShortcut(keyDown({ isComposing: true, control: true, shift: true }), 'linux')).toBe(false)
    expect(isDevToolsShortcut(keyDown({ control: true, shift: true, alt: true }), 'linux')).toBe(false)
    expect(isDevToolsShortcut(keyDown({ meta: true, alt: true }), 'linux')).toBe(false)
    expect(isDevToolsShortcut(keyDown(), 'darwin')).toBe(false)
  })
})

describe('DevTools target and toggle', () => {
  it('opens detached and closes an already-open target', () => {
    const closed = stubContents()
    toggleDevTools(closed as never)
    expect(closed.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })

    const open = stubContents(true)
    toggleDevTools(open as never)
    expect(open.closeDevTools).toHaveBeenCalledOnce()
  })

  it('targets only an active tab view that is attached and alive', () => {
    const mainContents = stubContents()
    const tabContents = stubContents()
    const view = { webContents: tabContents }
    const window = {
      webContents: mainContents,
      contentView: { children: [view] },
    }

    expect(resolveDevToolsTarget(window as never, view as never)).toBe(tabContents)

    window.contentView.children = []
    expect(resolveDevToolsTarget(window as never, view as never)).toBe(mainContents)

    window.contentView.children = [view]
    tabContents.isDestroyed.mockReturnValue(true)
    expect(resolveDevToolsTarget(window as never, view as never)).toBe(mainContents)
  })
})
