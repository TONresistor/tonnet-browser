import { describe, expect, it } from 'vitest'
import {
  ChatRoomPresenceSchema,
  ChatRoomStateSchema,
  chatConnectContract,
  ChatPendingOperationSchema,
  chatPendingContract,
  chatRetryPendingContract,
  chatRoomPresenceContract,
  chatRoomStateContract,
} from '../chat'

const identityKey = 'I'.repeat(43)
const state = {
  roomId: 'R'.repeat(43),
  name: 'Test room',
  description: '',
  writePolicy: 'everyone' as const,
  admins: [identityKey],
  moderators: [identityKey],
  pinnedMessages: [],
  revisionSeqno: 9,
  latestSeqno: 9,
}
const connection = { nodeRole: 'sequencer' as const }
const presence = { roomId: state.roomId, onlineUsers: 1 }

describe('chat IPC contracts', () => {
  it('accepts canonical base64url identity keys in room roles', () => {
    expect(ChatRoomStateSchema.parse(state)).toEqual(state)
    expect(chatRoomStateContract.payload.parse([state])).toEqual([state])
  })

  it('rejects legacy hexadecimal identity keys in room roles', () => {
    expect(() => ChatRoomStateSchema.parse({ ...state, admins: ['ab'.repeat(32)] })).toThrow()
  })

  it('keeps node-local presence outside verified room state', () => {
    expect(ChatRoomPresenceSchema.parse(presence)).toEqual(presence)
    expect(chatRoomPresenceContract.payload.parse([presence])).toEqual([presence])
    expect(ChatRoomStateSchema.parse({ ...state, onlineUsers: 1 })).not.toHaveProperty('onlineUsers')
    expect(
      chatConnectContract.output.parse({
        connected: true,
        room: state.roomId,
        via: 'dht',
        state,
        connection,
        presence,
        timeline: { items: [], hasMore: false },
        pending: null,
      })
    ).toBeDefined()
  })

  it('validates pending-operation recovery contracts', () => {
    const pending = {
      room: state.roomId,
      eventId: 'P'.repeat(43),
      status: 'uncertain' as const,
      ts: 1_788_553_280_000,
      kind: 'message' as const,
      summary: 'hello',
      text: 'hello',
    }
    expect(ChatPendingOperationSchema.parse(pending)).toEqual(pending)
    expect(chatPendingContract.output.parse({ pending })).toEqual({ pending })
    expect(chatRetryPendingContract.input.parse([state.roomId, pending.eventId])).toEqual([
      state.roomId,
      pending.eventId,
    ])
  })
})
