/**
 * Safe Storage Wrapper for transparent encryption/decryption
 * Uses Electron's safeStorage API (OS keychain: Keychain on macOS, DPAPI on Windows, libsecret on Linux)
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { ISecureStorage } from '../ports/secure-storage'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { createLogger } from '../../shared/logger'
import { isEnoent } from '../utils/errors'
import { writeFileAtomic } from '../utils/secure-fs'
import { SENC_MARKER, encodeSenc } from '../utils/senc'
import type { HistoryPersistenceError } from '../../shared/ipc-contract/history'
const log = createLogger('history')

export interface VersionedSafeStorageOptions<T> {
  version: number
  migrate(raw: unknown, storedVersion: number): unknown
  parse(raw: unknown): T
}

interface StoredEnvelope {
  schemaVersion: number
  payload: unknown
}

export class HistoryStorageError extends Error {
  constructor(
    readonly code: HistoryPersistenceError,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'HistoryStorageError'
  }
}

export class SafeStorageWrapper<T> {
  private storage: ISecureStorage
  private filePath: string
  private writeChain: Promise<void> = Promise.resolve()
  private failure: HistoryStorageError | null = null

  constructor(
    name: string,
    private readonly options: VersionedSafeStorageOptions<T>,
    storage: ISecureStorage = new ElectronSafeStorageAdapter(),
    basePath?: string
  ) {
    this.storage = storage
    const dir = basePath ?? app.getPath('userData')
    this.filePath = join(dir, `${name}.dat`)
    log.debug(`Storage path: ${this.filePath}`)
  }

  /**
   * Check if encryption is available on this platform
   */
  isAvailable(): boolean {
    return this.storage.isAvailable()
  }

  /**
   * Write data with automatic encryption.
   * Encrypted files are prefixed with the SENC marker.
   * Failed storage stays write-blocked; retry uses a fresh, validated instance.
   */
  async write(data: T): Promise<void> {
    let value: T
    try {
      value = this.options.parse(data)
    } catch (error) {
      throw this.block('invalid-data', 'Invalid history data', error)
    }
    const write = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        try {
          if (this.failure) throw this.failure
          const json = JSON.stringify({ schemaVersion: this.options.version, payload: value })
          if (!this.isAvailable()) {
            throw this.block('encryption-unavailable', 'History encryption is unavailable')
          }
          let markedBuffer: Buffer
          try {
            markedBuffer = encodeSenc(this.storage, json)
          } catch (error) {
            throw this.block('encryption-unavailable', 'History encryption failed', error)
          }
          await writeFileAtomic(this.filePath, markedBuffer)
          log.debug(`Wrote ${markedBuffer.length} encrypted bytes (with SENC marker)`)
        } catch (error) {
          log.error('Failed to write:', error)
          throw this.block('io-error', 'Unable to write encrypted history', error)
        }
      })
    this.writeChain = write
    await write
  }

  /**
   * Read data with automatic decryption.
   * Format is detected from the file contents — not from current encryption availability:
   *   - Starts with 'SENC' → new encrypted format (decrypt bytes after the marker)
   *   - Starts with '{' or '[' → plaintext JSON
   *   - Otherwise → legacy encrypted format (no marker)
   * Only a missing file returns null; unreadable data must not look like empty history.
   */
  async read(): Promise<T | null> {
    try {
      const buffer = await fs.readFile(this.filePath)

      // New encrypted format: SENC marker prefix
      if (buffer.subarray(0, 4).equals(SENC_MARKER)) {
        return this.decodeJson(this.decrypt(buffer.subarray(4)))
      }

      // Plaintext JSON (written when encryption was unavailable)
      const firstByte = buffer[0]
      if (firstByte === 0x7b /* '{' */ || firstByte === 0x5b /* '[' */) {
        const json = buffer.toString('utf-8')
        return this.decodeJson(json)
      }

      // Legacy encrypted format (written before SENC marker was introduced)
      log.info('Detected legacy encrypted file (no SENC marker), attempting decrypt')
      if (buffer.length === 0) throw this.block('invalid-data', 'History file is empty')
      return this.decodeJson(this.decrypt(buffer))
    } catch (error) {
      if (isEnoent(error)) return null
      log.error('Failed to read:', error)
      throw this.block('io-error', 'Unable to read history', error)
    }
  }

  private decode(raw: unknown): T {
    const envelope = asEnvelope(raw)
    if (envelope && envelope.schemaVersion > this.options.version) {
      throw this.block(
        'unsupported-version',
        `Unsupported schema version ${envelope.schemaVersion} for ${this.filePath}`
      )
    }
    const migrated = this.options.migrate(envelope?.payload ?? raw, envelope?.schemaVersion ?? 0)
    return this.options.parse(migrated)
  }

  private block(code: HistoryPersistenceError, message: string, cause?: unknown): HistoryStorageError {
    this.failure ??= cause instanceof HistoryStorageError ? cause : new HistoryStorageError(code, message, { cause })
    return this.failure
  }

  private decrypt(buffer: Buffer): string {
    if (!this.isAvailable()) throw this.block('encryption-unavailable', 'History encryption is unavailable')
    try {
      return this.storage.decrypt(buffer)
    } catch (error) {
      throw this.block('decryption-failed', 'Unable to decrypt history', error)
    }
  }

  private decodeJson(json: string): T {
    try {
      return this.decode(JSON.parse(json))
    } catch (error) {
      throw this.block('invalid-data', 'Invalid history data', error)
    }
  }

  /** Delete the encrypted file only on explicit request. */
  async delete(): Promise<void> {
    try {
      await this.writeChain.catch(() => undefined)
      await fs.unlink(this.filePath)
      log.info('Deleted storage file')
    } catch (error) {
      if (!isEnoent(error)) {
        log.error('Failed to delete:', error)
        throw error
      }
    }
  }

  /**
   * Check if file exists (async)
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.filePath)
      return true
    } catch {
      return false
    }
  }
}

function asEnvelope(raw: unknown): StoredEnvelope | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<StoredEnvelope>
  if (!Number.isInteger(candidate.schemaVersion) || (candidate.schemaVersion ?? -1) < 0 || !('payload' in candidate)) {
    return null
  }
  return { schemaVersion: candidate.schemaVersion as number, payload: candidate.payload }
}
