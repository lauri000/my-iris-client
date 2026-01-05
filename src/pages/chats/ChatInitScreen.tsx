import {useState} from "react"
import {RiChat1Line, RiWifiOffLine, RiDeviceLine, RiAddLine} from "@remixicon/react"
import Header from "@/shared/components/header/Header"
import {initializeChat} from "@/utils/dmEventHandler"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import type {ChatInitState} from "./hooks/useChatInitState"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UI_CHAT)

interface ChatInitScreenProps {
  state: ChatInitState
  onComplete: () => void
}

const ChatInitScreen = ({state, onComplete}: ChatInitScreenProps) => {
  const [isInitializing, setIsInitializing] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  const handleInitialize = async () => {
    setIsInitializing(true)
    setInitError(null)

    try {
      log("Initializing chat...")
      await initializeChat()
      log("Chat initialized successfully")
      onComplete()
    } catch (err) {
      error("Failed to initialize chat:", err)
      setInitError(err instanceof Error ? err.message : "Failed to initialize chat")
      setIsInitializing(false)
    }
  }

  const renderContent = () => {
    if (state.status === "loading" || state.status === "checking_remote") {
      return (
        <div className="flex flex-col items-center gap-4">
          <div className="loading loading-spinner loading-lg" />
          <p className="text-base-content/70">
            {state.status === "loading"
              ? "Loading..."
              : "Checking for existing devices..."}
          </p>
        </div>
      )
    }

    if (state.status === "offline") {
      return (
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="w-16 h-16 rounded-full bg-warning/20 flex items-center justify-center">
            <RiWifiOffLine className="w-8 h-8 text-warning" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">You&apos;re Offline</h2>
            <p className="text-base-content/70 max-w-md">
              Connect to the internet to set up private messaging. We need to check if you
              have existing devices on other apps.
            </p>
          </div>
        </div>
      )
    }

    if (state.status === "needs_link") {
      return (
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="w-16 h-16 rounded-full bg-info/20 flex items-center justify-center">
            <RiDeviceLine className="w-8 h-8 text-info" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">Add This Device</h2>
            <p className="text-base-content/70 max-w-md">
              Found {state.remoteDevices} existing device
              {state.remoteDevices > 1 ? "s" : ""}. Add this device to enable private
              messaging here.
            </p>
          </div>
          <button
            onClick={handleInitialize}
            disabled={isInitializing}
            className="btn btn-primary btn-lg gap-2"
            data-testid="chat-init-add-device"
          >
            {isInitializing ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              <RiAddLine className="w-5 h-5" />
            )}
            Add This Device
          </button>
        </div>
      )
    }

    if (state.status === "needs_new") {
      return (
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
            <RiChat1Line className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">Enable Private Messaging</h2>
            <p className="text-base-content/70 max-w-md">
              Set up end-to-end encrypted messaging. Your messages will be private and
              only readable by you and your contacts.
            </p>
          </div>
          <button
            onClick={handleInitialize}
            disabled={isInitializing}
            className="btn btn-primary btn-lg gap-2"
            data-testid="chat-init-enable"
          >
            {isInitializing ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              <RiChat1Line className="w-5 h-5" />
            )}
            Enable Private Messaging
          </button>
        </div>
      )
    }

    return null
  }

  return (
    <div className="flex flex-col h-full">
      <Header>
        <span>Private Messages</span>
      </Header>
      <div className="flex-1 flex items-center justify-center p-8 pt-[calc(4rem+env(safe-area-inset-top))] md:pt-8">
        <div className="w-full max-w-md">
          {renderContent()}
          {initError && (
            <div className="mt-4 alert alert-error">
              <span>{initError}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ChatInitScreen
