import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  privacy: {
    clearOnExit: true,
    disableCache: false,
    firstPartyIsolation: true,
    cookieAutoDelete: true,
    cookieAutoDeleteMinutes: 30,
    historyMode: 'memory' as 'memory' | 'persistent',
    historyMaxEntries: 1000,
  },
  read: vi.fn<() => Promise<unknown>>(),
  write: vi.fn<(entries: unknown[]) => Promise<void>>(),
  remove: vi.fn<() => Promise<void>>(),
  exists: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('../../settings', () => ({ getSetting: vi.fn(() => ({ ...mocks.privacy })) }))
vi.mock('../safe-storage-wrapper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../safe-storage-wrapper')>()),
  SafeStorageWrapper: class {
    isAvailable = () => true
    read = mocks.read
    write = mocks.write
    delete = mocks.remove
    exists = mocks.exists
  },
}))

import { HistoryManager } from '../manager'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function entry(url: string, visitedAt: number, visitCount = 1) {
  return {
    id: Buffer.from(url).toString('base64url'),
    url,
    title: url,
    visitedAt,
    visitCount,
  }
}

describe('HistoryManager settings', () => {
  beforeEach(() => {
    mocks.privacy.historyMode = 'memory'
    mocks.privacy.historyMaxEntries = 1000
    mocks.read.mockReset().mockResolvedValue(null)
    mocks.write.mockReset().mockResolvedValue()
    mocks.remove.mockReset().mockResolvedValue()
    mocks.exists.mockReset().mockResolvedValue(false)
  })

  it('falls back to memory when persistent history cannot load at startup', async () => {
    mocks.privacy.historyMode = 'persistent'
    mocks.read.mockRejectedValueOnce(new Error('keychain unavailable'))
    const manager = new HistoryManager()

    await manager.ready()
    manager.addEntry('https://fallback.ton/page', 'Fallback')

    expect((await manager.getStats()).mode).toBe('memory')
    await manager.onAppExit()
    await expect(manager.getRecent()).resolves.toEqual([])
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('durably prunes persistent history to the configured startup limit', async () => {
    mocks.privacy.historyMode = 'persistent'
    mocks.privacy.historyMaxEntries = 100
    mocks.read.mockResolvedValueOnce(
      Array.from({ length: 101 }, (_, index) => entry(`https://site-${index}.ton/`, index + 1))
    )
    const manager = new HistoryManager()

    await manager.ready()

    expect(mocks.write).toHaveBeenCalledWith(expect.not.arrayContaining([expect.objectContaining({ visitedAt: 1 })]))
    expect(mocks.write.mock.calls[0][0]).toHaveLength(100)
    await expect(manager.getRecent(200)).resolves.toHaveLength(100)
    expect((await manager.getStats()).mode).toBe('persistent')
  })

  it('falls back to empty memory when startup pruning cannot persist', async () => {
    mocks.privacy.historyMode = 'persistent'
    mocks.privacy.historyMaxEntries = 100
    mocks.read.mockResolvedValueOnce(
      Array.from({ length: 101 }, (_, index) => entry(`https://site-${index}.ton/`, index + 1))
    )
    mocks.write.mockRejectedValueOnce(new Error('disk full'))
    const manager = new HistoryManager()

    await manager.ready()

    expect((await manager.getStats()).mode).toBe('memory')
    await expect(manager.getRecent(200)).resolves.toEqual([])
  })

  it('merges memory and disk history before enabling persistence', async () => {
    const diskEntry = entry('https://disk.ton/', 1)
    mocks.read.mockResolvedValueOnce([diskEntry])
    const manager = new HistoryManager()
    await manager.ready()
    manager.addEntry('https://memory.ton/', 'Memory')
    const write = deferred<void>()
    mocks.write.mockReturnValueOnce(write.promise)

    const applying = manager.applySettings({ ...mocks.privacy, historyMode: 'persistent' })
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce())

    expect((await manager.getStats()).mode).toBe('memory')
    await expect(manager.getRecent()).resolves.toHaveLength(1)
    expect(mocks.write).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://disk.ton/' }),
        expect.objectContaining({ url: 'https://memory.ton/' }),
      ])
    )

    write.resolve()
    await applying

    expect((await manager.getStats()).mode).toBe('persistent')
    await expect(manager.getRecent()).resolves.toHaveLength(2)
  })

  it('keeps memory mode and entries when enabling persistence cannot write', async () => {
    const manager = new HistoryManager()
    await manager.ready()
    manager.addEntry('https://memory.ton/', 'Memory')
    mocks.write.mockRejectedValueOnce(new Error('disk full'))

    await expect(manager.applySettings({ ...mocks.privacy, historyMode: 'persistent' })).rejects.toThrow('disk full')

    expect((await manager.getStats()).mode).toBe('memory')
    await expect(manager.getRecent()).resolves.toEqual([expect.objectContaining({ url: 'https://memory.ton/' })])
  })

  it('preserves visit semantics for entries buffered during a settings transition', async () => {
    const manager = new HistoryManager()
    await manager.ready()
    manager.addEntry('https://memory.ton/', 'Initial')
    const write = deferred<void>()
    mocks.write.mockReturnValueOnce(write.promise)

    const applying = manager.applySettings({ ...mocks.privacy, historyMode: 'persistent' })
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce())
    manager.addEntry('https://memory.ton/', 'Updated', undefined, false)
    write.resolve()
    await applying

    await expect(manager.getRecent()).resolves.toEqual([
      expect.objectContaining({ url: 'https://memory.ton/', title: 'Updated', visitCount: 1 }),
    ])
  })

  it('rejects destructive mutations while a settings transition is in flight', async () => {
    const manager = new HistoryManager()
    await manager.ready()
    manager.addEntry('https://memory.ton/', 'Memory')
    const write = deferred<void>()
    mocks.write.mockReturnValueOnce(write.promise)

    const applying = manager.applySettings({ ...mocks.privacy, historyMode: 'persistent' })
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce())

    expect(() => manager.clear()).toThrow('History settings transition in progress')
    write.resolve()
    await applying
    await expect(manager.getRecent()).resolves.toHaveLength(1)
  })

  it('flushes pending persistent changes before switching to memory', async () => {
    mocks.privacy.historyMode = 'persistent'
    const manager = new HistoryManager()
    await manager.ready()
    manager.addEntry('https://example.ton/page', 'Example')
    const write = deferred<void>()
    mocks.write.mockReturnValueOnce(write.promise)

    const applying = manager.applySettings({ ...mocks.privacy, historyMode: 'memory' })
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce())

    expect((await manager.getStats()).mode).toBe('persistent')
    write.resolve()
    await applying
    await manager.onAppExit()

    expect((await manager.getStats()).mode).toBe('memory')
    expect(mocks.write).toHaveBeenCalledOnce()
  })

  it('publishes a combined mode and limit change as one state transition', async () => {
    mocks.privacy.historyMode = 'persistent'
    const persisted = Array.from({ length: 101 }, (_, index) => entry(`https://site-${index}.ton/`, index + 1))
    mocks.read.mockResolvedValueOnce(persisted)
    const manager = new HistoryManager()
    await manager.ready()
    const publishedSizes: number[] = []
    manager.on('mode-changed', () => {
      publishedSizes.push(manager.getByDateRange(0, Number.MAX_SAFE_INTEGER).length)
    })

    await manager.applySettings({ ...mocks.privacy, historyMode: 'memory', historyMaxEntries: 100 })

    expect(publishedSizes).toEqual([100])
    expect((await manager.getStats()).mode).toBe('memory')
  })

  it('suspends persistence and keeps entries in memory when the final flush fails', async () => {
    mocks.privacy.historyMode = 'persistent'
    const manager = new HistoryManager()
    await manager.ready()
    manager.addEntry('https://example.ton/page', 'Example')
    mocks.write.mockRejectedValueOnce(new Error('disk full'))

    await expect(manager.applySettings({ ...mocks.privacy, historyMode: 'memory' })).rejects.toThrow('disk full')

    expect(await manager.getStats()).toMatchObject({ mode: 'memory', persistenceError: 'io-error' })
    await expect(manager.getRecent()).resolves.toEqual([expect.objectContaining({ url: 'https://example.ton/page' })])
  })

  it('persists a reduced entry limit before publishing the pruned history', async () => {
    mocks.privacy.historyMode = 'persistent'
    const persisted = Array.from({ length: 101 }, (_, index) => entry(`https://site-${index}.ton/`, index + 1))
    mocks.read.mockResolvedValueOnce(persisted)
    const manager = new HistoryManager()
    await manager.ready()
    const write = deferred<void>()
    mocks.write.mockReturnValueOnce(write.promise)

    const applying = manager.applySettings({ ...mocks.privacy, historyMaxEntries: 100 })
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce())

    await expect(manager.getRecent(200)).resolves.toHaveLength(101)
    expect(mocks.write).toHaveBeenCalledWith(
      expect.not.arrayContaining([expect.objectContaining({ url: 'https://site-0.ton/' })])
    )
    write.resolve()
    await applying

    await expect(manager.getRecent(200)).resolves.toHaveLength(100)
  })

  it('keeps a pending save from restoring entries removed by durable pruning', async () => {
    vi.useFakeTimers()
    try {
      mocks.privacy.historyMode = 'persistent'
      const persisted = Array.from({ length: 101 }, (_, index) => entry(`https://site-${index}.ton/`, index + 1))
      mocks.read.mockResolvedValueOnce(persisted)
      const manager = new HistoryManager()
      await manager.ready()
      manager.addEntry('https://site-new.ton/', 'New')
      const firstWrite = deferred<void>()
      mocks.write.mockReturnValueOnce(firstWrite.promise).mockResolvedValue()

      const applying = manager.applySettings({ ...mocks.privacy, historyMaxEntries: 100 })
      await vi.advanceTimersByTimeAsync(500)
      firstWrite.resolve()
      await applying

      expect(mocks.write.mock.calls.map(([entries]) => entries.length)).toEqual([102, 100])
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves entries and the previous limit when durable pruning fails', async () => {
    mocks.privacy.historyMode = 'persistent'
    const persisted = Array.from({ length: 101 }, (_, index) => entry(`https://site-${index}.ton/`, index + 1))
    mocks.read.mockResolvedValueOnce(persisted)
    const manager = new HistoryManager()
    await manager.ready()
    mocks.write.mockRejectedValueOnce(new Error('disk full'))

    await expect(manager.applySettings({ ...mocks.privacy, historyMaxEntries: 100 })).rejects.toThrow('disk full')

    await expect(manager.getRecent(200)).resolves.toHaveLength(101)
    manager.addEntry('https://site-new.ton/', 'New')
    await expect(manager.getRecent(200)).resolves.toHaveLength(102)
  })
})
