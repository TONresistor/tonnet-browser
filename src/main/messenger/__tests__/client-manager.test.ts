import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), kill: vi.fn(), stdoutLog: vi.fn() }))
vi.mock('child_process', () => ({ spawn: mocks.spawn }))
vi.mock('electron', () => ({ app: { getPath: () => '/profile' } }))
vi.mock('../../daemon-registry', () => ({ trackDaemon: vi.fn() }))
vi.mock('../../proxy/process-utils', () => ({ killChildProcess: mocks.kill }))
vi.mock('../../utils/paths', () => ({ getBinaryPath: () => '/bin/messenger' }))
vi.mock('../../logging/native-log-router', () => ({
  nativeLogRouter: { createSession: () => ({ stdout: mocks.stdoutLog, stderr: vi.fn(), close: vi.fn() }) },
}))
vi.mock('../../../shared/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))

import { MessengerClientManager } from '../client-manager'

const identity = { key: 'A'.repeat(43), name: 'alice' }
const encode = (value: unknown) => Buffer.from(JSON.stringify(value) + '\n')

function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid: 42,
    stdin: { writable: true, write: vi.fn(), end: vi.fn() },
  })
  child.stdin.write.mockImplementation((line: string) => {
    const request = JSON.parse(line) as { id: number; method: string }
    if (request.method === 'slow') return true
    const result = request.method === 'client.info' ? { protocol: '0.4.0', room_transport: 'ton-quic' } : identity
    queueMicrotask(() => child.stdout.emit('data', encode({ jsonrpc: '2.0', id: request.id, result })))
    return true
  })
  return child
}

describe('MessengerClientManager', () => {
  let manager: MessengerClientManager
  let children: ReturnType<typeof childProcess>[]
  let announceReady: boolean

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    children = []
    announceReady = true
    mocks.spawn.mockImplementation(() => {
      const child = childProcess()
      children.push(child)
      if (announceReady)
        queueMicrotask(() =>
          child.stdout.emit('data', encode({ jsonrpc: '2.0', method: 'client.ready', params: { identity } }))
        )
      return child
    })
    mocks.kill.mockImplementation(async (child: ReturnType<typeof childProcess>) => {
      child.emit('exit', 0)
      child.emit('close', 0)
    })
    manager = new MessengerClientManager()
  })

  afterEach(async () => {
    await manager.stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('shares startup and verifies protocol information before serving concurrent requests', async () => {
    const results = await Promise.all([manager.request('identity.get'), manager.request('identity.get')])
    expect(results).toEqual([identity, identity])
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(JSON.parse(children[0].stdin.write.mock.calls[0][0]).method).toBe('client.info')
    expect(manager.isRunning).toBe(true)
    expect(mocks.stdoutLog).not.toHaveBeenCalled()
  })

  it('accepts a large batch of individually valid lines and split UTF-8', async () => {
    await manager.request('identity.get')
    const received = vi.fn()
    manager.on('probe', received)
    const notification = { jsonrpc: '2.0', method: 'probe', params: 'x'.repeat(1024) }
    children[0].stdout.emit('data', Buffer.concat(Array.from({ length: 140 }, () => encode(notification))))
    expect(received).toHaveBeenCalledTimes(140)
    const unicode = encode({ ...notification, params: 'hello 🚀' })
    const split = unicode.indexOf(Buffer.from('🚀')) + 1
    children[0].stdout.emit('data', unicode.subarray(0, split))
    expect(received).toHaveBeenCalledTimes(140)
    children[0].stdout.emit('data', unicode.subarray(split))
    expect(received).toHaveBeenLastCalledWith('hello 🚀')
  })

  it('rejects an incompatible helper before sending application requests', async () => {
    announceReady = false
    const pending = manager.request('identity.get')
    const rejected = expect(pending).rejects.toThrow()
    children[0].stdin.write.mockImplementation((line: string) => {
      const request = JSON.parse(line)
      queueMicrotask(() =>
        children[0].stdout.emit(
          'data',
          encode({ jsonrpc: '2.0', id: request.id, result: { protocol: '0.3.0', room_transport: 'ton-quic' } })
        )
      )
      return true
    })
    children[0].stdout.emit('data', encode({ jsonrpc: '2.0', method: 'client.ready', params: { identity } }))
    await rejected
    expect(children[0].stdin.write).toHaveBeenCalledOnce()
    expect(manager.isRunning).toBe(false)
  })

  it('waits for teardown before starting a new helper', async () => {
    await manager.request('identity.get')
    let finishStop!: () => void
    mocks.kill.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve
        })
    )
    const stopping = manager.stop()
    const starting = manager.request('identity.get')
    expect(children).toHaveLength(1)
    finishStop()
    await stopping
    await expect(starting).resolves.toEqual(identity)
    expect(children).toHaveLength(2)
  })

  it.each(['oversized', 'invalid-json', 'invalid-utf8'])(
    'terminates the helper on %s input and settles pending requests',
    async (kind) => {
      await manager.request('identity.get')
      const pending = manager.request('slow')
      const rejected = expect(pending).rejects.toMatchObject({ code: 'PROTOCOL_INVALID' })
      await Promise.resolve()
      const payload =
        kind === 'oversized'
          ? encode({ jsonrpc: '2.0', method: 'probe', params: 'x'.repeat(70 * 1024) })
          : kind === 'invalid-json'
            ? Buffer.from('invalid\n')
            : Buffer.from([0xff, 0x0a])
      children[0].stdout.emit('data', payload)
      await rejected
      expect(manager.isRunning).toBe(false)
      expect(mocks.kill).toHaveBeenCalledOnce()
    }
  )

  it('rejects request timeouts with the declared timeout code', async () => {
    await manager.request('identity.get')
    const rejected = expect(manager.request('slow')).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(30_000)
    await rejected
  })

  it('cancels startup immediately when stopped before readiness', async () => {
    announceReady = false
    const rejected = expect(manager.request('identity.get')).rejects.toThrow('stopped')
    await manager.stop()
    await rejected
    expect(manager.isRunning).toBe(false)
  })

  it('recovers an active client and ignores output from the failed generation', async () => {
    manager.setActive(true)
    await manager.request('identity.get')
    const first = children[0]
    const received = vi.fn()
    manager.on('probe', received)
    first.emit('exit', 1)
    expect(manager.isRunning).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(children).toHaveLength(2)
    expect(manager.isRunning).toBe(true)
    first.stdout.emit('data', encode({ jsonrpc: '2.0', method: 'probe', params: 'old' }))
    children[1].stdout.emit('data', encode({ jsonrpc: '2.0', method: 'probe', params: 'new' }))
    expect(received.mock.calls).toEqual([['new']])
  })

  it('cancels automatic recovery when the view is no longer active', async () => {
    manager.setActive(true)
    await manager.request('identity.get')
    children[0].emit('exit', 1)
    manager.setActive(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(children).toHaveLength(1)
  })

  it('bounds failed recovery to three attempts', async () => {
    manager.setActive(true)
    await manager.request('identity.get')
    announceReady = false
    children[0].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(100_000)
    expect(children).toHaveLength(4)
    expect(manager.isRunning).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
