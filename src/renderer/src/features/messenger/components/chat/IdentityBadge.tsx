import { cn } from '@/lib/utils'
import type { ChatIdentityInfo } from './util'

function CheckBadge({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className={cn('h-3.5 w-3.5 shrink-0', className)} aria-hidden>
      <path
        fill="currentColor"
        d="M8 0l1.9 1.4 2.3-.3 1 2.1 2.1 1-.3 2.3L16 8l-1.4 1.9.3 2.3-2.1 1-1 2.1-2.3-.3L8 16l-1.9-1.4-2.3.3-1-2.1-2.1-1 .3-2.3L0 8l1.4-1.9-.3-2.3 2.1-1 1-2.1 2.3.3z"
      />
      <path className="fill-identity-foreground" d="M6.9 11.2L4.2 8.5l1.1-1.1 1.6 1.6 3.8-3.8 1.1 1.1z" />
    </svg>
  )
}

export function IdentityBadge({ identity }: { identity: Pick<ChatIdentityInfo, 'tier'> }): React.JSX.Element | null {
  if (identity.tier === 'identity') return null
  return <CheckBadge className={identity.tier === 'domain' ? 'text-primary' : 'text-muted-foreground/70'} />
}

export function displayName(identity: ChatIdentityInfo | undefined, nick: string): string {
  return identity?.name || nick
}
