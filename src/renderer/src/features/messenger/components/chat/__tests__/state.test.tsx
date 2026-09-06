// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDmConversations } from '../useDmConversations'
import { useFollowedRooms } from '../useFollowedRooms'

describe('Messenger local state', () => {
  let root: Root
  let container: HTMLDivElement
  let direct: ReturnType<typeof useDmConversations.getState>
  let rooms: ReturnType<typeof useFollowedRooms>
  const room = 'Q'.repeat(43)
  const peer = 'B'.repeat(43)
  const identity = { tier: 'identity' as const, name: 'bob' }
  const message = { room, id: 'D'.repeat(43), peerKey: peer, text: 'hello', ts: 1_788_553_280_000, identity }

  function Harness() {
    direct = useDmConversations()
    rooms = useFollowedRooms()
    return null
  }

  beforeEach(() => {
    useDmConversations.setState({ conversations: {}, identityKey: null })
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it.each(['notification-first', 'reply-first'])(
    'deduplicates sent DMs with %s while preserving their direction and correspondent',
    async (order) => {
      await act(async () => root.render(<Harness />))
      act(() => {
        direct.open(identity, peer)
      })
      const notify = () => direct.receive({ ...message, direction: 'sent', identity: { ...identity, name: 'alice' } })
      const reply = () =>
        direct.appendSelf(peer, { room, id: message.id, text: message.text, ts: message.ts, self: true })
      act(() => {
        if (order === 'notification-first') {
          notify()
          reply()
        } else {
          reply()
          notify()
        }
      })
      expect(direct.conversations[peer].name).toBe('bob')
      expect(direct.conversations[peer].messages).toEqual([
        { room, id: message.id, text: 'hello', ts: message.ts, self: true },
      ])
      act(() => direct.receive({ ...message, id: 'E'.repeat(43), direction: 'received' }))
      expect(direct.conversations[peer].messages[1].self).toBe(false)
    }
  )

  it('imports valid legacy favourites into a separate key without changing the legacy list', async () => {
    const legacy = JSON.stringify([{ room: 'tonnet:groupchat' }, { room }, { room: 'groupchat.ton' }])
    localStorage.setItem('groupchat.rooms', legacy)
    await act(async () => root.render(<Harness />))
    expect(rooms.rooms.map((entry) => entry.room)).toEqual([room, 'groupchat.ton'])
    expect(localStorage.getItem('groupchat.rooms')).toBe(legacy)
    expect(JSON.parse(localStorage.getItem('messenger.rooms.v1')!)).toHaveLength(2)
    act(() => rooms.remove(room))
    expect(localStorage.getItem('groupchat.rooms')).toBe(legacy)
    expect(JSON.parse(localStorage.getItem('messenger.rooms.v1')!)).toHaveLength(1)
  })

  it('preserves t.me aliases through canonicalization and reload', async () => {
    localStorage.setItem('messenger.rooms.v1', JSON.stringify([{ room: 'team_member.t.me' }]))
    await act(async () => root.render(<Harness />))
    expect(rooms.rooms[0].room).toBe('team_member.t.me')
    act(() => rooms.canonicalize('team_member.t.me', room))
    expect(rooms.rooms[0]).toMatchObject({ room, alias: 'team_member.t.me' })
    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
    expect(rooms.rooms[0]).toMatchObject({ room, alias: 'team_member.t.me' })
  })
})
