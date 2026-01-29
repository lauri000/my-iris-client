import {useState, useEffect} from "react"
import NotificationPrompt from "@/shared/components/NotificationPrompt"
import {RiUserLine, RiTeamLine, RiEarthLine, RiComputerLine} from "@remixicon/react"
import InstallPWAPrompt from "@/shared/components/InstallPWAPrompt"
import PrivateChatCreation from "./private/PrivateChatCreation"
import {Link, useLocation, useNavigate} from "@/navigation"
import PublicChatCreation from "./public/PublicChatCreation"
import GroupChatCreation from "./group/GroupChatCreation"
import Header from "@/shared/components/header/Header"
import PublicChannelCreateStep from "./public/PublicChannelCreateStep"
import DevicesTab from "./devices/DevicesTab"
import {isDeviceRegistered} from "@/shared/services/DeviceRegistrationService"

const TabSelector = ({disabled}: {disabled?: boolean}) => {
  const location = useLocation()
  const isPublic = location.pathname.startsWith("/chats/new/public")
  const isGroup = location.pathname.startsWith("/chats/new/group")
  const isDevices = location.pathname.startsWith("/chats/new/devices")

  const getClasses = (isActive: boolean, isDisabled?: boolean) => {
    const baseClasses = "flex items-center justify-center flex-1 p-3"
    if (isDisabled) {
      return `${baseClasses} text-base-content/30 cursor-not-allowed border-b border-1 border-transparent`
    }
    return isActive
      ? `${baseClasses} border-highlight cursor-pointer border-b border-1`
      : `${baseClasses} border-highlight cursor-pointer text-base-content/70 hover:text-base-content border-b border-1 border-transparent`
  }

  return (
    <div className="flex mb-px md:mb-1">
      {disabled ? (
        <span className={getClasses(false, true)}>
          <RiUserLine className="mr-2 w-4 h-4" />
          Direct
        </span>
      ) : (
        <Link to="/chats/new" className={getClasses(!isPublic && !isGroup && !isDevices)}>
          <RiUserLine className="mr-2 w-4 h-4" />
          Direct
        </Link>
      )}
      {disabled ? (
        <span className={getClasses(false, true)}>
          <RiTeamLine className="mr-2 w-4 h-4" />
          Group
        </span>
      ) : (
        <Link to="/chats/new/group" className={getClasses(isGroup)}>
          <RiTeamLine className="mr-2 w-4 h-4" />
          Group
        </Link>
      )}
      {disabled ? (
        <span className={getClasses(false, true)}>
          <RiEarthLine className="mr-2 w-4 h-4" />
          Public
        </span>
      ) : (
        <Link to="/chats/new/public" className={getClasses(isPublic)}>
          <RiEarthLine className="mr-2 w-4 h-4" />
          Public
        </Link>
      )}
      <Link to="/chats/new/devices" className={getClasses(isDevices)}>
        <RiComputerLine className="mr-2 w-4 h-4" />
        Devices
      </Link>
    </div>
  )
}

const NewChat = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const [deviceRegistered, setDeviceRegistered] = useState<boolean | null>(null)
  const [isDevicePublished, setIsDevicePublished] = useState<boolean | null>(null)

  useEffect(() => {
    isDeviceRegistered().then(setDeviceRegistered)
  }, [])

  // Force navigate to devices tab when device is not published
  useEffect(() => {
    if (
      isDevicePublished === false &&
      !location.pathname.startsWith("/chats/new/devices")
    ) {
      navigate("/chats/new/devices")
    }
  }, [isDevicePublished, location.pathname, navigate])

  // If device not registered, always show DevicesTab (no tabs visible)
  if (deviceRegistered === false) {
    return (
      <>
        <Header>
          <span className="truncate">Get Started</span>
        </Header>
        <div className="pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
          <NotificationPrompt />
          {/* No TabSelector - just show DevicesTab */}
          <DevicesTab
            onRegistered={() => {
              setDeviceRegistered(true)
              navigate("/chats/new/devices")
            }}
          />
          <InstallPWAPrompt />
        </div>
      </>
    )
  }

  // Loading state - show minimal loading
  if (deviceRegistered === null) {
    return (
      <>
        <Header>
          <span className="truncate">Private Messaging</span>
        </Header>
        <div className="pt-[calc(4rem+env(safe-area-inset-top))]">
          <div className="flex justify-center py-8">
            <span className="loading loading-spinner" />
          </div>
        </div>
      </>
    )
  }

  // Determine which component to show based on the path
  let content = null
  if (location.pathname === "/chats/new/public/create") {
    content = <PublicChannelCreateStep />
  } else if (location.pathname.startsWith("/chats/new/public")) {
    content = <PublicChatCreation />
  } else if (location.pathname.startsWith("/chats/new/group")) {
    content = <GroupChatCreation />
  } else if (location.pathname.startsWith("/chats/new/devices")) {
    content = <DevicesTab onPublishStatusChange={setIsDevicePublished} />
  } else {
    // Default to private chat creation for /chats/new
    content = <PrivateChatCreation />
  }

  return (
    <>
      <Header>
        <span className="truncate">Private Messaging</span>
      </Header>
      <div className="pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        <NotificationPrompt />
        <TabSelector disabled={isDevicePublished === false} />
        {content}
        <InstallPWAPrompt />
      </div>
    </>
  )
}

export default NewChat
