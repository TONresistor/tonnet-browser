import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import type { OwnChatIdentity } from '@shared/types'
import type { ChatRoomPresence, ChatRoomState } from '@shared/ipc-contract/chat'
import ChatSidebar from './chat/ChatSidebar'
import ChatRoomView from './chat/ChatRoomView'
import DmView from './chat/DmView'
import { AddRoomModal } from './chat/AddRoomModal'
import { useFollowedRooms, type FollowedRoom } from './chat/useFollowedRooms'
import { useRoomPreviews } from './chat/useRoomPreviews'
import { useDmConversations } from './chat/useDmConversations'
import {
  formatTimelineItem,
  mergeTimelineItems,
  timelineIdentityLabels,
  type ChatStatus,
  type ChatTimelineItem,
  type ChatTimelineMessage,
} from './chat/util'
import { messengerClient } from '@/features/messenger/client'

function ChatPage(): React.JSX.Element {
  const { rooms, add, remove, canonicalize, updateName } = useFollowedRooms()
  const { previews, update: updatePreview } = useRoomPreviews()
  const { conversations, receive: receiveDm, appendSelf, open: openDm, remove: removeDm } = useDmConversations()

  const [room, setRoom] = useState<string>('')
  const [node, setNode] = useState<string>('')

  const [timeline, setTimeline] = useState<ChatTimelineItem[]>([])
  const [hasOlder, setHasOlder] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [identity, setIdentity] = useState<OwnChatIdentity | null>(null)
  const [roomState, setRoomState] = useState<ChatRoomState | null>(null)
  const [presence, setPresence] = useState<ChatRoomPresence | null>(null)

  const [activeDm, setActiveDm] = useState<string>('')
  const [dmInput, setDmInput] = useState('')
  const [dmError, setDmError] = useState<string | null>(null)

  const roomRef = useRef(room)
  roomRef.current = room
  const activeDmRef = useRef(activeDm)
  activeDmRef.current = activeDm
  const identityRef = useRef(identity)
  identityRef.current = identity
  const connectedKeyRef = useRef<string | null>(null)
  const timelineRef = useRef(timeline)
  timelineRef.current = timeline
  const pendingTimelineRef = useRef(new Map<string, ChatTimelineItem[]>())

  const refreshIdentity = useCallback(() => {
    messengerClient
      .getIdentity()
      .then(setIdentity)
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshIdentity()
  }, [refreshIdentity])

  useEffect(() => messengerClient.onIdentityChanged(setIdentity), [])

  useEffect(
    () => () => {
      connectedKeyRef.current = null
      messengerClient.disconnect().catch(() => {})
    },
    []
  )

  useEffect(() => {
    let cancelled = false
    const key = `${room} ${node}`
    if (connectedKeyRef.current === key) return
    connectedKeyRef.current = null
    pendingTimelineRef.current.clear()
    setTimeline([])
    setHasOlder(true)
    setLoadingOlder(false)
    setRoomState(null)
    setPresence(null)
    setError(null)
    if (!room) {
      setStatus('idle')
      messengerClient.disconnect().catch(() => {})
      return () => {
        cancelled = true
      }
    }
    setStatus('connecting')
    messengerClient
      .connect(room, node || undefined)
      .then((res) => {
        if (!cancelled) {
          connectedKeyRef.current = `${res.room} ${node}`
          roomRef.current = res.room
          setRoomState(res.state)
          setPresence(res.presence)
          setTimeline(mergeTimelineItems(res.timeline.items, pendingTimelineRef.current.get(res.room) ?? []))
          pendingTimelineRef.current.clear()
          setHasOlder(res.timeline.hasMore)
          if (res.room !== room) {
            canonicalize(room, res.room, res.state.name)
            setRoom(res.room)
          } else {
            updateName(res.room, res.state.name)
          }
          setStatus('connected')
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setStatus('error')
          setError(e instanceof Error ? e.message : String(e))
        }
      })
    return () => {
      cancelled = true
    }
  }, [room, node, canonicalize, updateName])

  useEffect(() => {
    const off = messengerClient.onTimeline((item) => {
      if (connectedKeyRef.current === null) {
        const buffers = pendingTimelineRef.current
        if (buffers.size < 16 || buffers.has(item.room)) {
          buffers.set(item.room, mergeTimelineItems(buffers.get(item.room) ?? [], item))
        }
      }
      if (item.room !== roomRef.current) return
      setTimeline((current) => mergeTimelineItems(current, item))
    })
    return () => off()
  }, [])

  const timelineLabels = useMemo(() => timelineIdentityLabels(timeline), [timeline])

  useEffect(() => {
    const latest = timeline[timeline.length - 1]
    if (room && latest) updatePreview(room, formatTimelineItem(latest, timelineLabels), latest.ts)
  }, [room, timeline, timelineLabels, updatePreview])

  useEffect(() => {
    const off = messengerClient.onDirectMessage((m) => {
      receiveDm(m)
    })
    return () => off()
  }, [receiveDm])

  useEffect(() => {
    const off = messengerClient.onConnection((event) => {
      if (event.room !== roomRef.current) return
      if (event.status === 'reconnecting') {
        setStatus('reconnecting')
        setPresence(null)
        setError(null)
      } else if (event.status === 'connected') {
        setRoomState(event.state)
        setPresence(event.presence)
        const first = timelineRef.current[0]
        const incomingFirst = event.timeline.items[0]
        setTimeline((current) => mergeTimelineItems(current, event.timeline.items, Number.POSITIVE_INFINITY))
        if (!first || !incomingFirst || first.seqno >= incomingFirst.seqno) setHasOlder(event.timeline.hasMore)
        updateName(event.room, event.state.name)
        setStatus('connected')
        setError(null)
      } else {
        setStatus('error')
        setPresence(null)
        setError(event.message)
      }
    })
    return () => off()
  }, [updateName])

  useEffect(() => {
    const off = messengerClient.onRoomPresence((next) => {
      if (next.roomId === roomRef.current) setPresence(next)
    })
    return () => off()
  }, [])

  useEffect(() => {
    const off = messengerClient.onRoomState((next) => {
      if (next.roomId === roomRef.current) {
        setRoomState(next)
        updateName(next.roomId, next.name)
      }
    })
    return () => off()
  }, [updateName])

  const openRoom = useCallback((r: FollowedRoom) => {
    setRoom(r.room)
    setNode(r.node || '')
    setActiveDm('')
  }, [])

  const handleOpenDm = useCallback(
    (message: ChatTimelineMessage) => {
      if (message.self) return
      const peerKey = openDm(message.identity, message.actorKey)
      setDmError(null)
      setActiveDm(peerKey)
    },
    [openDm]
  )

  const handleSelectDm = useCallback((peerKey: string) => {
    setDmError(null)
    setActiveDm(peerKey)
  }, [])

  const handleRemoveDm = useCallback(
    (peerKey: string) => {
      removeDm(peerKey)
      setActiveDm((cur) => (cur === peerKey ? '' : cur))
    },
    [removeDm]
  )

  const sendDm = useCallback(async () => {
    const text = dmInput.trim()
    const convo = conversations[activeDm]
    const targetRoom = roomRef.current
    if (!text || !convo || status !== 'connected') return
    setDmInput('')
    setDmError(null)
    try {
      const res = await messengerClient.sendDirectMessage(targetRoom, convo.peerKey, text)
      if (res.identity) setIdentity(res.identity)
      if (!res.sent) {
        if (roomRef.current !== targetRoom || activeDmRef.current !== activeDm) return
        setDmInput(text)
        setDmError('Message was not sent.')
        return
      }
      appendSelf(activeDm, { id: res.id ?? '', text, ts: res.ts ?? Date.now(), self: true, room: targetRoom })
    } catch (e) {
      if (roomRef.current !== targetRoom || activeDmRef.current !== activeDm) return
      setDmInput(text)
      setDmError(e instanceof Error ? e.message : String(e))
    }
  }, [dmInput, conversations, activeDm, appendSelf, status])

  const dmList = useMemo(() => {
    const last = (c: { messages: { ts: number }[] }): number => c.messages[c.messages.length - 1]?.ts ?? 0
    return Object.values(conversations).sort((a, b) => last(b) - last(a))
  }, [conversations])

  const leaveRoom = useCallback(async () => {
    const targetRoom = roomRef.current
    try {
      if (/^[A-Za-z0-9_-]{43}$/.test(targetRoom)) await messengerClient.leave(targetRoom)
      else await messengerClient.disconnect()
      if (roomRef.current !== targetRoom) return
      setRoom('')
      setNode('')
    } catch (cause) {
      if (roomRef.current === targetRoom) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const handleAdd = useCallback(
    (r: string, n?: string) => {
      add(r, n)
      openRoom({ room: r, node: n })
    },
    [add, openRoom]
  )

  const handleRemove = useCallback(
    async (r: string) => {
      try {
        if (/^[A-Za-z0-9_-]{43}$/.test(r)) await messengerClient.leave(r)
        else if (r === roomRef.current) await messengerClient.disconnect()
        remove(r)
        if (r === roomRef.current) {
          setRoom('')
          setNode('')
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [remove]
  )

  const send = useCallback(async () => {
    const targetRoom = roomRef.current
    const text = input.trim()
    if (!text || status !== 'connected') return
    const ownKey = identityRef.current?.identityKey
    if (
      roomState?.writePolicy === 'admins' &&
      (!ownKey || (ownKey !== roomState.roomId && !roomState.admins.includes(ownKey)))
    ) {
      setError('This room is read-only for non-admins.')
      return
    }
    setInput('')
    setError(null)
    try {
      const res = await messengerClient.send(targetRoom, text)
      if (roomRef.current !== targetRoom) return
      if (res.identity) setIdentity(res.identity)
      if (!res.sent) {
        setInput(text)
        setError('Message was not sent.')
        return
      }
      setTimeline((current) => mergeTimelineItems(current, res.item))
    } catch (e) {
      if (roomRef.current !== targetRoom) return
      setInput(text)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [input, status, roomState])

  const mutateRoom = useCallback(async (mutation: Parameters<typeof messengerClient.mutate>[1]) => {
    const targetRoom = roomRef.current
    setError(null)
    try {
      const result = await messengerClient.mutate(targetRoom, mutation)
      if (roomRef.current !== targetRoom) return
      setTimeline((current) => mergeTimelineItems(current, result.item))
    } catch (cause) {
      if (roomRef.current !== targetRoom) return
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const loadOlder = useCallback(async () => {
    const targetRoom = roomRef.current
    const first = timeline[0]
    if (!first || loadingOlder || !hasOlder) return
    setLoadingOlder(true)
    try {
      const page = await messengerClient.timelineBefore(targetRoom, first.seqno, 100)
      if (roomRef.current !== targetRoom) return
      setHasOlder(page.hasMore)
      setTimeline((current) => mergeTimelineItems(current, page.items, Number.POSITIVE_INFINITY))
    } catch (cause) {
      if (roomRef.current !== targetRoom) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (roomRef.current === targetRoom) setLoadingOlder(false)
    }
  }, [timeline, loadingOlder, hasOlder])

  const ownKey = identity?.identityKey
  const canAdmin = Boolean(ownKey && (ownKey === roomState?.roomId || roomState?.admins.includes(ownKey)))
  const canModerate = Boolean(canAdmin || (ownKey && roomState?.moderators.includes(ownKey)))
  const canWrite = Boolean(roomState?.writePolicy !== 'admins' || canAdmin)
  const followedRoom = rooms.find((entry) => entry.room === room)
  const pendingRoomName = followedRoom?.alias || followedRoom?.name

  return (
    <div
      className="flex h-full w-full bg-background-secondary text-foreground"
      style={{ fontFamily: 'Inter, sans-serif' }}
    >
      <ChatSidebar
        rooms={rooms}
        previews={previews}
        dms={dmList}
        activeRoom={room}
        activeDm={activeDm}
        onIdentityChange={setIdentity}
        onSelect={openRoom}
        onRemove={handleRemove}
        onSelectDm={handleSelectDm}
        onRemoveDm={handleRemoveDm}
        onAdd={() => setAddOpen(true)}
      />

      {activeDm && conversations[activeDm] ? (
        <DmView
          conversation={conversations[activeDm]}
          connected={status === 'connected'}
          error={dmError}
          input={dmInput}
          onInput={setDmInput}
          onSend={sendDm}
          onBack={() => setActiveDm('')}
        />
      ) : (
        <ChatRoomView
          room={room}
          pendingRoomName={pendingRoomName}
          roomState={roomState}
          onlineUsers={presence?.roomId === room ? presence.onlineUsers : null}
          canAdmin={canAdmin}
          canModerate={canModerate}
          canWrite={canWrite}
          hasOlder={hasOlder && timeline.length > 0}
          loadingOlder={loadingOlder}
          status={status}
          error={error}
          timeline={timeline}
          input={input}
          onInput={setInput}
          onSend={send}
          onLeave={leaveRoom}
          onOpenDm={handleOpenDm}
          onMutate={mutateRoom}
          onLoadOlder={loadOlder}
        />
      )}

      <AddRoomModal isOpen={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAdd} />
    </div>
  )
}

export default memo(ChatPage)
