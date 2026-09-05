import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { log } from './shared'
import { REQUIRED_NAMESPACES } from '../../../shared/bridge-config'
import { writeSecureJsonAtomicAsync } from '../../utils/secure-fs'
import type { ServiceRegistry } from '../../services'
import {
  bridgeGetConfigContract,
  bridgeGetPermissionsContract,
  bridgeMessageEventContract,
  bridgeRestartContract,
  bridgeRevokePermissionContract,
  bridgeSendContract,
  bridgeSetConfigContract,
} from '../../../shared/ipc-contract/bridge'
import { ipcFailure, secureContractHandle, tonsiteContractHandle } from '../contract-handler'

function getBridgeConfigPath(): string {
  return path.join(app.getPath('userData'), 'bridge', 'config.json')
}

export function registerBridgeHandlers(registry: ServiceRegistry): void {
  const { bridgeInterceptor, bridgePermissionStore, proxyManager, tonBridgeCoordinator } = registry

  tonsiteContractHandle(
    bridgeSendContract,
    (event) => registry.tabManager.resolveSenderIdentity(event.sender),
    async (domain, event, data) => {
      return new Promise<void>((resolve) => {
        bridgeInterceptor.handleRequest(
          domain,
          data,
          (response: string) => {
            try {
              const [validated] = bridgeMessageEventContract.payload.parse([response])
              if (!event.sender.isDestroyed()) event.sender.send(bridgeMessageEventContract.channel, validated)
            } catch (error) {
              log.error('Failed to deliver bridge response:', error)
            } finally {
              resolve()
            }
          },
          event.sender
        )
      })
    }
  )

  secureContractHandle(bridgeGetPermissionsContract, () => {
    return bridgePermissionStore.getAllPermissions()
  })

  secureContractHandle(bridgeRevokePermissionContract, async (domain, scope) => {
    await bridgePermissionStore.revokePermission(domain, scope)
    return { success: true }
  })

  // Bridge config: read
  secureContractHandle(bridgeGetConfigContract, async () => {
    const configPath = getBridgeConfigPath()
    try {
      const data = await fs.promises.readFile(configPath, 'utf-8')
      return JSON.parse(data)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      ipcFailure('BRIDGE_CONFIG_READ_FAILED', 'Unable to read bridge configuration', false, err)
    }
  })

  // Bridge config: write (deep-merge, enforce required namespaces)
  secureContractHandle(bridgeSetConfigContract, async (partial) => {
    const configPath = getBridgeConfigPath()
    try {
      let existing: Record<string, unknown> = {}
      try {
        existing = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }

      // Destructure to avoid mutating the caller's object
      const { namespaces: partialNs, websocket: partialWs, ...topLevel } = partial

      // Deep-merge namespaces
      if (partialNs) {
        const existingNs = (existing.namespaces as Record<string, unknown>) || {}
        for (const [key, value] of Object.entries(partialNs)) {
          existingNs[key] = {
            ...((existingNs[key] as Record<string, unknown>) || {}),
            ...(value as Record<string, unknown>),
          }
        }
        existing.namespaces = existingNs
      }

      // Deep-merge websocket
      if (partialWs) {
        existing.websocket = { ...((existing.websocket as Record<string, unknown>) || {}), ...partialWs }
      }

      // Merge top-level fields
      Object.assign(existing, topLevel)

      // Enforce required namespaces are always enabled
      const ns = (existing.namespaces as Record<string, Record<string, unknown>>) || {}
      for (const required of REQUIRED_NAMESPACES) {
        if (!ns[required]) ns[required] = {}
        ns[required].enabled = true
      }
      existing.namespaces = ns

      await writeSecureJsonAtomicAsync(configPath, existing)

      return { success: true }
    } catch (err) {
      ipcFailure('BRIDGE_CONFIG_WRITE_FAILED', 'Unable to save bridge configuration', false, err)
    }
  })

  // Bridge restart (bridge process only; proxy stays up)
  secureContractHandle(bridgeRestartContract, async () => {
    try {
      await proxyManager.restartBridge()
      const { wsPort } = proxyManager.getStatus()
      await tonBridgeCoordinator.waitUntilReady(wsPort)
      return { success: true }
    } catch (err) {
      ipcFailure('BRIDGE_RESTART_FAILED', 'Unable to restart bridge', true, err)
    }
  })

  log.debug('Bridge handlers registered')
}
