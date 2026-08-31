import secureLockIcon from '@/assets/telegram-lockedstickers.svg'
import { cn } from '@/lib/utils'

interface SecureLockIconProps {
  className?: string
}

export function SecureLockIcon({ className }: SecureLockIconProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-ui-icon="secure-lock"
      className={cn('inline-block shrink-0', className)}
      style={{
        backgroundColor: 'currentColor',
        maskImage: `url("${secureLockIcon}")`,
        WebkitMaskImage: `url("${secureLockIcon}")`,
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
      }}
    />
  )
}
