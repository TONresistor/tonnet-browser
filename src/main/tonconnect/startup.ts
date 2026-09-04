/** TON Connect failure must not abort browser-window creation. */
export async function initializeTonConnect(
  service: { init(clearSessions: boolean): Promise<void> },
  enabled: boolean,
  reportFailure: (error: unknown) => void
): Promise<boolean> {
  try {
    await service.init(!enabled)
    return true
  } catch (error) {
    reportFailure(error)
    return false
  }
}
