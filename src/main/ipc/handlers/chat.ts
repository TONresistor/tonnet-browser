import {
  chatClaimDomainContract,
  chatClearDomainContract,
  chatConnectionContract,
  chatConnectContract,
  chatDetectDomainsContract,
  chatDisconnectContract,
  chatDmMessageContract,
  chatDmSendContract,
  chatIdentityContract,
  chatLinkIdentityContract,
  chatMutateContract,
  chatResetIdentityContract,
  chatRoomPresenceContract,
  chatRoomStateContract,
  chatSendContract,
  chatTimelineBeforeContract,
  chatTimelineContract,
  type ChatRoomState,
  type ChatRoomConnection,
  type ChatRoomPresence,
  type ChatTimelineItem,
  type ChatTimelinePage,
} from '../../../shared/ipc-contract/chat'
import type { OwnChatIdentity, ChatIdentityInfo } from '../../../shared/types'
import { emitContractToRenderer } from '../../events/renderer-events'
import { ipcFailure, secureContractHandle } from '../contract-handler'
import type { ServiceRegistry } from '../../services'
import { MessengerRpcError } from '../../messenger/client-manager'
import { onEmitter } from '../../utils/disposable'

interface RpcIdentity {
  key: string
  name: string
  domain?: string
}

interface RpcActor {
  key: string
  name: string
  domain?: string
}

interface RpcEvent {
  room: string
  event_id: string
  seqno: string
  message_id: string
  committed_at: number
  actor: RpcActor
  kind:
    | 'message'
    | 'pin'
    | 'unpin'
    | 'metadata'
    | 'write-policy'
    | 'admin-grant'
    | 'admin-revoke'
    | 'moderator-grant'
    | 'moderator-revoke'
  text?: string
  target_message_id?: string
  subject_key?: string
  name?: string
  description?: string
  write_policy?: 'everyone' | 'admins'
}

interface RpcState {
  room: string
  name: string
  description: string
  write_policy: 'everyone' | 'admins'
  admins: string[]
  moderators: string[]
  pinned_messages: string[]
  revision_seqno: string
  latest_seqno: string
}

interface RpcConnection {
  node_role: 'sequencer' | 'relay'
}

interface RpcPresence {
  room: string
  online_users: number
}

function ownIdentity(value: RpcIdentity): OwnChatIdentity {
  return { identityKey: value.key, name: value.name, domain: value.domain }
}

function identityView(actor: RpcActor): ChatIdentityInfo {
  const fingerprint = actor.key.slice(0, 10)
  if (actor.domain) return { tier: 'domain', name: actor.domain, domain: actor.domain, fingerprint }
  return { tier: 'identity', name: actor.name || `#${fingerprint}`, fingerprint }
}

function timelineItem(value: RpcEvent, ownKey?: string): ChatTimelineItem {
  const base = {
    room: value.room,
    eventId: value.event_id,
    seqno: Number(value.seqno),
    ts: value.committed_at,
    actorKey: value.actor.key,
  }
  switch (value.kind) {
    case 'message':
      return {
        ...base,
        kind: 'message',
        messageId: value.message_id,
        nick: value.actor.name,
        text: value.text ?? '',
        self: value.actor.key === ownKey,
        identity: identityView(value.actor),
      }
    case 'pin':
    case 'unpin':
      return { ...base, kind: value.kind, targetMessageId: value.target_message_id ?? '0' }
    case 'metadata':
      return { ...base, kind: 'metadata', name: value.name ?? '', description: value.description ?? '' }
    case 'write-policy':
      return { ...base, kind: 'write-policy', anyoneCanWrite: value.write_policy === 'everyone' }
    default:
      return { ...base, kind: value.kind, subjectKey: value.subject_key ?? '' }
  }
}

function roomState(value: RpcState): ChatRoomState {
  return {
    roomId: value.room,
    name: value.name,
    description: value.description,
    writePolicy: value.write_policy,
    admins: value.admins,
    moderators: value.moderators,
    pinnedMessages: value.pinned_messages,
    revisionSeqno: Number(value.revision_seqno),
    latestSeqno: Number(value.latest_seqno),
  }
}

function roomConnection(value: RpcConnection): ChatRoomConnection {
  return { nodeRole: value.node_role }
}

function roomPresence(value: RpcPresence): ChatRoomPresence {
  return { roomId: value.room, onlineUsers: value.online_users }
}

function publicFailure(error: unknown): never {
  if (error instanceof MessengerRpcError) {
    const code =
      error.code === 'SEQUENCER_UNAVAILABLE'
        ? 'CHAT_SEQUENCER_UNAVAILABLE'
        : error.code === 'CLOCK_SKEW'
          ? 'CHAT_CLOCK_SKEW'
          : error.code
    ipcFailure(code, error.message, true, error)
  }
  ipcFailure(
    'CHAT_OPERATION_FAILED',
    error instanceof Error ? error.message : 'Messenger operation failed',
    true,
    error
  )
}

export function registerChatHandlers(registry: ServiceRegistry): void {
  const manager = registry.messengerClientManager
  let activeRoom: string | null = null
  let identity: OwnChatIdentity | null = null

  const getIdentity = async (): Promise<OwnChatIdentity> => {
    const value = await manager.request<RpcIdentity>('identity.get')
    identity = ownIdentity(value)
    return identity
  }

  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'room.event', (raw: RpcEvent) => {
      emitContractToRenderer(chatTimelineContract, timelineItem(raw, identity?.identityKey))
    })
  )
  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'room.state', (raw: RpcState) => emitContractToRenderer(chatRoomStateContract, roomState(raw)))
  )
  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'room.presence', (raw: RpcPresence) =>
      emitContractToRenderer(chatRoomPresenceContract, roomPresence(raw))
    )
  )
  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'dm.message', (raw: Record<string, unknown>) => {
      const peerKey = String(raw.peer_key ?? '')
      const authorName = String(raw.author_name ?? '')
      const domain = typeof raw.domain === 'string' ? raw.domain : undefined
      emitContractToRenderer(chatDmMessageContract, {
        room: String(raw.room ?? ''),
        id: String(raw.id ?? ''),
        peerKey,
        text: String(raw.text ?? ''),
        ts: Number(raw.timestamp ?? 0),
        identity: domain
          ? { tier: 'domain', name: domain, domain, fingerprint: peerKey.slice(0, 10) }
          : { tier: 'identity', name: authorName || `#${peerKey.slice(0, 10)}`, fingerprint: peerKey.slice(0, 10) },
      })
    })
  )
  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'identity.changed', (raw: RpcIdentity) => {
      identity = ownIdentity(raw)
    })
  )
  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'room.connection', (raw: Record<string, unknown>) => {
      const room = String(raw.room ?? '')
      const status = String(raw.status ?? '')
      if (status === 'reconnecting') {
        emitContractToRenderer(chatConnectionContract, {
          room,
          status: 'reconnecting',
          attempt: Number(raw.attempt ?? 1),
        })
      } else if (status === 'error') {
        emitContractToRenderer(chatConnectionContract, {
          room,
          status: 'error',
          code: 'ROOM_UNAVAILABLE',
          message: String(raw.message ?? 'Room unavailable'),
          retryable: Boolean(raw.retryable ?? true),
        })
      } else if (status === 'connected' && raw.state) {
        void manager
          .request<{ items: RpcEvent[]; has_more: boolean }>('room.getTimeline', { room, limit: 100 })
          .then((page) =>
            emitContractToRenderer(chatConnectionContract, {
              room,
              status: 'connected',
              state: roomState(raw.state as RpcState),
              connection: roomConnection(raw.connection as RpcConnection),
              presence: roomPresence(raw.presence as RpcPresence),
              timeline: {
                items: page.items.map((item) => timelineItem(item, identity?.identityKey)),
                hasMore: page.has_more,
              },
            })
          )
          .catch(() => {})
      }
    })
  )

  secureContractHandle(chatConnectContract, async (roomArg?: string, nodeArg?: string) => {
    const reference = String(roomArg ?? '').trim()
    if (!reference) ipcFailure('INVALID_ROOM', 'Invalid room key or domain')
    try {
      identity ??= await getIdentity()
      const joined = await manager.request<{
        room: string
        state: RpcState
        connection: RpcConnection
        presence: RpcPresence
        timeline: { items: RpcEvent[]; has_more: boolean }
      }>('room.join', { reference, bootstrap: nodeArg?.trim() || undefined })
      activeRoom = joined.room
      return {
        connected: true as const,
        room: joined.room,
        via: nodeArg ? ('node' as const) : ('dht' as const),
        state: roomState(joined.state),
        connection: roomConnection(joined.connection),
        presence: roomPresence(joined.presence),
        timeline: {
          items: joined.timeline.items.map((item) => timelineItem(item, identity?.identityKey)),
          hasMore: joined.timeline.has_more,
        },
      }
    } catch (error) {
      publicFailure(error)
    }
  })

  secureContractHandle(chatSendContract, async (text) => {
    if (!activeRoom) ipcFailure('CHAT_DISCONNECTED', 'Chat not connected')
    try {
      const item = await manager.request<RpcEvent>('room.sendMessage', { room: activeRoom, text: String(text) })
      const mapped = timelineItem(item, identity?.identityKey)
      if (mapped.kind !== 'message') ipcFailure('CHAT_PROTOCOL_INVALID', 'Messenger returned a non-message commit')
      return { sent: true as const, item: mapped, identity: identity ?? undefined }
    } catch (error) {
      publicFailure(error)
    }
  })

  secureContractHandle(chatDmSendContract, async (recipient, text) => {
    if (!activeRoom) ipcFailure('CHAT_DISCONNECTED', 'Chat not connected')
    try {
      const sent = await manager.request<Record<string, unknown>>('dm.send', {
        room: activeRoom,
        recipient,
        text: String(text),
      })
      return { sent: true, id: String(sent.id ?? ''), ts: Number(sent.timestamp ?? 0), identity: identity ?? undefined }
    } catch (error) {
      publicFailure(error)
    }
  })

  secureContractHandle(chatMutateContract, async (mutation) => {
    if (!activeRoom) ipcFailure('CHAT_DISCONNECTED', 'Chat not connected')
    try {
      let method = ''
      let params: Record<string, unknown> = { room: activeRoom }
      switch (mutation.action) {
        case 'metadata':
          method = 'room.setMetadata'
          params = { ...params, name: mutation.name ?? '', description: mutation.description ?? '' }
          break
        case 'write-policy':
          method = 'room.setWritePolicy'
          params = { ...params, policy: mutation.anyoneCanWrite ? 'everyone' : 'admins' }
          break
        case 'pin':
        case 'unpin':
          method = `room.${mutation.action}`
          params = { ...params, message_id: mutation.messageId }
          break
        case 'moderator-grant':
        case 'moderator-revoke':
          method = mutation.action === 'moderator-grant' ? 'room.grantModerator' : 'room.revokeModerator'
          params = { ...params, identity_key: mutation.subjectKey }
          break
      }
      if (!method) ipcFailure('INVALID_MUTATION', 'Invalid room mutation')
      const item = await manager.request<RpcEvent>(method, params)
      return { committed: true as const, item: timelineItem(item, identity?.identityKey) }
    } catch (error) {
      publicFailure(error)
    }
  })

  secureContractHandle(chatTimelineBeforeContract, async (beforeSeqno, limit = 100): Promise<ChatTimelinePage> => {
    if (!activeRoom) ipcFailure('CHAT_DISCONNECTED', 'Chat not connected')
    try {
      const page = await manager.request<{ items: RpcEvent[]; has_more: boolean }>('room.getTimeline', {
        room: activeRoom,
        before_seqno: String(beforeSeqno),
        limit,
      })
      return { items: page.items.map((item) => timelineItem(item, identity?.identityKey)), hasMore: page.has_more }
    } catch (error) {
      publicFailure(error)
    }
  })

  secureContractHandle(chatIdentityContract, async () => {
    try {
      return await getIdentity()
    } catch (error) {
      publicFailure(error)
    }
  })
  secureContractHandle(chatLinkIdentityContract, async () => getIdentity())
  secureContractHandle(chatClaimDomainContract, async (domain) => {
    try {
      const value = await manager.request<RpcIdentity>('identity.confirmDomainLink', { domain })
      identity = ownIdentity(value)
      return { ok: true, identity }
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Domain verification failed',
        identity: await getIdentity(),
      }
    }
  })
  secureContractHandle(chatClearDomainContract, async () => {
    const value = await manager.request<RpcIdentity>('identity.clearDomain')
    identity = ownIdentity(value)
    return identity
  })
  secureContractHandle(chatDetectDomainsContract, async () => ({ domains: [] }))
  secureContractHandle(chatResetIdentityContract, async () => {
    const current = identity ?? (await getIdentity())
    const value = await manager.request<RpcIdentity>('identity.reset', { expected_key: current.identityKey })
    identity = ownIdentity(value)
    return identity
  })
  secureContractHandle(chatDisconnectContract, async () => {
    if (activeRoom) await manager.request('room.leave', { reference: activeRoom })
    activeRoom = null
    return { disconnected: true as const }
  })
}
