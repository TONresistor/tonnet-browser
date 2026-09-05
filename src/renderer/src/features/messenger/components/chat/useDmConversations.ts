import { useCallback, useState } from 'react'
import type { ChatIdentityInfo } from '@shared/types'

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

const MAX_MESSAGES = 500

function withMessage(c: DmConversation, msg: DmMessage): DmConversation {
  if (msg.id && c.messages.some((m) => m.id === msg.id && m.room === msg.room)) return c
  const messages = [...c.messages, msg].slice(-MAX_MESSAGES)
  return { ...c, messages }
}

export function useDmConversations(): {
  conversations: Record<string, DmConversation>
  receive: (msg: {
    room?: string
    id: string
    peerKey: string
    text: string
    ts: number
    identity: ChatIdentityInfo
    direction: 'sent' | 'received'
  }) => void
  appendSelf: (peerKey: string, msg: DmMessage) => void
  open: (identity: ChatIdentityInfo, peerKey: string) => string
  remove: (peerKey: string) => void
} {
  const [conversations, setConversations] = useState<Record<string, DmConversation>>({})

  const receive = useCallback(
    (msg: {
      room?: string
      id: string
      peerKey: string
      text: string
      ts: number
      identity: ChatIdentityInfo
      direction: 'sent' | 'received'
    }) => {
      const peerKey = msg.peerKey
      if (!peerKey) return
      setConversations((prev) => {
        const cur = prev[peerKey] ?? { peerKey, name: msg.identity.name, messages: [] }
        const profile =
          msg.direction === 'sent' ? cur : { ...cur, name: msg.identity.name, domain: msg.identity.domain, peerKey }
        const next = withMessage(profile, {
          id: msg.id,
          text: msg.text,
          ts: msg.ts,
          self: msg.direction === 'sent',
          room: msg.room ?? '',
        })
        if (next === cur) return prev
        const out = { ...prev, [peerKey]: next }
        return out
      })
    },
    []
  )

  const appendSelf = useCallback((peerKey: string, msg: DmMessage) => {
    setConversations((prev) => {
      const cur = prev[peerKey]
      if (!cur) return prev
      const next = withMessage(cur, msg)
      if (next === cur) return prev
      const out = { ...prev, [peerKey]: next }
      return out
    })
  }, [])

  const open = useCallback((identity: ChatIdentityInfo, peerKey: string): string => {
    setConversations((prev) => {
      const cur = prev[peerKey]
      const next: DmConversation = cur
        ? { ...cur, name: identity.name, domain: identity.domain, peerKey }
        : { peerKey, name: identity.name, domain: identity.domain, messages: [] }
      const out = { ...prev, [peerKey]: next }
      return out
    })
    return peerKey
  }, [])

  const remove = useCallback((peerKey: string) => {
    setConversations((prev) => {
      if (!prev[peerKey]) return prev
      const out = { ...prev }
      delete out[peerKey]
      return out
    })
  }, [])

  return { conversations, receive, appendSelf, open, remove }
}
