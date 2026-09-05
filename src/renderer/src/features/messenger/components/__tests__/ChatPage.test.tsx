// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPage from '../ChatPage'

vi.mock('electron-log/renderer', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

const listeners = new Map<string, Set<(...args: any[]) => void>>()
const ROOM = 'Q'.repeat(43)
const ROOM_STATE = {
  roomId: ROOM,
  name: 'Community',
  description: 'Persistent room',
  writePolicy: 'everyone',
  admins: [],
  moderators: [],
  pinnedMessages: [],
  revisionSeqno: 0,
  latestSeqno: 0,
}
const ROOM_CONNECTION = { nodeRole: 'sequencer' as const }
const ROOM_PRESENCE = { roomId: ROOM, onlineUsers: 1 }

const mockElectron = {
  chat: {
    connect: vi.fn().mockResolvedValue({
      connected: true,
      room: ROOM,
      via: 'dht',
      state: ROOM_STATE,
      connection: ROOM_CONNECTION,
      presence: ROOM_PRESENCE,
      timeline: { items: [], hasMore: false },
    }),
    send: vi.fn(),
    dmSend: vi.fn(),
    mutate: vi.fn(),
    timelineBefore: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    disconnect: vi.fn().mockResolvedValue({ disconnected: true }),
    identity: vi.fn().mockResolvedValue({
      identityKey: 'a'.repeat(43),
      name: '',
    }),
    linkIdentity: vi.fn(),
    claimDomain: vi.fn(),
    clearDomain: vi.fn(),
    detectDomains: vi.fn(),
    resetIdentity: vi.fn(),
  },
  on: vi.fn((channel: string, callback: (...args: any[]) => void) => {
    const set = listeners.get(channel) ?? new Set()
    set.add(callback)
    listeners.set(channel, set)
    return () => {
      set.delete(callback)
    }
  }),
}

describe('ChatPage', () => {
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    vi.clearAllMocks()
    listeners.clear()
    localStorage.clear()
    localStorage.setItem('groupchat.rooms', JSON.stringify([{ room: ROOM }]))
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: mockElectron,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
      root = null
    }
    container.remove()
  })

  it('disconnects the active chat session when unmounted', async () => {
    await act(async () => {
      root?.render(<ChatPage />)
    })

    const row = container.querySelector('[role="option"]') as HTMLElement
    expect(row).toBeTruthy()

    await act(async () => {
      row.click()
    })

    expect(mockElectron.chat.connect).toHaveBeenCalledWith(ROOM, undefined)
    expect(container.textContent).toContain('connected')
    mockElectron.chat.disconnect.mockClear()

    await act(async () => {
      root?.unmount()
    })
    root = null

    expect(mockElectron.chat.disconnect).toHaveBeenCalledTimes(1)
  })

  it('shows a connection error when chat.connect rejects', async () => {
    mockElectron.chat.connect.mockRejectedValueOnce(new Error('Bridge not connected'))

    await act(async () => {
      root?.render(<ChatPage />)
    })

    const row = container.querySelector('[role="option"]') as HTMLElement
    await act(async () => {
      row.click()
    })

    expect(container.textContent).toContain('Bridge not connected')
  })

  it('keeps the TON DNS alias visible while resolving the canonical room', async () => {
    localStorage.setItem('groupchat.rooms', JSON.stringify([{ room: ROOM, alias: 'groupchat.ton' }]))
    let resolveConnect!: (value: Awaited<ReturnType<typeof mockElectron.chat.connect>>) => void
    mockElectron.chat.connect.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConnect = resolve
      })
    )

    await act(async () => {
      root?.render(<ChatPage />)
    })

    const row = container.querySelector('[role="option"]') as HTMLElement
    await act(async () => {
      row.click()
    })

    expect(container.querySelector('[title="groupchat.ton"]')).toBeTruthy()
    expect(container.querySelector(`[title="${ROOM}"]`)).toBeNull()

    await act(async () => {
      resolveConnect({
        connected: true,
        room: ROOM,
        via: 'dht',
        state: ROOM_STATE,
        connection: ROOM_CONNECTION,
        presence: ROOM_PRESENCE,
        timeline: { items: [], hasMore: false },
      })
    })

    expect(container.querySelector('[title="Community"]')).toBeTruthy()
  })

  it('updates node-local presence independently from room state', async () => {
    await act(async () => {
      root?.render(<ChatPage />)
    })
    const row = container.querySelector('[role="option"]') as HTMLElement
    await act(async () => {
      row.click()
    })
    expect(container.textContent).toContain('1 online')

    await act(async () => {
      for (const listener of listeners.get('chat:room-presence') ?? []) {
        listener({ roomId: ROOM, onlineUsers: 4 })
      }
    })
    expect(container.textContent).toContain('4 online')
  })
})
