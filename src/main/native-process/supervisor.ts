import { spawn, type ChildProcess, type SpawnOptions } from 'child_process'
import { trackDaemon } from '../daemon-registry'
import { killChildProcess } from '../proxy/process-utils'
import { nativeLogRouter, type NativeLogLine, type NativeRawLogLine } from '../logging/native-log-router'

export interface NativeProcessSpec {
  name: string
  command: string
  args: string[]
  options?: SpawnOptions
  onStdout?(data: Buffer): void
  onStderr?(data: Buffer): void
  onLine?(entry: NativeLogLine): void
  onRawLine?(entry: NativeRawLogLine): void
  onExit?(code: number | null): void
  onError?(error: Error): void
  /** stdout carries a private machine protocol and must not enter logs or readiness capture. */
  protocolStdout?: boolean
}

export type NativeProcessState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed'

export interface ReadinessProbeOptions {
  probe(): boolean | Promise<boolean>
  timeoutMs: number
  intervalMs: number
  signal?: AbortSignal
}

export interface OutputReadinessOptions {
  matches(data: Buffer): boolean
  timeoutMs: number
  signal?: AbortSignal
}

export interface BackoffPolicy {
  maxAttempts: number
  initialDelayMs: number
  multiplier?: number
  maxDelayMs?: number
  signal?: AbortSignal
  shouldRetry?(error: unknown): boolean
  onRetry?(error: unknown, attempt: number, nextDelayMs: number): void
}

/** Owns one native child process and its deterministic teardown. */
export class NativeProcessSupervisor {
  private child: ChildProcess | null = null
  private stopFlight: Promise<void> | null = null
  private restartFlight: Promise<ChildProcess> | null = null
  private backoffFlight: Promise<unknown> | null = null
  private currentSpec: NativeProcessSpec | null = null
  private lifecycleState: NativeProcessState = 'stopped'
  private cleanupChildOutput: (() => void) | null = null
  private recentOutput = Buffer.alloc(0)

  get process(): ChildProcess | null {
    return this.child
  }

  get isRunning(): boolean {
    return this.child !== null
  }

  get state(): NativeProcessState {
    return this.lifecycleState
  }

  start(spec: NativeProcessSpec): ChildProcess {
    if (this.stopFlight) throw new Error('Cannot start native process while stop is in progress')
    if (this.child) return this.child
    this.lifecycleState = 'starting'
    this.currentSpec = spec
    this.recentOutput = Buffer.alloc(0)
    const child = spawn(spec.command, spec.args, spec.options ?? {}) as ChildProcess
    this.child = child
    trackDaemon(spec.name, child)

    const nativeLogs = nativeLogRouter.createSession(spec.name, child.pid, spec.onLine, spec.onRawLine)
    const onStdout = (data: Buffer): void => {
      if (!spec.protocolStdout) {
        this.captureOutput(data)
        nativeLogs.stdout(data)
      }
      spec.onStdout?.(data)
    }
    const onStderr = (data: Buffer): void => {
      this.captureOutput(data)
      nativeLogs.stderr(data)
      spec.onStderr?.(data)
    }

    let outputCleaned = false
    const cleanupOutput = (): void => {
      if (outputCleaned) return
      outputCleaned = true
      child.stdout?.off('data', onStdout)
      child.stderr?.off('data', onStderr)
      child.off('close', cleanupOutput)
      nativeLogs.close()
      if (this.cleanupChildOutput === cleanupOutput) this.cleanupChildOutput = null
    }
    this.cleanupChildOutput = cleanupOutput
    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    child.once('close', cleanupOutput)
    this.lifecycleState = 'running'
    child.on('exit', (code) => {
      if (this.child === child) this.child = null
      this.lifecycleState = code === 0 || this.lifecycleState === 'stopping' ? 'stopped' : 'crashed'
      spec.onExit?.(code)
    })
    child.on('error', (error) => {
      if (this.child === child) this.child = null
      this.lifecycleState = 'crashed'
      spec.onError?.(error)
    })
    return child
  }

  stop(): Promise<void> {
    if (this.stopFlight) return this.stopFlight
    const child = this.child
    if (!child) {
      this.lifecycleState = 'stopped'
      return Promise.resolve()
    }
    this.lifecycleState = 'stopping'
    this.child = null
    const cleanupOutput = this.cleanupChildOutput
    const stop = killChildProcess(child).finally(() => {
      cleanupOutput?.()
      if (this.stopFlight === stop) this.stopFlight = null
      this.lifecycleState = 'stopped'
    })
    this.stopFlight = stop
    return stop
  }

  restart(spec: NativeProcessSpec = this.currentSpec as NativeProcessSpec): Promise<ChildProcess> {
    if (!spec) return Promise.reject(new Error('Cannot restart before a process specification has been started'))
    if (this.restartFlight) return this.restartFlight
    const restart = this.stop()
      .then(() => this.start(spec))
      .finally(() => {
        if (this.restartFlight === restart) this.restartFlight = null
      })
    this.restartFlight = restart
    return restart
  }

  /** Execute one daemon lifecycle transition with a shared bounded retry policy. */
  runWithBackoff<TResult>(operation: (attempt: number) => Promise<TResult>, policy: BackoffPolicy): Promise<TResult> {
    if (this.backoffFlight) return this.backoffFlight as Promise<TResult>
    if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
      return Promise.reject(new Error('Backoff policy maxAttempts must be a positive integer'))
    }
    const multiplier = policy.multiplier ?? 2
    const maximum = policy.maxDelayMs ?? Number.MAX_SAFE_INTEGER
    const run = (async () => {
      let delay = Math.max(0, policy.initialDelayMs)
      for (let attempt = 1; ; attempt += 1) {
        if (policy.signal?.aborted) throw new Error('Native process retry aborted')
        try {
          return await operation(attempt)
        } catch (error) {
          const retry = attempt < policy.maxAttempts && (policy.shouldRetry?.(error) ?? true)
          if (!retry) throw error
          const nextDelay = Math.min(delay, maximum)
          policy.onRetry?.(error, attempt, nextDelay)
          await waitForBackoff(nextDelay, policy.signal)
          delay = Math.min(Math.max(0, delay * multiplier), maximum)
        }
      }
    })()
    const owned = run.finally(() => {
      if (this.backoffFlight === owned) this.backoffFlight = null
    })
    this.backoffFlight = owned
    return owned
  }

  async waitForReady(options: ReadinessProbeOptions): Promise<void> {
    if (options.signal?.aborted) throw new Error('Readiness wait aborted')
    const child = this.child
    if (!child) throw new Error('Cannot wait for readiness without a running process')
    const deadline = Date.now() + options.timeoutMs
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      let settled = false
      const cleanup = (): void => {
        if (timer) clearTimeout(timer)
        child.off('exit', onExit)
        child.off('error', onError)
        options.signal?.removeEventListener('abort', onAbort)
      }
      const settle = (error?: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve()
      }
      const onExit = (code: number | null) => settle(new Error(`Process exited before ready (code: ${code})`))
      const onError = (error: Error) => settle(error)
      const onAbort = () => settle(new Error('Readiness wait aborted'))
      const poll = async (): Promise<void> => {
        if (settled) return
        if (Date.now() >= deadline) {
          settle(new Error(`Process readiness timed out after ${options.timeoutMs}ms`))
          return
        }
        try {
          if (await options.probe()) {
            settle()
            return
          }
        } catch {
          // A failed probe is transient until the bounded deadline.
        }
        timer = setTimeout(() => void poll(), options.intervalMs)
      }
      child.once('exit', onExit)
      child.once('error', onError)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      void poll()
    })
  }

  async waitForOutput(options: OutputReadinessOptions): Promise<void> {
    if (options.signal?.aborted) throw new Error('Readiness wait aborted')
    const child = this.child
    if (!child) throw new Error('Cannot wait for output without a running process')
    if (options.matches(this.recentOutput)) return
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        clearTimeout(timeout)
        child.stdout?.off('data', onData)
        child.stderr?.off('data', onData)
        child.off('exit', onExit)
        child.off('error', onError)
        options.signal?.removeEventListener('abort', onAbort)
      }
      const settle = (error?: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve()
      }
      const onData = (): void => {
        if (options.matches(this.recentOutput)) settle()
      }
      const onExit = (code: number | null): void => settle(new Error(`Process exited before ready (code: ${code})`))
      const onError = (error: Error): void => settle(error)
      const onAbort = (): void => settle(new Error('Readiness wait aborted'))
      const timeout = setTimeout(
        () => settle(new Error(`Process readiness timed out after ${options.timeoutMs}ms`)),
        options.timeoutMs
      )
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      child.once('exit', onExit)
      child.once('error', onError)
      options.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private captureOutput(data: Buffer): void {
    const output = Buffer.concat([this.recentOutput, data])
    this.recentOutput = output.subarray(Math.max(0, output.length - 65_536))
  }
}

function waitForBackoff(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('Native process retry aborted'))
  if (delayMs === 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new Error('Native process retry aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
