import { memo, useEffect, useRef, useState } from 'react'
import { Search, SquarePen, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OwnChatIdentity } from '@shared/types'
import type { FollowedRoom } from './useFollowedRooms'
import { IdentityBadge } from './IdentityBadge'
import type { RoomPreview } from './useRoomPreviews'
import type { DmConversation } from './useDmConversations'
import { avatarColor, formatChatTime, initial, roomLabel } from './util'
import { GroupsIcon, MessagesIcon, ProfileIcon } from './tabIcons'
import { MessengerSection } from '@/features/messenger/components/MessengerSection'

interface ChatSidebarProps {
  rooms: FollowedRoom[]
  previews: Record<string, RoomPreview>
  dms: DmConversation[]
  activeRoom: string
  activeDm: string
  onIdentityChange: (id: OwnChatIdentity | null) => void
  onSelect: (room: FollowedRoom) => void
  onRemove: (room: string) => void
  onSelectDm: (address: string) => void
  onRemoveDm: (address: string) => void
  onAdd: () => void
}

type SidebarTab = 'groups' | 'messages' | 'profile'

const TABS: { id: SidebarTab; label: string; Icon: (props: { className?: string }) => React.JSX.Element }[] = [
  { id: 'groups', label: 'Groups', Icon: GroupsIcon },
  { id: 'messages', label: 'Messages', Icon: MessagesIcon },
  { id: 'profile', label: 'Profile', Icon: ProfileIcon },
]

const SIDEBAR_MIN = 240
const SIDEBAR_MAX = 460
const SIDEBAR_KEY = 'groupchat.sidebarWidth'

function readSidebarWidth(): number {
  const v = Number(localStorage.getItem(SIDEBAR_KEY))
  return Number.isFinite(v) && v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : 280
}

function RoomRow({
  room,
  active,
  preview,
  onSelect,
  onRemove,
}: {
  room: FollowedRoom
  active: boolean
  preview?: RoomPreview
  onSelect: (room: FollowedRoom) => void
  onRemove: (room: string) => void
}): React.JSX.Element {
  const label = room.name || room.alias || roomLabel(room.room)
  const time = preview ? formatChatTime(preview.ts) : ''
  const subtitle = preview?.text ?? room.alias ?? room.room
  return (
    <div
      role="option"
      aria-selected={active}
      tabIndex={0}
      onClick={() => onSelect(room)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(room)
        }
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors',
        active ? 'bg-primary' : 'hover:bg-surface-hover'
      )}
    >
      <span
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-[17px] font-semibold text-identity-foreground"
        style={{ backgroundColor: avatarColor(room.room) }}
      >
        {initial(label)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[15px] font-semibold',
              active ? 'text-primary-foreground' : 'text-foreground'
            )}
          >
            {label}
          </span>
          {time && (
            <span
              className={cn(
                'shrink-0 text-[11px] tabular-nums group-hover:hidden',
                active ? 'text-primary-foreground/70' : 'text-muted-foreground'
              )}
            >
              {time}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(room.room)
            }}
            aria-label={`Unfollow ${label}`}
            className={cn(
              'hidden shrink-0 rounded-full p-1 transition-colors group-hover:block',
              active
                ? 'text-identity-foreground/80 hover:bg-identity-foreground/20 hover:text-identity-foreground'
                : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            )}
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
        <div className={cn('truncate text-[13px]', active ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
          {subtitle}
        </div>
      </div>
    </div>
  )
}

function DmRow({
  dm,
  active,
  onSelect,
  onRemove,
}: {
  dm: DmConversation
  active: boolean
  onSelect: (address: string) => void
  onRemove: (address: string) => void
}): React.JSX.Element {
  const last = dm.messages[dm.messages.length - 1]
  const time = last ? formatChatTime(last.ts) : ''
  const subtitle = last ? (last.self ? `You: ${last.text}` : last.text) : 'No message yet'
  return (
    <div
      role="option"
      aria-selected={active}
      tabIndex={0}
      onClick={() => onSelect(dm.peerKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(dm.peerKey)
        }
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors',
        active ? 'bg-primary' : 'hover:bg-surface-hover'
      )}
    >
      <span
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-[17px] font-semibold text-identity-foreground"
        style={{ backgroundColor: avatarColor(dm.peerKey) }}
      >
        {initial(dm.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 truncate text-[15px] font-semibold',
              active ? 'text-primary-foreground' : 'text-foreground',
              dm.domain ? 'lowercase' : 'font-mono'
            )}
          >
            <span className="min-w-0 truncate">{dm.name}</span>
            <IdentityBadge identity={{ tier: dm.domain ? 'domain' : 'identity' }} />
          </span>
          {time && (
            <span
              className={cn(
                'shrink-0 text-[11px] tabular-nums group-hover:hidden',
                active ? 'text-primary-foreground/70' : 'text-muted-foreground'
              )}
            >
              {time}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(dm.peerKey)
            }}
            aria-label={`Delete conversation with ${dm.name}`}
            className={cn(
              'hidden shrink-0 rounded-full p-1 transition-colors group-hover:block',
              active
                ? 'text-identity-foreground/80 hover:bg-identity-foreground/20 hover:text-identity-foreground'
                : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            )}
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
        <div className={cn('truncate text-[13px]', active ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
          {subtitle}
        </div>
      </div>
    </div>
  )
}

function ChatSidebar({
  rooms,
  previews,
  dms,
  activeRoom,
  activeDm,
  onIdentityChange,
  onSelect,
  onRemove,
  onSelectDm,
  onRemoveDm,
  onAdd,
}: ChatSidebarProps): React.JSX.Element {
  const [tab, setTab] = useState<SidebarTab>('groups')
  const [query, setQuery] = useState('')
  const [width, setWidth] = useState(readSidebarWidth)
  const [resizing, setResizing] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!resizing) return
    let raf: number | null = null
    let pending: number | null = null
    const onMove = (e: MouseEvent): void => {
      const left = rootRef.current?.getBoundingClientRect().left ?? 0
      const w = Math.min(Math.max(e.clientX - left, SIDEBAR_MIN), SIDEBAR_MAX)
      pending = w
      if (raf === null) {
        raf = requestAnimationFrame(() => {
          raf = null
          if (pending !== null) setWidth(pending)
        })
      }
    }
    const onUp = (): void => {
      setResizing(false)
      if (raf !== null) cancelAnimationFrame(raf)
      if (pending !== null) {
        setWidth(pending)
        localStorage.setItem(SIDEBAR_KEY, String(pending))
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [resizing])

  const q = query.trim().toLowerCase()
  const filteredRooms = q
    ? rooms.filter((room) =>
        `${room.name ?? ''} ${room.alias ?? ''} ${roomLabel(room.room)} ${room.room}`.toLowerCase().includes(q)
      )
    : rooms
  const filteredDms = q
    ? dms.filter((d) => (d.name + ' ' + d.peerKey + ' ' + (d.domain ?? '')).toLowerCase().includes(q))
    : dms

  return (
    <div
      ref={rootRef}
      style={{ width }}
      className="relative m-3 flex shrink-0 flex-col overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 shadow-panel"
    >
      <div className="relative flex items-center justify-center px-4 pb-2 pt-4">
        <h2 className="text-lg font-semibold tracking-tight text-heading">
          {tab === 'profile' ? 'Profile' : 'Messenger'}
        </h2>
        {tab !== 'profile' && (
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add chat"
            title="Add chat"
            className="absolute right-3 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <SquarePen className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>

      {tab !== 'profile' && (
        <div className="px-2.5 pb-2">
          <div className="flex items-center gap-2 rounded-full bg-elevation-2 px-3.5 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search chats"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2.5">
        {tab === 'groups' &&
          (filteredRooms.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              {rooms.length === 0 ? (
                <>
                  No groups yet. Tap the <span className="font-medium text-foreground">compose</span> icon to add one.
                </>
              ) : (
                'No matches.'
              )}
            </div>
          ) : (
            <div role="listbox" aria-label="Groups" className="space-y-0.5 py-1">
              {filteredRooms.map((r) => (
                <RoomRow
                  key={r.room}
                  room={r}
                  active={!activeDm && r.room === activeRoom}
                  preview={previews[r.room]}
                  onSelect={onSelect}
                  onRemove={onRemove}
                />
              ))}
            </div>
          ))}

        {tab === 'messages' &&
          (filteredDms.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              {dms.length === 0 ? 'No conversations yet. Open a group and tap a member to start a DM.' : 'No matches.'}
            </div>
          ) : (
            <div role="listbox" aria-label="Direct messages" className="space-y-0.5 py-1">
              {filteredDms.map((d) => (
                <DmRow
                  key={d.peerKey}
                  dm={d}
                  active={d.peerKey === activeDm}
                  onSelect={onSelectDm}
                  onRemove={onRemoveDm}
                />
              ))}
            </div>
          ))}

        {tab === 'profile' && (
          <div className="py-1">
            <MessengerSection onIdentityChange={onIdentityChange} />
          </div>
        )}
      </div>

      <nav className="flex border-t border-border-subtle" aria-label="Messenger sections">
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={active}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </button>
          )
        })}
      </nav>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={(e) => {
          e.preventDefault()
          setResizing(true)
        }}
        className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-ew-resize transition-colors hover:bg-primary/40"
      >
        <div className="absolute inset-y-0 -left-1.5 right-0" />
      </div>
    </div>
  )
}

export default memo(ChatSidebar)
