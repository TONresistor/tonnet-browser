// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPage from '../ChatPage'
import { useMessengerRuntime } from '../../useMessengerRuntime'
import { useDirectMessageStore } from '../../direct-message-store'

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
    leave: vi.fn().mockResolvedValue({ left: true }),
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

function Application({ showChat = true }: { showChat?: boolean }) {
  useMessengerRuntime()
  return showChat ? <ChatPage /> : null
}

describe('ChatPage', () => {
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    useDirectMessageStore.setState({ conversations: {}, identityKey: null })
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
    vi.unstubAllGlobals()
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
    expect(mockElectron.chat.leave).not.toHaveBeenCalled()
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
    expect(mockElectron.chat.connect).toHaveBeenCalledOnce()
  })

  it('does not rejoin after canonicalizing a DNS-only favorite', async () => {
    localStorage.setItem('groupchat.rooms', JSON.stringify([{ room: 'community.ton' }]))
    await act(async () => {
      root?.render(<ChatPage />)
    })
    await act(async () => {
      ;(container.querySelector('[role="option"]') as HTMLElement).click()
    })
    expect(mockElectron.chat.connect).toHaveBeenCalledOnce()
    expect(mockElectron.chat.connect).toHaveBeenCalledWith('community.ton', undefined)
    expect(container.textContent).toContain('connected')
    expect(JSON.parse(localStorage.getItem('messenger.rooms.v1')!)).toEqual([
      expect.objectContaining({ room: ROOM, alias: 'community.ton' }),
    ])
  })

  it('ignores a late join after switching to another room', async () => {
    const other = 'R'.repeat(43)
    localStorage.setItem('groupchat.rooms', JSON.stringify([{ room: ROOM }, { room: other }]))
    let completeFirst!: (value: unknown) => void
    mockElectron.chat.connect.mockReturnValueOnce(
      new Promise((resolve) => {
        completeFirst = resolve
      })
    )
    mockElectron.chat.connect.mockResolvedValueOnce({
      connected: true,
      room: other,
      via: 'dht',
      state: { ...ROOM_STATE, roomId: other, name: 'Second room' },
      connection: ROOM_CONNECTION,
      presence: { ...ROOM_PRESENCE, roomId: other },
      timeline: { items: [], hasMore: false },
    })
    await act(async () => {
      root?.render(<ChatPage />)
    })
    const rows = container.querySelectorAll('[role="option"]')
    await act(async () => {
      ;(rows[0] as HTMLElement).click()
    })
    await act(async () => {
      ;(rows[1] as HTMLElement).click()
    })
    await act(async () => {
      completeFirst({
        connected: true,
        room: ROOM,
        via: 'dht',
        state: ROOM_STATE,
        connection: ROOM_CONNECTION,
        presence: ROOM_PRESENCE,
        timeline: { items: [], hasMore: false },
      })
    })
    expect(container.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain('Second room')
    expect(mockElectron.chat.connect).toHaveBeenCalledTimes(2)
    expect(mockElectron.chat.leave).not.toHaveBeenCalled()
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

  it('preserves received DMs when the Messenger view is unmounted', async () => {
    await act(async () => {
      root?.render(<Application />)
    })
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Messages')!
        .click()
    })
    await act(async () => {
      for (const listener of listeners.get('chat:dm') ?? [])
        listener({
          room: ROOM,
          id: 'D'.repeat(43),
          peerKey: 'B'.repeat(43),
          text: 'private message',
          ts: 1_788_553_280_000,
          direction: 'received',
          identity: { tier: 'identity', name: 'Bob' },
        })
    })
    expect(container.textContent).toContain('Bob')
    await act(async () => {
      root?.render(<Application showChat={false} />)
    })
    expect(listeners.get('chat:dm')?.size).toBe(1)
    await act(async () => {
      for (const listener of listeners.get('chat:dm') ?? [])
        listener({
          room: ROOM,
          id: 'E'.repeat(43),
          peerKey: 'B'.repeat(43),
          text: 'received while browsing',
          ts: 1_788_553_281_000,
          direction: 'received',
          identity: { tier: 'identity', name: 'Bob' },
        })
    })
    await act(async () => {
      root?.render(<Application />)
    })
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Messages')!
        .click()
    })
    expect(container.textContent).toContain('Bob')
    expect(
      useDirectMessageStore.getState().conversations['B'.repeat(43)].messages.map((message) => message.text)
    ).toEqual(['private message', 'received while browsing'])
    await act(async () => {
      root?.render(null)
    })
    expect(listeners.get('chat:dm')?.size).toBe(0)
    expect(mockElectron.chat.identity).toHaveBeenCalledTimes(2)
  })

  it('receives DMs before opening Messenger and scopes them to the client identity', async () => {
    await act(async () => {
      root?.render(<Application showChat={false} />)
    })
    expect(mockElectron.chat.identity).not.toHaveBeenCalled()
    const changeIdentity = (key: string) => {
      for (const listener of listeners.get('chat:identity-changed') ?? []) listener({ identityKey: key, name: 'Alice' })
    }
    await act(async () => {
      changeIdentity('A'.repeat(43))
      for (const listener of listeners.get('chat:dm') ?? [])
        listener({
          room: ROOM,
          id: 'D'.repeat(43),
          peerKey: 'B'.repeat(43),
          text: 'arrived before opening',
          ts: 1_788_553_280_000,
          direction: 'received',
          identity: { tier: 'identity', name: 'Bob' },
        })
      changeIdentity('A'.repeat(43))
    })
    expect(useDirectMessageStore.getState().conversations['B'.repeat(43)].messages).toHaveLength(1)
    await act(async () => {
      changeIdentity('C'.repeat(43))
    })
    expect(useDirectMessageStore.getState().conversations).toEqual({})
  })

  it('accepts canonical recovery after an alias join fails', async () => {
    localStorage.setItem('groupchat.rooms', JSON.stringify([{ room: 'community.ton' }]))
    mockElectron.chat.connect.mockRejectedValueOnce(new Error('Temporary node failure'))
    await act(async () => {
      root?.render(<ChatPage />)
    })
    await act(async () => {
      ;(container.querySelector('[role="option"]') as HTMLElement).click()
    })
    await act(async () => {
      for (const listener of listeners.get('chat:connection') ?? [])
        listener({
          room: ROOM,
          reference: 'another.ton',
          status: 'connected',
          state: ROOM_STATE,
          connection: ROOM_CONNECTION,
          presence: ROOM_PRESENCE,
          timeline: { items: [], hasMore: false },
        })
    })
    expect(container.textContent).toContain('Temporary node failure')
    await act(async () => {
      for (const listener of listeners.get('chat:connection') ?? [])
        listener({
          room: ROOM,
          reference: 'community.ton',
          status: 'connected',
          state: ROOM_STATE,
          connection: ROOM_CONNECTION,
          presence: ROOM_PRESENCE,
          timeline: { items: [], hasMore: false },
        })
    })
    expect(container.textContent).not.toContain('Temporary node failure')
    expect(container.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain('Community')
    expect(mockElectron.chat.connect).toHaveBeenCalledOnce()
  })

  it('retries an unchanged room selection after resolution fails', async () => {
    mockElectron.chat.connect.mockRejectedValueOnce(new Error('Temporary DNS failure'))
    await act(async () => {
      root?.render(<ChatPage />)
    })
    await act(async () => {
      ;(container.querySelector('[role="option"]') as HTMLElement).click()
    })
    await act(async () => {
      ;(container.querySelector('[role="option"]') as HTMLElement).click()
    })
    expect(mockElectron.chat.connect).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('Temporary DNS failure')
  })

  it('keeps fully paginated history when a live message arrives', async () => {
    const item = (seqno: number) => ({
      room: ROOM,
      eventId: `event-${seqno}`,
      seqno,
      ts: 1_788_553_280_000,
      actorKey: 'B'.repeat(43),
      kind: 'message',
      messageId: String(seqno),
      nick: 'Bob',
      text: `history-message-${seqno}-end`,
      self: false,
      identity: { tier: 'identity', name: 'Bob' },
    })
    mockElectron.chat.connect.mockResolvedValueOnce({
      connected: true,
      room: ROOM,
      via: 'dht',
      state: ROOM_STATE,
      connection: ROOM_CONNECTION,
      presence: ROOM_PRESENCE,
      timeline: { items: Array.from({ length: 100 }, (_, index) => item(index + 501)), hasMore: true },
    })
    for (let page = 4; page >= 0; page--)
      mockElectron.chat.timelineBefore.mockResolvedValueOnce({
        items: Array.from({ length: 100 }, (_, index) => item(page * 100 + index + 1)),
        hasMore: page > 0,
      })
    await act(async () => {
      root?.render(<ChatPage />)
    })
    await act(async () => {
      ;(container.querySelector('[role="option"]') as HTMLElement).click()
    })
    for (let page = 0; page < 5; page++) {
      const load = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Load older')
      )
      expect(load).toBeTruthy()
      await act(async () => {
        load!.click()
      })
    }
    expect(container.textContent).toContain('history-message-1-end')
    await act(async () => {
      for (const listener of listeners.get('chat:timeline') ?? []) listener(item(601))
    })
    expect(container.textContent).toContain('history-message-1-end')
    expect(container.textContent).toContain('history-message-601-end')
  })
})
