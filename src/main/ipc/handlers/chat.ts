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
  chatIdentityChangedContract,
  chatLeaveContract,
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
import { z } from 'zod'
import { IpcBoundaryError } from './shared'
import {
  rpcIdentitySchema,
  rpcEventSchema,
  rpcStateSchema,
  rpcPresenceSchema,
  rpcConnectionSchema,
  rpcDirectSchema,
  rpcPageSchema,
  rpcJoinSchema,
  rpcRoomKeySchema,
} from '../../messenger/protocol'

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
    ts: value.committed_at * 1000,
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
  if (error instanceof IpcBoundaryError) throw error
  if (error instanceof MessengerRpcError) {
    const codes: Record<string, string> = {
      PERMISSION_DENIED: 'CHAT_PERMISSION_DENIED',
      UNKNOWN_MESSAGE: 'CHAT_UNKNOWN_MESSAGE',
      ROLE_CONFLICT: 'CHAT_ROLE_CONFLICT',
      LIMIT_EXCEEDED: 'CHAT_LIMIT_EXCEEDED',
      RESPONSE_TOO_LARGE: 'CHAT_LIMIT_EXCEEDED',
      INVALID_ARGUMENT: 'CHAT_INVALID_ARGUMENT',
      INVALID_IDENTITY_DOMAIN: 'CHAT_INVALID_IDENTITY_DOMAIN',
      SEQUENCER_UNAVAILABLE: 'CHAT_SEQUENCER_UNAVAILABLE',
      CLOCK_SKEW: 'CHAT_CLOCK_SKEW',
      TIMEOUT: 'CHAT_TIMEOUT',
      ROOM_UNAVAILABLE: 'CHAT_NODE_UNREACHABLE',
      NOT_CONNECTED: 'CHAT_DISCONNECTED',
      SESSION_CHANGED: 'CHAT_DISCONNECTED',
      PROTOCOL_INVALID: 'CHAT_PROTOCOL_INVALID',
    }
    const retryable = ['SEQUENCER_UNAVAILABLE', 'TIMEOUT', 'ROOM_UNAVAILABLE', 'NOT_CONNECTED'].includes(error.code)
    ipcFailure(codes[error.code] ?? 'CHAT_OPERATION_FAILED', error.message, retryable, error)
  }
  if (error instanceof z.ZodError) {
    ipcFailure('CHAT_PROTOCOL_INVALID', 'Invalid Messenger response', false, error)
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
  let wantedRoom: string | null = null
  let identity: OwnChatIdentity | null = null
  let generation = 0
  let refreshGeneration = 0

  const request = async <Schema extends z.ZodType>(
    method: string,
    schema: Schema,
    params: Record<string, unknown> = {}
  ): Promise<z.infer<Schema>> => {
    const value = await manager.request(method, params)
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      const error = new MessengerRpcError('Invalid Messenger response', 'PROTOCOL_INVALID', -32000)
      manager.invalidate(error)
      throw error
    }
    return parsed.data
  }

  const requireRoom = (roomId: string): void => {
    if (roomId !== activeRoom) ipcFailure('CHAT_DISCONNECTED', 'Room is not active')
  }

  const getIdentity = async (): Promise<OwnChatIdentity> => {
    const value = await request('identity.get', rpcIdentitySchema)
    identity = ownIdentity(value)
    return identity
  }

  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'client.ready', (raw: unknown) => {
      const ready = z.object({ identity: rpcIdentitySchema }).parse(raw)
      identity = ownIdentity(ready.identity)
      emitContractToRenderer(chatIdentityChangedContract, identity)
    })
  )
  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'room.event', (raw: unknown) => {
      emitContractToRenderer(chatTimelineContract, timelineItem(rpcEventSchema.parse(raw), identity?.identityKey))
    })
  )
  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'room.state', (raw: unknown) =>
      emitContractToRenderer(chatRoomStateContract, roomState(rpcStateSchema.parse(raw)))
    )
  )
  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'room.presence', (raw: unknown) =>
      emitContractToRenderer(chatRoomPresenceContract, roomPresence(rpcPresenceSchema.parse(raw)))
    )
  )
  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'dm.message', (raw: unknown) => {
      const direct = rpcDirectSchema.parse(raw)
      const peerKey = direct.peer_key
      const authorName = direct.direction === 'received' ? direct.author_name : ''
      const domain = direct.domain
      emitContractToRenderer(chatDmMessageContract, {
        room: direct.room,
        id: direct.id,
        peerKey,
        text: direct.text,
        ts: direct.timestamp * 1000,
        direction: direct.direction,
        identity: domain
          ? { tier: 'domain', name: domain, domain, fingerprint: peerKey.slice(0, 10) }
          : { tier: 'identity', name: authorName || `#${peerKey.slice(0, 10)}`, fingerprint: peerKey.slice(0, 10) },
      })
    })
  )
  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'identity.changed', (raw: unknown) => {
      identity = ownIdentity(rpcIdentitySchema.parse(raw))
      emitContractToRenderer(chatIdentityChangedContract, identity)
    })
  )
  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'room.connection', (value: unknown) => {
      const raw = rpcConnectionSchema.parse(value)
      const { room, status } = raw
      if (room !== wantedRoom) return
      const currentGeneration = generation
      const currentRefresh = ++refreshGeneration
      if (status === 'reconnecting') {
        activeRoom = null
        emitContractToRenderer(chatConnectionContract, {
          room,
          status: 'reconnecting',
          attempt: Number(raw.attempt ?? 1),
        })
      } else if (status === 'error') {
        activeRoom = null
        emitContractToRenderer(chatConnectionContract, {
          room,
          status: 'error',
          code: 'ROOM_UNAVAILABLE',
          message: String(raw.message ?? 'Room unavailable'),
          retryable: Boolean(raw.retryable ?? true),
        })
      } else if (status === 'connected') {
        void request(
          'room.getTimeline',
          rpcPageSchema.refine((page) => page.items.every((item) => item.room === room)),
          { room, limit: 100 }
        )
          .then((page) => {
            if (generation !== currentGeneration || currentRefresh !== refreshGeneration || wantedRoom !== room) return
            activeRoom = room
            emitContractToRenderer(chatConnectionContract, {
              room,
              status: 'connected',
              state: roomState(raw.state),
              connection: roomConnection(raw.connection),
              presence: roomPresence(raw.presence),
              timeline: {
                items: page.items.map((item) => timelineItem(item, identity?.identityKey)),
                hasMore: page.has_more,
              },
            })
          })
          .catch(() => {
            if (generation !== currentGeneration || currentRefresh !== refreshGeneration || wantedRoom !== room) return
            activeRoom = null
            emitContractToRenderer(chatConnectionContract, {
              room,
              status: 'error',
              code: 'CHAT_OPERATION_FAILED',
              message: 'Unable to refresh room history',
              retryable: true,
            })
          })
      }
    })
  )

  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'client.exit', () => {
      generation++
      activeRoom = null
      if (wantedRoom)
        emitContractToRenderer(chatConnectionContract, {
          room: wantedRoom,
          status: 'error',
          code: 'CHAT_NODE_UNREACHABLE',
          message: 'Messenger client disconnected',
          retryable: true,
        })
    })
  )
  registry.lifecycleRegistrations.add(
    onEmitter(manager, 'client.reconnecting', (attempt: number) => {
      if (wantedRoom)
        emitContractToRenderer(chatConnectionContract, { room: wantedRoom, status: 'reconnecting', attempt })
    })
  )

  secureContractHandle(chatConnectContract, async (roomArg?: string, nodeArg?: string) => {
    const reference = String(roomArg ?? '').trim()
    if (!reference) ipcFailure('INVALID_ROOM', 'Invalid room key or domain')
    const currentGeneration = ++generation
    activeRoom = null
    wantedRoom = null
    manager.setActive(true)
    try {
      identity ??= await getIdentity()
      if (generation !== currentGeneration) ipcFailure('CHAT_DISCONNECTED', 'Room selection changed')
      const canonical = rpcRoomKeySchema.safeParse(reference)
      const roomId = canonical.success
        ? canonical.data
        : (await request('room.resolve', z.object({ room: rpcRoomKeySchema }), { reference })).room
      if (generation !== currentGeneration) ipcFailure('CHAT_DISCONNECTED', 'Room selection changed')
      wantedRoom = roomId
      const joined = await request(
        'room.join',
        rpcJoinSchema.refine((joined) => joined.room === roomId),
        { reference: roomId, bootstrap: nodeArg?.trim() || undefined }
      )
      if (generation !== currentGeneration) ipcFailure('CHAT_DISCONNECTED', 'Room selection changed')
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
      if (generation === currentGeneration && !wantedRoom) manager.setActive(false)
      publicFailure(error)
    }
  })

  secureContractHandle(chatSendContract, async (roomId, text) => {
    requireRoom(roomId)
    try {
      const item = await request(
        'room.sendMessage',
        rpcEventSchema.refine((item) => item.room === roomId),
        { room: roomId, text }
      )
      const mapped = timelineItem(item, identity?.identityKey)
      if (mapped.kind !== 'message') ipcFailure('CHAT_PROTOCOL_INVALID', 'Messenger returned a non-message commit')
      return { sent: true as const, item: mapped, identity: identity ?? undefined }
    } catch (error) {
      publicFailure(error)
    }
  })

  secureContractHandle(chatDmSendContract, async (roomId, recipient, text) => {
    requireRoom(roomId)
    try {
      const sent = await request(
        'dm.send',
        rpcDirectSchema.refine(
          (item) => item.room === roomId && item.peer_key === recipient && item.direction === 'sent'
        ),
        {
          room: roomId,
          recipient,
          text: String(text),
        }
      )
      return { sent: true, id: sent.id, ts: sent.timestamp * 1000, identity: identity ?? undefined }
    } catch (error) {
      publicFailure(error)
    }
  })

  secureContractHandle(chatMutateContract, async (roomId, mutation) => {
    requireRoom(roomId)
    try {
      let method = ''
      let params: Record<string, unknown> = { room: roomId }
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
      const item = await request(
        method,
        rpcEventSchema.refine((item) => item.room === roomId),
        params
      )
      return { committed: true as const, item: timelineItem(item, identity?.identityKey) }
    } catch (error) {
      publicFailure(error)
    }
  })

  secureContractHandle(
    chatTimelineBeforeContract,
    async (roomId, beforeSeqno, limit = 100): Promise<ChatTimelinePage> => {
      requireRoom(roomId)
      try {
        const page = await request(
          'room.getTimeline',
          rpcPageSchema.refine((page) => page.items.every((item) => item.room === roomId)),
          {
            room: roomId,
            before_seqno: String(beforeSeqno),
            limit,
          }
        )
        return { items: page.items.map((item) => timelineItem(item, identity?.identityKey)), hasMore: page.has_more }
      } catch (error) {
        publicFailure(error)
      }
    }
  )

  secureContractHandle(chatIdentityContract, async () => {
    try {
      return await getIdentity()
    } catch (error) {
      publicFailure(error)
    }
  })
  secureContractHandle(chatLinkIdentityContract, async () => {
    try {
      return await getIdentity()
    } catch (error) {
      publicFailure(error)
    }
  })
  secureContractHandle(chatClaimDomainContract, async (domain) => {
    try {
      const value = await request('identity.confirmDomainLink', rpcIdentitySchema, { domain })
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
    try {
      identity = ownIdentity(await request('identity.clearDomain', rpcIdentitySchema))
      return identity
    } catch (error) {
      publicFailure(error)
    }
  })
  secureContractHandle(chatDetectDomainsContract, async () => ({ domains: [] }))
  secureContractHandle(chatResetIdentityContract, async () => {
    try {
      const current = identity ?? (await getIdentity())
      identity = ownIdentity(await request('identity.reset', rpcIdentitySchema, { expected_key: current.identityKey }))
      return identity
    } catch (error) {
      publicFailure(error)
    }
  })
  secureContractHandle(chatDisconnectContract, async () => {
    generation++
    activeRoom = null
    wantedRoom = null
    manager.setActive(false)
    return { disconnected: true as const }
  })
  secureContractHandle(chatLeaveContract, async (roomId) => {
    if (wantedRoom === roomId) {
      generation++
      activeRoom = null
      wantedRoom = null
      manager.setActive(false)
    }
    try {
      await request('room.leave', z.object({ left: z.literal(true) }), { reference: roomId })
      return { left: true as const }
    } catch (error) {
      publicFailure(error)
    }
  })
}
