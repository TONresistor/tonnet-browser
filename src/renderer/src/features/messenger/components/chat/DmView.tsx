import { memo, useEffect, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IdentityBadge } from './IdentityBadge'
import { SendIcon } from './SendIcon'
import { avatarColor, initial } from './util'
import type { DmConversation } from './useDmConversations'

interface DmViewProps {
  conversation: DmConversation
  connected: boolean
  error: string | null
  input: string
  onInput: (v: string) => void
  onSend: () => void
  onBack: () => void
}

function DmView({ conversation, connected, error, input, onInput, onSend, onBack }: DmViewProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [conversation.messages])

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="m-3 mb-0 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full border border-border-subtle bg-elevation-1 px-3 py-1.5 shadow-panel">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to room"
            title="Back to room"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
          </button>
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-identity-foreground"
            style={{ backgroundColor: avatarColor(conversation.peerKey) }}
          >
            {initial(conversation.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  'min-w-0 truncate text-[15px] font-semibold leading-tight text-heading',
                  conversation.domain ? 'lowercase' : 'font-mono'
                )}
              >
                {conversation.name}
              </span>
              <IdentityBadge identity={{ tier: conversation.domain ? 'domain' : 'identity' }} />
            </div>
            <div
              className="truncate font-mono text-[12px] leading-tight text-muted-foreground"
              title={conversation.peerKey}
            >
              {`identity ${conversation.peerKey.slice(0, 16)}…`}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 rounded-card border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {conversation.messages.length === 0 && (
          <div className="mt-10 text-center text-sm text-muted-foreground">End-to-end encrypted. No message yet.</div>
        )}
        {conversation.messages.map((m) => (
          <div key={m.id || m.ts} className={cn('flex flex-col', m.self ? 'items-end' : 'items-start')}>
            <div
              className={cn(
                'max-w-[75%] rounded-2xl px-3 py-2 text-sm',
                m.self
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border-subtle bg-elevation-2 text-foreground'
              )}
            >
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{new Date(m.ts).toLocaleTimeString()}</div>
          </div>
        ))}
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
          disabled={!connected}
          className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 disabled:opacity-50"
          placeholder={connected ? 'Message…' : 'Join a room to send…'}
          aria-label="message"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!connected || !input.trim()}
          aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-identity-foreground transition-opacity hover:bg-primary/90 disabled:opacity-40"
        >
          <SendIcon className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  )
}

export default memo(DmView)
