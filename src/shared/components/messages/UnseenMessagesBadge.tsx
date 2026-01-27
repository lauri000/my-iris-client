import {getMillisecondTimestamp} from "nostr-double-ratchet"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {MessageType} from "@/pages/chats/message/Message"
import {useMemo} from "react"
import {useUserStore} from "@/stores/user"

interface UnseenMessagesBadgeProps {
  messages?: SortedMap<string, MessageType>
  lastSeen?: number
}

const UnseenMessagesBadge = ({messages, lastSeen}: UnseenMessagesBadgeProps) => {
  const {events, lastSeen: lastSeenFromStore} = usePrivateMessagesStore()

  // Global usage - check all sessions (for navsidebar/footer)
  const hasUnread = useMemo(() => {
    const myPubKey = useUserStore.getState().publicKey
    for (const [chatId, sessionEvents] of events.entries()) {
      const [, latest] = sessionEvents.last() ?? []
      if (!latest) continue
      if (latest.pubkey === myPubKey) continue
      const lastSeenForChat = lastSeenFromStore.get(chatId) || 0
      const latestTime = getMillisecondTimestamp(latest as MessageType)
      if (latestTime > lastSeenForChat) {
        return true
      }
    }
    return false
  }, [events, lastSeenFromStore])

  // If props are provided, use them (for specific session usage)
  if (messages && lastSeen !== undefined) {
    const unseenMessages = Array.from(messages.entries()).filter(([, message]) => {
      if (!message.created_at) return false
      const myPubKey = useUserStore.getState().publicKey
      if (message.pubkey === myPubKey) return false
      return getMillisecondTimestamp(message) > lastSeen
    })

    if (unseenMessages.length === 0) {
      return null
    }

    return (
      <div className="flex items-center gap-1">
        <span className="badge badge-primary badge-sm">{unseenMessages.length}</span>
      </div>
    )
  }

  // Global usage - return the unread indicator
  return (
    <>
      {hasUnread && <div className="indicator-item badge badge-primary badge-xs"></div>}
    </>
  )
}

export default UnseenMessagesBadge
