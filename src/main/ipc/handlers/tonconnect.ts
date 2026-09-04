import { log } from './shared'
import type { ServiceRegistry } from '../../services'
import {
  tonConnectAvailabilityContract,
  tonConnectDisconnectSessionContract,
  tonConnectGetSessionsContract,
  tonConnectRequestContract,
  type TonConnectRequestPayload,
} from '../../../shared/ipc-contract/tonconnect'
import { ipcFailure, secureContractHandle, tonsiteContractHandle } from '../contract-handler'
import { getSetting } from '../../settings'
import { CONNECT_ERROR, TONCONNECT_ERROR } from '../../tonconnect/types'

const EXPERIMENTAL_DISABLED = 'Experimental feature disabled'

function disabledResponse(payload: TonConnectRequestPayload) {
  if (payload.method === 'send') {
    return {
      id: payload.message?.id ?? '0',
      error: { code: TONCONNECT_ERROR.UNKNOWN_APP, message: EXPERIMENTAL_DISABLED },
    }
  }
  return {
    event: 'connect_error' as const,
    id: 0,
    payload: { code: CONNECT_ERROR.UNKNOWN_APP, message: EXPERIMENTAL_DISABLED },
  }
}

export function registerTonConnectHandlers(registry: ServiceRegistry): void {
  const { tonConnectService } = registry

  tonsiteContractHandle(
    tonConnectAvailabilityContract,
    (event) => registry.tabManager.resolveSenderIdentity(event.sender),
    () => ({ enabled: getSetting('advanced').tonConnectEnabled && tonConnectService.isAvailable() })
  )

  tonsiteContractHandle(
    tonConnectRequestContract,
    (event) => registry.tabManager.resolveSenderIdentity(event.sender),
    async (domain, event, payload) => {
      if (!getSetting('advanced').tonConnectEnabled && payload.method !== 'disconnect') {
        return disabledResponse(payload)
      }
      return tonConnectService.handleRequest(domain, event, payload)
    }
  )

  secureContractHandle(tonConnectGetSessionsContract, () => {
    if (!tonConnectService.isAvailable()) ipcFailure('TONCONNECT_UNAVAILABLE', 'TON Connect is unavailable')
    return tonConnectService.getSessions()
  })

  secureContractHandle(tonConnectDisconnectSessionContract, async (domain) => {
    if (!tonConnectService.isAvailable()) ipcFailure('TONCONNECT_UNAVAILABLE', 'TON Connect is unavailable')
    await tonConnectService.disconnectSession(domain)
    return { success: true }
  })

  log.debug('TON Connect handlers registered')
}
