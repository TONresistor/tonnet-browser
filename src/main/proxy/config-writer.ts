/**
 * Proxy/bridge config.json generation. Extracted from ProxyManager (OPP-36).
 *
 * Concentrates three invariants in one place:
 *  - tunnel activation via TunnelSectionsNum (proxy config)
 *  - re-enforcement of REQUIRED_NAMESPACES on every bridge start (bridge config)
 *  - durable, secret-safe writes via writeSecureJsonAtomic (0o600)
 */
import path from 'path'
import { readFile } from 'fs/promises'
import { randomBytes } from 'crypto'
import { cpus } from 'os'
import { writeSecureJsonAtomicAsync } from '../utils/secure-fs'
import { createLogger } from '../../shared/logger'
import { CHAT_NAMESPACES, DEFAULT_NAMESPACE_STATE, REQUIRED_NAMESPACES } from '../../shared/bridge-config'

const log = createLogger('proxy')
const MESSENGER_NAMESPACES_MANAGED_KEY = '_messengerNamespacesManaged'

type NamespaceRecord = Record<string, Record<string, unknown>>
type BridgeConfigJson = Record<string, unknown> & { namespaces?: NamespaceRecord }

function namespaceRecord(config: BridgeConfigJson): NamespaceRecord | undefined {
  return config.namespaces
}

function setNamespaceEnabled(ns: NamespaceRecord, name: string, enabled: boolean): boolean {
  if (!ns[name]) ns[name] = {}
  if (ns[name].enabled === enabled) return false
  ns[name].enabled = enabled
  return true
}

function clearLegacyMessengerNamespaceState(config: BridgeConfigJson): boolean {
  if (!(MESSENGER_NAMESPACES_MANAGED_KEY in config)) return false
  const ns = namespaceRecord(config)
  if (ns && config[MESSENGER_NAMESPACES_MANAGED_KEY] === true) {
    for (const name of CHAT_NAMESPACES) {
      setNamespaceEnabled(ns, name, false)
    }
  }
  delete config[MESSENGER_NAMESPACES_MANAGED_KEY]
  return true
}

/**
 * Apply browser namespace defaults to the bridge config.json.
 * Runs once per install: disables unused namespaces (least privilege),
 * preserves user overrides on subsequent launches via _browserDefaults flag.
 * Required namespaces are always re-enforced regardless.
 */
export async function applyBridgeDefaults(workDir: string): Promise<void> {
  const configPath = path.join(workDir, 'config.json')

  try {
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as BridgeConfigJson
    if (config._browserDefaults) {
      // Already applied, only enforce required namespaces
      let changed = false
      const ns = namespaceRecord(config)
      if (ns) {
        for (const required of REQUIRED_NAMESPACES) {
          if (ns[required] && ns[required].enabled === false) {
            ns[required].enabled = true
            changed = true
          }
        }
      }
      changed = clearLegacyMessengerNamespaceState(config) || changed
      if (changed) {
        await writeSecureJsonAtomicAsync(configPath, config)
        log.debug('Re-enforced managed bridge namespaces')
      }
      return
    }

    // First application: set namespace defaults
    const ns = namespaceRecord(config)
    if (ns) {
      for (const [name, enabled] of Object.entries(DEFAULT_NAMESPACE_STATE)) {
        if (!ns[name]) ns[name] = {}
        ns[name].enabled = enabled
      }
    }
    clearLegacyMessengerNamespaceState(config)
    config._browserDefaults = true
    await writeSecureJsonAtomicAsync(configPath, config)

    const disabled = Object.entries(DEFAULT_NAMESPACE_STATE)
      .filter(([, v]) => !v)
      .map(([k]) => k)
    log.debug(`Bridge namespace defaults applied, disabled: ${disabled.join(', ')}`)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    log.warn('Failed to apply bridge defaults:', err)
    throw err
  }
}

export async function writeProxyConfig(workDir: string, tunnelSections: number): Promise<void> {
  const configPath = path.join(workDir, 'config.json')

  // Patch existing config when readable; corrupted or missing files regenerate.
  try {
    const existing = JSON.parse(await readFile(configPath, 'utf-8'))
    if (existing.TunnelConfig) {
      existing.TunnelConfig.NodesPoolConfigPath = ''
      existing.TunnelConfig.TunnelSectionsNum = tunnelSections
    }
    delete existing.BlockHTTP
    await writeSecureJsonAtomicAsync(configPath, existing, 2)
    log.debug(`Proxy config updated: tunnelSections=${tunnelSections}`)
    return
  } catch {
    // Corrupted or missing config -- regenerate below.
  }

  // First run: generate config with correct tunnel settings immediately
  // This avoids the double-start (direct -> restart -> tunnel)
  const generateKey = () => Array.from(randomBytes(32))
  const config = {
    Version: 1,
    ADNLKey: generateKey(),
    CustomTunnelNetworkConfigPath: '',
    TunnelConfig: {
      TunnelServerKey: generateKey(),
      TunnelThreads: cpus().length,
      TunnelSectionsNum: tunnelSections,
      NodesPoolConfigPath: '',
      PaymentsEnabled: false,
      Payments: {
        ADNLServerKey: generateKey(),
        PaymentsNodeKey: generateKey(),
        WalletPrivateKey: generateKey(),
        DBPath: './payments-db/',
        SecureProofPolicy: false,
        ChannelsConfig: {
          SupportedCoins: { Ton: { Enabled: true }, Jettons: {}, ExtraCurrencies: {} },
          BufferTimeToCommit: 10800,
          QuarantineDurationSec: 21600,
          ConditionalCloseDurationSec: 10800,
          MinSafeVirtualChannelTimeoutSec: 300,
        },
      },
    },
  }
  await writeSecureJsonAtomicAsync(configPath, config, 2)
  log.debug(`Proxy config generated: tunnelSections=${tunnelSections}`)
}
