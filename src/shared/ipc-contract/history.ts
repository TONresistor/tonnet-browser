import { z } from 'zod'
import { HISTORY_CHANNELS } from './channels'
import { defineRequest } from './definition'

export const HistoryEntrySchema = z.object({
  id: z.string().min(1).max(256),
  url: z.string().min(1).max(16_384),
  title: z.string().max(4_096),
  visitedAt: z.number().finite().nonnegative(),
  visitCount: z.number().int().nonnegative(),
  favicon: z.string().max(1_048_576).optional(),
})
export const HistoryPersistenceErrorSchema = z.enum([
  'encryption-unavailable',
  'decryption-failed',
  'invalid-data',
  'unsupported-version',
  'io-error',
])
export type HistoryPersistenceError = z.infer<typeof HistoryPersistenceErrorSchema>
export const HistoryStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  mode: z.enum(['memory', 'persistent']),
  oldestEntry: z.number().finite().nonnegative().optional(),
  newestEntry: z.number().finite().nonnegative().optional(),
  isLocked: z.boolean(),
  persistenceError: HistoryPersistenceErrorSchema.optional(),
})
const LimitSchema = z.number().int().min(1).max(1_000).optional()
const DateRangeSchema = z
  .tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()])
  .refine(([start, end]) => start <= end, { message: 'startDate must not exceed endDate' })
const MutationSchema = z.object({ success: z.boolean() })
const CountMutationSchema = MutationSchema.extend({ count: z.number().int().nonnegative() })
const base = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
  redaction: 'sensitive' as const,
}
const request = <const TChannel extends string, TInput extends readonly unknown[], TOutput>(
  channel: TChannel,
  input: z.ZodType<TInput>,
  output: z.ZodType<TOutput>,
  errors: readonly string[]
) => defineRequest({ ...base, channel, input, output, errors })

export const historyChangeModeContract = request(
  HISTORY_CHANNELS.changeMode,
  z.tuple([z.enum(['memory', 'persistent'])]),
  MutationSchema,
  ['INVALID_HISTORY_MODE', 'HISTORY_MODE_CHANGE_FAILED']
)
export const historySearchContract = request(
  HISTORY_CHANNELS.search,
  z.tuple([z.string().max(4_096), LimitSchema]),
  z.array(HistoryEntrySchema),
  ['HISTORY_SEARCH_FAILED']
)
export const historyGetRecentContract = request(
  HISTORY_CHANNELS.getRecent,
  z.tuple([LimitSchema]),
  z.array(HistoryEntrySchema),
  ['HISTORY_READ_FAILED']
)
export const historyGetTopContract = request(
  HISTORY_CHANNELS.getTop,
  z.tuple([LimitSchema]),
  z.array(HistoryEntrySchema),
  ['HISTORY_READ_FAILED']
)
export const historyGetByDateContract = request(
  HISTORY_CHANNELS.getByDate,
  DateRangeSchema,
  z.array(HistoryEntrySchema),
  ['INVALID_DATE_RANGE', 'HISTORY_READ_FAILED']
)
export const historyDeleteContract = request(
  HISTORY_CHANNELS.delete,
  z.tuple([z.string().min(1).max(256)]),
  MutationSchema,
  ['INVALID_HISTORY_ID', 'HISTORY_DELETE_FAILED']
)
export const historyDeleteByDateContract = request(
  HISTORY_CHANNELS.deleteByDate,
  DateRangeSchema,
  CountMutationSchema,
  ['INVALID_DATE_RANGE', 'HISTORY_DELETE_FAILED']
)
export const historyDeletePatternContract = request(
  HISTORY_CHANNELS.deletePattern,
  z.tuple([z.string().min(1).max(4_096)]),
  CountMutationSchema,
  ['INVALID_HISTORY_PATTERN', 'HISTORY_DELETE_FAILED']
)
export const historyClearContract = request(HISTORY_CHANNELS.clear, z.tuple([]), MutationSchema, [
  'HISTORY_CLEAR_FAILED',
])
export const historyGetStatsContract = request(HISTORY_CHANNELS.getStats, z.tuple([]), HistoryStatsSchema, [
  'HISTORY_STATS_FAILED',
])
export const historyHasPersistentFileContract = request(HISTORY_CHANNELS.hasPersistentFile, z.tuple([]), z.boolean(), [
  'HISTORY_STORAGE_CHECK_FAILED',
])

export const HISTORY_REQUEST_CONTRACTS = [
  historyChangeModeContract,
  historySearchContract,
  historyGetRecentContract,
  historyGetTopContract,
  historyGetByDateContract,
  historyDeleteContract,
  historyDeleteByDateContract,
  historyDeletePatternContract,
  historyClearContract,
  historyGetStatsContract,
  historyHasPersistentFileContract,
] as const
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>
export type HistoryStats = z.infer<typeof HistoryStatsSchema>
