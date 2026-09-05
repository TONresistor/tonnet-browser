/**
 * TON proxy manager.
 * Spawns and manages the tonutils-proxy process (Tonutils-Proxy CLI).
 * Uses adnl-tunnel for multi-hop garlic routing via TON DHT discovery.
 */

import { EventEmitter } from 'events'
import path from 'path'
import { mkdir } from 'fs/promises'
import { app } from 'electron'
import { getBinaryPath } from '../utils/paths'
import { validatePort } from '../utils/validators'
import { stripAnsi } from '../utils/strip-ansi'
import { getSetting } from '../settings'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import { GeneralSettings } from '../../shared/schemas'
import type { AppSettings } from '../../shared/types'
import { createLogger } from '../../shared/logger'
import { TUNNEL_SECTIONS } from '../../shared/constants'
import { writeProxyConfig } from './config-writer'
import { BridgeManager } from './bridge-manager'
import { NativeProcessSupervisor } from '../native-process/supervisor'
const log = createLogger('proxy')

/**
 * Build CLI args for the tonutils-proxy binary.
 * Exported for unit testing.
 */
export function buildProxyArgs(port: number, general: GeneralSettings, verbosity = 2): string[] {
  const args: string[] = [
    '-addr',
    `127.0.0.1:${port}`,
    '-no-http',
    '-verbosity',
    String(Math.max(0, Math.min(3, verbosity))),
  ]
  if (general.resolveEth === false) {
    args.push('-no-eth')
  } else if (general.resolveEth === true && general.ethRpc.trim() !== '') {
    args.push('-eth-rpc', general.ethRpc.trim())
  }
  if (general.resolveSol === false) {
    args.push('-no-sol')
  } else if (general.resolveSol === true && general.solRpc.trim() !== '') {
    args.push('-sol-rpc', general.solRpc.trim())
  }
  return args
}

export type ProxyStatus = 'stopped' | 'starting' | 'syncing' | 'connected'
export type ProxySettingsApplyResult = { bridgeRestarted: boolean }

type ProxySettingsSnapshot = {
  port: number
  wsPort: number
  connectionTimeout: number
  anonymousMode: boolean
  tunnelMode: 'standard' | 'maximum'
  general: GeneralSettings
  proxyVerbosity: number
}

export class ProxyManager extends EventEmitter {
  private readonly supervisor = new NativeProcessSupervisor()
  private readonly bridge = new BridgeManager()
  private port: number = DEFAULT_SETTINGS.proxyPort
  private wsPort: number = DEFAULT_SETTINGS.wsPort
  private status: ProxyStatus = 'stopped'
  private anonymousMode: boolean = DEFAULT_SETTINGS.anonymousMode
  private tunnelMode: 'standard' | 'maximum' = DEFAULT_SETTINGS.tunnelMode
  private tunnelRoute: string = ''
  private resolveEth: boolean = DEFAULT_SETTINGS.resolveEth
  private ethRpc: string = DEFAULT_SETTINGS.ethRpc
  private resolveSol: boolean = DEFAULT_SETTINGS.resolveSol
  private solRpc: string = DEFAULT_SETTINGS.solRpc
  private proxyVerbosity: number = DEFAULT_SETTINGS.proxyVerbosity
  private lifecycleTail: Promise<void> = Promise.resolve()
  private readonly cancellableOperations = new Set<AbortController>()
  private sharedStart: Promise<void> | null = null
  private shouldRun = false

  constructor() {
    super()
    // The bridge is a distinct process; forward its events. A bridge-only crash
    // must not mislabel a still-working proxy as stopped, so the session-wide
    // 'exit' only fires here when the proxy is already gone.
    this.bridge.on('ready', (wsPort: number) => this.emit('ws-bridge-ready', wsPort))
    this.bridge.on('log', (line: string) => this.emit('log', line))
    this.bridge.on('error', (message: string) => {
      this.setStatus(this.process ? 'syncing' : 'stopped')
      this.emit('error', message)
    })
    this.bridge.on('exit', (code: number | null) => {
      this.emit('bridge-exit', code)
      if (this.process) {
        this.setStatus('syncing')
      } else {
        this.setStatus('stopped')
        this.emit('exit', code)
      }
    })
  }

  private get process() {
    return this.supervisor.process
  }

  private readSettings(source?: AppSettings): ProxySettingsSnapshot {
    const network = source?.network ?? getSetting('network')
    const advanced = source?.advanced ?? getSetting('advanced')
    const general = source?.general ?? getSetting('general')
    return {
      port: validatePort(network.proxyPort, DEFAULT_SETTINGS.proxyPort),
      wsPort: validatePort(network.wsPort, DEFAULT_SETTINGS.wsPort),
      connectionTimeout: network.connectionTimeout,
      anonymousMode: network.anonymousMode,
      tunnelMode: network.tunnelMode,
      general: {
        ...general,
        ethRpc: general.ethRpc.trim(),
        solRpc: general.solRpc.trim(),
      },
      proxyVerbosity: Math.max(0, Math.min(3, advanced.proxyVerbosity)),
    }
  }

  private bridgeStartOptions(settings: ProxySettingsSnapshot) {
    return {
      verbosity: settings.proxyVerbosity,
    }
  }

  private commitRuntimeSettings(settings: ProxySettingsSnapshot): void {
    this.port = settings.port
    this.wsPort = settings.wsPort
    this.anonymousMode = settings.anonymousMode
    this.tunnelMode = settings.tunnelMode
    this.resolveEth = settings.general.resolveEth
    this.ethRpc = settings.general.ethRpc
    this.resolveSol = settings.general.resolveSol
    this.solRpc = settings.general.solRpc
    this.proxyVerbosity = settings.proxyVerbosity
  }

  private static MAX_START_RETRIES = 3
  private static RETRY_DELAY_MS = 2000

  private enqueueLifecycle<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.lifecycleTail.then(operation)
    this.lifecycleTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private enqueueCancellable<TResult>(operation: (signal: AbortSignal) => Promise<TResult>): Promise<TResult> {
    const controller = new AbortController()
    this.cancellableOperations.add(controller)
    const result = this.enqueueLifecycle(() => operation(controller.signal))
    result.then(
      () => this.cancellableOperations.delete(controller),
      () => this.cancellableOperations.delete(controller)
    )
    return result
  }

  private abortCancellableOperations(): void {
    for (const controller of this.cancellableOperations) controller.abort()
  }

  start(): Promise<void> {
    if (this.sharedStart) return this.sharedStart

    this.shouldRun = true
    const flight = this.enqueueCancellable((signal) => this.ensureStarted(signal, this.readSettings()))
    this.sharedStart = flight
    flight.then(
      () => {
        if (this.sharedStart === flight) this.sharedStart = null
      },
      () => {
        if (this.sharedStart === flight) this.sharedStart = null
      }
    )
    return flight
  }

  private async ensureStarted(signal: AbortSignal, settings: ProxySettingsSnapshot): Promise<void> {
    if (signal.aborted) throw new Error('Proxy start aborted')
    if (this.process) {
      if (this.bridge.isRunning()) {
        if (this.status !== 'connected') this.setStatus('connected')
        return
      }
      this.setStatus('syncing')
      try {
        await this.bridge.start(settings.wsPort, this.bridgeStartOptions(settings), signal)
        if (signal.aborted) throw new Error('Proxy start aborted')
        this.wsPort = settings.wsPort
        this.setStatus('connected')
        return
      } catch (error) {
        this.setStatus(this.process ? 'syncing' : 'stopped')
        throw error
      }
    }

    try {
      await this.supervisor.runWithBackoff(
        async () => {
          try {
            await this.startOnce(signal, settings)
          } catch (error) {
            await this.stopRunningProcesses()
            throw error
          }
        },
        {
          maxAttempts: ProxyManager.MAX_START_RETRIES,
          initialDelayMs: ProxyManager.RETRY_DELAY_MS,
          multiplier: 1,
          signal,
          shouldRetry: (error) =>
            (error instanceof Error ? error.message : String(error)).includes('exited before ready'),
          onRetry: (error, attempt, delay) => {
            const message = error instanceof Error ? error.message : String(error)
            log.warn(`Proxy start failed (attempt ${attempt}/${ProxyManager.MAX_START_RETRIES}): ${message}`)
            log.debug(`Retrying in ${delay}ms...`)
          },
        }
      )
    } catch (error) {
      this.setStatus(this.process ? 'syncing' : 'stopped')
      throw error
    }
  }

  private async startOnce(signal: AbortSignal, settings: ProxySettingsSnapshot): Promise<void> {
    const startedAt = Date.now()
    if (signal.aborted) throw new Error('Proxy start aborted')
    if (this.process) {
      throw new Error('Proxy already running')
    }
    if (this.bridge.isRunning()) {
      await this.bridge.stop()
      if (signal.aborted) throw new Error('Proxy start aborted')
    }

    this.setStatus('starting')

    const proxyBinPath = getBinaryPath('tonutils-proxy')
    const proxyWorkDir = await this.getProxyWorkDir()
    if (signal.aborted) throw new Error('Proxy start aborted')

    // Write proxy config to control tunnel mode
    const tunnelSections = settings.anonymousMode ? TUNNEL_SECTIONS[settings.tunnelMode] : 0
    await writeProxyConfig(proxyWorkDir, tunnelSections)
    if (signal.aborted) throw new Error('Proxy start aborted')

    // Spawn proxy process (HTTP proxy for .ton sites)
    if (settings.anonymousMode) {
      log.debug(`Starting anonymous proxy from: ${proxyBinPath}`)
      log.debug(`Port: ${settings.port}, Mode: tunnel (DHT discovery)`)
      log.debug('Tunnel auto-reroute: managed by adnl-tunnel (on stall)')
    } else {
      log.debug(`Starting direct proxy from: ${proxyBinPath}`)
      log.debug(`Port: ${settings.port}, Mode: direct`)
    }

    // Proxy output handler
    const handleProxyOutput = (raw: string) => {
      if (!raw) return
      // Strip ANSI escape codes for parsing
      const message = stripAnsi(raw)

      // Transition to syncing once DHT/tunnel work begins
      if (this.status === 'starting') {
        const lower = message.toLowerCase()
        if (
          lower.includes('discovering tunnel relay') ||
          lower.includes('initializing dht') ||
          lower.includes('initializing adnl tunnel') ||
          lower.includes('initializing dns resolver')
        ) {
          this.setStatus('syncing')
        }
      }

      // Parse storage bag discovery from proxy logs
      // Format: searching for bag id bag_id=<hex> host=<domain>
      const bagMatch = message.match(/searching for bag id\s+bag_id=([a-fA-F0-9]{64})\s+host=(\S+)/)
      if (bagMatch) {
        const domain = bagMatch[2]
        // Validate domain format to prevent log injection attacks
        if (/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(domain)) {
          this.emit('storage-bag-detected', { bagId: bagMatch[1], domain })
        }
      }

      // Parse tunnel route from Tonutils-Proxy logs
      // Raw format: route="we -> KEY1 -> KEY2 -> KEY1 -> we"
      if (settings.anonymousMode) {
        const routeMatch = message.match(/route="([^"]+)"/)
        if (routeMatch && routeMatch[1] !== this.tunnelRoute) {
          this.tunnelRoute = routeMatch[1]
          const relays = routeMatch[1].split(' -> ').filter((s) => s !== 'we')
          log.info(`Tunnel route (${relays.length} hops):`)
          relays.forEach((key, i) => log.info(`  ${i + 1} → ${key.slice(0, 16)}`))
        }
      }
    }

    this.supervisor.start({
      name: 'tonutils-proxy',
      command: proxyBinPath,
      args: buildProxyArgs(settings.port, settings.general, settings.proxyVerbosity),
      options: { windowsHide: true, cwd: proxyWorkDir },
      onRawLine: ({ line }) => handleProxyOutput(line),
      onLine: ({ line }) => this.emit('log', line),
      onExit: (code) => {
        log.info(`Proxy exited with code: ${code}`)
        this.setStatus('stopped')
        this.emit('exit', code)
      },
      onError: (error) => {
        log.error(`Failed to start proxy:`, error)
        this.setStatus('stopped')
        this.emit('error', error.message)
      },
    })

    await this.waitForReady(signal, settings)
    if (signal.aborted) throw new Error('Proxy start aborted')

    await this.bridge.start(settings.wsPort, this.bridgeStartOptions(settings), signal)
    if (signal.aborted) throw new Error('Proxy start aborted')
    this.commitRuntimeSettings(settings)
    this.setStatus('connected')
    log.status('proxy.ready', `proxy ready · ${Date.now() - startedAt}ms`, {
      durationMs: Date.now() - startedAt,
      port: settings.port,
    })
  }

  private async stopRunningProcesses(): Promise<void> {
    const promises: Promise<void>[] = [this.bridge.stop()]
    if (this.supervisor.isRunning) promises.push(this.supervisor.stop())
    await Promise.allSettled(promises)
  }

  private async getProxyWorkDir(): Promise<string> {
    const dir = path.join(app.getPath('userData'), 'proxy')
    await mkdir(dir, { recursive: true })
    return dir
  }

  private setStatus(status: ProxyStatus): void {
    this.status = status
    this.emit('status', status)
    log.event('debug', 'proxy.status.changed', `status ${status}`, { status })
  }

  private async stopLifecycle(): Promise<void> {
    if (!this.process && !this.bridge.isRunning() && this.status === 'stopped') return
    log.info('Stopping proxy and bridge...')
    this.tunnelRoute = ''
    const promises: Promise<void>[] = [this.bridge.stop()]
    if (this.supervisor.isRunning) promises.push(this.supervisor.stop())
    await Promise.allSettled(promises)
    this.setStatus('stopped')
    this.emit('disconnected')
  }

  stop(): Promise<void> {
    this.shouldRun = false
    this.abortCancellableOperations()
    this.sharedStart = null
    return this.enqueueLifecycle(() => this.stopLifecycle())
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      port: this.port,
      wsPort: this.wsPort,
      anonymousMode: this.anonymousMode,
      circuitRelays: this.tunnelRoute ? this.tunnelRoute.split(' -> ').filter((s) => s !== 'we') : [],
    }
  }

  isRunning(): boolean {
    return this.process !== null && this.bridge.isRunning()
  }

  isActive(): boolean {
    return (
      this.shouldRun ||
      this.status !== 'stopped' ||
      this.process !== null ||
      this.bridge.isRunning() ||
      this.sharedStart !== null ||
      this.cancellableOperations.size > 0
    )
  }

  isSynced(): boolean {
    return this.status === 'connected'
  }

  getProxyUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  restart(): Promise<void> {
    log.info('Restarting proxy...')
    this.shouldRun = true
    this.sharedStart = null
    return this.enqueueCancellable(async (signal) => {
      if (signal.aborted) throw new Error('Proxy restart aborted')
      await this.stopLifecycle()
      if (signal.aborted) throw new Error('Proxy restart aborted')
      await this.ensureStarted(signal, this.readSettings())
    })
  }

  restartBridge(source?: AppSettings): Promise<void> {
    this.sharedStart = null
    return this.enqueueCancellable(async (signal) => {
      if (signal.aborted) throw new Error('Bridge restart aborted')
      if (!this.process) {
        throw new Error('Cannot restart bridge: proxy is not running')
      }
      log.info('Restarting bridge (keeping proxy)...')
      const settings = this.readSettings(source)
      this.setStatus('syncing')
      await this.bridge.stop()
      if (signal.aborted) throw new Error('Bridge restart aborted')
      await this.bridge.start(settings.wsPort, this.bridgeStartOptions(settings), signal)
      if (signal.aborted) throw new Error('Bridge restart aborted')
      this.wsPort = settings.wsPort
      this.setStatus('connected')
    })
  }

  applySettingsChange(source?: AppSettings): Promise<ProxySettingsApplyResult> {
    this.sharedStart = null
    return this.enqueueCancellable(async (signal) => {
      if (signal.aborted) throw new Error('Settings apply aborted')
      const settings = this.readSettings(source)
      const proxyChanged =
        settings.port !== this.port ||
        settings.anonymousMode !== this.anonymousMode ||
        settings.tunnelMode !== this.tunnelMode ||
        settings.general.resolveEth !== this.resolveEth ||
        settings.general.ethRpc !== this.ethRpc ||
        settings.general.resolveSol !== this.resolveSol ||
        settings.general.solRpc !== this.solRpc ||
        settings.proxyVerbosity !== this.proxyVerbosity
      const bridgeChanged = settings.wsPort !== this.wsPort

      if (!this.process) {
        if (this.shouldRun) {
          await this.ensureStarted(signal, settings)
          return { bridgeRestarted: true }
        }
        return { bridgeRestarted: false }
      }

      if (proxyChanged) {
        log.info(`Settings changed, restarting proxy...`)
        this.tunnelRoute = ''
        await this.stopLifecycle()
        if (signal.aborted) throw new Error('Settings apply aborted')
        await this.ensureStarted(signal, settings)
        return { bridgeRestarted: true }
      }

      if (bridgeChanged || !this.bridge.isRunning()) {
        this.setStatus('syncing')
        await this.bridge.stop()
        if (signal.aborted) throw new Error('Settings apply aborted')
        const wsPort = bridgeChanged ? settings.wsPort : this.wsPort
        await this.bridge.start(wsPort, this.bridgeStartOptions(settings), signal)
        if (signal.aborted) throw new Error('Settings apply aborted')
        if (bridgeChanged) {
          this.wsPort = settings.wsPort
        }
        this.setStatus('connected')
        return { bridgeRestarted: true }
      }
      return { bridgeRestarted: false }
    })
  }

  private async waitForReady(signal: AbortSignal, settings: ProxySettingsSnapshot): Promise<void> {
    const maxAttempts = settings.anonymousMode ? settings.connectionTimeout * 3 : settings.connectionTimeout

    await this.supervisor.waitForOutput({
      timeoutMs: maxAttempts * 1000,
      signal,
      matches: (data) => {
        const raw = data.toString()
        const output = stripAnsi(raw).toLowerCase()
        // In direct mode: "starting proxy server" comes immediately
        // In tunnel mode: "starting proxy server" comes AFTER tunnel init (~10-15s)
        // We must wait for the proxy to actually be listening before starting sync checks
        if (
          output.includes('starting proxy server') ||
          output.includes('listening on') ||
          output.includes('proxy listening')
        ) {
          log.debug('Proxy is ready')
          return true
        }
        return false
      },
    })
  }
}

// Singleton removed: use ServiceRegistry from services.ts
