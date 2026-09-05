/**
 * WebSocket bridge client.
 * Communicates with the TON blockchain via the tonutils-bridge binary
 * over a local JSON-RPC 2.0 WebSocket connection.
 */

import { createLogger, RepetitionAggregator } from '../../shared/logger'
import { JsonRpcRequestTracker, type JsonRpcResponse } from './json-rpc-peer'
import {
  AccountBalanceResultSchema,
  AccountInformationResultSchema,
  EmulateTransactionResultSchema,
  BridgeAccountStateSchema,
  BridgeTransactionsResultSchema,
  BridgeTransactionSchema,
  JsonRpcInboundSchema,
  SeqnoResultSchema,
} from './bridge-codecs'
import type {
  AccountInformationResult,
  BridgeAccountState,
  BridgeTransaction,
  EmulateTransactionResult,
} from '../ports/ton-bridge'
import type { BridgeEventCallback } from './bridge-event-bus'
import { BridgeSubscriptions } from './bridge-subscriptions'
import { BridgeDhtClient, BridgeDnsClient, BridgeOverlayClient } from './bridge-capabilities'
import { BridgeTransactionWatcher } from './bridge-transaction-watcher'
import { WebSocketTransport } from './websocket-transport'

const log = createLogger('ton-bridge:client')

export { isContractNotDeployedError } from '../ports/ton-bridge'

const REQUEST_TIMEOUT_MS = 10_000
const READINESS_PROBE_MAX_ATTEMPTS = 15
const READINESS_PROBE_BASE_MS = 300

// --- Bridge-specific types ---

/** Value paired with the address it was fetched for, so switching wallets invalidates the cache. */
interface AddressScoped<T> {
  address: string
  value: T
}

type RpcParams = Record<string, unknown>
type EventCallback = BridgeEventCallback

export class WsBridgeClient {
  private wsPort: number
  private transport: WebSocketTransport
  private nextId = 0
  private requestTracker = new JsonRpcRequestTracker()
  private readonly reconnectLogs = new RepetitionAggregator(log)
  private subscriptions = new BridgeSubscriptions(
    (method, params) => this.request(method, params),
    (operation, error) => log.error(`Bridge subscription error (${operation}):`, error)
  )
  private requestQueue: Array<{
    id: string
    message: string
    resolve: (v: unknown) => void
    reject: (e: Error) => void
    method: string
    deadline: number
    timer: ReturnType<typeof setTimeout>
  }> = []
  private cachedBalance: AddressScoped<string> | null = null
  private balanceDegraded = false
  private dns: BridgeDnsClient
  private overlay: BridgeOverlayClient
  private dht: BridgeDhtClient
  private transactionWatcher: BridgeTransactionWatcher

  constructor(wsPort: number) {
    this.wsPort = wsPort
    const request = (method: string, params: RpcParams, timeoutMs?: number) =>
      this.request(method, params, undefined, timeoutMs)
    this.dns = new BridgeDnsClient(request)
    this.overlay = new BridgeOverlayClient(request, this.subscriptions)
    this.dht = new BridgeDhtClient(request, (message) => log.warn(message))
    this.transactionWatcher = new BridgeTransactionWatcher(request, this.subscriptions)
    this.transport = new WebSocketTransport(`ws://127.0.0.1:${wsPort}`, {
      onMessage: (message) => this.handleMessage(message),
      onSocketOpen: () => this.waitForPoolReady(),
      onReady: (reconnected) => {
        this.drainQueue()
        if (reconnected) void this.subscriptions.resubscribeAll()
        this.reconnectLogs.recovered('connection', 'ton.bridge.restored', 'TON bridge restored')
        log.debug(`Connected to bridge on port ${this.wsPort}`)
      },
      onDisconnect: (error) => {
        this.requestTracker.rejectAll(error)
        this.transactionWatcher.rejectAll(error)
      },
      onError: (error) =>
        this.reconnectLogs.record('connection', 'ton.bridge.unavailable', 'TON bridge unavailable · reconnecting', {
          error,
        }),
      onReconnectScheduled: (delay, attempt) => log.debug(`Reconnecting in ${delay}ms (attempt ${attempt})`),
    })
  }

  async connect(): Promise<void> {
    await this.transport.connect()
  }

  disconnect(): void {
    this.requestTracker.rejectAll(new Error('Client disconnected'))
    this.transactionWatcher.rejectAll(new Error('Client disconnected'))
    // Drain request queue
    for (const queued of this.requestQueue) {
      clearTimeout(queued.timer)
      queued.reject(new Error('Client disconnected'))
    }
    this.requestQueue = []
    this.subscriptions.clear()
    this.transport.stop()
  }

  isConnected(): boolean {
    return this.transport.isConnected()
  }

  // --- Wallet operations ---

  async getBalance(address: string): Promise<string> {
    try {
      const raw = await this.request('lite.getAccountState', { address })
      const { balance } = AccountBalanceResultSchema.parse(raw)
      this.cachedBalance = { address, value: balance }
      this.balanceDegraded = false
      return balance
    } catch (err) {
      if (this.cachedBalance && this.cachedBalance.address === address) {
        if (this.balanceDegraded) {
          log.debug('getBalance still failing, returning cached value')
        } else {
          log.warn('getBalance failed, returning cached value')
          this.balanceDegraded = true
        }
        return this.cachedBalance.value
      }
      throw err
    }
  }

  async getAccountInformation(address: string): Promise<AccountInformationResult> {
    return AccountInformationResultSchema.parse(await this.request('lite.getAccountState', { address }))
  }

  async emulateTransaction(address: string, boc: string): Promise<EmulateTransactionResult> {
    return EmulateTransactionResultSchema.parse(
      await this.request('lite.emulateTransaction', { address, boc, ignore_chksig: true })
    )
  }

  async getSeqno(address: string): Promise<number> {
    const raw = await this.request('wallet.getSeqno', { address })
    const { seqno } = SeqnoResultSchema.parse(raw)
    return seqno
  }

  async broadcast(boc: Buffer): Promise<void> {
    const b64 = boc.toString('base64')
    await this.request('lite.sendMessage', { boc: b64 })
    log.info('Transaction broadcast successful')
  }

  async getTransactions(
    address: string,
    limit: number = 20,
    lastLt?: string,
    lastHash?: string
  ): Promise<BridgeTransaction[]> {
    const params: RpcParams = { address, limit }
    if (lastLt && lastHash) {
      params.last_lt = lastLt
      params.last_hash = lastHash
    }
    const result = BridgeTransactionsResultSchema.parse(await this.request('lite.getTransactions', params))
    return result.transactions ?? []
  }

  // --- Subscriptions ---

  subscribeAccountState(address: string, callback: (state: BridgeAccountState) => void): () => void {
    return this.subscribe('subscribe.accountState', { address }, 'account_state', (data) => {
      callback(BridgeAccountStateSchema.parse(data))
    })
  }

  subscribeTransactions(address: string, callback: (tx: BridgeTransaction) => void): () => void {
    return this.subscribe('subscribe.transactions', { address, last_lt: '0' }, 'transaction', (data) => {
      callback(BridgeTransactionSchema.parse(data))
    })
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    await this.subscriptions.unsubscribe(subscriptionId)
  }

  // --- Payment flow ---

  async sendAndWatch(boc: Buffer): Promise<string> {
    return this.transactionWatcher.sendAndWatch(boc)
  }

  // --- DNS ---

  resolveDomain(domain: string) {
    return this.dns.resolve(domain)
  }

  // --- Generic ---

  async runMethod(address: string, method: string, params?: unknown[]): Promise<unknown> {
    return await this.request('lite.runMethod', { address, method, params: params ?? [] })
  }

  async overlayConnectAndJoin(anchorAdnlB64: string, overlayIdB64: string): Promise<string> {
    return this.overlay.connectAndJoin(anchorAdnlB64, overlayIdB64)
  }

  async overlaySend(overlayIdB64: string, dataB64: string): Promise<void> {
    await this.overlay.send(overlayIdB64, dataB64)
  }

  async overlaySendRaw(overlayIdB64: string, dataB64: string): Promise<void> {
    await this.overlay.sendRaw(overlayIdB64, dataB64)
  }

  async overlayQuery(overlayIdB64: string, dataB64: string, timeoutSec = 3): Promise<string> {
    return this.overlay.query(overlayIdB64, dataB64, timeoutSec)
  }

  async adnlPing(peerId: string): Promise<void> {
    await this.overlay.ping(peerId)
  }

  async overlayLeave(overlayIdB64: string): Promise<void> {
    await this.overlay.leave(overlayIdB64)
  }

  async overlayLeaveAndDisconnect(overlayIdB64: string, peerId: string): Promise<void> {
    await this.overlay.leaveAndDisconnect(overlayIdB64, peerId)
  }

  onOverlayMessage(cb: (data: { overlay_id: string; message: string; trusted?: boolean }) => void): () => void {
    return this.overlay.onMessage(cb)
  }

  async dhtFindValue(keyIdB64: string, name: string, index = 0): Promise<{ data: string; ttl: number } | null> {
    return this.dht.findValue(keyIdB64, name, index)
  }

  async dhtFindOverlayNodes(overlayKeyB64: string) {
    return this.dht.findOverlayNodes(overlayKeyB64)
  }

  // --- Internal: JSON-RPC transport ---

  private request<T = unknown>(
    method: string,
    params: RpcParams,
    guard?: (value: unknown) => value is T,
    timeoutMs: number = REQUEST_TIMEOUT_MS
  ): Promise<T> {
    const id = String(++this.nextId)
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })

    const raw = this.transport.isConnected()
      ? this.sendRequest(id, message, method, timeoutMs)
      : new Promise<unknown>((resolve, reject) => {
          const queued = {
            id,
            message,
            resolve,
            reject,
            method,
            deadline: Date.now() + timeoutMs,
            timer: setTimeout(() => {
              const index = this.requestQueue.indexOf(queued)
              if (index === -1) return
              this.requestQueue.splice(index, 1)
              reject(new Error(`Request timeout: ${method}`))
            }, timeoutMs),
          }
          this.requestQueue.push(queued)
        })

    return raw.then((value) => {
      if (guard && !guard(value)) {
        throw new Error(`Unexpected response shape for ${method}`)
      }
      return value as T
    })
  }

  private sendRequest(
    id: string,
    message: string,
    method: string,
    timeoutMs: number = REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    const pending = this.requestTracker.wait(id, method, timeoutMs)
    void this.transport.send(message).catch((error) => this.requestTracker.reject(id, error))
    return pending
  }

  private handleMessage(raw: string): void {
    let msg
    try {
      msg = JsonRpcInboundSchema.parse(JSON.parse(raw))
    } catch {
      log.warn('Received invalid JSON-RPC message from bridge')
      return
    }

    // Push event (no id, has event field)
    if (msg.event) {
      this.subscriptions.emit(msg.event, msg.data)
      return
    }

    // RPC response (has id)
    if (msg.id !== undefined) {
      this.requestTracker.settle(msg as JsonRpcResponse)
    }
  }

  // --- Internal: subscriptions ---

  private subscribe(method: string, params: RpcParams, eventName: string, callback: EventCallback): () => void {
    return this.subscriptions.subscribe(method, params, eventName, callback)
  }

  /**
   * Poll lite.getMasterchainInfo until the bridge liteserver pool responds.
   * Uses exponential backoff (300ms, 600ms, 1.2s, ...) up to ~15 attempts.
   * If the pool never warms up, proceed anyway and let callers handle errors.
   */
  private async waitForPoolReady(): Promise<void> {
    for (let i = 0; i < READINESS_PROBE_MAX_ATTEMPTS; i++) {
      try {
        const id = String(++this.nextId)
        const msg = JSON.stringify({ jsonrpc: '2.0', id, method: 'lite.getMasterchainInfo', params: {} })
        await this.sendRequest(id, msg, 'lite.getMasterchainInfo')
        log.debug(`Bridge liteserver pool ready (probe ${i + 1})`)
        return
      } catch {
        const delay = Math.min(READINESS_PROBE_BASE_MS * Math.pow(2, i), 5_000)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
    log.warn('Bridge liteserver pool did not respond to readiness probes, proceeding anyway')
  }

  private drainQueue(): void {
    const queue = this.requestQueue
    this.requestQueue = []
    for (const { id, message, resolve, reject, method, deadline, timer } of queue) {
      clearTimeout(timer)
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        reject(new Error(`Request timeout: ${method}`))
        continue
      }
      this.sendRequest(id, message, method, remainingMs).then(resolve, reject)
    }
  }
}
