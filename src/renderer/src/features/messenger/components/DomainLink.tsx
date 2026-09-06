import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Globe, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { messengerClient } from '@/features/messenger/client'
import { useAddBrowserTab } from '@/features/browser/navigation'
import type { OwnChatIdentity } from '@shared/types'
import type { ChatDomainLink } from '@shared/ipc-contract/chat'
import { isMessengerDomain } from '@/features/messenger/domain'

function TransactionQR({ url }: { url: string }) {
  const [image, setImage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(url, { width: 180, margin: 4, errorCorrectionLevel: 'M' }))
      .then((value) => active && setImage(value))
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [url])

  if (failed) return <p className="text-xs text-muted-foreground">QR unavailable. Use the transaction link below.</p>
  return (
    <div className="flex min-h-[180px] items-center justify-center">
      {image ? (
        <img
          src={image}
          width={180}
          height={180}
          className="max-w-full rounded-lg"
          alt="Scan to update the domain DNS record"
        />
      ) : (
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading QR code" />
      )}
    </div>
  )
}

export function DomainLink({
  identity,
  onIdentityChange,
}: {
  identity: OwnChatIdentity
  onIdentityChange: (identity: OwnChatIdentity) => void
}) {
  const [domain, setDomain] = useState('')
  const [prepared, setPrepared] = useState<ChatDomainLink | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'category' | 'value' | 'link' | null>(null)
  const [manual, setManual] = useState(false)
  const [requestedDomain, setRequestedDomain] = useState('')
  const [retry, setRetry] = useState(0)
  const [verificationStopped, setVerificationStopped] = useState(false)
  const addTab = useAddBrowserTab()
  const requestId = useRef(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const verificationFlight = useRef<Promise<void> | null>(null)
  const normalizedDomain = domain.trim().toLowerCase()
  const validDomain = isMessengerDomain(normalizedDomain)
  const verificationDomain = identity.domain
    ? ''
    : (prepared?.domain ?? (manual && validDomain ? normalizedDomain : requestedDomain))

  useEffect(() => {
    setVerificationStopped(false)
    if (!verificationDomain) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const stop = () => {
      active = false
      clearTimeout(timer)
      setVerificationStopped(true)
    }
    const deadline = setTimeout(stop, 10 * 60 * 1000)
    const check = async () => {
      await verificationFlight.current
      if (!active) return
      const flight = (async () => {
        try {
          const result = await messengerClient.claimDomain(verificationDomain)
          if (!active) return
          if (result.ok) {
            active = false
            clearTimeout(deadline)
            onIdentityChange(result.identity)
          }
        } catch (cause) {
          if (!active) return
          if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'CHAT_PROTOCOL_INVALID') {
            stop()
            clearTimeout(deadline)
            setError(cause instanceof Error ? cause.message : 'Unable to verify domain')
          }
        }
      })()
      verificationFlight.current = flight
      await flight
      if (verificationFlight.current === flight) verificationFlight.current = null
      if (active) timer = setTimeout(() => void check(), 5000)
    }
    timer = setTimeout(() => void check(), 5000)
    return () => {
      active = false
      clearTimeout(timer)
      clearTimeout(deadline)
    }
  }, [verificationDomain, retry, onIdentityChange])

  useEffect(
    () => () => {
      requestId.current++
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    []
  )

  async function copy(value: string, kind: 'category' | 'value' | 'link') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(null), 1500)
    } catch {
      setError('Unable to copy. Please try again.')
    }
  }

  async function prepare() {
    const current = ++requestId.current
    setBusy(true)
    setError(null)
    try {
      const value = await messengerClient.prepareDomainLink(domain.trim().toLowerCase())
      if (current !== requestId.current) return
      if (value.key !== identity.identityKey) throw new Error('Your identity changed. Please try again.')
      setPrepared(value)
    } catch (cause) {
      if (current === requestId.current)
        setError(cause instanceof Error ? cause.message : 'Unable to prepare transaction')
    } finally {
      if (current === requestId.current) setBusy(false)
    }
  }

  function verify() {
    setError(null)
    setRequestedDomain(normalizedDomain)
    setRetry((value) => value + 1)
  }

  async function openWallet() {
    if (!prepared) return
    try {
      await messengerClient.openDomainLink(prepared.txUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open wallet. Scan the QR code instead.')
    }
  }

  async function remove() {
    const current = ++requestId.current
    setBusy(true)
    setError(null)
    try {
      const value = await messengerClient.clearDomain()
      if (current === requestId.current) onIdentityChange(value)
    } catch (cause) {
      if (current === requestId.current) setError(cause instanceof Error ? cause.message : 'Unable to remove domain')
    } finally {
      if (current === requestId.current) setBusy(false)
    }
  }

  const manualSetup = (
    <div className="mt-3 min-w-0">
      <Button variant="ghost" size="sm" className="w-full" aria-expanded={manual} onClick={() => setManual(!manual)}>
        {manual ? (prepared ? 'Back to QR code' : 'Hide instructions') : 'Add manually'}
      </Button>
      {manual && (
        <ol className="mt-2 list-decimal space-y-3 pl-4 text-xs text-muted-foreground">
          <li>
            Open the recommended app:{' '}
            <a
              href="https://t.me/resistancetoolsbot"
              className="break-all text-primary hover:underline"
              onClick={(event) => {
                event.preventDefault()
                void addTab('https://t.me/resistancetoolsbot').catch(() =>
                  setError('Unable to open the app. Open t.me/resistancetoolsbot in Telegram.')
                )
              }}
            >
              t.me/resistancetoolsbot
            </a>
            .
          </li>
          <li>
            Select your domain{prepared ? ` (${prepared.domain})` : ''}, then{' '}
            <span className="text-foreground">Add record → Text</span>.
          </li>
          <li>
            Enter these values. Click each one to copy.
            {(
              [
                { kind: 'category', label: 'Category', value: 'msg_id' },
                { kind: 'value', label: 'Value', value: identity.identityKey },
              ] as const
            ).map((field) => (
              <div key={field.kind} className="mt-2 min-w-0">
                <div className="mb-1 text-[11px]">{field.label}</div>
                <button
                  type="button"
                  onClick={() => void copy(field.value, field.kind)}
                  aria-label={`Copy DNS ${field.kind}`}
                  title={copied === field.kind ? 'Copied' : 'Click to copy'}
                  className="flex min-w-0 w-full items-start gap-2 rounded-lg bg-surface px-3 py-2 text-left hover:bg-surface-hover"
                >
                  <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-foreground">
                    {field.value}
                  </code>
                  {copied === field.kind ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 shrink-0" />
                  )}
                </button>
              </div>
            ))}
          </li>
          <li>Approve in the wallet owning the domain. Confirmation is automatic while this screen is open.</li>
        </ol>
      )}
    </div>
  )

  const verification = verificationStopped ? (
    <Button size="sm" className="mt-3 w-full" onClick={verify}>
      Retry verification
    </Button>
  ) : (
    <p role="status" className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      Waiting for confirmation…
    </p>
  )

  return (
    <div className="min-w-0 max-w-full border-t border-border-subtle p-3" aria-busy={busy}>
      {!identity.domain && <div className="mb-3 text-xs text-muted-foreground">Link a TON domain</div>}
      {identity.domain ? (
        <>
          <div className="flex items-center gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center text-muted-foreground">
              <Globe className="h-[17px] w-[17px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">TON domain</div>
              <div className="mt-0.5 truncate text-[13px] lowercase text-foreground">{identity.domain}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Remove domain from this profile"
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          </div>
        </>
      ) : prepared ? (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{prepared.domain}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setPrepared(null)
                setManual(false)
                setRequestedDomain('')
                setError(null)
                setCopied(null)
              }}
            >
              Back
            </Button>
          </div>
          {!manual && (
            <>
              <TransactionQR key={prepared.txUrl} url={prepared.txUrl} />
              <p className="my-3 text-center text-xs text-muted-foreground">
                Scan with the wallet owning this domain and approve the transaction.
              </p>
              <Button variant="secondary" size="sm" className="w-full" onClick={() => void openWallet()}>
                Open in wallet
              </Button>
              <button
                type="button"
                className="mt-2 flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => void copy(prepared.txUrl, 'link')}
              >
                {copied === 'link' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied === 'link' ? 'Copied' : 'Copy transaction link'}
              </button>
            </>
          )}
          {manualSetup}
          {verification}
        </>
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!busy && domain.trim()) void prepare()
            }}
          >
            <input
              value={domain}
              onChange={(event) => {
                setDomain(event.target.value)
                setRequestedDomain('')
                setError(null)
              }}
              disabled={busy}
              aria-label="TON domain"
              placeholder="alice.ton / alice.t.me"
              autoCapitalize="none"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-foreground"
            />
            <Button type="submit" size="sm" disabled={busy || !domain.trim()}>
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'Continue'}
            </Button>
          </form>
          {manualSetup}
          {verificationDomain ? (
            verification
          ) : (
            <Button variant="ghost" size="sm" className="mt-2 w-full" disabled={busy || !validDomain} onClick={verify}>
              {manual ? 'Verify DNS record' : 'Already set up? Verify'}
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 break-words text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
