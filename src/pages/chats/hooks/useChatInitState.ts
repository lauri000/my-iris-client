import {useState, useEffect, useCallback} from "react"
import {useUserStore} from "@/stores/user"
import {hasLocalChatData} from "@/shared/services/PrivateChats"
import {ndk} from "@/utils/ndk"
import {KIND_APP_DATA, KIND_INVITE_LIST, DEBUG_NAMESPACES} from "@/utils/constants"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UI_CHAT)

const CHAT_INITIALIZED_KEY = "chat-initialized"
const EOSE_TIMEOUT_MS = 5000

export type ChatInitState =
  | {status: "loading"}
  | {status: "offline"}
  | {status: "has_local"}
  | {status: "checking_remote"}
  | {status: "needs_new"}
  | {status: "needs_link"; remoteDevices: number}
  | {status: "ready"}

/**
 * Hook to determine chat initialization state.
 *
 * Flow:
 * 1. Check if already initialized (localStorage flag) → ready
 * 2. Check if local data exists → has_local
 * 3. If offline and no local data → offline
 * 4. Check Nostr for existing InviteList → needs_link or needs_new
 */
export const useChatInitState = (): {
  state: ChatInitState
  setReady: () => void
} => {
  const [state, setState] = useState<ChatInitState>({status: "loading"})
  const publicKey = useUserStore((s) => s.publicKey)

  const setReady = useCallback(() => {
    localStorage.setItem(CHAT_INITIALIZED_KEY, "true")
    setState({status: "ready"})
  }, [])

  useEffect(() => {
    if (!publicKey) {
      setState({status: "loading"})
      return
    }

    let cancelled = false
    let subscription: ReturnType<typeof ndk>["subscribe"] extends (
      ...args: infer A
    ) => infer R
      ? R
      : never

    const checkState = async () => {
      // 1. Check if already initialized
      const isInitialized = localStorage.getItem(CHAT_INITIALIZED_KEY) === "true"
      if (isInitialized) {
        log("Chat already initialized (flag set)")
        if (!cancelled) setState({status: "ready"})
        return
      }

      // 2. Check for local data
      const hasLocal = await hasLocalChatData()
      if (hasLocal) {
        log("Found local chat data")
        if (!cancelled) setState({status: "has_local"})
        return
      }

      // 3. Check if offline
      if (!navigator.onLine) {
        log("Offline with no local data")
        if (!cancelled) setState({status: "offline"})
        return
      }

      // 4. Check Nostr for existing InviteList
      log("Checking Nostr for existing devices...")
      if (!cancelled) setState({status: "checking_remote"})

      let foundRemoteDevices = 0
      let eoseReceived = false

      // Subscribe to both kinds (10078 and 30078)
      // Cast to any to avoid NDKKind type issues with custom kinds
      subscription = ndk().subscribe(
        [
          {
            kinds: [KIND_INVITE_LIST as number],
            authors: [publicKey],
          },
          {
            kinds: [KIND_APP_DATA as number],
            authors: [publicKey],
            "#l": ["double-ratchet/invites"],
          },
        ],
        {closeOnEose: true}
      )

      subscription.on("event", () => {
        foundRemoteDevices++
        log(`Found remote device event (total: ${foundRemoteDevices})`)
      })

      subscription.on("eose", () => {
        if (eoseReceived || cancelled) return
        eoseReceived = true
        log(`EOSE received, found ${foundRemoteDevices} remote device(s)`)

        if (foundRemoteDevices > 0) {
          setState({status: "needs_link", remoteDevices: foundRemoteDevices})
        } else {
          setState({status: "needs_new"})
        }
      })

      // Timeout fallback
      setTimeout(() => {
        if (!eoseReceived && !cancelled) {
          log("EOSE timeout, treating as no remote data")
          eoseReceived = true
          subscription?.stop()
          setState({status: "needs_new"})
        }
      }, EOSE_TIMEOUT_MS)
    }

    void checkState()

    // Listen for online status changes
    const handleOnline = () => {
      if (state.status === "offline") {
        void checkState()
      }
    }
    window.addEventListener("online", handleOnline)

    return () => {
      cancelled = true
      subscription?.stop()
      window.removeEventListener("online", handleOnline)
    }
  }, [publicKey])

  return {state, setReady}
}
