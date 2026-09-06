import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, LogOut, Pin, PinOff, RotateCcw, Search, Settings2, Trash2, X } from 'lucide-react'
import type { ChatPendingOperation, ChatRoomState } from '@shared/ipc-contract/chat'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/ios/EmptyState'
import { useConfirmAction } from '@/hooks/useConfirmAction'
import { ChatsIcon } from './ChatsIcon'
import { SendIcon } from './SendIcon'
import { IdentityBadge, displayName } from './IdentityBadge'
import {
  avatarColor,
  formatTimelineItem,
  identitySeed,
  initial,
  roomLabel,
  timelineIdentityLabels,
  type ChatStatus,
  type ChatTimelineItem,
  type ChatTimelineMessage,
} from './util'

interface ChatRoomViewProps {
  room: string
  pendingRoomName?: string
  roomState: ChatRoomState | null
  onlineUsers: number | null
  canAdmin: boolean
  canModerate: boolean
  canWrite: boolean
  hasOlder: boolean
  loadingOlder: boolean
  status: ChatStatus
  error: string | null
  pending: ChatPendingOperation | null
  pendingBusy: boolean
  timeline: ChatTimelineItem[]
  input: string
  onInput: (v: string) => void
  onSend: () => void
  onRetryPending: () => void
  onDiscardPending: () => void
  onLeave: () => void
  onOpenDm: (message: ChatTimelineMessage) => void
  onMutate: (mutation: RoomMutation) => Promise<void>
  onLoadOlder: () => Promise<void>
}

type RoomMutation =
  | { action: 'metadata'; name: string; description: string }
  | { action: 'pin' | 'unpin'; messageId: string }
  | { action: 'moderator-grant' | 'moderator-revoke'; subjectKey: string }
  | { action: 'write-policy'; anyoneCanWrite: boolean }

function subtitle(status: ChatStatus): string {
  if (status === 'connected') return 'connected'
  if (status === 'connecting') return 'connecting…'
  if (status === 'reconnecting') return 'reconnecting…'
  if (status === 'error') return 'connection error'
  return ''
}

function ChatRoomView({
  room,
  pendingRoomName,
  roomState,
  onlineUsers,
  canAdmin,
  canModerate,
  canWrite,
  hasOlder,
  loadingOlder,
  status,
  error,
  pending,
  pendingBusy,
  timeline,
  input,
  onInput,
  onSend,
  onRetryPending,
  onDiscardPending,
  onLeave,
  onOpenDm,
  onMutate,
  onLoadOlder,
}: ChatRoomViewProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [adminOpen, setAdminOpen] = useState(false)
  const [metadataName, setMetadataName] = useState('')
  const [metadataDescription, setMetadataDescription] = useState('')
  const [moderatorKey, setModeratorKey] = useState('')
  const [pinnedRequest, setPinnedRequest] = useState<{ messageId: string; nonce: number } | null>(null)
  const { reset: resetDiscardConfirm, trigger: triggerDiscardConfirm, isArmed: isDiscardArmed } = useConfirmAction()
  const pinnedRequestNonceRef = useRef(0)
  const pinnedLoadCursorRef = useRef<number | null>(null)

  useEffect(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setPinnedRequest(null)
    pinnedRequestNonceRef.current = 0
    pinnedLoadCursorRef.current = null
  }, [room])

  useEffect(() => resetDiscardConfirm(), [pending?.eventId, resetDiscardConfirm])

  useEffect(() => {
    setMetadataName(roomState?.name ?? '')
    setMetadataDescription(roomState?.description ?? '')
  }, [roomState?.name, roomState?.description])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [timeline])

  const identityLabels = useMemo(() => timelineIdentityLabels(timeline), [timeline])
  const pinnedMessageId = roomState?.pinnedMessages.at(-1)

  useEffect(() => {
    if (!pinnedRequest) return
    const target = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? []).find(
      (element) => element.dataset.messageId === pinnedRequest.messageId
    )
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setPinnedRequest(null)
      pinnedLoadCursorRef.current = null
      return
    }
    if (!hasOlder) {
      setPinnedRequest(null)
      pinnedLoadCursorRef.current = null
      return
    }
    if (loadingOlder) return
    const cursor = timeline[0]?.seqno
    if (!cursor) {
      setPinnedRequest(null)
      pinnedLoadCursorRef.current = null
      return
    }
    if (pinnedLoadCursorRef.current === cursor) return
    pinnedLoadCursorRef.current = cursor
    void onLoadOlder()
  }, [hasOlder, loadingOlder, onLoadOlder, pinnedRequest, timeline])

  if (!room) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <EmptyState icon={<ChatsIcon className="h-8 w-8" />} title="No room open" />
      </div>
    )
  }

  const connected = status === 'connected'
  const displayedRoomName = roomState?.name || pendingRoomName || roomLabel(room)
  const q = searchQuery.trim().toLowerCase()
  const visible = q
    ? timeline.filter((item) => {
        const text = formatTimelineItem(item, identityLabels).toLowerCase()
        return text.includes(q) || (item.kind === 'message' && item.identity.name.toLowerCase().includes(q))
      })
    : timeline
  const pinned = new Set(roomState?.pinnedMessages ?? [])

  const openPinnedMessage = (): void => {
    if (!pinnedMessageId) return
    setSearchOpen(false)
    setSearchQuery('')
    pinnedLoadCursorRef.current = null
    pinnedRequestNonceRef.current += 1
    setPinnedRequest({ messageId: pinnedMessageId, nonce: pinnedRequestNonceRef.current })
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="m-3 mb-0 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full border border-border-subtle bg-elevation-1 px-3 py-1.5 shadow-panel">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-identity-foreground"
            style={{ backgroundColor: avatarColor(room) }}
          >
            {initial(displayedRoomName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-tight text-heading" title={displayedRoomName}>
              {displayedRoomName}
            </div>
            <div className="flex items-center gap-2 text-[12px] leading-tight text-muted-foreground">
              <span>{subtitle(status)}</span>
              {onlineUsers !== null && <span>{onlineUsers} online</span>}
            </div>
          </div>
          {roomState && roomState.pinnedMessages.length > 0 && (
            <button
              type="button"
              onClick={openPinnedMessage}
              disabled={loadingOlder}
              aria-label="Open pinned messages"
              title={`${roomState.pinnedMessages.length} pinned message${roomState.pinnedMessages.length > 1 ? 's' : ''}`}
              className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground disabled:opacity-40"
            >
              <Pin className="h-[17px] w-[17px]" />
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border-subtle bg-elevation-1 p-1 shadow-panel">
          {canAdmin && (
            <button
              type="button"
              onClick={() => setAdminOpen((open) => !open)}
              aria-label="Room administration"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                adminOpen ? 'bg-surface-active text-foreground' : 'text-muted-foreground hover:bg-surface'
              )}
            >
              <Settings2 className="h-[18px] w-[18px]" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setSearchOpen((o) => !o)}
            aria-label="Search messages"
            title="Search in this chat"
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
              searchOpen
                ? 'bg-surface-active text-foreground'
                : 'text-muted-foreground hover:bg-surface hover:text-foreground'
            )}
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onLeave}
            disabled={pending !== null || pendingBusy}
            aria-label="Leave room"
            title={pending ? 'Resolve the pending operation before leaving' : 'Leave room'}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground disabled:opacity-40"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {adminOpen && canAdmin && roomState && (
        <div className="mx-3 mt-2 grid gap-2 rounded-card border border-border-subtle bg-elevation-1 p-3 shadow-panel">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={metadataName}
              onChange={(event) => setMetadataName(event.target.value.slice(0, 64))}
              placeholder="Room name"
              className="rounded-card bg-surface px-3 py-2 text-sm outline-none"
            />
            <input
              value={metadataDescription}
              onChange={(event) => setMetadataDescription(event.target.value.slice(0, 512))}
              placeholder="Description"
              className="rounded-card bg-surface px-3 py-2 text-sm outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending !== null || pendingBusy}
              onClick={() =>
                void onMutate({ action: 'metadata', name: metadataName, description: metadataDescription })
              }
              className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
            >
              Save metadata
            </button>
            <button
              type="button"
              disabled={pending !== null || pendingBusy}
              onClick={() =>
                void onMutate({ action: 'write-policy', anyoneCanWrite: roomState.writePolicy !== 'everyone' })
              }
              className="rounded-full border border-border-subtle px-3 py-1.5 text-xs disabled:opacity-40"
            >
              {roomState.writePolicy === 'everyone' ? 'Make admins-only' : 'Let everyone post'}
            </button>
            <span className="text-xs text-muted-foreground">
              {roomState.writePolicy === 'everyone' ? 'Everyone can post' : 'Admins only'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={moderatorKey}
              onChange={(event) => setModeratorKey(event.target.value.trim().slice(0, 43))}
              placeholder="Moderator identity key"
              className="min-w-64 flex-1 rounded-card bg-surface px-3 py-2 font-mono text-xs outline-none"
            />
            {(['moderator-grant', 'moderator-revoke'] as const).map((action) => (
              <button
                key={action}
                type="button"
                disabled={pending !== null || pendingBusy || !/^[A-Za-z0-9_-]{43}$/.test(moderatorKey)}
                onClick={() => void onMutate({ action, subjectKey: moderatorKey })}
                className="rounded-full border border-border-subtle px-3 py-1.5 text-xs disabled:opacity-40"
              >
                {action === 'moderator-grant' ? 'Grant moderator' : 'Revoke'}
              </button>
            ))}
          </div>
        </div>
      )}

      {searchOpen && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-full border border-border-subtle bg-elevation-1 px-3 py-1.5 shadow-panel">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages"
            aria-label="Search messages"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false)
              setSearchQuery('')
            }}
            aria-label="Close search"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="mx-3 mt-2 rounded-card border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {pending && (
        <div className="mx-3 mt-2 flex items-start gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">
              {pending.status === 'committed' ? 'Operation confirmed' : 'Delivery result unknown'}
            </div>
            <div className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">{pending.summary}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!connected || pendingBusy}
                onClick={onRetryPending}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-3 py-1 text-xs font-medium disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {pending.status === 'committed' ? 'Apply result' : 'Retry exact operation'}
              </button>
              <button
                type="button"
                disabled={pendingBusy}
                onClick={() => {
                  if (triggerDiscardConfirm(pending.eventId)) onDiscardPending()
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 px-3 py-1 text-xs font-medium text-destructive disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isDiscardArmed(pending.eventId) ? 'Confirm discard' : 'Discard tracking'}
              </button>
            </div>
            {isDiscardArmed(pending.eventId) && (
              <div className="mt-1.5 text-xs text-destructive">This does not cancel a possible commit.</div>
            )}
          </div>
        </div>
      )}

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {hasOlder && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              disabled={loadingOlder}
              onClick={() => void onLoadOlder()}
              className="rounded-full border border-border-subtle px-3 py-1 text-xs text-muted-foreground disabled:opacity-50"
            >
              {loadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        )}
        {visible.length === 0 && (
          <div className="mt-10 text-center text-sm text-muted-foreground">
            {q ? 'No matching messages.' : connected ? 'No message yet.' : 'Connecting to the room…'}
          </div>
        )}
        {visible.map((item) => {
          if (item.kind !== 'message') {
            return (
              <div key={item.eventId} className="flex flex-col items-center px-4 py-1 text-center">
                <span className="text-xs text-muted-foreground">{formatTimelineItem(item, identityLabels)}</span>
                <span className="mt-0.5 text-[10px] text-muted-foreground/70">
                  {new Date(item.ts).toLocaleTimeString()}
                </span>
              </div>
            )
          }
          const message = item
          return (
            <div
              key={message.eventId}
              data-message-id={message.messageId}
              className={cn('flex flex-col', message.self ? 'items-end' : 'items-start')}
            >
              <div
                className={cn(
                  'max-w-[75%] rounded-2xl px-3 py-2 text-sm',
                  message.self
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border-subtle bg-elevation-2 text-foreground'
                )}
              >
                {!message.self && (
                  <div className="mb-0.5 flex items-center gap-1 text-xs font-medium" title={message.identity.domain}>
                    <button
                      type="button"
                      onClick={() => onOpenDm(message)}
                      title="Send a direct message"
                      className="min-w-0 truncate cursor-pointer text-left hover:underline"
                      style={{ color: avatarColor(identitySeed(message)) }}
                    >
                      {displayName(message.identity, message.nick)}
                    </button>
                    <IdentityBadge identity={message.identity} />
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">{message.text}</div>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                {pinned.has(message.messageId) && <Pin className="h-3 w-3" aria-label="Pinned" />}
                <span>{new Date(message.ts).toLocaleTimeString()}</span>
                {canModerate && (
                  <button
                    type="button"
                    disabled={pending !== null || pendingBusy}
                    onClick={() =>
                      void onMutate({
                        action: pinned.has(message.messageId) ? 'unpin' : 'pin',
                        messageId: message.messageId,
                      })
                    }
                    aria-label={pinned.has(message.messageId) ? 'Unpin message' : 'Pin message'}
                    className="rounded-full p-0.5 hover:text-foreground disabled:opacity-40"
                  >
                    {pinned.has(message.messageId) ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="m-3 mt-0 flex items-center gap-2 rounded-full border border-border-subtle bg-elevation-1 px-3 py-1.5 shadow-panel">
        <input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          disabled={!connected || !canWrite}
          className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 disabled:opacity-50"
          placeholder={connected ? (canWrite ? 'Message…' : 'Admins only') : 'Connecting…'}
          aria-label="message"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!connected || !canWrite || !input.trim() || pending !== null || pendingBusy}
          aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-identity-foreground transition-opacity hover:bg-primary/90 disabled:opacity-40"
        >
          <SendIcon className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  )
}

export default memo(ChatRoomView)
