import { Address } from '@ton/core'
import { APP_VERSION } from '../../shared/constants'
import { errorMessage } from '../../shared/errors'
import { KeyedRateLimiter } from '../ipc/validation'
import { createLogger } from '../../shared/logger'
import { TonConnectSessionStore } from './session-store'
import {
  TONCONNECT_PROTOCOL_VERSION,
  TON_MAINNET_CHAIN,
  TONCONNECT_MAX_MESSAGES,
  TONCONNECT_ERROR,
  CONNECT_ERROR,
  type AppManifest,
  type AppRequest,
  type ConnectEvent,
  type ConnectEventError,
  type ConnectItemReply,
  type ConnectRequest,
  type DeviceInfo,
  type DisconnectEvent,
  type TonProofItem,
  type WalletResponse,
} from './types'
import type { TonConnectSession } from '../../shared/types'
import { TonConnectManifestLoader } from './manifest-loader'
import type { TonConnectApprovalPort } from './approval'
import type { TonConnectWalletPort } from './wallet-port'
import type { TonConnectRequestContext } from './request-context'
import type { TonConnectEventDeliveryPort } from './event-delivery'
import { TonConnectSigningWorkflow } from './signing-workflow'

const log = createLogger('tonconnect')

interface TonConnectRequestPayload {
  method: 'connect' | 'restore' | 'send' | 'disconnect'
  protocolVersion?: number
  request?: ConnectRequest
  message?: AppRequest
}

function connectError(code: number, message: string): ConnectEventError {
  return { event: 'connect_error', id: 0, payload: { code, message } }
}

function rpcError(id: string, code: number, message: string): WalletResponse {
  return { id, error: { code, message } }
}

function anyToAddress(value: string): Address {
  try {
    return Address.parseFriendly(value).address
  } catch {
    return Address.parseRaw(value)
  }
}

function sameAddress(a: string, b: string): boolean {
  try {
    return anyToAddress(a).equals(anyToAddress(b))
  } catch {
    return false
  }
}

function shortAddress(value: string): string {
  let s = value
  try {
    s = anyToAddress(value).toString({ bounceable: false })
  } catch {
    s = value
  }
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s
}

function platform(): string {
  switch (process.platform) {
    case 'darwin':
      return 'mac'
    case 'win32':
      return 'windows'
    case 'linux':
      return 'linux'
    default:
      return 'browser'
  }
}

export class TonConnectService {
  private availability: 'pending' | 'ready' | 'unavailable' = 'pending'
  private wallet: TonConnectWalletPort
  private sessionStore: TonConnectSessionStore
  private approval: TonConnectApprovalPort
  private manifestLoader: TonConnectManifestLoader
  private eventDelivery: TonConnectEventDeliveryPort
  private signingWorkflow: TonConnectSigningWorkflow
  private sessionGeneration = 0
  private lastGrantedAt = 0
  // Per-domain so one noisy tonsite cannot exhaust another's request budget.
  private limiter = new KeyedRateLimiter(10, 1000)

  constructor(
    wallet: TonConnectWalletPort,
    sessionStore: TonConnectSessionStore,
    approval: TonConnectApprovalPort,
    manifestLoader: TonConnectManifestLoader,
    eventDelivery: TonConnectEventDeliveryPort
  ) {
    this.wallet = wallet
    this.sessionStore = sessionStore
    this.approval = approval
    this.manifestLoader = manifestLoader
    this.eventDelivery = eventDelivery
    this.signingWorkflow = new TonConnectSigningWorkflow(wallet, approval)
  }

  async init(clearSessions = false): Promise<void> {
    this.availability = 'pending'
    try {
      await this.sessionStore.init()
      if (clearSessions) await this.sessionStore.clear()
      this.availability = 'ready'
    } catch (error) {
      this.availability = 'unavailable'
      throw error
    }
  }

  isAvailable(): boolean {
    return this.availability === 'ready'
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) throw new Error('TON Connect is unavailable')
  }

  async handleRequest(
    domain: string,
    event: TonConnectRequestContext,
    payload: TonConnectRequestPayload
  ): Promise<unknown> {
    if (!this.isAvailable()) {
      return payload.method === 'send' || payload.method === 'disconnect'
        ? rpcError(payload.message?.id ?? '0', TONCONNECT_ERROR.UNKNOWN_APP, 'TON Connect is unavailable')
        : connectError(CONNECT_ERROR.UNKNOWN_APP, 'TON Connect is unavailable')
    }
    if (!this.limiter.check(domain)) {
      if (payload?.method === 'send') {
        return rpcError(payload.message?.id ?? '0', TONCONNECT_ERROR.UNKNOWN, 'Rate limit exceeded')
      }
      return connectError(CONNECT_ERROR.UNKNOWN, 'Rate limit exceeded')
    }
    try {
      switch (payload?.method) {
        case 'connect':
          return await this.connect(domain, event, payload.request, payload.protocolVersion)
        case 'restore':
          return this.restore(domain, event)
        case 'send':
          return await this.send(domain, event, payload.message)
        case 'disconnect':
          await this.sessionStore.delete(domain)
          this.limiter.forget(domain)
          return { id: '0', result: {} }
        default:
          return connectError(CONNECT_ERROR.BAD_REQUEST, 'Unknown method')
      }
    } catch (err) {
      log.event('error', 'tonconnect.request.failed', 'TON Connect request failed', {
        method: payload?.method,
        error: err,
      })
      if (payload?.method === 'send') {
        return rpcError(payload.message?.id ?? '0', TONCONNECT_ERROR.UNKNOWN, errorMessage(err))
      }
      return connectError(CONNECT_ERROR.UNKNOWN, errorMessage(err))
    }
  }

  getSessions(): TonConnectSession[] {
    this.assertAvailable()
    return this.sessionStore.list()
  }

  async disconnectSession(domain: string): Promise<void> {
    this.assertAvailable()
    await this.emitDisconnect(domain)
    await this.sessionStore.delete(domain)
    this.limiter.forget(domain)
  }

  async clearSessions(): Promise<void> {
    // Disabling a failed service must not attempt another write to its unreadable store.
    if (!this.isAvailable()) return
    this.sessionGeneration += 1
    this.limiter.clear()
    for (const domain of this.sessionStore.list().map((s) => s.domain)) {
      await this.emitDisconnect(domain)
    }
    await this.sessionStore.clear()
  }

  private async connect(
    domain: string,
    event: TonConnectRequestContext,
    request?: ConnectRequest,
    protocolVersion?: number
  ): Promise<ConnectEvent> {
    const sessionGeneration = this.sessionGeneration
    if (protocolVersion && protocolVersion > TONCONNECT_PROTOCOL_VERSION) {
      return connectError(CONNECT_ERROR.BAD_REQUEST, 'Unsupported protocol version')
    }
    const account = this.wallet.getTonConnectAccount()
    if (!account) {
      return connectError(CONNECT_ERROR.UNKNOWN, 'No wallet available')
    }
    if (!request || !Array.isArray(request.items) || !request.items.some((i) => i.name === 'ton_addr')) {
      return connectError(CONNECT_ERROR.BAD_REQUEST, 'ton_addr item is required')
    }

    let manifest: AppManifest | null = null
    try {
      manifest = await this.manifestLoader.load(event.sender.session, request.manifestUrl)
    } catch (err) {
      log.event('warn', 'tonconnect.manifest.failed', 'TON Connect manifest fetch failed', { error: err })
    }

    const appName = manifest?.name || domain
    const appUrl = manifest?.url || `http://${domain}`
    const appIconUrl = manifest?.iconUrl

    const icon = await this.manifestLoader.loadIcon(event.sender.session, manifest?.iconUrl)
    const approved = await this.approval.request({
      type: 'approval',
      icon: icon ?? undefined,
      iconTon: icon ? undefined : true,
      title: appName,
      subtitle: 'wants to connect to your wallet',
      domain,
      rows: [{ label: 'Wallet', value: shortAddress(account.addressRaw) }],
      actions: [
        { id: 'deny', label: 'Cancel' },
        { id: 'approve', label: 'Connect', primary: true },
      ],
    })
    if (!approved) {
      return connectError(CONNECT_ERROR.USER_DECLINED, 'User declined the connection')
    }

    const approvedAccount = this.wallet.getTonConnectAccount()
    if (!approvedAccount || !sameAddress(account.addressRaw, approvedAccount.addressRaw)) {
      return connectError(CONNECT_ERROR.UNKNOWN, 'Wallet changed while connection approval was pending')
    }

    const items: ConnectItemReply[] = [
      {
        name: 'ton_addr',
        address: approvedAccount.addressRaw,
        network: TON_MAINNET_CHAIN,
        publicKey: approvedAccount.publicKey,
        walletStateInit: approvedAccount.walletStateInit,
      },
    ]

    const proofItem = request.items.find((i): i is TonProofItem => i.name === 'ton_proof')
    if (proofItem) {
      try {
        const proof = await this.wallet.signTonProof(domain, proofItem.payload, approvedAccount.addressRaw)
        items.push({ name: 'ton_proof', proof })
      } catch (err) {
        items.push({ name: 'ton_proof', error: { code: 0, message: errorMessage(err) } })
      }
    }

    const currentAccount = this.wallet.getTonConnectAccount()
    if (
      sessionGeneration !== this.sessionGeneration ||
      !currentAccount ||
      !sameAddress(approvedAccount.addressRaw, currentAccount.addressRaw)
    ) {
      return connectError(CONNECT_ERROR.UNKNOWN, 'Wallet changed while connection approval was pending')
    }

    const grantedAt = Math.max(Date.now(), this.lastGrantedAt + 1)
    this.lastGrantedAt = grantedAt
    await this.sessionStore.set({
      domain,
      manifestUrl: request.manifestUrl,
      appName,
      appIconUrl,
      url: appUrl,
      address: approvedAccount.addressRaw,
      network: TON_MAINNET_CHAIN,
      grantedAt,
      lastEventId: 0,
      lastRpcId: null,
    })
    const stored = this.sessionStore.get(domain)
    const finalAccount = this.wallet.getTonConnectAccount()
    if (
      sessionGeneration !== this.sessionGeneration ||
      !finalAccount ||
      !sameAddress(approvedAccount.addressRaw, finalAccount.addressRaw)
    ) {
      if (stored?.grantedAt === grantedAt) await this.sessionStore.delete(domain)
      return connectError(CONNECT_ERROR.UNKNOWN, 'Wallet changed while connection approval was pending')
    }
    if (stored?.grantedAt !== grantedAt) {
      return connectError(CONNECT_ERROR.UNKNOWN, 'Connection approval was superseded by a newer request')
    }
    this.eventDelivery.track(domain, event.sender)
    log.event('info', 'tonconnect.session.connected', 'TON Connect session established')

    return { event: 'connect', id: 0, payload: { items, device: this.buildDeviceInfo() } }
  }

  private restore(domain: string, event: TonConnectRequestContext): ConnectEvent {
    const session = this.sessionStore.get(domain)
    const account = this.wallet.getTonConnectAccount()
    if (!session || !account || !sameAddress(session.address, account.addressRaw)) {
      return connectError(CONNECT_ERROR.UNKNOWN_APP, 'Unknown app')
    }
    this.eventDelivery.track(domain, event.sender)
    return {
      event: 'connect',
      id: 0,
      payload: {
        items: [
          {
            name: 'ton_addr',
            address: account.addressRaw,
            network: TON_MAINNET_CHAIN,
            publicKey: account.publicKey,
            walletStateInit: account.walletStateInit,
          },
        ],
        device: this.buildDeviceInfo(),
      },
    }
  }

  private async send(domain: string, event: TonConnectRequestContext, message?: AppRequest): Promise<WalletResponse> {
    if (!message || typeof message.id !== 'string' || typeof message.method !== 'string') {
      return rpcError('0', TONCONNECT_ERROR.BAD_REQUEST, 'Malformed request')
    }
    const session = this.sessionStore.get(domain)
    const account = this.wallet.getTonConnectAccount()
    if (!session || !account || !sameAddress(session.address, account.addressRaw)) {
      return rpcError(message.id, TONCONNECT_ERROR.UNKNOWN_APP, 'Unknown app')
    }
    this.eventDelivery.track(domain, event.sender)

    if (message.method === 'disconnect') {
      await this.sessionStore.delete(domain)
      this.limiter.forget(domain)
      return { id: message.id, result: {} }
    }

    if (!(await this.sessionStore.acceptRpcId(domain, message.id))) {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Request id must strictly increase')
    }

    switch (message.method) {
      case 'sendTransaction':
        return this.signingWorkflow.sendTransaction(domain, session.appName, session.address, message)
      case 'signData':
        return this.signingWorkflow.signData(domain, session.appName, session.address, message)
      default:
        return rpcError(message.id, TONCONNECT_ERROR.METHOD_NOT_SUPPORTED, `Method ${message.method} not supported`)
    }
  }

  private buildDeviceInfo(): DeviceInfo {
    return {
      platform: platform(),
      appName: 'tonnet',
      appVersion: APP_VERSION,
      maxProtocolVersion: TONCONNECT_PROTOCOL_VERSION,
      features: [
        { name: 'SendTransaction', maxMessages: TONCONNECT_MAX_MESSAGES, extraCurrencySupported: false },
        { name: 'SignData', types: ['text', 'binary', 'cell'] },
      ],
    }
  }

  private async emitDisconnect(domain: string): Promise<void> {
    const evt: DisconnectEvent = { event: 'disconnect', id: await this.sessionStore.nextEventId(domain), payload: {} }
    this.eventDelivery.emitDisconnect(domain, evt)
  }
}
