import { describe, expect, it } from 'vitest'
import {
  ChatRoomPresenceSchema,
  ChatRoomStateSchema,
  chatConnectContract,
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
      })
    ).toBeDefined()
  })
})
