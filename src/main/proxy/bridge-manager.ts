/**
 * WS-ADNL bridge process lifecycle (OPP-36).
 *
 * Split out of ProxyManager: the bridge is conceptually a distinct service from
 * the HTTP proxy. BridgeManager owns only the bridge process and emits events;
 * ProxyManager orchestrates (starts it after the proxy is ready) and decides
 * session-wide status. REQUIRED_NAMESPACES re-enforcement stays in
 * applyBridgeDefaults (config-writer), called on every start here.
 *
 * Events: 'ready'(wsPort) | 'log'(line) | 'exit'(code) | 'error'(message).
 */
import { EventEmitter } from 'events'
import path from 'path'
import { mkdir } from 'fs/promises'
import { app } from 'electron'
import { getBinaryPath } from '../utils/paths'
import { stripAnsi } from '../utils/strip-ansi'
import { createLogger } from '../../shared/logger'
import { applyBridgeDefaults } from './config-writer'
import { NativeProcessSupervisor } from '../native-process/supervisor'

const log = createLogger('bridge')
const BRIDGE_READY_TIMEOUT_MS = 15_000

export class BridgeManager extends EventEmitter {
  private readonly supervisor = new NativeProcessSupervisor()

  isRunning(): boolean {
    return this.supervisor.isRunning
  }

  private async getWorkDir(): Promise<string> {
    const dir = path.join(app.getPath('userData'), 'bridge')
    await mkdir(dir, { recursive: true })
    return dir
  }

  async start(wsPort: number, settings: { verbosity: number }, signal?: AbortSignal): Promise<void> {
    const startedAt = Date.now()
    if (signal?.aborted) throw new Error('Bridge start aborted')
    const bridgeBinPath = getBinaryPath('tonutils-bridge')
    const bridgeWorkDir = await this.getWorkDir()
    if (signal?.aborted) throw new Error('Bridge start aborted')
    await applyBridgeDefaults(bridgeWorkDir)
    if (signal?.aborted) throw new Error('Bridge start aborted')
    const verbosity = Math.max(0, Math.min(3, settings.verbosity))
    const bridgeArgs = ['-addr', `127.0.0.1:${wsPort}`, '-data-dir', bridgeWorkDir, '-verbosity', String(verbosity)]

    log.debug(`Starting bridge from: ${bridgeBinPath}`)
    log.debug(`Bridge WS port: ${wsPort}`)

    const handleBridgeOutput = (raw: string) => {
      if (!raw) return
      this.emit('log', raw)
    }

    this.supervisor.start({
      name: 'tonutils-bridge',
      command: bridgeBinPath,
      args: bridgeArgs,
      options: { windowsHide: true },
      onLine: ({ line }) => handleBridgeOutput(line),
      onExit: (code) => {
        log.info(`Bridge exited with code: ${code}`)
        this.emit('exit', code)
      },
      onError: (error) => {
        log.error(`Failed to start bridge:`, error)
        this.emit('error', error.message)
      },
    })

    try {
      await this.supervisor.waitForOutput({
        timeoutMs: BRIDGE_READY_TIMEOUT_MS,
        signal,
        matches: (data) => stripAnsi(data.toString()).toLowerCase().includes('websocket-adnl bridge started'),
      })
      log.status('bridge.ready', `bridge ready · ${Date.now() - startedAt}ms`, {
        durationMs: Date.now() - startedAt,
        port: wsPort,
      })
      this.emit('ready', wsPort)
    } catch (error) {
      await this.supervisor.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.supervisor.stop()
  }
}
