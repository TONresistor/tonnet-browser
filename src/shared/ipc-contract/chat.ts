import { z } from 'zod'
import { defineEvent, defineRequest } from './definition'
import { CHAT_CHANNELS } from './channels'

const IdentityKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export const ChatIdentityInfoSchema = z.object({
  tier: z.enum(['domain', 'identity']),
  name: z.string(),
  domain: z.string().optional(),
  fingerprint: z.string().optional(),
})

export const OwnChatIdentitySchema = z.object({
  identityKey: IdentityKeySchema,
  name: z.string().max(64),
  domain: z.string().optional(),
})

const mainBase = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
  redaction: 'sensitive' as const,
}
const optionalInput = z.string().min(1).max(4_096).optional()
const ChatPublicErrorCodes = [
  'CHAT_IDENTITY_BINDING_FAILED',
  'CHAT_PERMISSION_DENIED',
  'CHAT_SEQUENCER_UNAVAILABLE',
  'CHAT_NODE_UNREACHABLE',
  'CHAT_TIMEOUT',
  'CHAT_CLOCK_SKEW',
  'CHAT_PROTOCOL_INVALID',
  'CHAT_UNKNOWN_MESSAGE',
  'CHAT_ROLE_CONFLICT',
  'CHAT_LIMIT_EXCEEDED',
  'CHAT_OPERATION_FAILED',
  'CHAT_DISCONNECTED',
  'CHAT_INVALID_ARGUMENT',
  'CHAT_INVALID_IDENTITY_DOMAIN',
] as const
const EventIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const MessageIdSchema = z.string().regex(/^[1-9]\d*$/)
const TimelineBaseSchema = z.object({
  room: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  eventId: EventIdSchema,
  seqno: z.number().int().positive(),
  ts: z.number().finite(),
  actorKey: IdentityKeySchema,
})

export const ChatTimelineMessageSchema = TimelineBaseSchema.extend({
  kind: z.literal('message'),
  messageId: MessageIdSchema,
  nick: z.string(),
  text: z.string().max(4_000),
  self: z.boolean(),
  identity: ChatIdentityInfoSchema,
})

const roleTimelineItem = <TKind extends 'admin-grant' | 'admin-revoke' | 'moderator-grant' | 'moderator-revoke'>(
  kind: TKind
) => TimelineBaseSchema.extend({ kind: z.literal(kind), subjectKey: IdentityKeySchema })
const pinTimelineItem = <TKind extends 'pin' | 'unpin'>(kind: TKind) =>
  TimelineBaseSchema.extend({ kind: z.literal(kind), targetMessageId: MessageIdSchema })

export const ChatTimelineSystemSchema = z.discriminatedUnion('kind', [
  roleTimelineItem('admin-grant'),
  roleTimelineItem('admin-revoke'),
  roleTimelineItem('moderator-grant'),
  roleTimelineItem('moderator-revoke'),
  pinTimelineItem('pin'),
  pinTimelineItem('unpin'),
  TimelineBaseSchema.extend({
    kind: z.literal('metadata'),
    name: z.string().max(64),
    description: z.string().max(512),
  }),
  TimelineBaseSchema.extend({ kind: z.literal('write-policy'), anyoneCanWrite: z.boolean() }),
])

export const ChatTimelineItemSchema = z.discriminatedUnion('kind', [
  ChatTimelineMessageSchema,
  ...ChatTimelineSystemSchema.options,
])
export type ChatTimelineMessage = z.infer<typeof ChatTimelineMessageSchema>
export type ChatTimelineSystem = z.infer<typeof ChatTimelineSystemSchema>
export type ChatTimelineItem = z.infer<typeof ChatTimelineItemSchema>

export const ChatTimelinePageSchema = z.object({
  items: z.array(ChatTimelineItemSchema).max(256),
  hasMore: z.boolean(),
})
export type ChatTimelinePage = z.infer<typeof ChatTimelinePageSchema>
const sendResult = z.object({
  sent: z.boolean(),
  needsLink: z.boolean().optional(),
  identity: OwnChatIdentitySchema.optional(),
})
const publicSendResult = z.discriminatedUnion('sent', [
  z.object({
    sent: z.literal(true),
    item: ChatTimelineMessageSchema,
    identity: OwnChatIdentitySchema.optional(),
  }),
  z.object({
    sent: z.literal(false),
    needsLink: z.boolean().optional(),
    identity: OwnChatIdentitySchema.optional(),
  }),
])

export const ChatRoomStateSchema = z.object({
  roomId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  name: z.string().max(64),
  description: z.string().max(512),
  writePolicy: z.enum(['everyone', 'admins']),
  admins: z.array(IdentityKeySchema).max(64),
  moderators: z.array(IdentityKeySchema).max(256),
  pinnedMessages: z.array(z.string().regex(/^[1-9]\d*$/)).max(100),
  revisionSeqno: z.number().int().nonnegative(),
  latestSeqno: z.number().int().nonnegative(),
})
export type ChatRoomState = z.infer<typeof ChatRoomStateSchema>

export const ChatRoomConnectionSchema = z.object({
  nodeRole: z.enum(['sequencer', 'relay']),
})
export type ChatRoomConnection = z.infer<typeof ChatRoomConnectionSchema>

export const ChatRoomPresenceSchema = z.object({
  roomId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  onlineUsers: z.number().int().nonnegative(),
})
export type ChatRoomPresence = z.infer<typeof ChatRoomPresenceSchema>

export const ChatConnectionEventSchema = z.discriminatedUnion('status', [
  z.object({
    room: z.string().min(1),
    status: z.literal('reconnecting'),
    reference: z.string().min(1).optional(),
    attempt: z.number().int().positive().optional(),
  }),
  z.object({
    room: z.string().min(1),
    status: z.literal('connected'),
    reference: z.string().min(1).optional(),
    state: ChatRoomStateSchema,
    connection: ChatRoomConnectionSchema,
    presence: ChatRoomPresenceSchema,
    timeline: ChatTimelinePageSchema,
  }),
  z.object({
    room: z.string().min(1),
    status: z.literal('error'),
    reference: z.string().min(1).optional(),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
])
export type ChatConnectionEvent = z.infer<typeof ChatConnectionEventSchema>

export const chatConnectContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.connect,
  input: z.tuple([optionalInput, optionalInput]),
  output: z.object({
    connected: z.literal(true),
    room: z.string().min(1),
    via: z.enum(['node', 'dht']),
    state: ChatRoomStateSchema,
    connection: ChatRoomConnectionSchema,
    presence: ChatRoomPresenceSchema,
    timeline: ChatTimelinePageSchema,
  }),
  errors: [
    'INVALID_ROOM',
    'INVALID_NODE_ID',
    'MESSENGER_DISABLED',
    'BRIDGE_DISCONNECTED',
    'ROOM_UNAVAILABLE',
    ...ChatPublicErrorCodes,
  ],
})
export const chatSendContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.send,
  input: z.tuple([IdentityKeySchema, z.string().max(16_384)]),
  output: publicSendResult,
  errors: ['CHAT_DISCONNECTED', 'SEND_FAILED', ...ChatPublicErrorCodes],
  redaction: 'secret',
})
export const chatDmSendContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.dmSend,
  input: z.tuple([IdentityKeySchema, IdentityKeySchema, z.string().max(16_384)]),
  output: sendResult.extend({ id: z.string().optional(), ts: z.number().finite().optional() }),
  errors: ['CHAT_DISCONNECTED', 'INVALID_RECIPIENT', 'SEND_FAILED', ...ChatPublicErrorCodes],
  redaction: 'secret',
})
export const chatMutateContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.mutate,
  input: z.tuple([
    IdentityKeySchema,
    z.object({
      action: z.enum(['metadata', 'pin', 'unpin', 'moderator-grant', 'moderator-revoke', 'write-policy']),
      name: z.string().max(64).optional(),
      description: z.string().max(512).optional(),
      messageId: z
        .string()
        .regex(/^[1-9]\d*$/)
        .optional(),
      subjectKey: IdentityKeySchema.optional(),
      anyoneCanWrite: z.boolean().optional(),
    }),
  ]),
  output: z.object({ committed: z.literal(true), item: ChatTimelineSystemSchema }),
  errors: ['CHAT_DISCONNECTED', 'INVALID_MUTATION', 'MUTATION_REJECTED', ...ChatPublicErrorCodes],
})
export const chatDisconnectContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.disconnect,
  input: z.tuple([]),
  output: z.object({ disconnected: z.literal(true) }),
  errors: ['DISCONNECT_FAILED'],
})
export const chatLeaveContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.leave,
  input: z.tuple([IdentityKeySchema]),
  output: z.object({ left: z.literal(true) }),
  errors: ['DISCONNECT_FAILED', ...ChatPublicErrorCodes],
})
const identityRequest = <const TChannel extends string>(channel: TChannel) =>
  defineRequest({
    ...mainBase,
    channel,
    input: z.tuple([]),
    output: OwnChatIdentitySchema,
    errors: ['IDENTITY_FAILED', ...ChatPublicErrorCodes],
  })
export const chatIdentityContract = identityRequest(CHAT_CHANNELS.identity)
export const chatLinkIdentityContract = identityRequest(CHAT_CHANNELS.linkIdentity)
export const chatClearDomainContract = identityRequest(CHAT_CHANNELS.clearDomain)
export const chatResetIdentityContract = identityRequest(CHAT_CHANNELS.resetIdentity)
export const chatClaimDomainContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.claimDomain,
  input: z.tuple([z.string().min(1).max(253)]),
  output: z.object({ ok: z.boolean(), reason: z.string().optional(), identity: OwnChatIdentitySchema }),
  errors: ['INVALID_DOMAIN', 'DOMAIN_CLAIM_FAILED'],
})
export const chatDetectDomainsContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.detectDomains,
  input: z.tuple([]),
  output: z.object({ domains: z.array(z.string().min(1).max(253)).max(10_000) }),
  errors: ['DOMAIN_DETECTION_FAILED'],
})

export const chatTimelineBeforeContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.timelineBefore,
  input: z.tuple([IdentityKeySchema, z.number().int().positive(), z.number().int().min(1).max(256).optional()]),
  output: ChatTimelinePageSchema,
  errors: ['CHAT_DISCONNECTED', 'HISTORY_FAILED', ...ChatPublicErrorCodes],
})
export const ChatDmMessageSchema = z.object({
  room: z.string().optional(),
  id: z.string().min(1),
  peerKey: IdentityKeySchema,
  text: z.string().max(4_000),
  ts: z.number().finite(),
  identity: ChatIdentityInfoSchema,
  direction: z.enum(['sent', 'received']),
})
export const chatTimelineContract = defineEvent({
  channel: CHAT_CHANNELS.timeline,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([ChatTimelineItemSchema]),
  redaction: 'secret',
})
export const chatDmMessageContract = defineEvent({
  channel: CHAT_CHANNELS.dmMessage,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([ChatDmMessageSchema]),
  redaction: 'secret',
})
export const chatConnectionContract = defineEvent({
  channel: CHAT_CHANNELS.connection,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([ChatConnectionEventSchema]),
  redaction: 'public',
})

export const chatRoomStateContract = defineEvent({
  channel: CHAT_CHANNELS.roomState,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([ChatRoomStateSchema]),
  redaction: 'public',
})

export const chatRoomPresenceContract = defineEvent({
  channel: CHAT_CHANNELS.roomPresence,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([ChatRoomPresenceSchema]),
  redaction: 'public',
})

export const chatIdentityChangedContract = defineEvent({
  channel: CHAT_CHANNELS.identityChanged,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([OwnChatIdentitySchema]),
  redaction: 'sensitive',
})

export const CHAT_REQUEST_CONTRACTS = [
  chatConnectContract,
  chatSendContract,
  chatDmSendContract,
  chatMutateContract,
  chatTimelineBeforeContract,
  chatDisconnectContract,
  chatLeaveContract,
  chatIdentityContract,
  chatLinkIdentityContract,
  chatClaimDomainContract,
  chatClearDomainContract,
  chatDetectDomainsContract,
  chatResetIdentityContract,
] as const
export const CHAT_EVENT_CONTRACTS = [
  chatTimelineContract,
  chatDmMessageContract,
  chatConnectionContract,
  chatRoomStateContract,
  chatRoomPresenceContract,
  chatIdentityChangedContract,
] as const
