export const messengerClient = {
  connect: (room?: string, node?: string) => window.electron.chat.connect(room, node),
  disconnect: () => window.electron.chat.disconnect(),
  send: (text: string) => window.electron.chat.send(text),
  sendDirectMessage: (peerKey: string, text: string) => window.electron.chat.dmSend(peerKey, text),
  mutate: (mutation: Parameters<typeof window.electron.chat.mutate>[0]) => window.electron.chat.mutate(mutation),
  timelineBefore: (beforeSeqno: number, limit = 100) => window.electron.chat.timelineBefore(beforeSeqno, limit),
  getIdentity: () => window.electron.chat.identity(),
  linkIdentity: () => window.electron.chat.linkIdentity(),
  detectDomains: () => window.electron.chat.detectDomains(),
  claimDomain: (domain: string) => window.electron.chat.claimDomain(domain),
  clearDomain: () => window.electron.chat.clearDomain(),
  resetIdentity: () => window.electron.chat.resetIdentity(),
  onTimeline: (listener: Parameters<typeof window.electron.on<'chat:timeline'>>[1]) =>
    window.electron.on('chat:timeline', listener),
  onDirectMessage: (listener: Parameters<typeof window.electron.on<'chat:dm'>>[1]) =>
    window.electron.on('chat:dm', listener),
  onConnection: (listener: Parameters<typeof window.electron.on<'chat:connection'>>[1]) =>
    window.electron.on('chat:connection', listener),
  onRoomState: (listener: Parameters<typeof window.electron.on<'chat:room-state'>>[1]) =>
    window.electron.on('chat:room-state', listener),
  onRoomPresence: (listener: Parameters<typeof window.electron.on<'chat:room-presence'>>[1]) =>
    window.electron.on('chat:room-presence', listener),
}
