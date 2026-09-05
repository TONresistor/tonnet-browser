import type { ChatTimelineItem, ChatTimelineMessage } from '@shared/ipc-contract/chat'
import type { ChatIdentityInfo } from '@shared/types'

export type ChatStatus = 'idle' | 'connecting' | 'reconnecting' | 'connected' | 'error'

export type { ChatIdentityInfo }

export type { ChatTimelineItem, ChatTimelineMessage }
export type TimelineIdentityLabels = ReadonlyMap<string, string>

export const PUBLIC_MESSAGE_LIMIT = 500

export function mergeTimelineItems(
  current: ChatTimelineItem[],
  incoming: ChatTimelineItem | ChatTimelineItem[],
  limit = PUBLIC_MESSAGE_LIMIT
): ChatTimelineItem[] {
  if (limit <= 0) return []
  const items = Array.isArray(incoming) ? incoming : [incoming]
  const eventIds = new Set(current.map((item) => item.eventId))
  const seqnos = new Set(current.map((item) => item.seqno))
  let changed = false
  const merged = [...current]
  for (const item of items) {
    if (eventIds.has(item.eventId) || seqnos.has(item.seqno)) continue
    eventIds.add(item.eventId)
    seqnos.add(item.seqno)
    merged.push(item)
    changed = true
  }
  if (!changed) return current
  merged.sort((left, right) => left.seqno - right.seqno)
  return Number.isFinite(limit) && merged.length > limit ? merged.slice(-limit) : merged
}

export function timelineIdentityLabels(items: ChatTimelineItem[]): TimelineIdentityLabels {
  const labels = new Map<string, string>()
  for (const item of items) {
    if (item.kind !== 'message') continue
    const label = item.identity.name.trim() || item.nick.trim()
    if (label) labels.set(item.actorKey, label)
  }
  return labels
}

export function timelineIdentityLabel(key: string, labels: TimelineIdentityLabels): string {
  return labels.get(key) ?? `#${key.slice(0, 8)}`
}

export function formatTimelineItem(item: ChatTimelineItem, labels: TimelineIdentityLabels): string {
  if (item.kind === 'message') return item.text
  const actor = timelineIdentityLabel(item.actorKey, labels)
  switch (item.kind) {
    case 'admin-grant':
      return `${actor} made ${timelineIdentityLabel(item.subjectKey, labels)} an admin`
    case 'admin-revoke':
      return `${actor} removed ${timelineIdentityLabel(item.subjectKey, labels)} as admin`
    case 'moderator-grant':
      return `${actor} made ${timelineIdentityLabel(item.subjectKey, labels)} a moderator`
    case 'moderator-revoke':
      return `${actor} removed ${timelineIdentityLabel(item.subjectKey, labels)} as moderator`
    case 'metadata':
      return `${actor} updated the room details to “${item.name}”`
    case 'write-policy':
      return item.anyoneCanWrite ? `${actor} allowed everyone to post` : `${actor} limited posting to admins`
    case 'pin':
      return `${actor} pinned message #${item.targetMessageId}`
    case 'unpin':
      return `${actor} unpinned message #${item.targetMessageId}`
  }
}

const AVATAR_COLORS = ['#0098EA', '#5856D6', '#34C759', '#FF9500', '#FF2D55', '#AF52DE', '#FF3B30', '#00C7BE']

export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

export function identitySeed(message: ChatTimelineMessage): string {
  return message.identity.domain ?? message.identity.fingerprint ?? message.nick
}

export function initial(name: string): string {
  const cleaned = name.replace(/^tonnet:/i, '').trim()
  const ch = (cleaned || name).match(/[a-z0-9]/i)
  return (ch ? ch[0] : '#').toUpperCase()
}

export function roomLabel(name: string): string {
  return name.replace(/^tonnet:/i, '') || name
}

export function formatChatTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  if (now.getTime() - d.getTime() < 6 * 86400000) {
    return d.toLocaleDateString(undefined, { weekday: 'short' })
  }
  return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })
}
