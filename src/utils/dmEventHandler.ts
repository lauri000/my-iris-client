import {getSessionManager} from "@/shared/services/SessionManagerService"
import {useUserStore} from "@/stores/user"
import {useDelegateDeviceStore} from "@/stores/delegateDevice"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useGroupsStore} from "@/stores/groups"
import {getTag} from "./tagUtils"
import {KIND_CHANNEL_CREATE} from "./constants"
import {isTauri} from "./utils"
import {getSocialGraph} from "./socialGraph"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {Rumor} from "nostr-double-ratchet"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

let unsubscribeSessionEvents: (() => void) | null = null

export const cleanupSessionEventListener = () => {
  unsubscribeSessionEvents?.()
}

export const attachSessionEventListener = async () => {
  // For delegate devices, check if we have credentials but device is not yet activated
  // In that case, skip - SessionManagerService will handle activation
  const delegateCredentials = useDelegateDeviceStore.getState().credentials
  if (delegateCredentials && !delegateCredentials.ownerPublicKey) {
    log("Delegate device not yet activated, skipping session listener setup")
    return
  }

  // For main devices, check if device is registered before trying to initialize
  if (!delegateCredentials) {
    const {isDeviceRegistered} =
      await import("@/shared/services/DeviceRegistrationService")
    const registered = await isDeviceRegistered()
    if (!registered) {
      log("Device not registered, skipping session listener setup")
      return
    }
  }

  getSessionManager()
    .then((sessionManager) => {
      unsubscribeSessionEvents?.()

      // Get the delegate device pubkey for isFromUs check (if this is a delegate device)
      const delegatePubkey = delegateCredentials?.devicePublicKey

      unsubscribeSessionEvents = sessionManager.onEvent(
        (event: Rumor, pubKey: string) => {
          log("[dmEventHandler] received", {
            from: pubKey?.slice(0, 8),
            kind: event.kind,
            id: event.id?.slice(0, 8),
          })

          const {publicKey} = useUserStore.getState()
          if (!publicKey) return

          // Block events from muted users
          const mutedUsers = getSocialGraph().getMutedByUser(publicKey)
          if (mutedUsers.has(pubKey)) {
            log("[dmEventHandler] blocked: muted user", pubKey?.slice(0, 8))
            return
          }

          // Trigger desktop notification for DMs if on desktop
          if (isTauri() && event.pubkey !== publicKey) {
            import("./desktopNotifications").then(({handleDMEvent}) => {
              handleDMEvent(event, pubKey).catch(console.error)
            })
          }

          // Check if it's a group creation event
          const lTag = getTag("l", event.tags)
          if (event.kind === KIND_CHANNEL_CREATE && lTag) {
            try {
              const group = JSON.parse(event.content)
              const {addGroup} = useGroupsStore.getState()
              addGroup(group)
              log("Received group creation:", group.name, group.id)
            } catch (e) {
              error("Failed to parse group creation event:", e)
            }
            return
          }

          // Check if it's a group message (has l tag but not group creation)
          if (lTag) {
            // Create placeholder group if we don't have metadata yet
            const {groups, addGroup} = useGroupsStore.getState()
            if (!groups[lTag]) {
              const placeholderGroup = {
                id: lTag,
                name: `Group ${lTag.slice(0, 8)}`,
                description: "",
                picture: "",
                members: [publicKey],
                createdAt: Date.now(),
              }
              addGroup(placeholderGroup)
              log("Created placeholder group:", lTag)
            }

            // Group message or reaction - store under group ID
            log("Received group message for group:", lTag)
            void usePrivateMessagesStore.getState().upsert(lTag, publicKey, event)
            return
          }

          const pTag = getTag("p", event.tags)
          if (!pTag) return

          // Determine the chat ID - the "other party" in the conversation
          // pubKey from SessionManager is already resolved to owner pubkey (not device identity)
          // For outgoing messages, chatId is the recipient (pTag)
          // For incoming messages, chatId is the sender's owner pubkey (pubKey)
          //
          // isFromUs check (unified for main and delegate devices):
          // 1. event.pubkey matches our owner pubkey (direct match)
          // 2. event.pubkey matches our delegate device pubkey (sent from this device)
          // 3. pubKey matches our owner pubkey (self-sync session - message from sibling device)
          const isFromUs =
            event.pubkey === publicKey ||
            (delegatePubkey && event.pubkey === delegatePubkey) ||
            pubKey === publicKey
          const chatId = isFromUs ? pTag : pubKey

          // Normalize pubkey for messages from us so they display on correct side
          const normalizedEvent = isFromUs ? {...event, pubkey: publicKey} : event
          void usePrivateMessagesStore
            .getState()
            .upsert(chatId, publicKey, normalizedEvent)
        }
      )
    })
    .catch((err) => {
      error("Failed to initialize session manager:", err)
    })
}
