// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPage from '../ChatPage'
import { useMessengerRuntime } from '../../useMessengerRuntime'
import { useDirectMessageStore } from '../../direct-message-store'

const qr = vi.hoisted(() => ({ toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,cXI=') }))
vi.mock('qrcode', () => ({ default: qr }))

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
const PENDING = {
  room: ROOM,
  eventId: 'P'.repeat(43),
  status: 'uncertain' as const,
  ts: 1_788_553_280_000,
  kind: 'message' as const,
  summary: 'original pending message',
  text: 'original pending message',
}
const RECOVERED = {
  room: ROOM,
  eventId: PENDING.eventId,
  seqno: 1,
  ts: 1_788_553_280_000,
  actorKey: 'a'.repeat(43),
  kind: 'message' as const,
  messageId: '1',
  nick: 'Alice',
  text: 'original pending message',
  self: true,
  identity: { tier: 'identity' as const, name: 'Alice' },
}

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
      pending: null,
    }),
    send: vi.fn(),
    dmSend: vi.fn(),
    mutate: vi.fn(),
    pending: vi.fn().mockResolvedValue({ pending: null }),
    retryPending: vi.fn().mockResolvedValue({ item: RECOVERED }),
    discardPending: vi.fn().mockResolvedValue({ discarded: true }),
    timelineBefore: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    disconnect: vi.fn().mockResolvedValue({ disconnected: true }),
    leave: vi.fn().mockResolvedValue({ left: true }),
    identity: vi.fn().mockResolvedValue({
      identityKey: 'a'.repeat(43),
      name: '',
    }),
    linkIdentity: vi.fn(),
    claimDomain: vi.fn(),
    prepareDomainLink: vi.fn(),
    openDomainLink: vi.fn().mockResolvedValue({ opened: true }),
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

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ChatPage', () => {
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    useDirectMessageStore.setState({ conversations: {}, identityKey: null })
    vi.clearAllMocks()
    mockElectron.chat.claimDomain.mockReset()
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
    vi.useRealTimers()
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

  it('shows manual DNS instructions only on request and copies category and value separately', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await act(async () => root?.render(<ChatPage />))
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Profile')!
        .click()
    })
    expect(container.textContent).not.toContain('Required DNS record')
    expect(container.querySelector('[aria-label="Copy DNS value"]')).toBeNull()
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Add manually')!
        .click()
    )
    expect(container.querySelector('a[href="https://t.me/resistancetoolsbot"]')).not.toBeNull()
    expect(container.textContent).toContain('Add record → Text')
    const category = container.querySelector('[aria-label="Copy DNS category"]') as HTMLButtonElement
    const value = container.querySelector('[aria-label="Copy DNS value"]') as HTMLButtonElement
    await act(async () => category.click())
    expect(writeText).toHaveBeenLastCalledWith('msg_id')
    await act(async () => value.click())
    expect(writeText).toHaveBeenLastCalledWith('a'.repeat(43))
    expect(value.title).toBe('Copied')
  })

  it.each(['alice.ton', 'team_member.t.me'])(
    'keeps the %s transaction available until DNS verification succeeds',
    async (domain) => {
      const txUrl = `ton://transfer/${'E'.repeat(48)}?bin=abc&amount=20000000`
      const identity = { identityKey: 'a'.repeat(43), name: '' }
      mockElectron.chat.prepareDomainLink.mockResolvedValueOnce({
        domain,
        category: 'msg_id',
        key: identity.identityKey,
        owner: 'owner',
        txUrl,
      })
      let resolveVerification!: (value: unknown) => void
      mockElectron.chat.claimDomain.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveVerification = resolve
        })
      )
      mockElectron.chat.claimDomain.mockResolvedValueOnce({ ok: true, identity: { ...identity, domain } })
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
      const button = (label: string) =>
        Array.from(container.querySelectorAll('button')).find((element) => element.textContent === label)!
      await act(async () => root?.render(<ChatPage />))
      await act(async () => button('Profile').click())
      await changeInput(container.querySelector('[aria-label="TON domain"]')!, ` ${domain.toUpperCase()} `)
      vi.useFakeTimers()
      const verificationStart = Date.now()
      await act(async () =>
        container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      )
      expect(mockElectron.chat.prepareDomainLink).toHaveBeenCalledWith(domain)
      await vi.waitFor(() => expect(qr.toDataURL).toHaveBeenCalledWith(txUrl, expect.any(Object)))
      expect(mockElectron.chat.claimDomain).not.toHaveBeenCalled()
      expect(container.textContent).not.toContain('Linked')
      await act(async () => button('Copy transaction link').click())
      expect(writeText).toHaveBeenCalledWith(txUrl)
      await act(async () => button('Open in wallet').click())
      expect(mockElectron.chat.openDomainLink).toHaveBeenCalledWith(txUrl)
      await act(async () => button('Add manually').click())
      await act(async () => button('Back to QR code').click())
      await act(async () => vi.advanceTimersByTimeAsync(4999 - (Date.now() - verificationStart)))
      expect(mockElectron.chat.claimDomain).not.toHaveBeenCalled()
      await act(async () => vi.advanceTimersByTimeAsync(1))
      expect(mockElectron.chat.claimDomain).toHaveBeenCalledTimes(1)
      await act(async () => vi.advanceTimersByTimeAsync(20_000))
      expect(mockElectron.chat.claimDomain).toHaveBeenCalledTimes(1)
      await act(async () =>
        resolveVerification({ ok: false, reason: 'identity domain does not resolve to this identity', identity })
      )
      expect(container.textContent).toContain('Waiting for confirmation')
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(container.querySelector('img[alt="Scan to update the domain DNS record"]')).not.toBeNull()
      await act(async () => vi.advanceTimersByTimeAsync(5000))
      expect(mockElectron.chat.claimDomain).toHaveBeenLastCalledWith(domain)
      expect(container.textContent).not.toContain('Linked')
      expect(container.textContent).toContain('Remove')
      expect(container.querySelector('img[alt="Scan to update the domain DNS record"]')).toBeNull()
      await act(async () => vi.advanceTimersByTimeAsync(15_000))
      expect(mockElectron.chat.claimDomain).toHaveBeenCalledTimes(2)
    }
  )

  it('bounds manual verification to ten minutes and stops when leaving the flow', async () => {
    mockElectron.chat.claimDomain.mockResolvedValue({
      ok: false,
      reason: 'identity domain does not resolve to this identity',
    })
    const button = (label: string) =>
      Array.from(container.querySelectorAll('button')).find((element) => element.textContent === label)!
    await act(async () => root?.render(<ChatPage />))
    await act(async () => button('Profile').click())
    vi.useFakeTimers()
    await changeInput(container.querySelector('[aria-label="TON domain"]')!, 'alice.ton')
    await act(async () => button('Add manually').click())
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1000))
    expect(button('Retry verification')).toBeDefined()
    const attempts = mockElectron.chat.claimDomain.mock.calls.length
    await act(async () => vi.advanceTimersByTimeAsync(15_000))
    expect(mockElectron.chat.claimDomain).toHaveBeenCalledTimes(attempts)
    await act(async () => button('Retry verification').click())
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(mockElectron.chat.claimDomain).toHaveBeenCalledTimes(attempts + 1)
    await act(async () => root?.unmount())
    root = null
    await act(async () => vi.advanceTimersByTimeAsync(15_000))
    expect(mockElectron.chat.claimDomain).toHaveBeenCalledTimes(attempts + 1)
  })

  it('ignores a prepared transaction returned after an identity reset', async () => {
    let resolve!: (value: unknown) => void
    mockElectron.chat.prepareDomainLink.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    await act(async () => root?.render(<ChatPage />))
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((element) => element.textContent === 'Profile')!
        .click()
    )
    await changeInput(container.querySelector('[aria-label="TON domain"]')!, 'alice.ton')
    await act(async () =>
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
    await act(async () => {
      for (const listener of listeners.get('chat:identity-changed') ?? [])
        listener({ identityKey: 'b'.repeat(43), name: '' })
    })
    await act(async () => resolve({ domain: 'alice.ton', key: 'a'.repeat(43), txUrl: 'stale transaction' }))
    expect(qr.toDataURL).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="TON domain"]')).not.toBeNull()
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
        pending: null,
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
      pending: null,
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
        pending: null,
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
          pending: null,
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
          pending: null,
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
      pending: null,
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

  it('restores a pending operation and retries it without changing the draft', async () => {
    mockElectron.chat.connect.mockResolvedValueOnce({
      connected: true,
      room: ROOM,
      via: 'dht',
      state: ROOM_STATE,
      connection: ROOM_CONNECTION,
      presence: ROOM_PRESENCE,
      timeline: { items: [], hasMore: false },
      pending: PENDING,
    })
    await act(async () => root?.render(<ChatPage />))
    await act(async () => (container.querySelector('[role="option"]') as HTMLElement).click())
    const input = container.querySelector('[aria-label="message"]') as HTMLInputElement
    await changeInput(input, 'new draft')
    expect(container.textContent).toContain('Delivery result unknown')
    expect(container.textContent).toContain(PENDING.summary)

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Retry exact operation'))!
        .click()
    })

    expect(mockElectron.chat.retryPending).toHaveBeenCalledWith(ROOM, PENDING.eventId)
    expect(input.value).toBe('new draft')
    expect(container.textContent).not.toContain('Delivery result unknown')
    expect(container.textContent).toContain(RECOVERED.text)
  })

  it('marks a pending operation committed when its canonical event arrives', async () => {
    mockElectron.chat.connect.mockResolvedValueOnce({
      connected: true,
      room: ROOM,
      via: 'dht',
      state: ROOM_STATE,
      connection: ROOM_CONNECTION,
      presence: ROOM_PRESENCE,
      timeline: { items: [], hasMore: false },
      pending: PENDING,
    })
    await act(async () => root?.render(<ChatPage />))
    await act(async () => (container.querySelector('[role="option"]') as HTMLElement).click())
    await act(async () => {
      for (const listener of listeners.get('chat:timeline') ?? []) listener(RECOVERED)
    })
    expect(container.textContent).toContain('Operation confirmed')
    expect(container.textContent).not.toContain('Delivery result unknown')
  })

  it('does not unfollow the current room while pending recovery exists', async () => {
    mockElectron.chat.connect.mockResolvedValueOnce({
      connected: true,
      room: ROOM,
      via: 'dht',
      state: ROOM_STATE,
      connection: ROOM_CONNECTION,
      presence: ROOM_PRESENCE,
      timeline: { items: [], hasMore: false },
      pending: PENDING,
    })
    await act(async () => root?.render(<ChatPage />))
    await act(async () => (container.querySelector('[role="option"]') as HTMLElement).click())
    await act(async () => {
      ;(container.querySelector('[aria-label^="Unfollow"]') as HTMLElement).click()
    })
    expect(mockElectron.chat.leave).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Resolve the pending operation before unfollowing this room.')
    expect(container.querySelector('[role="option"]')).toBeTruthy()
  })

  it('requires confirmation before discarding pending tracking and preserves the draft', async () => {
    mockElectron.chat.connect.mockResolvedValueOnce({
      connected: true,
      room: ROOM,
      via: 'dht',
      state: ROOM_STATE,
      connection: ROOM_CONNECTION,
      presence: ROOM_PRESENCE,
      timeline: { items: [], hasMore: false },
      pending: PENDING,
    })
    await act(async () => root?.render(<ChatPage />))
    await act(async () => (container.querySelector('[role="option"]') as HTMLElement).click())
    const input = container.querySelector('[aria-label="message"]') as HTMLInputElement
    await changeInput(input, 'draft kept during discard')

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Discard tracking'))!
        .click()
    })
    expect(mockElectron.chat.discardPending).not.toHaveBeenCalled()
    expect(container.textContent).toContain('This does not cancel a possible commit.')

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Confirm discard'))!
        .click()
    })
    expect(mockElectron.chat.discardPending).toHaveBeenCalledWith(ROOM, PENDING.eventId)
    expect(input.value).toBe('draft kept during discard')
    expect(container.textContent).not.toContain('Delivery result unknown')
  })

  it('loads pending recovery after an uncertain send without overwriting newer typing', async () => {
    let rejectSend!: (reason: Error) => void
    mockElectron.chat.send.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectSend = reject
      })
    )
    mockElectron.chat.pending.mockResolvedValueOnce({ pending: PENDING })
    await act(async () => root?.render(<ChatPage />))
    await act(async () => (container.querySelector('[role="option"]') as HTMLElement).click())
    const input = container.querySelector('[aria-label="message"]') as HTMLInputElement
    await changeInput(input, 'original pending message')
    await act(async () => {
      ;(container.querySelector('[aria-label="Send"]') as HTMLElement).click()
    })
    await changeInput(input, 'newer draft')
    await act(async () => rejectSend(new Error('Delivery outcome is unknown')))

    expect(mockElectron.chat.pending).toHaveBeenCalledWith(ROOM)
    expect(input.value).toBe('newer draft')
    expect(container.textContent).toContain('Delivery result unknown')
  })

  it('does not show a previous room send error after a delayed pending refresh', async () => {
    const otherRoom = 'R'.repeat(43)
    localStorage.setItem('groupchat.rooms', JSON.stringify([{ room: ROOM }, { room: otherRoom }]))
    let resolvePending!: (value: { pending: null }) => void
    mockElectron.chat.pending.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePending = resolve
      })
    )
    mockElectron.chat.send.mockRejectedValueOnce(new Error('Previous room send failed'))
    await act(async () => root?.render(<ChatPage />))
    await act(async () => (container.querySelectorAll('[role="option"]')[0] as HTMLElement).click())
    await changeInput(container.querySelector('[aria-label="message"]')!, 'hello')
    await act(async () => (container.querySelector('[aria-label="Send"]') as HTMLButtonElement).click())
    expect(mockElectron.chat.pending).toHaveBeenCalledWith(ROOM)
    mockElectron.chat.connect.mockResolvedValueOnce({
      connected: true,
      room: otherRoom,
      via: 'dht',
      state: { ...ROOM_STATE, roomId: otherRoom },
      connection: ROOM_CONNECTION,
      presence: { ...ROOM_PRESENCE, roomId: otherRoom },
      timeline: { items: [], hasMore: false },
      pending: null,
    })
    await act(async () => (container.querySelectorAll('[role="option"]')[1] as HTMLElement).click())
    await act(async () => resolvePending({ pending: null }))
    expect(container.textContent).not.toContain('Previous room send failed')
  })

  it('serializes canonical actions while preserving typing during an in-flight send', async () => {
    let resolveSend!: (value: { sent: true; item: typeof RECOVERED }) => void
    mockElectron.chat.send.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSend = resolve
      })
    )
    await act(async () => root?.render(<ChatPage />))
    await act(async () => (container.querySelector('[role="option"]') as HTMLElement).click())
    const input = container.querySelector('[aria-label="message"]') as HTMLInputElement
    await changeInput(input, 'first message')
    await act(async () => {
      ;(container.querySelector('[aria-label="Send"]') as HTMLButtonElement).click()
    })
    await changeInput(input, 'newer draft')
    await act(async () => {
      ;(container.querySelector('[aria-label="Send"]') as HTMLButtonElement).click()
      ;(container.querySelector('[aria-label="Leave room"]') as HTMLButtonElement).click()
      ;(container.querySelector('[aria-label^="Unfollow"]') as HTMLButtonElement).click()
    })
    expect(mockElectron.chat.send).toHaveBeenCalledTimes(1)
    expect(mockElectron.chat.leave).not.toHaveBeenCalled()

    await act(async () => resolveSend({ sent: true, item: { ...RECOVERED, text: 'first message' } }))
    expect(input.value).toBe('newer draft')
  })
})
