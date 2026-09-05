import type {
  AppSettings,
  ProxyStatus,
  WalletState,
  WalletTransaction,
  PaymentNotificationData,
  StorageBag,
} from './types'
import type { CocoonState, CocoonLogEvent, WithdrawDriverEvent, RecoveryDriverEvent } from './cocoon-types'
import type { BrowserShortcutCommand } from './ipc-contract/browsing'

export interface ProxyStatusEvent extends Partial<ProxyStatus> {
  status?: string
  anonymousMode?: boolean
  circuitRelays?: string[]
}

export interface PageNavigateEvent {
  tabId: string
  url: string
  canGoBack: boolean
  canGoForward: boolean
}

export interface SettingsChangedEvent {
  reset?: boolean
  category?: string
  values?: object
  settings?: AppSettings
}

export interface IpcEventMap {
  'page:loading': [loading: boolean, tabId: string]
  'page:navigate': [event: PageNavigateEvent]
  'page:title': [title: string, tabId: string]
  'page:favicon': [favicon: string, tabId: string]
  'page:zoom': [zoom: number, tabId: string]
  'browser:shortcut': [command: BrowserShortcutCommand]
  'proxy:status': [status: ProxyStatusEvent]
  'proxy:progress': [progress: { step: number; message: string }]
  'proxy:auto-connect': []
  'storage:bags-updated': [bags: StorageBag[]]
  'storage:status': [status: { running: boolean }]
  'context:open-link': [url: string]
  'settings:changed': [change: SettingsChangedEvent]
  'tab:history-reset': [tabId: string, url: string]
  'wallet:balance-updated': [balance: string]
  'wallet:state-changed': [state: WalletState]
  'wallet:new-transaction': [tx: WalletTransaction]
  'wallet:payment-req': [notification: PaymentNotificationData]
  'wallet:payment-made': [notification: PaymentNotificationData]
  'wallet:payment-failed': [notification: PaymentNotificationData]
  'overlay:action': [overlayId: string, actionType: string, actionData: unknown]
  'chat:timeline': [item: import('./ipc-contract/chat').ChatTimelineItem]
  'chat:dm': [
    msg: {
      room?: string
      id: string
      peerKey: string
      text: string
      ts: number
      identity: import('./types').ChatIdentityInfo
      direction: 'sent' | 'received'
    },
  ]
  'chat:connection': [event: import('./ipc-contract/chat').ChatConnectionEvent]
  'chat:room-state': [state: import('./ipc-contract/chat').ChatRoomState]
  'chat:room-presence': [presence: import('./ipc-contract/chat').ChatRoomPresence]
  'chat:identity-changed': [identity: import('./types').OwnChatIdentity]
  'cocoon:state-changed': [state: CocoonState]
  'cocoon:log': [event: CocoonLogEvent]
  'cocoon:withdraw:event': [event: WithdrawDriverEvent]
  'cocoon:recovery:event': [event: RecoveryDriverEvent]
}

export type IpcEventChannel = keyof IpcEventMap
