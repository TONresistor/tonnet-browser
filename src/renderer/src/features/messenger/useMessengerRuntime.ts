import { useEffect } from 'react'
import { messengerClient } from './client'
import { useDirectMessageStore } from './direct-message-store'

export function useMessengerRuntime(): void {
  useEffect(() => {
    const offDirect = messengerClient.onDirectMessage(useDirectMessageStore.getState().receive)
    const offIdentity = messengerClient.onIdentityChanged((identity) => {
      useDirectMessageStore.getState().setIdentity(identity.identityKey)
    })
    return () => {
      offDirect()
      offIdentity()
    }
  }, [])
}
