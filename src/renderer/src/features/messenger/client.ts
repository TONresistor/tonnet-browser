export const messengerClient = {
  connect: (room?: string, node?: string) => window.electron.chat.connect(room, node),
  disconnect: () => window.electron.chat.disconnect(),
  leave: (roomId: string) => window.electron.chat.leave(roomId),
  send: (roomId: string, text: string) => window.electron.chat.send(roomId, text),
  sendDirectMessage: (roomId: string, peerKey: string, text: string) =>
    window.electron.chat.dmSend(roomId, peerKey, text),
  mutate: (roomId: string, mutation: Parameters<typeof window.electron.chat.mutate>[1]) =>
    window.electron.chat.mutate(roomId, mutation),
  getPending: (roomId: string) => window.electron.chat.pending(roomId),
  retryPending: (roomId: string, eventId: string) => window.electron.chat.retryPending(roomId, eventId),
  discardPending: (roomId: string, eventId: string) => window.electron.chat.discardPending(roomId, eventId),
  timelineBefore: (roomId: string, beforeSeqno: number, limit = 100) =>
    window.electron.chat.timelineBefore(roomId, beforeSeqno, limit),
  getIdentity: () => window.electron.chat.identity(),
  linkIdentity: () => window.electron.chat.linkIdentity(),
  detectDomains: () => window.electron.chat.detectDomains(),
  claimDomain: (domain: string) => window.electron.chat.claimDomain(domain),
  prepareDomainLink: (domain: string) => window.electron.chat.prepareDomainLink(domain),
  openDomainLink: (txUrl: string) => window.electron.chat.openDomainLink(txUrl),
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
  onIdentityChanged: (listener: Parameters<typeof window.electron.on<'chat:identity-changed'>>[1]) =>
    window.electron.on('chat:identity-changed', listener),
}
