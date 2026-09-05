import { EventEmitter } from 'events'
import { app } from 'electron'
import path from 'path'
import { NativeProcessSupervisor } from '../native-process/supervisor'
import { getBinaryPath } from '../utils/paths'
import { createLogger } from '../../shared/logger'

const log = createLogger('messenger:client')
const REQUEST_TIMEOUT_MS = 30_000
const READY_TIMEOUT_MS = 30_000
const MAX_LINE_BYTES = 64 * 1024

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: number
  result?: unknown
  error?: { code: number; message: string; data?: { code?: string } }
  method?: string
  params?: unknown
}

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
  private readyResolve: (() => void) | null = null
  private readyReject: ((error: Error) => void) | null = null

  get isRunning(): boolean {
    return this.supervisor.isRunning
  }

  start(): Promise<void> {
    if (this.startFlight) return this.startFlight
    if (this.supervisor.isRunning) return Promise.resolve()
    const flight = this.startOnce().finally(() => {
      if (this.startFlight === flight) this.startFlight = null
    })
    this.startFlight = flight
    return flight
  }

  private async startOnce(): Promise<void> {
    const binary = getBinaryPath('tonnet-messenger')
    const state = path.join(app.getPath('userData'), 'messenger')
    this.stdoutBuffer = Buffer.alloc(0)
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.supervisor.start({
      name: 'tonnet-messenger',
      command: binary,
      args: ['--state', state, 'run', '--stdio'],
      options: { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      protocolStdout: true,
      onStdout: (chunk) => this.consumeStdout(chunk),
      onLine: ({ line, level }) => {
        if (level === 'error') log.error(line)
        else log.debug(line)
      },
      onExit: (code) => this.handleExit(new Error(`Messenger client exited (code=${code})`)),
      onError: (error) => this.handleExit(error),
    })
    const timeout = setTimeout(
      () => this.readyReject?.(new Error('Messenger client readiness timed out')),
      READY_TIMEOUT_MS
    )
    try {
      await ready
    } catch (error) {
      await this.stop()
      throw error
    } finally {
      clearTimeout(timeout)
      this.readyResolve = null
      this.readyReject = null
    }
  }

  async stop(): Promise<void> {
    const process = this.supervisor.process
    process?.stdin?.end()
    await this.supervisor.stop()
    this.handleExit(new Error('Messenger client stopped'))
  }

  async request<TResult>(method: string, params: Record<string, unknown> = {}): Promise<TResult> {
    await this.start()
    const process = this.supervisor.process
    if (!process?.stdin?.writable) throw new Error('Messenger client stdin is unavailable')
    const id = this.nextId++
    const line = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error('Messenger request exceeds local protocol limit')
    const result = new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Messenger request timed out: ${method}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve: (value) => resolve(value as TResult), reject, timer })
    })
    process.stdin.write(line, (error) => {
      if (!error) return
      const pending = this.pending.get(id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    })
    return result
  }

  private consumeStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk])
    if (this.stdoutBuffer.length > MAX_LINE_BYTES * 2) {
      this.handleExit(new Error('Messenger client emitted an oversized protocol frame'))
      return
    }
    for (;;) {
      const newline = this.stdoutBuffer.indexOf(0x0a)
      if (newline < 0) return
      const raw = this.stdoutBuffer.subarray(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1)
      if (raw.length === 0) continue
      try {
        this.handleMessage(JSON.parse(raw.toString('utf8')) as JsonRpcResponse)
      } catch (error) {
        this.handleExit(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  private handleMessage(message: JsonRpcResponse): void {
    if (message.jsonrpc !== '2.0') throw new Error('Messenger client emitted invalid JSON-RPC')
    if (message.method) {
      if (message.method === 'client.ready') this.readyResolve?.()
      this.emit(message.method, message.params)
      return
    }
    if (typeof message.id !== 'number') throw new Error('Messenger response has no id')
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(
        new MessengerRpcError(message.error.message, message.error.data?.code ?? 'OPERATION_FAILED', message.error.code)
      )
      return
    }
    pending.resolve(message.result)
  }

  private handleExit(error: Error): void {
    this.readyReject?.(error)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.emit('client.exit', error)
  }
}
