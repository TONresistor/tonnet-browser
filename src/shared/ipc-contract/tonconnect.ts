import { z } from 'zod'
import { defineEvent, defineRequest } from './definition'
import { TONCONNECT_CHANNELS } from './channels'

const DomainSchema = z.string().min(1).max(253)
const AppRequestSchema = z.object({
  method: z.string().min(1),
  params: z.array(z.string()),
  id: z.string().min(1),
})
const ConnectRequestSchema = z.object({
  manifestUrl: z.string().url(),
  items: z.array(
    z.union([
      z.object({ name: z.literal('ton_addr') }),
      z.object({ name: z.literal('ton_proof'), payload: z.string() }),
    ])
  ),
})

export const TonConnectRequestPayloadSchema = z.object({
  method: z.enum(['connect', 'restore', 'send', 'disconnect']),
  protocolVersion: z.number().int().positive().optional(),
  request: ConnectRequestSchema.optional(),
  message: AppRequestSchema.optional(),
})

const ConnectItemReplySchema = z.union([
  z.object({
    name: z.literal('ton_addr'),
    address: z.string(),
    network: z.string(),
    publicKey: z.string(),
    walletStateInit: z.string(),
  }),
  z.object({
    name: z.literal('ton_proof'),
    proof: z.object({
      timestamp: z.number().int().nonnegative(),
      domain: z.object({ lengthBytes: z.number().int().nonnegative(), value: z.string() }),
      signature: z.string(),
      payload: z.string(),
    }),
  }),
  z.object({ name: z.literal('ton_proof'), error: z.object({ code: z.number(), message: z.string().optional() }) }),
])

const DeviceInfoSchema = z.object({
  platform: z.string(),
  appName: z.string(),
  appVersion: z.string(),
  maxProtocolVersion: z.number().int(),
  features: z.array(
    z.object({
      name: z.string(),
      maxMessages: z.number().int().optional(),
      extraCurrencySupported: z.boolean().optional(),
      types: z.array(z.string()).optional(),
    })
  ),
})

const ConnectEventSchema = z.union([
  z.object({
    event: z.literal('connect'),
    id: z.number().int().nonnegative(),
    payload: z.object({ items: z.array(ConnectItemReplySchema), device: DeviceInfoSchema }),
  }),
  z.object({
    event: z.literal('connect_error'),
    id: z.number().int().nonnegative(),
    payload: z.object({ code: z.number(), message: z.string() }),
  }),
])

const WalletResponseSchema = z.union([
  z.object({ id: z.string(), result: z.union([z.string(), z.record(z.string(), z.unknown())]) }),
  z.object({
    id: z.string(),
    error: z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() }),
  }),
])

export const TonConnectResponseSchema = z.union([ConnectEventSchema, WalletResponseSchema])

export const TonConnectSessionSchema = z
  .object({
    domain: DomainSchema,
    appName: z.string(),
    appIconUrl: z.string().optional(),
    url: z.string(),
    grantedAt: z.number().nonnegative(),
  })
  .passthrough()

export const tonConnectRequestContract = defineRequest({
  channel: TONCONNECT_CHANNELS.request,
  direction: 'request',
  caller: 'tonsite',
  authorization: 'owning-tonsite-session',
  rateLimit: { kind: 'fixed-window', maxRequests: 10, windowMs: 1_000, key: 'domain' },
  input: z.tuple([TonConnectRequestPayloadSchema]),
  output: TonConnectResponseSchema,
  errors: ['BAD_REQUEST', 'UNKNOWN_APP', 'USER_DECLINED', 'METHOD_NOT_SUPPORTED', 'UNKNOWN'],
  redaction: 'secret',
})

export const tonConnectAvailabilityContract = defineRequest({
  channel: TONCONNECT_CHANNELS.availability,
  direction: 'request',
  caller: 'tonsite',
  authorization: 'owning-tonsite-session',
  rateLimit: { kind: 'none' },
  input: z.tuple([]),
  output: z.object({ enabled: z.boolean() }),
  errors: ['TONCONNECT_AVAILABILITY_FAILED'],
  redaction: 'public',
})

export const tonConnectGetSessionsContract = defineRequest({
  channel: TONCONNECT_CHANNELS.getSessions,
  direction: 'request',
  caller: 'main-renderer',
  authorization: 'main-window',
  rateLimit: { kind: 'none' },
  input: z.tuple([]),
  output: z.array(TonConnectSessionSchema),
  errors: ['SESSION_READ_FAILED', 'TONCONNECT_UNAVAILABLE'],
  redaction: 'sensitive',
})

export const tonConnectDisconnectSessionContract = defineRequest({
  channel: TONCONNECT_CHANNELS.disconnectSession,
  direction: 'request',
  caller: 'main-renderer',
  authorization: 'main-window',
  rateLimit: { kind: 'none' },
  input: z.tuple([DomainSchema]),
  output: z.object({ success: z.literal(true) }),
  errors: ['UNKNOWN_APP', 'SESSION_DELETE_FAILED', 'TONCONNECT_UNAVAILABLE'],
  redaction: 'sensitive',
})

export const tonConnectEventContract = defineEvent({
  channel: TONCONNECT_CHANNELS.event,
  direction: 'event',
  recipient: 'tonsite',
  payload: z.tuple([
    z.object({ event: z.literal('disconnect'), id: z.number().int().nonnegative(), payload: z.object({}) }),
  ]),
  redaction: 'sensitive',
})

export type TonConnectRequestPayload = z.infer<typeof TonConnectRequestPayloadSchema>
