import {useState, useEffect, useCallback} from "react"
import {getDelegateManager} from "@/shared/services/DelegateManagerService"
import {
  isDeviceRegistered,
  registerCurrentDevice,
  addDeviceToExistingList,
} from "@/shared/services/DeviceRegistrationService"
import {createNostrSubscribe} from "@/shared/services/nostrHelpers"
import {ndk} from "@/utils/ndk"
import {alert} from "@/utils/utils"
import {InviteList, DeviceEntry} from "nostr-double-ratchet"
import {attachSessionEventListener} from "@/utils/dmEventHandler"

type PendingAction = "start" | "add" | null

interface UseDeviceRegistrationResult {
  isCurrentDeviceRegistered: boolean | null
  isRegistering: boolean
  remoteInviteList: InviteList | null
  loadingRemoteList: boolean
  showConfirmModal: boolean
  pendingAction: PendingAction
  currentDeviceId: string | null
  handleStartPrivateMessaging: () => void
  handleAddThisDevice: () => void
  handleConfirmPublish: () => Promise<void>
  handleCancelConfirm: () => void
  getDevicesToPublish: () => string[]
}

export function useDeviceRegistration(
  publicKey: string | undefined,
  onRegistered?: () => void
): UseDeviceRegistrationResult {
  const [isCurrentDeviceRegistered, setIsCurrentDeviceRegistered] = useState<
    boolean | null
  >(null)
  const [isRegistering, setIsRegistering] = useState(false)
  const [remoteInviteList, setRemoteInviteList] = useState<InviteList | null>(null)
  const [loadingRemoteList, setLoadingRemoteList] = useState(true)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)

  // Check registration status on mount
  useEffect(() => {
    if (!publicKey) {
      setIsCurrentDeviceRegistered(null)
      return
    }
    isDeviceRegistered().then(setIsCurrentDeviceRegistered)
  }, [publicKey])

  // Fetch current device ID on mount
  useEffect(() => {
    getDelegateManager().then((dm) => setCurrentDeviceId(dm.getIdentityPublicKey()))
  }, [])

  // Fetch remote InviteList when device is not registered
  useEffect(() => {
    if (!publicKey || isCurrentDeviceRegistered !== false) {
      setLoadingRemoteList(false)
      return
    }

    setLoadingRemoteList(true)
    const ndkInstance = ndk()
    const subscribe = createNostrSubscribe(ndkInstance)

    const unsubscribe = InviteList.fromUser(publicKey, subscribe, (list) => {
      setRemoteInviteList(list)
      setLoadingRemoteList(false)
    })

    // Timeout fallback if no list found
    const timeout = setTimeout(() => setLoadingRemoteList(false), 3000)

    return () => {
      unsubscribe()
      clearTimeout(timeout)
    }
  }, [publicKey, isCurrentDeviceRegistered])

  const handleStartPrivateMessaging = useCallback(() => {
    setPendingAction("start")
    setShowConfirmModal(true)
  }, [])

  const handleAddThisDevice = useCallback(() => {
    if (!remoteInviteList) return
    setPendingAction("add")
    setShowConfirmModal(true)
  }, [remoteInviteList])

  const handleConfirmPublish = useCallback(async () => {
    setShowConfirmModal(false)
    setIsRegistering(true)
    try {
      if (pendingAction === "start") {
        await registerCurrentDevice()
      } else if (pendingAction === "add" && remoteInviteList) {
        await addDeviceToExistingList(remoteInviteList)
      }
      setIsCurrentDeviceRegistered(true)
      onRegistered?.()
      // Initialize the session listener now that device is registered
      await attachSessionEventListener()
    } catch (err) {
      console.error("Failed to register device:", err)
      await alert("Failed to register device")
    } finally {
      setIsRegistering(false)
      setPendingAction(null)
    }
  }, [pendingAction, remoteInviteList, onRegistered])

  const handleCancelConfirm = useCallback(() => {
    setShowConfirmModal(false)
    setPendingAction(null)
  }, [])

  const getDevicesToPublish = useCallback((): string[] => {
    if (pendingAction === "start") {
      // For start: just this device
      return currentDeviceId ? [currentDeviceId] : []
    } else if (pendingAction === "add" && remoteInviteList) {
      // For add: existing devices + this device
      const existingIds = remoteInviteList
        .getAllDevices()
        .map((d: DeviceEntry) => d.identityPubkey)
      if (currentDeviceId && !existingIds.includes(currentDeviceId)) {
        return [...existingIds, currentDeviceId]
      }
      return existingIds
    }
    return []
  }, [pendingAction, currentDeviceId, remoteInviteList])

  return {
    isCurrentDeviceRegistered,
    isRegistering,
    remoteInviteList,
    loadingRemoteList,
    showConfirmModal,
    pendingAction,
    currentDeviceId,
    handleStartPrivateMessaging,
    handleAddThisDevice,
    handleConfirmPublish,
    handleCancelConfirm,
    getDevicesToPublish,
  }
}
