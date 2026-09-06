import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceRegistry } from '../../services'

const mocks = vi.hoisted(() => {
  class BoundaryError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly retryable = false
    ) {
      super(message)
    }
  }
  return {
    BoundaryError,
    handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
    emit: vi.fn(),
    openExternal: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('electron', () => ({ shell: { openExternal: mocks.openExternal } }))
vi.mock('../handlers/shared', () => ({
  IpcBoundaryError: mocks.BoundaryError,
  secureHandleWithEvent: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
    mocks.handlers.set(channel, handler)
    return { dispose: () => mocks.handlers.delete(channel) }
  },
  overlayHandle: vi.fn(),
  tonsiteHandle: vi.fn(),
}))
vi.mock('../../events/renderer-events', () => ({ emitContractToRenderer: mocks.emit }))
vi.mock('../../../shared/logger', () => ({
  createOperationId: () => 'test',
  runWithLogContext: (_context: unknown, operation: () => unknown) => operation(),
  createLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('../../messenger/client-manager', () => ({
  MessengerRpcError: class extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly rpcCode: number
    ) {
      super(message)
    }
  },
}))

import { registerChatHandlers } from '../handlers/chat'
import { MessengerRpcError } from '../../messenger/client-manager'
import { DisposableStore } from '../../utils/disposable'

const ROOM = 'Q'.repeat(43)
const OTHER_ROOM = 'R'.repeat(43)
const IDENTITY = { key: 'A'.repeat(43), name: 'alice' }
const TIMESTAMP = 1_788_553_280
const EVENT = {
  room: ROOM,
  event_id: 'E'.repeat(43),
  seqno: '1',
  message_id: '1',
  committed_at: TIMESTAMP,
  actor: IDENTITY,
  kind: 'message',
  text: 'hello',
}
const STATE = {
  room: ROOM,
  name: 'Room',
  description: '',
  write_policy: 'everyone',
  admins: [],
  moderators: [],
  pinned_messages: [],
  revision_seqno: '0',
  latest_seqno: '1',
}
const JOIN = {
  room: ROOM,
  state: STATE,
  connection: { node_role: 'sequencer' },
  presence: { room: ROOM, online_users: 1 },
  timeline: { items: [EVENT], has_more: false },
}
const DIRECT = {
  room: ROOM,
  id: 'D'.repeat(43),
  peer_key: 'B'.repeat(43),
  text: 'hello',
  timestamp: TIMESTAMP,
  direction: 'sent',
  author_name: 'alice',
}
const PENDING = {
  room: ROOM,
  event_id: 'P'.repeat(43),
  status: 'uncertain' as const,
  timestamp: TIMESTAMP,
  event: { actor: IDENTITY, kind: 'message' as const, text: 'pending message' },
}
const RETRIED_EVENT = { ...EVENT, event_id: PENDING.event_id, text: PENDING.event.text }

describe('standalone Messenger IPC', () => {
  let manager: EventEmitter & {
    request: ReturnType<typeof vi.fn>
    setActive: ReturnType<typeof vi.fn>
    invalidate: ReturnType<typeof vi.fn>
  }
  let lifecycle: DisposableStore
  const invoke = (channel: string, ...args: unknown[]) => mocks.handlers.get(channel)!({ sender: { id: 1 } }, ...args)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    manager = Object.assign(new EventEmitter(), { request: vi.fn(), setActive: vi.fn(), invalidate: vi.fn() })
    manager.invalidate.mockImplementation((error) => manager.emit('client.exit', error))
    manager.request.mockImplementation(async (method: string, params?: { reference?: string }) => {
      if (method === 'identity.get' || method === 'identity.reset' || method === 'identity.clearDomain') return IDENTITY
      if (method === 'room.resolve') return { room: ROOM }
      if (method === 'room.join') {
        const room = params?.reference ?? ROOM
        return {
          ...JOIN,
          room,
          state: { ...STATE, room },
          presence: { ...JOIN.presence, room },
          timeline: { ...JOIN.timeline, items: [{ ...EVENT, room }] },
        }
      }
      if (method === 'room.sendMessage') return EVENT
      if (method === 'room.getTimeline') return JOIN.timeline
      if (method === 'room.getPending') return { pending: null }
      if (method === 'room.retryPending') return EVENT
      if (method === 'room.discardPending') return { discarded: true }
      if (method === 'room.leave') return { left: true }
      if (method === 'dm.send') return DIRECT
      throw new Error('Unexpected method ' + method)
    })
    mocks.emit.mockImplementation((contract, payload) => contract.payload.parse([payload]))
    lifecycle = new DisposableStore()
    registerChatHandlers({
      messengerClientManager: manager,
      lifecycleRegistrations: lifecycle,
    } as unknown as ServiceRegistry)
  })

  afterEach(() => lifecycle.dispose())

  it('prepares the exact helper transaction and opens it only on request', async () => {
    const txUrl = `ton://transfer/${'E'.repeat(48)}?bin=abc&amount=20000000`
    manager.request.mockResolvedValueOnce({
      Domain: 'alice.ton',
      Category: 'msg_id',
      Key: IDENTITY.key,
      Owner: 'owner',
      TxURL: txUrl,
    })
    await expect(invoke('chat:identity:prepare-domain-link', 'alice.ton')).resolves.toEqual({
      domain: 'alice.ton',
      category: 'msg_id',
      key: IDENTITY.key,
      owner: 'owner',
      txUrl,
    })
    expect(manager.request).toHaveBeenCalledWith('identity.prepareDomainLink', { domain: 'alice.ton' })
    expect(mocks.openExternal).not.toHaveBeenCalled()
    await invoke('chat:identity:open-domain-link', txUrl)
    expect(mocks.openExternal).toHaveBeenCalledWith(txUrl)
    await expect(invoke('chat:identity:open-domain-link', 'file:///tmp/test')).rejects.toThrow()
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
  })

  it('invalidates a malformed prepared domain transaction', async () => {
    manager.request.mockResolvedValueOnce({
      Domain: 'alice.ton',
      Category: 'msg_id',
      Key: IDENTITY.key,
      Owner: 'owner',
      TxURL: 'https://example.com',
    })
    await expect(invoke('chat:identity:prepare-domain-link', 'alice.ton')).rejects.toMatchObject({
      code: 'CHAT_PROTOCOL_INVALID',
    })
    expect(manager.invalidate).toHaveBeenCalledTimes(1)
  })

  it('converts canonical and direct timestamps to renderer milliseconds', async () => {
    const joined = (await invoke('chat:connect', ROOM)) as { timeline: { items: { ts: number }[] } }
    expect(new Date(joined.timeline.items[0].ts).toISOString()).toBe('2026-09-04T20:21:20.000Z')
    manager.emit('room.event', EVENT)
    expect(mocks.emit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ ts: TIMESTAMP * 1000, self: true })
    )
    const sent = await invoke('chat:dm:send', ROOM, DIRECT.peer_key, 'hello')
    expect(sent).toMatchObject({ ts: TIMESTAMP * 1000 })
    manager.emit('dm.message', DIRECT)
    expect(mocks.emit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        direction: 'sent',
        ts: TIMESTAMP * 1000,
        identity: expect.objectContaining({ name: '#' + DIRECT.peer_key.slice(0, 10) }),
      })
    )
  })

  it.each([
    ['PERMISSION_DENIED', 'CHAT_PERMISSION_DENIED', false],
    ['UNKNOWN_MESSAGE', 'CHAT_UNKNOWN_MESSAGE', false],
    ['ROLE_CONFLICT', 'CHAT_ROLE_CONFLICT', false],
    ['LIMIT_EXCEEDED', 'CHAT_LIMIT_EXCEEDED', false],
    ['INVALID_ARGUMENT', 'CHAT_INVALID_ARGUMENT', false],
    ['INVALID_IDENTITY_DOMAIN', 'CHAT_INVALID_IDENTITY_DOMAIN', false],
    ['TIMEOUT', 'CHAT_TIMEOUT', true],
    ['SEQUENCER_UNAVAILABLE', 'CHAT_SEQUENCER_UNAVAILABLE', true],
    ['SEND_UNCERTAIN', 'CHAT_SEND_UNCERTAIN', true],
    ['PENDING_OPERATION', 'CHAT_PENDING_OPERATION', true],
  ])('preserves the declared code for %s', async (rpcCode, ipcCode, retryable) => {
    await invoke('chat:connect', ROOM)
    manager.request.mockRejectedValueOnce(new MessengerRpcError('rejected', String(rpcCode), -32000))
    await expect(invoke('chat:send', ROOM, 'hello')).rejects.toMatchObject({ code: ipcCode, retryable })
  })

  it('invalidates the helper on a protocol error', async () => {
    await invoke('chat:connect', ROOM)
    manager.request.mockRejectedValueOnce(new MessengerRpcError('invalid response', 'PROTOCOL_ERROR', -32034))
    await expect(invoke('chat:send', ROOM, 'hello')).rejects.toMatchObject({ code: 'CHAT_PROTOCOL_INVALID' })
    expect(manager.invalidate).toHaveBeenCalledOnce()
  })

  it('invalidates protocol failures during domain confirmation', async () => {
    manager.request.mockRejectedValueOnce(new MessengerRpcError('invalid identity', 'PROTOCOL_ERROR', -32034))
    await expect(invoke('chat:identity:claim-domain', 'alice.ton')).rejects.toMatchObject({
      code: 'CHAT_PROTOCOL_INVALID',
    })
    expect(manager.invalidate).toHaveBeenCalledOnce()
  })

  it('loads, retries and explicitly discards the exact pending operation', async () => {
    await invoke('chat:connect', ROOM)
    manager.request.mockResolvedValueOnce({ pending: PENDING })
    await expect(invoke('chat:pending', ROOM)).resolves.toEqual({
      pending: expect.objectContaining({
        room: ROOM,
        eventId: PENDING.event_id,
        status: 'uncertain',
        kind: 'message',
        summary: 'pending message',
        text: 'pending message',
      }),
    })
    expect(manager.request).toHaveBeenLastCalledWith('room.getPending', { room: ROOM })

    manager.request.mockResolvedValueOnce(RETRIED_EVENT)
    await expect(invoke('chat:pending:retry', ROOM, PENDING.event_id)).resolves.toMatchObject({
      item: { eventId: PENDING.event_id, kind: 'message', text: PENDING.event.text },
    })
    expect(manager.request).toHaveBeenLastCalledWith('room.retryPending', {
      room: ROOM,
      event_id: PENDING.event_id,
    })

    manager.request.mockResolvedValueOnce({ discarded: true })
    await expect(invoke('chat:pending:discard', ROOM, PENDING.event_id)).resolves.toEqual({ discarded: true })
    expect(manager.request).toHaveBeenLastCalledWith('room.discardPending', {
      room: ROOM,
      event_id: PENDING.event_id,
    })
  })

  it('rejects pending state bound to another room', async () => {
    await invoke('chat:connect', ROOM)
    manager.request.mockResolvedValueOnce({ pending: { ...PENDING, room: OTHER_ROOM } })
    await expect(invoke('chat:pending', ROOM)).rejects.toMatchObject({ code: 'CHAT_PROTOCOL_INVALID' })
    expect(manager.invalidate).toHaveBeenCalledOnce()
  })

  it('invalidates a retry result bound to another pending event', async () => {
    await invoke('chat:connect', ROOM)
    manager.request.mockResolvedValueOnce(EVENT)
    await expect(invoke('chat:pending:retry', ROOM, PENDING.event_id)).rejects.toMatchObject({
      code: 'CHAT_PROTOCOL_INVALID',
    })
    expect(manager.invalidate).toHaveBeenCalledOnce()
  })

  it('rejects unsafe sequence conversion and malformed helper results', async () => {
    await invoke('chat:connect', ROOM)
    manager.request.mockResolvedValueOnce({ ...EVENT, seqno: '9007199254740993' })
    await expect(invoke('chat:send', ROOM, 'hello')).rejects.toMatchObject({ code: 'CHAT_PROTOCOL_INVALID' })
    expect(manager.invalidate).toHaveBeenCalledOnce()
  })

  it('invalidates a join result bound to a different room', async () => {
    await invoke('chat:identity')
    manager.request.mockResolvedValueOnce(JOIN)
    await expect(invoke('chat:connect', OTHER_ROOM)).rejects.toMatchObject({ code: 'CHAT_PROTOCOL_INVALID' })
    expect(manager.invalidate).toHaveBeenCalledOnce()
  })

  it('reactivates the selected room only after recovery history is verified', async () => {
    await invoke('chat:connect', ROOM)
    manager.emit('client.exit', new Error('exit'))
    await expect(invoke('chat:send', ROOM, 'hello')).rejects.toMatchObject({ code: 'CHAT_DISCONNECTED' })
    manager.emit('room.connection', { ...JOIN, status: 'connected' })
    await vi.waitFor(() =>
      expect(mocks.emit).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ room: ROOM, status: 'connected' })
      )
    )
    await expect(invoke('chat:send', ROOM, 'hello')).resolves.toMatchObject({ sent: true })
  })

  it('does not reactivate a room when a pending join completes after disconnect', async () => {
    let completeJoin!: (value: unknown) => void
    manager.request.mockImplementation(async (method: string) =>
      method === 'identity.get'
        ? IDENTITY
        : new Promise((resolve) => {
            completeJoin = resolve
          })
    )
    const joining = invoke('chat:connect', ROOM)
    const rejected = expect(joining).rejects.toMatchObject({ code: 'CHAT_DISCONNECTED' })
    await vi.waitFor(() => expect(completeJoin).toBeTypeOf('function'))
    await invoke('chat:disconnect')
    completeJoin(JOIN)
    await rejected
    await expect(invoke('chat:send', ROOM, 'hello')).rejects.toMatchObject({ code: 'CHAT_DISCONNECTED' })
    expect(manager.request).not.toHaveBeenCalledWith('room.leave', expect.anything())
  })

  it('keeps cached membership on view disconnect and leaves only on explicit request', async () => {
    await invoke('chat:connect', ROOM)
    await invoke('chat:disconnect')
    expect(manager.request).not.toHaveBeenCalledWith('room.leave', expect.anything())
    await invoke('chat:leave', ROOM)
    expect(manager.request).toHaveBeenLastCalledWith('room.leave', { reference: ROOM })
  })

  it('requires an explicit active room for every write and history request', async () => {
    await invoke('chat:connect', ROOM)
    const calls = manager.request.mock.calls.length
    await expect(invoke('chat:send', OTHER_ROOM, 'hello')).rejects.toMatchObject({ code: 'CHAT_DISCONNECTED' })
    await expect(invoke('chat:timeline:before', OTHER_ROOM, 10)).rejects.toMatchObject({ code: 'CHAT_DISCONNECTED' })
    expect(manager.request.mock.calls.length).toBe(calls)
  })

  it('reports helper exit and recovery to the active room', async () => {
    await invoke('chat:connect', ROOM)
    manager.emit('client.exit', new Error('exit'))
    expect(mocks.emit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ room: ROOM, status: 'error' })
    )
    manager.emit('client.reconnecting', 1)
    expect(mocks.emit).toHaveBeenLastCalledWith(expect.anything(), {
      room: ROOM,
      reference: ROOM,
      status: 'reconnecting',
      attempt: 1,
    })
  })

  it('allows pending inspection and discard while the selected room reconnects', async () => {
    await invoke('chat:connect', ROOM)
    manager.emit('client.exit', new Error('exit'))
    manager.request.mockResolvedValueOnce({ pending: PENDING })
    await expect(invoke('chat:pending', ROOM)).resolves.toMatchObject({ pending: { eventId: PENDING.event_id } })
    manager.request.mockResolvedValueOnce({ discarded: true })
    await expect(invoke('chat:pending:discard', ROOM, PENDING.event_id)).resolves.toEqual({ discarded: true })
    await expect(invoke('chat:pending:retry', ROOM, PENDING.event_id)).rejects.toMatchObject({
      code: 'CHAT_DISCONNECTED',
    })
  })

  it('keeps the room selected when leave is rejected by pending recovery', async () => {
    await invoke('chat:connect', ROOM)
    manager.request.mockRejectedValueOnce(new MessengerRpcError('pending', 'PENDING_OPERATION', -32033))
    await expect(invoke('chat:leave', ROOM)).rejects.toMatchObject({ code: 'CHAT_PENDING_OPERATION' })
    manager.request.mockResolvedValueOnce({ pending: PENDING })
    await expect(invoke('chat:pending', ROOM)).resolves.toMatchObject({ pending: { eventId: PENDING.event_id } })
    expect(manager.setActive).not.toHaveBeenLastCalledWith(false)
  })

  it('retains the requested alias through a failed join and canonical recovery', async () => {
    await invoke('chat:identity')
    manager.request
      .mockResolvedValueOnce({ room: ROOM })
      .mockRejectedValueOnce(new MessengerRpcError('Temporary node failure', 'ROOM_UNAVAILABLE', -32000))
    await expect(invoke('chat:connect', 'community.ton')).rejects.toMatchObject({ code: 'CHAT_NODE_UNREACHABLE' })
    manager.emit('room.connection', { room: ROOM, status: 'reconnecting', attempt: 1 })
    expect(mocks.emit).toHaveBeenLastCalledWith(expect.anything(), {
      room: ROOM,
      reference: 'community.ton',
      status: 'reconnecting',
      attempt: 1,
    })
    manager.emit('room.connection', { ...JOIN, status: 'connected' })
    await vi.waitFor(() =>
      expect(mocks.emit).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          room: ROOM,
          reference: 'community.ton',
          status: 'connected',
        })
      )
    )
    await invoke('chat:disconnect')
    mocks.emit.mockClear()
    manager.emit('room.connection', { ...JOIN, status: 'connected' })
    expect(mocks.emit).not.toHaveBeenCalled()
  })

  it('ignores a history refresh completed after another room is selected', async () => {
    await invoke('chat:connect', ROOM)
    let completePage!: (value: unknown) => void
    manager.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completePage = resolve
        })
    )
    manager.emit('room.connection', { ...JOIN, status: 'connected' })
    await invoke('chat:connect', OTHER_ROOM)
    mocks.emit.mockClear()
    completePage(JOIN.timeline)
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.emit).not.toHaveBeenCalled()
  })

  it('surfaces protocol-invalid reconnect refreshes after invalidating the helper', async () => {
    await invoke('chat:connect', ROOM)
    manager.request.mockRejectedValueOnce(new MessengerRpcError('invalid pending receipt', 'PROTOCOL_ERROR', -32034))
    manager.emit('room.connection', { ...JOIN, status: 'connected' })
    await vi.waitFor(() =>
      expect(mocks.emit).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'chat:connection' }),
        expect.objectContaining({ room: ROOM, status: 'error', code: 'CHAT_PROTOCOL_INVALID', retryable: false })
      )
    )
    expect(manager.invalidate).toHaveBeenCalledOnce()
  })

  it('does not reactivate a room when an older refresh finishes during reconnect', async () => {
    await invoke('chat:connect', ROOM)
    let completePage!: (value: unknown) => void
    manager.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completePage = resolve
        })
    )
    manager.emit('room.connection', { ...JOIN, status: 'connected' })
    manager.emit('room.connection', { room: ROOM, status: 'reconnecting', attempt: 1 })
    completePage(JOIN.timeline)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.emit).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: 'reconnecting' }))
    await expect(invoke('chat:send', ROOM, 'hello')).rejects.toMatchObject({ code: 'CHAT_DISCONNECTED' })
  })

  it('broadcasts identity changes and disposes every registered listener', () => {
    manager.emit('identity.changed', IDENTITY)
    expect(mocks.emit).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'chat:identity-changed' }), {
      identityKey: IDENTITY.key,
      name: 'alice',
    })
    lifecycle.dispose()
    expect(manager.eventNames()).toEqual([])
  })
})
