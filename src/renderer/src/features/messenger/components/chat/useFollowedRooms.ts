import { useCallback, useState } from 'react'
import { isMessengerDomain, isMessengerReference as validReference } from '@/features/messenger/domain'

export interface FollowedRoom {
  room: string
  node?: string
  name?: string
  alias?: string
}

const KEY = 'messenger.rooms.v1'
const LEGACY_KEY = 'groupchat.rooms'

function readStored(): FollowedRoom[] | null {
  const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed
        .filter((room): room is FollowedRoom => !!room && typeof room.room === 'string' && validReference(room.room))
        .map((room) => ({
          room: room.room,
          node: typeof room.node === 'string' ? room.node : undefined,
          name: typeof room.name === 'string' ? room.name : undefined,
          alias: typeof room.alias === 'string' && validReference(room.alias) ? room.alias : undefined,
        }))
    }
  } catch {
    return null
  }
  return null
}

function load(): FollowedRoom[] {
  const stored = readStored()
  if (stored) {
    if (localStorage.getItem(KEY) === null) persist(stored)
    return stored
  }
  return []
}

function persist(rooms: FollowedRoom[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rooms))
  } catch {
    return
  }
}

export function useFollowedRooms(): {
  rooms: FollowedRoom[]
  add: (room: string, node?: string) => void
  remove: (room: string) => void
  canonicalize: (reference: string, roomId: string, name?: string) => void
  updateName: (roomId: string, name: string) => void
} {
  const [rooms, setRooms] = useState<FollowedRoom[]>(load)

  const add = useCallback((room: string, node?: string) => {
    const name = room.trim()
    if (!name) return
    setRooms((prev) => {
      const next = [
        {
          room: name,
          node: node?.trim() || undefined,
          alias: isMessengerDomain(name) ? name.toLowerCase() : undefined,
        },
        ...prev.filter((r) => r.room !== name),
      ]
      persist(next)
      return next
    })
  }, [])

  const remove = useCallback((room: string) => {
    setRooms((prev) => {
      const next = prev.filter((r) => r.room !== room)
      persist(next)
      return next
    })
  }, [])

  const canonicalize = useCallback((reference: string, roomId: string, name?: string) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(roomId)) return
    setRooms((prev) => {
      const source = prev.find((entry) => entry.room === reference)
      const existing = prev.find((entry) => entry.room === roomId)
      const alias = source?.alias ?? (isMessengerDomain(reference) ? reference.toLowerCase() : existing?.alias)
      const next = [
        {
          room: roomId,
          node: source?.node ?? existing?.node,
          name: name || source?.name || existing?.name,
          alias,
        },
        ...prev.filter((entry) => entry.room !== reference && entry.room !== roomId),
      ]
      persist(next)
      return next
    })
  }, [])

  const updateName = useCallback((roomId: string, name: string) => {
    if (!name.trim()) return
    setRooms((prev) => {
      let changed = false
      const next = prev.map((room) => {
        if (room.room !== roomId || room.name === name) return room
        changed = true
        return { ...room, name }
      })
      if (!changed) return prev
      persist(next)
      return next
    })
  }, [])

  return { rooms, add, remove, canonicalize, updateName }
}
