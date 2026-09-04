/**
 * History Manager with 2 privacy modes:
 * - MEMORY: RAM only, cleared on exit (private/live mode)
 * - PERSISTENT: Automatically encrypted disk storage via OS keychain
 */

import { EventEmitter } from 'events'
import { createHash } from 'node:crypto'
import { getSetting } from '../settings'
import { HistoryStorageError, SafeStorageWrapper } from './safe-storage-wrapper'
import { createLogger } from '../../shared/logger'
import { HistoryEntry, HistoryStats, PrivacySettings } from '../../shared/types'
import { HistoryEntrySchema, type HistoryPersistenceError } from '../../shared/ipc-contract/history'
import { z } from 'zod'
const log = createLogger('history')

const HistoryFileSchema = z.array(HistoryEntrySchema)
const HISTORY_SCHEMA_VERSION = 1
const historyStorageOptions = {
  version: HISTORY_SCHEMA_VERSION,
  migrate: (raw: unknown) => raw,
  parse: (raw: unknown) => HistoryFileSchema.parse(raw),
}

export enum HistoryMode {
  MEMORY = 'memory',
  PERSISTENT = 'persistent',
}

export type { HistoryEntry, HistoryStats }

export class HistoryManager extends EventEmitter {
  private entries: Map<string, HistoryEntry> = new Map()
  private maxEntries: number = 1000
  private mode: HistoryMode = HistoryMode.MEMORY
  private storage: SafeStorageWrapper<HistoryEntry[]> | null = null
  private persistenceError?: HistoryPersistenceError
  private readyPromise: Promise<void>
  private isReady: boolean = false
  private pendingEntries: Array<{ url: string; title: string; favicon?: string; countVisit: boolean }> = []
  private settingsTransitionEntries: Array<{
    url: string
    title: string
    favicon?: string
    countVisit: boolean
  }> | null = null
  private settingsTransitionPromise: Promise<void> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private lastVisitKey: string = ''
  private lastVisitTime: number = 0
  private static readonly SAVE_DEBOUNCE_MS = 500
  private static readonly VISIT_DEDUP_MS = 1000

  constructor() {
    super()
    this.readyPromise = this.loadSettings().then(() => {
      this.isReady = true
      // Flush buffered entries that arrived before initialization completed
      if (this.pendingEntries.length > 0) {
        log.debug(`Flushing ${this.pendingEntries.length} buffered history entries`)
        for (const entry of this.pendingEntries) {
          this.addEntry(entry.url, entry.title, entry.favicon, entry.countVisit)
        }
        this.pendingEntries = []
      }
    })
  }

  async ready(): Promise<void> {
    return this.readyPromise
  }

  private createStorage(): SafeStorageWrapper<HistoryEntry[]> {
    return new SafeStorageWrapper('history', historyStorageOptions)
  }

  private async loadPersistedEntries(): Promise<void> {
    const storage = this.createStorage()
    if (!storage.isAvailable())
      throw new HistoryStorageError('encryption-unavailable', 'History encryption is unavailable')
    const data = await storage.read()
    const entries = new Map<string, HistoryEntry>()
    if (data && Array.isArray(data)) {
      data.forEach((entry) => {
        entries.set(entry.id, entry)
      })
      if (entries.size > this.maxEntries) {
        this.enforceLimitOn(entries, this.maxEntries)
        await storage.write([...entries.values()])
      }
      log.info(`Loaded ${entries.size} entries from persistent storage`)
    }
    this.entries = entries
    this.storage = storage
  }

  private async loadSettings(): Promise<void> {
    const settings = getSetting('privacy')
    this.mode = (settings.historyMode as HistoryMode) || HistoryMode.MEMORY
    this.maxEntries = settings.historyMaxEntries || 1000

    log.debug(`Mode: ${this.mode}, Max entries: ${this.maxEntries}`)

    // Initialize persistent storage if needed
    if (this.mode === HistoryMode.PERSISTENT) {
      try {
        await this.loadPersistedEntries()
      } catch (error) {
        log.error('Failed to load persistent history:', error)
        this.suspendPersistence(error)
      }
    }
  }

  private suspendPersistence(error: unknown): void {
    this.persistenceError = error instanceof HistoryStorageError ? error.code : 'io-error'
    this.mode = HistoryMode.MEMORY
    this.storage = null
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.emit('persistence-failed', this.persistenceError)
  }

  async applySettings(settings: PrivacySettings): Promise<void> {
    await this.readyPromise
    if (this.settingsTransitionPromise) throw new Error('History settings transition already in progress')
    const operation = this.applySettingsOnce(settings)
    this.settingsTransitionPromise = operation
    try {
      await operation
    } finally {
      if (this.settingsTransitionPromise === operation) this.settingsTransitionPromise = null
    }
  }

  private async applySettingsOnce(settings: PrivacySettings): Promise<void> {
    this.settingsTransitionEntries = []
    const nextMode = settings.historyMode as HistoryMode
    const previousMode = this.mode
    let nextEntries = this.entries
    let nextStorage = this.storage
    try {
      if (nextMode !== previousMode) {
        if (nextMode === HistoryMode.PERSISTENT) {
          const storage = this.createStorage()
          if (!storage.isAvailable())
            throw new HistoryStorageError('encryption-unavailable', 'History encryption is unavailable')
          const persisted = await storage.read()
          const entries = new Map<string, HistoryEntry>()
          for (const entry of persisted ?? []) entries.set(entry.id, entry)
          for (const entry of this.entries.values()) {
            const existing = entries.get(entry.id)
            if (!existing || entry.visitedAt >= existing.visitedAt) {
              entries.set(entry.id, {
                ...existing,
                ...entry,
                visitCount: Math.max(existing?.visitCount ?? 0, entry.visitCount),
              })
            }
          }
          this.enforceLimitOn(entries, settings.historyMaxEntries)
          await storage.write([...entries.values()])
          nextEntries = entries
          nextStorage = storage
        } else {
          await this.flushSave()
          nextStorage = null
        }
      }

      if (settings.historyMaxEntries < nextEntries.size) {
        if (nextMode === HistoryMode.PERSISTENT && previousMode === HistoryMode.PERSISTENT) {
          await this.flushSave()
        }
        const entries = new Map(nextEntries)
        this.enforceLimitOn(entries, settings.historyMaxEntries)
        if (nextMode === HistoryMode.PERSISTENT) {
          if (!nextStorage) throw new Error('Persistent history storage is unavailable')
          await nextStorage.write([...entries.values()])
        }
        nextEntries = entries
      }

      this.entries = nextEntries
      this.storage = nextStorage
      this.mode = nextMode
      this.maxEntries = settings.historyMaxEntries
      if (nextMode === HistoryMode.PERSISTENT) this.persistenceError = undefined
      if (nextMode !== previousMode) {
        this.emit('mode-changed', nextMode)
        log.info(`Mode changed: ${previousMode} → ${nextMode}`)
      }
    } catch (error) {
      if (nextStorage && nextStorage === this.storage) this.suspendPersistence(error)
      else this.persistenceError = error instanceof HistoryStorageError ? error.code : 'io-error'
      throw error
    } finally {
      const pending = this.settingsTransitionEntries
      this.settingsTransitionEntries = null
      for (const entry of pending ?? []) this.addEntry(entry.url, entry.title, entry.favicon, entry.countVisit)
    }
  }

  /**
   * Add or update a history entry.
   * @param countVisit - if false, only updates title/favicon without incrementing visitCount
   */
  addEntry(url: string, title: string, favicon?: string, countVisit: boolean = true): void {
    // Buffer entry if manager not yet ready (readyPromise not resolved)
    if (!this.isReady) {
      log.debug(`HistoryManager not ready, buffering entry: ${url}`)
      this.pendingEntries.push({ url, title, favicon, countVisit })
      return
    }
    if (this.settingsTransitionEntries) {
      this.settingsTransitionEntries.push({ url, title, favicon, countVisit })
      return
    }

    // Don't record internal pages
    if (url.startsWith('ton://') || url.startsWith('about:') || url.startsWith('data:')) {
      return
    }

    // Don't record empty/invalid URLs
    if (!url || url.length < 5 || url.length > 16_384) {
      return
    }

    const id = this.generateId(url)
    const existing = this.entries.get(id)

    if (existing) {
      // Update existing entry
      existing.title = (title || existing.title).slice(0, 4_096)
      if (countVisit) {
        const now = Date.now()
        const isDuplicate = id === this.lastVisitKey && now - this.lastVisitTime < HistoryManager.VISIT_DEDUP_MS
        if (!isDuplicate) {
          existing.visitedAt = now
          existing.visitCount++
          this.lastVisitKey = id
          this.lastVisitTime = now
        }
      }
      if (favicon) {
        existing.favicon = favicon
      }

      log.debug(`Updated: ${url} (visits: ${existing.visitCount})`)
    } else {
      // Create new entry
      const entry: HistoryEntry = {
        id,
        url,
        title: (title || url).slice(0, 4_096),
        visitedAt: Date.now(),
        visitCount: 1,
        favicon,
      }

      this.entries.set(id, entry)
      log.debug(`Added: ${url}`)

      // Enforce limit
      this.enforceLimit()
    }

    this.emit('entry-added', url)

    // Auto-save if persistent mode (debounced to batch rapid writes)
    if (this.mode === HistoryMode.PERSISTENT) {
      this.debouncedSave()
    }
  }

  private generateId(url: string): string {
    // Use URL as ID (remove fragments and query for deduplication)
    let cleanUrl = url
    try {
      const parsed = new URL(url)
      cleanUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`
    } catch {
      /* Preserve the existing normalization for nonstandard URLs. */
    }
    const legacyId = Buffer.from(cleanUrl).toString('base64url')
    return legacyId.length <= 256 ? legacyId : `sha256:${createHash('sha256').update(cleanUrl).digest('hex')}`
  }

  private enforceLimit(): void {
    this.enforceLimitOn(this.entries, this.maxEntries)
  }

  private enforceLimitOn(entries: Map<string, HistoryEntry>, maxEntries: number): void {
    if (entries.size <= maxEntries) {
      return
    }

    const sorted = Array.from(entries.values()).sort((a, b) => a.visitedAt - b.visitedAt)

    const toRemove = sorted.slice(0, sorted.length - maxEntries)
    toRemove.forEach((entry) => {
      entries.delete(entry.id)
    })

    log.info(`Enforced limit: removed ${toRemove.length} old entries`)
  }

  /**
   * Search history
   */
  async search(query: string, limit: number = 50): Promise<HistoryEntry[]> {
    await this.readyPromise
    const lowerQuery = query.toLowerCase()
    return Array.from(this.entries.values())
      .filter((entry) => entry.url.toLowerCase().includes(lowerQuery) || entry.title.toLowerCase().includes(lowerQuery))
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, limit)
  }

  /**
   * Get recent entries
   */
  async getRecent(limit: number = 100): Promise<HistoryEntry[]> {
    await this.readyPromise
    return Array.from(this.entries.values())
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, limit)
  }

  /**
   * Get top visited sites
   */
  getTopVisited(limit: number = 20): HistoryEntry[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.visitCount > 1)
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, limit)
  }

  /**
   * Get entries by date range
   */
  getByDateRange(startDate: number, endDate: number): HistoryEntry[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.visitedAt >= startDate && entry.visitedAt <= endDate)
      .sort((a, b) => b.visitedAt - a.visitedAt)
  }

  /**
   * Delete every entry visited within [startDate, endDate]. Returns the count.
   * One ranged op instead of one IPC round-trip + write per entry.
   */
  deleteByDateRange(startDate: number, endDate: number): number {
    this.assertNoSettingsTransition()
    let deleted = 0
    for (const entry of Array.from(this.entries.values())) {
      if (entry.visitedAt >= startDate && entry.visitedAt <= endDate) {
        this.entries.delete(entry.id)
        this.emit('entry-deleted', entry.id)
        deleted++
      }
    }
    if (deleted > 0 && this.mode === HistoryMode.PERSISTENT) {
      this.debouncedSave()
    }
    return deleted
  }

  /**
   * Delete single entry
   */
  deleteEntry(id: string): boolean {
    this.assertNoSettingsTransition()
    const deleted = this.entries.delete(id)

    if (deleted) {
      this.emit('entry-deleted', id)
      log.debug(`Deleted entry: ${id}`)

      // Auto-save if persistent (debounced)
      if (this.mode === HistoryMode.PERSISTENT) {
        this.debouncedSave()
      }
    }

    return deleted
  }

  /**
   * Delete entries by URL pattern
   */
  deleteByPattern(pattern: string): number {
    this.assertNoSettingsTransition()
    // Anti-ReDoS protection: validate pattern complexity
    if (!pattern || pattern.length > 500) {
      return 0
    }

    // Detect potentially dangerous patterns (catastrophic backtracking)
    const dangerousPatterns = [
      /(\*|\+|\{[0-9,]+\}){3,}/, // Multiple quantifiers in a row
      /(\(.*\+.*\))\1/, // Nested repeating groups
      /(.+\*){2,}/, // Multiple greedy quantifiers
    ]

    for (const dangerous of dangerousPatterns) {
      if (dangerous.test(pattern)) {
        throw new Error('Pattern contains potentially dangerous constructs')
      }
    }

    let regex: RegExp
    try {
      regex = new RegExp(pattern, 'i')
    } catch (err) {
      throw new Error(`Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`)
    }

    const toDelete: string[] = []

    for (const [id, entry] of this.entries) {
      try {
        if (regex.test(entry.url) || regex.test(entry.title)) {
          toDelete.push(id)
        }
      } catch (err) {
        // Skip entry if regex test fails (protection against edge cases)
        log.error(`Regex test failed for entry ${id}:`, err)
      }
    }

    toDelete.forEach((id) => this.entries.delete(id))

    if (toDelete.length > 0) {
      this.emit('entries-deleted', toDelete.length)
      log.debug(`Deleted ${toDelete.length} entries matching pattern: ${pattern}`)

      // Auto-save if persistent (debounced)
      if (this.mode === HistoryMode.PERSISTENT) {
        this.debouncedSave()
      }
    }

    return toDelete.length
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.assertNoSettingsTransition()
    const count = this.entries.size
    this.entries.clear()

    this.emit('cleared')
    log.info(`Cleared ${count} entries`)

    // Delete persistent file if exists
    if (this.mode === HistoryMode.PERSISTENT && this.storage) {
      this.storage.delete().catch((err) => {
        log.error('Failed to delete persistent history:', err)
      })
    }
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<HistoryStats> {
    await this.readyPromise
    const entries = Array.from(this.entries.values())

    return {
      total: entries.length,
      mode: this.mode,
      oldestEntry: entries.length > 0 ? Math.min(...entries.map((e) => e.visitedAt)) : undefined,
      newestEntry: entries.length > 0 ? Math.max(...entries.map((e) => e.visitedAt)) : undefined,
      isLocked: false,
      ...(this.persistenceError ? { persistenceError: this.persistenceError } : {}),
    }
  }

  /**
   * Check if persistent file exists
   */
  async hasPersistentFile(): Promise<boolean> {
    if (!this.storage) {
      const tempStorage = new SafeStorageWrapper('history', historyStorageOptions)
      return tempStorage.exists()
    }
    return this.storage.exists()
  }

  /**
   * Debounce save: batches rapid writes into a single disk write
   */
  private debouncedSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.savePersistent().catch((err) => {
        log.error('Auto-save failed:', err)
      })
    }, HistoryManager.SAVE_DEBOUNCE_MS)
  }

  /**
   * Flush any pending debounced save immediately
   */
  private async flushSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      await this.savePersistent()
    }
  }

  /**
   * Save to persistent storage (automatic encryption)
   */
  private async savePersistent(): Promise<void> {
    const storage = this.storage
    if (!storage || this.mode !== HistoryMode.PERSISTENT) {
      return
    }

    const entries = Array.from(this.entries.values())
    try {
      await storage.write(entries)
    } catch (error) {
      if (this.storage === storage) this.suspendPersistence(error)
      throw error
    }
    log.debug(`Saved ${entries.length} entries to persistent storage`)
  }

  /**
   * Called on app exit
   */
  async onAppExit(): Promise<void> {
    await this.readyPromise
    await this.settingsTransitionPromise?.catch(() => undefined)
    if (this.mode === HistoryMode.MEMORY) {
      // Clear everything
      this.clear()
      log.info('Memory cleared on exit')
    } else if (this.mode === HistoryMode.PERSISTENT) {
      // Flush debounced save + final save
      await this.flushSave()
      await this.savePersistent()
      log.info('Persistent history saved on exit')
    }
  }

  private assertNoSettingsTransition(): void {
    if (this.settingsTransitionPromise) throw new Error('History settings transition in progress')
  }
}

// Singleton removed: use ServiceRegistry from services.ts
