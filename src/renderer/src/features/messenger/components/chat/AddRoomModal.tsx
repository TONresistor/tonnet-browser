import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { ActionButton } from '@/components/ui/ios/ActionButton'

interface AddRoomModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (room: string) => void
}

export function AddRoomModal({ isOpen, onClose, onAdd }: AddRoomModalProps): React.JSX.Element | null {
  const [room, setRoom] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, isOpen)

  const reset = (): void => {
    setRoom('')
  }
  const close = (): void => {
    reset()
    onClose()
  }
  const submit = (): void => {
    const name = room.trim()
    if (!isValidReference(name)) return
    onAdd(name)
    reset()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-room-title"
    >
      <div
        ref={ref}
        className="relative w-full max-w-md overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 p-5 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Cancel"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 id="add-room-title" className="mb-4 pr-8 text-[17px] font-semibold text-heading">
          Join a room
        </h3>

        <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Room key or .ton domain
        </label>
        <input
          value={room}
          onChange={(e) => setRoom(e.target.value.trim().slice(0, 253))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isValidReference(room.trim())) submit()
          }}
          placeholder="43-character room key or community.ton"
          className="mb-4 w-full rounded-card bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />

        <div className="flex gap-3">
          <ActionButton variant="gray" onClick={close} className="flex-1">
            Cancel
          </ActionButton>
          <ActionButton variant="filled" onClick={submit} disabled={!isValidReference(room.trim())} className="flex-1">
            Join
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

function isValidReference(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value) || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ton$/i.test(value)
}
