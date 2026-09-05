import { z } from 'zod'

const key = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const rpcRoomKeySchema = key
const sequence = z
  .string()
  .max(20)
  .regex(/^(0|[1-9]\d*)$/)
  .refine((value) => Number.isSafeInteger(Number(value)))
const timestamp = z
  .number()
  .int()
  .nonnegative()
  .max(Math.floor(8.64e15 / 1000))

export const rpcIdentitySchema = z.object({ key, name: z.string().max(64), domain: z.string().max(126).optional() })
const actor = z.object({ key, name: z.string().max(64), domain: z.string().max(126).optional() })
const event = z.object({
  room: key,
  event_id: key,
  seqno: sequence.refine((value) => Number(value) > 0),
  message_id: sequence,
  committed_at: timestamp,
  actor,
})

export const rpcEventSchema = z.discriminatedUnion('kind', [
  event.extend({ kind: z.literal('message'), text: z.string().max(2048) }),
  event.extend({ kind: z.literal('pin'), target_message_id: sequence }),
  event.extend({ kind: z.literal('unpin'), target_message_id: sequence }),
  event.extend({ kind: z.literal('metadata'), name: z.string().max(64), description: z.string().max(512) }),
  event.extend({ kind: z.literal('write-policy'), write_policy: z.enum(['everyone', 'admins']) }),
  event.extend({ kind: z.literal('admin-grant'), subject_key: key }),
  event.extend({ kind: z.literal('admin-revoke'), subject_key: key }),
  event.extend({ kind: z.literal('moderator-grant'), subject_key: key }),
  event.extend({ kind: z.literal('moderator-revoke'), subject_key: key }),
])

export const rpcStateSchema = z.object({
  room: key,
  name: z.string().max(64),
  description: z.string().max(512),
  write_policy: z.enum(['everyone', 'admins']),
  admins: z.array(key).max(64),
  moderators: z.array(key).max(256),
  pinned_messages: z.array(sequence).max(100),
  revision_seqno: sequence,
  latest_seqno: sequence,
})
export const rpcPresenceSchema = z.object({ room: key, online_users: z.number().int().nonnegative() })
const connection = z.object({ node_role: z.enum(['sequencer', 'relay']) })
export const rpcPageSchema = z
  .object({ items: z.array(rpcEventSchema).max(256), has_more: z.boolean() })
  .refine((page) => !page.has_more || page.items.length > 0)
export const rpcJoinSchema = z
  .object({
    room: key,
    state: rpcStateSchema,
    connection,
    presence: rpcPresenceSchema,
    timeline: rpcPageSchema,
  })
  .refine(
    (joined) =>
      joined.state.room === joined.room &&
      joined.presence.room === joined.room &&
      joined.timeline.items.every((item) => item.room === joined.room)
  )
export const rpcConnectionSchema = z
  .discriminatedUnion('status', [
    z.object({ room: key, status: z.literal('reconnecting'), attempt: z.number().int().positive().optional() }),
    z.object({ room: key, status: z.literal('error'), message: z.string(), retryable: z.boolean() }),
    z.object({
      room: key,
      status: z.literal('connected'),
      state: rpcStateSchema,
      connection,
      presence: rpcPresenceSchema,
    }),
  ])
  .refine(
    (value) => value.status !== 'connected' || (value.state.room === value.room && value.presence.room === value.room)
  )
export const rpcDirectSchema = z.object({
  room: key,
  id: key,
  peer_key: key,
  text: z.string().max(1400),
  timestamp,
  direction: z.enum(['sent', 'received']),
  author_name: z.string().max(64),
  domain: z.string().max(126).optional(),
})

export type RpcIdentity = z.infer<typeof rpcIdentitySchema>
export type RpcEvent = z.infer<typeof rpcEventSchema>
export type RpcState = z.infer<typeof rpcStateSchema>
export type RpcPresence = z.infer<typeof rpcPresenceSchema>
export type RpcConnection = z.infer<typeof connection>
