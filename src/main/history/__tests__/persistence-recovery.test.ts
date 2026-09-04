import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ directory: '', available: true, decryptFails: false }))
vi.mock('electron', () => ({
  app: { getPath: () => runtime.directory },
  safeStorage: {
    isEncryptionAvailable: () => runtime.available,
    encryptString: (value: string) => Buffer.concat([Buffer.from([0xff]), Buffer.from(value)]),
    decryptString: (value: Buffer) => {
      if (runtime.decryptFails) throw new Error('Keychain refused access')
      return value.subarray(1).toString('utf8')
    },
  },
}))
vi.mock('../../settings', () => ({ getSetting: () => ({ historyMode: 'persistent', historyMaxEntries: 100 }) }))

import { HistoryManager } from '../manager'

const persisted = { id: 'old', url: 'http://old.ton/', title: 'Old', visitCount: 1, visitedAt: 1 }
let original: Buffer
let file: string
beforeEach(async () => {
  runtime.directory = await mkdtemp(join(tmpdir(), 'browser-history-recovery-'))
  runtime.available = true
  runtime.decryptFails = false
  file = join(runtime.directory, 'history.dat')
  original = Buffer.concat([
    Buffer.from('SENC'),
    Buffer.from([0xff]),
    Buffer.from(JSON.stringify({ schemaVersion: 1, payload: [persisted] })),
  ])
  await writeFile(file, original)
})
afterEach(async () => {
  await rm(runtime.directory, { recursive: true, force: true })
})

describe('real history persistence recovery', () => {
  it('persists long supported URLs without oversized IDs or fallback titles', async () => {
    const manager = new HistoryManager()
    await manager.ready()
    manager.addEntry('http://site.ton/' + 'x'.repeat(400), 'Long path')
    manager.addEntry('http://site.ton/#' + 'x'.repeat(5_000), '')
    await manager.onAppExit()
    expect((await manager.getStats()).mode).toBe('persistent')
    const entries = JSON.parse((await readFile(file)).subarray(5).toString()).payload
    expect(entries).toHaveLength(3)
    expect(
      entries.every((entry: { id: string; title: string }) => entry.id.length <= 256 && entry.title.length <= 4_096)
    ).toBe(true)
    expect(entries.find((entry: { title: string }) => entry.title === 'Long path').id).toMatch(/^sha256:/)
    expect(entries[0].id).toBe('old')
  })

  it.each(['unavailable', 'decrypt'])(
    'does not overwrite history on startup/exit after %s failure',
    async (failure) => {
      runtime.available = failure !== 'unavailable'
      runtime.decryptFails = failure === 'decrypt'
      const manager = new HistoryManager()
      await manager.ready()
      expect(await manager.getStats()).toMatchObject({ mode: 'memory', persistenceError: expect.any(String) })
      await manager.onAppExit()
      expect(await readFile(file)).toEqual(original)
    }
  )

  it('keeps live entries after encryption fails, then merges them on manual reactivation', async () => {
    const manager = new HistoryManager()
    await manager.ready()
    manager.addEntry('http://new.ton/', 'New')
    runtime.available = false
    await expect(manager.applySettings({ historyMode: 'memory', historyMaxEntries: 100 } as never)).rejects.toThrow()
    expect(await manager.getStats()).toMatchObject({ mode: 'memory', persistenceError: 'encryption-unavailable' })
    expect(await manager.getRecent()).toHaveLength(2)
    expect(await readFile(file)).toEqual(original)
    runtime.available = true
    await manager.applySettings({ historyMode: 'persistent', historyMaxEntries: 100 } as never)
    expect(await manager.getStats()).toMatchObject({ mode: 'persistent' })
    expect((await manager.getStats()).persistenceError).toBeUndefined()
    expect(JSON.parse((await readFile(file)).subarray(5).toString()).payload).toHaveLength(2)
    await manager.onAppExit()
  })

  it('does not retry a failed save during exit', async () => {
    const manager = new HistoryManager()
    await manager.ready()
    manager.addEntry('http://new.ton/', 'New')
    runtime.available = false
    await expect(manager.onAppExit()).rejects.toThrow()
    runtime.available = true
    await manager.onAppExit()
    expect(await readFile(file)).toEqual(original)
  })
})
