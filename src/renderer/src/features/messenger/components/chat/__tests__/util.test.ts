import { describe, expect, it } from 'vitest'
import type { ChatTimelineItem, ChatTimelineMessage } from '../util'
import { formatTimelineItem, mergeTimelineItems, timelineIdentityLabels } from '../util'

const ROOM = 'Q'.repeat(43)
const ACTOR = 'a'.repeat(64)
const SUBJECT = 'b'.repeat(64)

function message(index: number): ChatTimelineMessage {
  const seqno = index + 1
  return {
    kind: 'message',
    room: ROOM,
    eventId: seqno.toString(16).padStart(64, '0'),
    seqno,
    messageId: String(seqno),
    actorKey: ACTOR,
    nick: 'alice.ton',
    text: `message-${seqno}`,
    ts: seqno,
    self: false,
    identity: { tier: 'domain', name: 'alice.ton', domain: 'alice.ton', fingerprint: 'aaaaaaaa' },
  }
}

function system(kind: Exclude<ChatTimelineItem['kind'], 'message'>): ChatTimelineItem {
  const base = { room: ROOM, eventId: 'f'.repeat(64), seqno: 2, actorKey: ACTOR, ts: 2 }
  switch (kind) {
    case 'admin-grant':
    case 'admin-revoke':
    case 'moderator-grant':
    case 'moderator-revoke':
      return { ...base, kind, subjectKey: SUBJECT }
    case 'pin':
    case 'unpin':
      return { ...base, kind, targetMessageId: '1' }
    case 'metadata':
      return { ...base, kind, name: 'New room', description: '' }
    case 'write-policy':
      return { ...base, kind, anyoneCanWrite: false }
  }
}

describe('Messenger timeline', () => {
  it('deduplicates submit/live races and preserves canonical seqno order', () => {
    const first = message(0)
    const second = message(1)
    const merged = mergeTimelineItems(mergeTimelineItems([], second), [first, second])

    expect(merged).toEqual([first, second])
    expect(mergeTimelineItems(merged, second)).toBe(merged)
  })

  it('keeps only the newest 500 live items', () => {
    const items = Array.from({ length: 500 }, (_, index) => message(index))
    const bounded = mergeTimelineItems(items, message(500))

    expect(bounded).toHaveLength(500)
    expect(bounded[0].seqno).toBe(2)
    expect(bounded[499].seqno).toBe(501)
  })

  it('formats every canonical system event with verified-name fallback', () => {
    const labels = timelineIdentityLabels([message(0)])
    expect(formatTimelineItem(system('admin-grant'), labels)).toBe('alice.ton made #bbbbbbbb an admin')
    expect(formatTimelineItem(system('admin-revoke'), labels)).toBe('alice.ton removed #bbbbbbbb as admin')
    expect(formatTimelineItem(system('moderator-grant'), labels)).toBe('alice.ton made #bbbbbbbb a moderator')
    expect(formatTimelineItem(system('moderator-revoke'), labels)).toBe('alice.ton removed #bbbbbbbb as moderator')
    expect(formatTimelineItem(system('metadata'), labels)).toBe('alice.ton updated the room details to “New room”')
    expect(formatTimelineItem(system('write-policy'), labels)).toBe('alice.ton limited posting to admins')
    expect(formatTimelineItem(system('pin'), labels)).toBe('alice.ton pinned message #1')
    expect(formatTimelineItem(system('unpin'), labels)).toBe('alice.ton unpinned message #1')
  })
})
