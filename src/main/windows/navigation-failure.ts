/** Chromium cancellation is not a page failure and must not replace the next navigation. */
export function isAbortedNavigation(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const failure = error as { errno?: number; code?: string; message?: string }
    return failure.errno === -3 || failure.code === 'ERR_ABORTED' || !!failure.message?.includes('ERR_ABORTED')
  }
  return typeof error === 'string' && error.includes('ERR_ABORTED')
}
