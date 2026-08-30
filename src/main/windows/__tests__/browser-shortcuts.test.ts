import { describe, expect, it } from 'vitest'
import { matchBrowserShortcut } from '../browser-shortcuts'

function input(overrides: Partial<Electron.Input>): Electron.Input {
  return {
    type: 'keyDown',
    key: '',
    code: '',
    isAutoRepeat: false,
    isComposing: false,
    control: false,
    shift: false,
    alt: false,
    meta: false,
    location: 0,
    modifiers: [],
    ...overrides,
  }
}

describe('browser shortcut matching', () => {
  it.each([
    ['F5', input({ key: 'F5', code: 'F5' }), 'reload'],
    ['Ctrl+R', input({ key: 'r', code: 'KeyR', control: true }), 'reload'],
    ['Ctrl+F5', input({ key: 'F5', code: 'F5', control: true }), 'hard-reload'],
    ['Shift+F5', input({ key: 'F5', code: 'F5', shift: true }), 'hard-reload'],
    ['Ctrl+Shift+R', input({ key: 'R', code: 'KeyR', control: true, shift: true }), 'hard-reload'],
    ['Ctrl+F', input({ key: 'f', code: 'KeyF', control: true }), 'find'],
    ['Alt+Left', input({ key: 'ArrowLeft', code: 'ArrowLeft', alt: true }), 'back'],
    ['Ctrl+9', input({ key: '9', code: 'Digit9', control: true }), 'select-tab'],
  ])('matches %s on Windows/Linux', (_label, event, action) => {
    expect(matchBrowserShortcut(event, 'linux')).toMatchObject({ action })
  })

  it.each([
    ['Cmd+R', input({ key: 'r', code: 'KeyR', meta: true }), 'reload'],
    ['Cmd+Shift+R', input({ key: 'R', code: 'KeyR', meta: true, shift: true }), 'hard-reload'],
    ['Cmd+F', input({ key: 'f', code: 'KeyF', meta: true }), 'find'],
    ['Cmd+[', input({ key: '[', code: 'BracketLeft', meta: true }), 'back'],
    ['Cmd+Right', input({ key: 'ArrowRight', code: 'ArrowRight', meta: true }), 'forward'],
    ['Cmd+Option+Left', input({ key: 'ArrowLeft', code: 'ArrowLeft', meta: true, alt: true }), 'previous-tab'],
    ['Cmd+9', input({ key: '9', code: 'Digit9', meta: true }), 'select-tab'],
    ['Cmd+Y', input({ key: 'y', code: 'KeyY', meta: true }), 'history'],
  ])('matches %s on macOS', (_label, event, action) => {
    expect(matchBrowserShortcut(event, 'darwin')).toMatchObject({ action })
  })

  it('distinguishes a numbered tab from the last tab', () => {
    expect(matchBrowserShortcut(input({ key: '8', code: 'Digit8', control: true }), 'win32')).toEqual({
      action: 'select-tab',
      index: 8,
    })
    expect(matchBrowserShortcut(input({ key: '9', code: 'Digit9', control: true }), 'win32')).toEqual({
      action: 'select-tab',
      index: 9,
    })
  })

  it('leaves OS and modified shortcuts untouched', () => {
    expect(matchBrowserShortcut(input({ key: 'h', code: 'KeyH', meta: true }), 'darwin')).toBeNull()
    expect(matchBrowserShortcut(input({ key: 'W', code: 'KeyW', control: true, shift: true }), 'linux')).toBeNull()
    expect(matchBrowserShortcut(input({ key: 'r', code: 'KeyR', control: true, alt: true }), 'linux')).toBeNull()
    expect(matchBrowserShortcut(input({ key: 'F5', code: 'F5', isAutoRepeat: true }), 'linux')).toBeNull()
  })
})
