import type { DnsResolveResult } from '../../shared/types'
import {
  AdnlConnectionResultSchema,
  DhtOverlayNodesResultSchema,
  DhtValueResultSchema,
  DnsResolveResultSchema,
  OverlayMessageEventSchema,
  OverlayQueryResultSchema,
} from './bridge-codecs'
import type { BridgeEventCallback } from './bridge-event-bus'

type RpcParams = Record<string, unknown>
type Request = (method: string, params: RpcParams, timeoutMs?: number) => Promise<unknown>
const ADNL_CONNECT_TIMEOUT_MS = 20_000

function isTransientAdnlConnectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /request timeout: adnl\.connectByADNL|dht resolve failed|no live public ADNL address found/i.test(message)
}

export interface BridgeEventsPort {
  on(event: string, callback: BridgeEventCallback): () => void
}

export class BridgeDnsClient {
  constructor(private readonly request: Request) {}

  async resolve(domain: string): Promise<DnsResolveResult> {
    const raw = DnsResolveResultSchema.parse(await this.request('dns.resolve', { domain }))
    return {
      ...raw,
      wallet: raw.wallet ?? null,
      site_adnl: raw.site_adnl ?? raw.site ?? null,
      has_storage: Boolean(raw.has_storage ?? raw.storage ?? false),
      storage_bag_id: raw.storage_bag_id ?? raw.dns_storage_bag_id ?? raw.bag_id ?? null,
      next_resolver: raw.next_resolver ?? raw.dns_next_resolver ?? raw.next ?? null,
      owner: raw.owner ?? null,
      nft_address: raw.nft_address ?? null,
      collection: raw.collection ?? null,
      editor: raw.editor ?? null,
      initialized: raw.initialized !== false,
      expiring_at: raw.expiring_at ?? null,
      text_records: raw.text_records,
    }
  }
}

export class BridgeOverlayClient {
  constructor(
    private readonly request: Request,
    private readonly events: BridgeEventsPort
  ) {}

  async connectAndJoin(anchorAdnlB64: string, overlayIdB64: string): Promise<string> {
    const connect = () => this.request('adnl.connectByADNL', { adnl_id: anchorAdnlB64 }, ADNL_CONNECT_TIMEOUT_MS)
    let rawConnection: unknown
    try {
      rawConnection = await connect()
    } catch (error) {
      if (!isTransientAdnlConnectError(error)) throw error
      rawConnection = await connect()
    }
    const connection = AdnlConnectionResultSchema.parse(rawConnection)
    try {
      await this.request('overlay.join', { overlay_id: overlayIdB64, peer_id: connection.peer_id })
    } catch (error) {
      await this.request('adnl.disconnect', { peer_id: connection.peer_id }).catch(() => {})
      throw error
    }
    return connection.peer_id
  }

  async send(overlayIdB64: string, dataB64: string): Promise<void> {
    await this.request('overlay.sendMessage', { overlay_id: overlayIdB64, data: dataB64 })
  }

  async sendRaw(overlayIdB64: string, dataB64: string): Promise<void> {
    await this.request('overlay.sendRaw', { overlay_id: overlayIdB64, data: dataB64 })
  }

  async query(overlayIdB64: string, dataB64: string, timeoutSec = 3): Promise<string> {
    const result = OverlayQueryResultSchema.parse(
      await this.request(
        'overlay.query',
        { overlay_id: overlayIdB64, data: dataB64, timeout: timeoutSec },
        (timeoutSec + 1) * 1_000
      )
    )
    return result.data
  }

  async ping(peerId: string): Promise<void> {
    await this.request('adnl.ping', { peer_id: peerId })
  }

  async leaveAndDisconnect(overlayIdB64: string, peerId: string): Promise<void> {
    await this.leave(overlayIdB64)
    await this.request('adnl.disconnect', { peer_id: peerId }).catch(() => {})
  }

  async leave(overlayIdB64: string): Promise<void> {
    await this.request('overlay.leave', { overlay_id: overlayIdB64 }).catch(() => {})
  }

  onMessage(callback: (data: { overlay_id: string; message: string; trusted?: boolean }) => void): () => void {
    return this.events.on('overlay.message', (data) => callback(OverlayMessageEventSchema.parse(data)))
  }
}

export class BridgeDhtClient {
  constructor(
    private readonly request: Request,
    private readonly onFailure: (message: string) => void,
    private readonly attempts = 3,
    private readonly timeoutMs = 22_000
  ) {}

  async findValue(keyIdB64: string, name: string, index = 0): Promise<{ data: string; ttl: number } | null> {
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        return DhtValueResultSchema.parse(
          await this.request('dht.findValue', { key_id: keyIdB64, name, index }, this.timeoutMs)
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/not found|no value/i.test(message)) return null
        lastError = error instanceof Error ? error : new Error(message)
      }
    }
    if (lastError) this.onFailure(`dht.findValue gave up after ${this.attempts} attempts: ${lastError.message}`)
    return null
  }

  async findOverlayNodes(overlayKeyB64: string) {
    return DhtOverlayNodesResultSchema.parse(
      await this.request('dht.findOverlayNodes', { overlay_key: overlayKeyB64 }, this.timeoutMs)
    )
  }
}
