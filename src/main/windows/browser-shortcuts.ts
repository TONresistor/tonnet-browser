import { isDevToolsShortcut } from './devtools'

export type WebContentsInputHandler = (event: Electron.Event, input: Electron.Input) => void

export type BrowserShortcut =
  | { action: 'new-tab' }
  | { action: 'close-tab' }
  | { action: 'reopen-tab' }
  | { action: 'next-tab' }
  | { action: 'previous-tab' }
  | { action: 'select-tab'; index: number }
  | { action: 'history' }
  | { action: 'focus-address' }
  | { action: 'reload' }
  | { action: 'hard-reload' }
  | { action: 'back' }
  | { action: 'forward' }
  | { action: 'stop' }
  | { action: 'zoom-in' }
  | { action: 'zoom-out' }
  | { action: 'zoom-reset' }
  | { action: 'find' }
  | { action: 'devtools' }

function hasExactModifiers(
  input: Electron.Input,
  modifiers: { control?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
): boolean {
  return (
    input.control === Boolean(modifiers.control) &&
    input.shift === Boolean(modifiers.shift) &&
    input.alt === Boolean(modifiers.alt) &&
    input.meta === Boolean(modifiers.meta)
  )
}

export function matchBrowserShortcut(
  input: Electron.Input,
  platform: NodeJS.Platform = process.platform
): BrowserShortcut | null {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.isComposing) return null

  if (isDevToolsShortcut(input, platform)) return { action: 'devtools' }

  if (input.code === 'F5' && !input.alt && !input.meta) {
    if (!input.control && !input.shift) return { action: 'reload' }
    if (input.control !== input.shift) return { action: 'hard-reload' }
    return null
  }

  if (hasExactModifiers(input, {}) && input.code === 'Escape') return { action: 'stop' }

  if (hasExactModifiers(input, { control: true }) && (input.code === 'Tab' || input.key === 'Tab')) {
    return { action: 'next-tab' }
  }
  if (hasExactModifiers(input, { control: true, shift: true }) && (input.code === 'Tab' || input.key === 'Tab')) {
    return { action: 'previous-tab' }
  }

  const primary = platform === 'darwin' ? { meta: true } : { control: true }
  const primaryShift = { ...primary, shift: true }

  if (hasExactModifiers(input, primaryShift) && input.code === 'KeyR') return { action: 'hard-reload' }
  if (hasExactModifiers(input, primary) && input.code === 'KeyR') return { action: 'reload' }
  if (hasExactModifiers(input, primary) && input.code === 'KeyF') return { action: 'find' }
  if (hasExactModifiers(input, primary) && input.code === 'KeyL') return { action: 'focus-address' }
  if (hasExactModifiers(input, primary) && input.code === 'KeyT') return { action: 'new-tab' }
  if (hasExactModifiers(input, primaryShift) && input.code === 'KeyT') return { action: 'reopen-tab' }
  if (hasExactModifiers(input, primary) && input.code === 'KeyW') return { action: 'close-tab' }

  const tabNumber = /^[1-9]$/.test(input.key) ? Number(input.key) : null
  if (tabNumber !== null && hasExactModifiers(input, primary)) return { action: 'select-tab', index: tabNumber }

  if (platform === 'darwin') {
    if (hasExactModifiers(input, { meta: true }) && input.code === 'KeyY') return { action: 'history' }
    if (hasExactModifiers(input, { meta: true, alt: true }) && input.code === 'ArrowLeft') {
      return { action: 'previous-tab' }
    }
    if (hasExactModifiers(input, { meta: true, alt: true }) && input.code === 'ArrowRight') {
      return { action: 'next-tab' }
    }
    if (hasExactModifiers(input, { meta: true }) && (input.code === 'BracketLeft' || input.code === 'ArrowLeft')) {
      return { action: 'back' }
    }
    if (hasExactModifiers(input, { meta: true }) && (input.code === 'BracketRight' || input.code === 'ArrowRight')) {
      return { action: 'forward' }
    }
  } else {
    if (hasExactModifiers(input, { control: true }) && input.code === 'KeyH') return { action: 'history' }
    if (hasExactModifiers(input, { alt: true }) && input.code === 'ArrowLeft') return { action: 'back' }
    if (hasExactModifiers(input, { alt: true }) && input.code === 'ArrowRight') return { action: 'forward' }
  }

  if (
    (hasExactModifiers(input, primary) || hasExactModifiers(input, primaryShift)) &&
    (input.code === 'Equal' || input.code === 'NumpadAdd')
  ) {
    return { action: 'zoom-in' }
  }
  if (hasExactModifiers(input, primary) && (input.code === 'Minus' || input.code === 'NumpadSubtract')) {
    return { action: 'zoom-out' }
  }
  if (hasExactModifiers(input, primary) && (input.code === 'Digit0' || input.code === 'Numpad0')) {
    return { action: 'zoom-reset' }
  }

  return null
}
