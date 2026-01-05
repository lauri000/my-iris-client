import {ReactNode} from "react"
import {useChatInitState} from "./hooks/useChatInitState"
import ChatInitScreen from "./ChatInitScreen"

interface ChatInitGuardProps {
  children: ReactNode
}

/**
 * Guard component that shows the initialization screen until chat is ready.
 * Wraps chat routes to ensure users explicitly enable private messaging.
 */
const ChatInitGuard = ({children}: ChatInitGuardProps) => {
  const {state, setReady} = useChatInitState()

  if (state.status === "ready") {
    return <>{children}</>
  }

  return <ChatInitScreen state={state} onComplete={setReady} />
}

export default ChatInitGuard
