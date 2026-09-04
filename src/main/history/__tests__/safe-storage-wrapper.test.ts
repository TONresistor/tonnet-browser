import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import fixture from './fixtures/history-v0.json'
import type { ISecureStorage } from '../../ports/secure-storage'
import { SENC_MARKER } from '../../utils/senc'

vi.mock('electron', () => ({
  app: { getPath: () => '/unused' },
  safeStorage: {},
}))

import { SafeStorageWrapper } from '../safe-storage-wrapper'

class IdentitySecureStorage implements ISecureStorage {
  isAvailable = () => true
  encrypt = (plaintext: string) => Buffer.concat([Buffer.from([0xff]), Buffer.from(plaintext)])
  decrypt = (encrypted: Buffer) => encrypted.subarray(1).toString('utf8')
  getBackendName = () => 'test'
}

const directories: string[] = []
const EntrySchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  visitedAt: z.number(),
  visitCount: z.number(),
})
const FileSchema = z.array(EntrySchema)
const options = { version: 1, migrate: (raw: unknown) => raw, parse: (raw: unknown) => FileSchema.parse(raw) }

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'history-fixture-'))
  directories.push(directory)
  return {
    directory,
    filePath: join(directory, 'history.dat'),
    storage: new SafeStorageWrapper('history', options, new IdentitySecureStorage(), directory),
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('SafeStorageWrapper version migration', () => {
  it('loads the frozen unversioned plaintext fixture and rewrites a versioned envelope', async () => {
    const { filePath, storage } = await setup()
    await writeFile(filePath, JSON.stringify(fixture))

    await expect(storage.read()).resolves.toEqual(fixture)
    await storage.write(fixture)

    const persisted = JSON.parse((await readFile(filePath)).subarray(5).toString('utf8'))
    expect(persisted).toEqual({ schemaVersion: 1, payload: fixture })
  })

  it('loads the legacy encrypted format without a marker', async () => {
    const { filePath, storage } = await setup()
    await writeFile(filePath, Buffer.concat([Buffer.from([0xff]), Buffer.from(JSON.stringify(fixture))]))
    await expect(storage.read()).resolves.toEqual(fixture)
  })

  it('writes and validates the current SENC envelope', async () => {
    const { filePath, storage } = await setup()
    await storage.write(fixture)
    const persisted = await readFile(filePath)

    expect(persisted.subarray(0, 4)).toEqual(SENC_MARKER)
    expect(JSON.parse(persisted.subarray(5).toString('utf8'))).toEqual({ schemaVersion: 1, payload: fixture })
  })

  it('rejects invalid migrated payloads instead of admitting corrupt state', async () => {
    const { filePath, storage } = await setup()
    await writeFile(filePath, JSON.stringify([{ id: 4 }]))
    await expect(storage.read()).rejects.toThrow()
  })

  it('rejects documents from an unsupported future schema version', async () => {
    const { filePath, storage } = await setup()
    await writeFile(filePath, JSON.stringify({ schemaVersion: 2, payload: fixture }))
    await expect(storage.read()).rejects.toThrow('Unsupported schema version 2')
  })

  it('serializes concurrent writes and leaves the last complete document', async () => {
    const { filePath, storage } = await setup()
    const first = fixture.map((entry) => ({ ...entry, title: 'First' }))
    const second = fixture.map((entry) => ({ ...entry, title: 'Second' }))

    await Promise.all([storage.write(first), storage.write(second)])

    expect(JSON.parse((await readFile(filePath)).subarray(5).toString('utf8'))).toEqual({
      schemaVersion: 1,
      payload: second,
    })
  })

  it.each(['unavailable', 'decrypt', 'future', 'invalid'])(
    'preserves an unreadable encrypted file: %s',
    async (failure) => {
      const { directory, filePath } = await setup()
      const secure = new IdentitySecureStorage()
      const json = JSON.stringify({
        schemaVersion: failure === 'future' ? 2 : 1,
        payload: failure === 'invalid' ? [{ id: 4 }] : fixture,
      })
      const bytes = Buffer.concat([SENC_MARKER, secure.encrypt(json)])
      await writeFile(filePath, bytes)
      if (failure === 'unavailable') secure.isAvailable = () => false
      if (failure === 'decrypt')
        secure.decrypt = () => {
          throw new Error('locked')
        }
      const storage = new SafeStorageWrapper('history', options, secure, directory)
      const codes = {
        unavailable: 'encryption-unavailable',
        decrypt: 'decryption-failed',
        future: 'unsupported-version',
        invalid: 'invalid-data',
      }
      await expect(storage.read()).rejects.toMatchObject({ code: codes[failure as keyof typeof codes] })
      // A failed instance cannot overwrite the original, even when the OS recovers.
      secure.isAvailable = () => true
      await expect(storage.write(fixture)).rejects.toThrow()
      expect(await readFile(filePath)).toEqual(bytes)
    }
  )

  it('rejects queued writes when encryption becomes unavailable, without a plaintext fallback', async () => {
    const { directory, filePath } = await setup()
    const secure = new IdentitySecureStorage()
    const storage = new SafeStorageWrapper('history', options, secure, directory)
    await storage.write(fixture)
    const original = await readFile(filePath)
    const first = storage.write([])
    const second = storage.write(fixture)
    secure.isAvailable = () => false
    const outcomes = await Promise.allSettled([first, second])
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected'])
    expect(await readFile(filePath)).toEqual(original)
  })
})
