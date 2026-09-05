import { EventEmitter } from 'events'
import { app } from 'electron'
import path from 'path'
import { z } from 'zod'
import { NativeProcessSupervisor } from '../native-process/supervisor'
import { getBinaryPath } from '../utils/paths'
import { createLogger } from '../../shared/logger'
import { rpcIdentitySchema } from './protocol'

const log = createLogger('messenger:client')
const REQUEST_TIMEOUT_MS = 30_000
const READY_TIMEOUT_MS = 30_000
const MAX_LINE_BYTES = 64 * 1024
const RECOVERY_DELAYS = [1_000, 2_000, 4_000]
const readySchema = z.object({ identity: rpcIdentitySchema })
const infoSchema = z.object({ protocol: z.literal('0.4.0'), room_transport: z.literal('ton-quic') })
const errorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.object({ code: z.string().optional() }).optional(),
})

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export class MessengerRpcError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly rpcCode: number
  ) {
    super(message)
    this.name = 'MessengerRpcError'
  }
}

export class MessengerClientManager extends EventEmitter {
  private readonly supervisor = new NativeProcessSupervisor()
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1
  private stdoutBuffer = Buffer.alloc(0)
  private startFlight: Promise<void> | null = null
  private stopFlight: Promise<void> | null = null
  private readyResolve: (() => void) | null = null
  private readyReject: ((error: Error) => void) | null = null
  private ready = false
  private generation = 0
  private active = false
  private keepAlive = false
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null
  private recoveryAttempt = 0

  get isRunning(): boolean {
    return this.ready && this.supervisor.isRunning
  }

  setActive(active: boolean): void {
    this.active = active
    if (!active && !this.keepAlive) this.cancelRecovery()
  }

  invalidate(error: Error): void {
    this.fail(this.generation, error)
  }

  start(): Promise<void> {
    this.keepAlive = true
    return this.ensureStarted()
  }

  private ensureStarted(): Promise<void> {
    if (this.startFlight) return this.startFlight
    if (this.isRunning) return Promise.resolve()
    this.cancelRecovery()
    const flight = this.startOnce().finally(() => {
      if (this.startFlight === flight) this.startFlight = null
    })
    this.startFlight = flight
    return flight
  }

  private async startOnce(): Promise<void> {
    const generation = ++this.generation
    if (this.stopFlight) await this.stopFlight
    if (generation !== this.generation) throw new Error('Messenger client startup cancelled')
    const binary = getBinaryPath('tonnet-messenger')
    const state = path.join(app.getPath('userData'), 'messenger')
    this.ready = false
    this.stdoutBuffer = Buffer.alloc(0)
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    void ready.catch(() => {})
    const timeout = setTimeout(
      () => this.readyReject?.(new Error('Messenger client readiness timed out')),
      READY_TIMEOUT_MS
    )
    try {
      this.supervisor.start({
        name: 'tonnet-messenger',
        command: binary,
        args: ['--state', state, 'run', '--stdio'],
        options: { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
        protocolStdout: true,
        onStdout: (chunk) => {
          if (generation === this.generation) this.consumeStdout(chunk, generation)
        },
        onLine: ({ line, level }) => {
          if (level === 'error') log.error(line)
          else log.debug(line)
        },
        onExit: (code) => this.fail(generation, new Error('Messenger client exited (code=' + code + ')')),
        onError: (error) => this.fail(generation, error),
      })
      await ready
      this.readyResolve = null
      this.readyReject = null
      clearTimeout(timeout)
      const info = await this.sendRequest('client.info', {})
      infoSchema.parse(info)
      if (generation !== this.generation) throw new Error('Messenger client session changed')
      this.ready = true
      this.recoveryAttempt = 0
      this.emit('client.running')
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Messenger client startup failed')
      this.fail(generation, failure)
      throw failure
    } finally {
      clearTimeout(timeout)
      if (generation === this.generation) {
        this.readyResolve = null
        this.readyReject = null
      }
    }
  }

  async stop(): Promise<void> {
    this.keepAlive = false
    this.active = false
    this.cancelRecovery()
    this.generation++
    this.ready = false
    this.stdoutBuffer = Buffer.alloc(0)
    const failure = new Error('Messenger client stopped')
    this.readyReject?.(failure)
    this.readyResolve = null
    this.readyReject = null
    this.rejectPending(failure)
    const starting = this.startFlight
    await this.stopProcess()
    await starting?.catch(() => {})
  }

  async request<TResult>(method: string, params: Record<string, unknown> = {}): Promise<TResult> {
    await this.ensureStarted()
    return this.sendRequest(method, params) as Promise<TResult>
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const process = this.supervisor.process
    if (!process?.stdin?.writable) return Promise.reject(new Error('Messenger client stdin is unavailable'))
    const generation = this.generation
    const id = this.nextId++
    const line = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
      return Promise.reject(
        new MessengerRpcError('Messenger request exceeds local protocol limit', 'LIMIT_EXCEEDED', -32602)
      )
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new MessengerRpcError('Messenger request timed out: ' + method, 'TIMEOUT', -32001))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      try {
        process.stdin!.write(line, (error) => {
          if (error) this.fail(generation, error)
        })
      } catch (error) {
        this.fail(generation, error instanceof Error ? error : new Error('Messenger stdin write failed'))
      }
    })
  }

  private consumeStdout(chunk: Buffer, generation: number): void {
    let offset = 0
    while (offset < chunk.length && generation === this.generation) {
      const newline = chunk.indexOf(0x0a, offset)
      const end = newline < 0 ? chunk.length : newline
      const fragment = chunk.subarray(offset, end)
      if (this.stdoutBuffer.length + fragment.length + 1 > MAX_LINE_BYTES) {
        this.fail(
          generation,
          new MessengerRpcError('Messenger client emitted an oversized protocol frame', 'PROTOCOL_INVALID', -32000)
        )
        return
      }
      const raw = this.stdoutBuffer.length ? Buffer.concat([this.stdoutBuffer, fragment]) : fragment
      if (newline < 0) {
        this.stdoutBuffer = Buffer.from(raw)
        return
      }
      this.stdoutBuffer = Buffer.alloc(0)
      offset = newline + 1
      if (raw.length === 0) continue
      try {
        this.handleMessage(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)))
      } catch {
        this.fail(
          generation,
          new MessengerRpcError('Messenger client emitted an invalid protocol frame', 'PROTOCOL_INVALID', -32000)
        )
        return
      }
    }
  }

  private handleMessage(value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON-RPC object')
    const message = value as Record<string, unknown>
    if (message.jsonrpc !== '2.0') throw new Error('Invalid JSON-RPC version')
    if (typeof message.method === 'string') {
      if ('id' in message) throw new Error('Unexpected JSON-RPC request')
      if (message.method === 'client.ready') {
        readySchema.parse(message.params)
        this.readyResolve?.()
      }
      this.emit(message.method, message.params)
      return
    }
    if (typeof message.id !== 'number' || !Number.isSafeInteger(message.id)) throw new Error('Invalid response id')
    if ('result' in message === 'error' in message) throw new Error('Invalid response result')
    const error = 'error' in message ? errorSchema.parse(message.error) : null
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (error) {
      pending.reject(new MessengerRpcError(error.message, error.data?.code ?? 'OPERATION_FAILED', error.code))
    } else {
      pending.resolve(message.result)
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private fail(generation: number, error: Error): void {
    if (generation !== this.generation) return
    this.generation++
    this.ready = false
    this.stdoutBuffer = Buffer.alloc(0)
    this.readyReject?.(error)
    this.readyResolve = null
    this.readyReject = null
    this.rejectPending(error)
    this.emit('client.exit', error)
    void this.stopProcess().finally(() => this.scheduleRecovery())
  }

  private stopProcess(): Promise<void> {
    if (this.stopFlight) return this.stopFlight
    this.supervisor.process?.stdin?.end()
    const flight = this.supervisor
      .stop()
      .catch((error) => {
        log.error('Failed to stop Messenger client:', error)
      })
      .finally(() => {
        if (this.stopFlight === flight) this.stopFlight = null
      })
    this.stopFlight = flight
    return flight
  }

  private scheduleRecovery(): void {
    if ((!this.active && !this.keepAlive) || this.recoveryTimer || this.isRunning) return
    const delay = RECOVERY_DELAYS[this.recoveryAttempt++]
    if (delay === undefined) return
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      if (!this.active && !this.keepAlive) return
      this.emit('client.reconnecting', this.recoveryAttempt)
      void this.ensureStarted().catch(() => {})
    }, delay)
  }

  private cancelRecovery(): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = null
  }
}
