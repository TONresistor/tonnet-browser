import { create } from 'zustand'
import type { ChatIdentityInfo } from '@shared/types'
import type { IpcEventMap } from '@shared/ipc-events'

export interface DmMessage {
  id: string
  text: string
  ts: number
  self: boolean
  room: string
}

export interface DmConversation {
  peerKey: string
  name: string
  domain?: string
  messages: DmMessage[]
}

interface DirectMessageState {
  identityKey: string | null
  conversations: Record<string, DmConversation>
  receive: (message: IpcEventMap['chat:dm'][0]) => void
  appendSelf: (peerKey: string, message: DmMessage) => void
  open: (identity: ChatIdentityInfo, peerKey: string) => string
  remove: (peerKey: string) => void
  setIdentity: (identityKey: string) => void
}

function withMessage(conversation: DmConversation, message: DmMessage): DmConversation {
  if (message.id && conversation.messages.some((item) => item.id === message.id && item.room === message.room)) {
    return conversation
  }
  return { ...conversation, messages: [...conversation.messages, message].slice(-500) }
}

export const useDirectMessageStore = create<DirectMessageState>()((set) => ({
  identityKey: null,
  conversations: {},
  receive: (message) =>
    set((state) => {
      const peerKey = message.peerKey
      if (!peerKey) return state
      const current = state.conversations[peerKey] ?? { peerKey, name: message.identity.name, messages: [] }
      const profile =
        message.direction === 'sent'
          ? current
          : { ...current, name: message.identity.name, domain: message.identity.domain }
      const next = withMessage(profile, {
        id: message.id,
        text: message.text,
        ts: message.ts,
        self: message.direction === 'sent',
        room: message.room ?? '',
      })
      return next === current ? state : { conversations: { ...state.conversations, [peerKey]: next } }
    }),
  appendSelf: (peerKey, message) =>
    set((state) => {
      const current = state.conversations[peerKey]
      if (!current) return state
      const next = withMessage(current, message)
      return next === current ? state : { conversations: { ...state.conversations, [peerKey]: next } }
    }),
  open: (identity, peerKey) => {
    set((state) => ({
      conversations: {
        ...state.conversations,
        [peerKey]: {
          ...state.conversations[peerKey],
          peerKey,
          name: identity.name,
          domain: identity.domain,
          messages: state.conversations[peerKey]?.messages ?? [],
        },
      },
    }))
    return peerKey
  },
  remove: (peerKey) =>
    set((state) => {
      if (!state.conversations[peerKey]) return state
      const conversations = { ...state.conversations }
      delete conversations[peerKey]
      return { conversations }
    }),
  setIdentity: (identityKey) =>
    set((state) => ({
      identityKey,
      conversations: state.identityKey && state.identityKey !== identityKey ? {} : state.conversations,
    })),
}))
