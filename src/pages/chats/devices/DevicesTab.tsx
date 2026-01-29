import {useState, useEffect, useMemo} from "react"
import {useUserStore} from "@/stores/user"
import {
  RiDeleteBin6Line,
  RiAddLine,
  RiShieldCheckLine,
  RiLogoutBoxRLine,
} from "@remixicon/react"
import {getDeviceManager} from "@/shared/services/DeviceManagerService"
import {getDelegateManager} from "@/shared/services/DelegateManagerService"
import {
  isDeviceRegistered,
  registerCurrentDevice,
  addDeviceToExistingList,
} from "@/shared/services/DeviceRegistrationService"
import {createNostrSubscribe} from "@/shared/services/nostrHelpers"
import {ndk} from "@/utils/ndk"
import {confirm, alert} from "@/utils/utils"
import {DelegatePayload, ApplicationKeys, DeviceEntry} from "nostr-double-ratchet"
import {attachSessionEventListener} from "@/utils/dmEventHandler"
import {isDelegateDevice, resetDelegateDevice} from "@/shared/services/DelegateDevice"
import {resetSessionManager} from "@/shared/services/SessionManagerService"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useDraftStore} from "@/stores/draft"
import localforage from "localforage"

interface DeviceInfo {
  id: string
  isCurrent: boolean
  createdAt: number
  isNotPublished?: boolean
}

const formatDeviceId = (id: string): string => {
  if (id.length <= 12) return id
  return `${id.slice(0, 8)}...${id.slice(-4)}`
}

interface DevicesTabProps {
  onRegistered?: () => void
  onPublishStatusChange?: (isPublished: boolean) => void
}

const DevicesTab = ({onRegistered, onPublishStatusChange}: DevicesTabProps = {}) => {
  const {publicKey} = useUserStore()
  const [remoteDevices, setRemoteDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showPairingModal, setShowPairingModal] = useState(false)
  const [pairingCodeInput, setPairingCodeInput] = useState("")
  const [addingDevice, setAddingDevice] = useState(false)
  const [pairingError, setPairingError] = useState("")
  const [isCurrentDeviceRegistered, setIsCurrentDeviceRegistered] = useState<
    boolean | null
  >(null)
  const [isRegistering, setIsRegistering] = useState(false)
  const [remoteApplicationKeys, setRemoteApplicationKeys] = useState<ApplicationKeys | null>(null)
  const [loadingRemoteList, setLoadingRemoteList] = useState(true)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [pendingAction, setPendingAction] = useState<"start" | "add" | null>(null)
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const isDelegate = isDelegateDevice()

  // Check if current device is published on relays
  const isCurrentDevicePublished = useMemo(() => {
    if (!currentDeviceId) return null
    return remoteDevices.some((d) => d.id === currentDeviceId)
  }, [remoteDevices, currentDeviceId])

  // Always include current device in display list
  const displayDevices = useMemo(() => {
    const isCurrentInRemote = remoteDevices.some((d) => d.id === currentDeviceId)
    if (isCurrentInRemote || !currentDeviceId) {
      return remoteDevices
    }
    // Add current device at the top with isNotPublished flag
    return [
      {id: currentDeviceId, isCurrent: true, createdAt: Date.now(), isNotPublished: true},
      ...remoteDevices,
    ]
  }, [remoteDevices, currentDeviceId])

  // Notify parent when publish status changes
  useEffect(() => {
    if (isCurrentDevicePublished !== null) {
      onPublishStatusChange?.(isCurrentDevicePublished)
    }
  }, [isCurrentDevicePublished, onPublishStatusChange])

  const handleDelegateLogout = async () => {
    const confirmed = await confirm(
      "This will remove this device from your account. You can pair it again later.",
      "Log out?"
    )
    if (!confirmed) return

    setIsLoggingOut(true)
    try {
      // Clean up stores
      await usePrivateMessagesStore.getState().clear()
      useDraftStore.getState().clearAll()

      // Reset session and delegate device
      resetSessionManager()
      resetDelegateDevice()

      // Clean up NDK
      const ndkInstance = ndk()
      ndkInstance.signer = undefined
      ndkInstance.pool.relays.forEach((relay) => relay.disconnect())
      ndkInstance.pool.relays.clear()

      // Clear storage
      localStorage.clear()
      await localforage.clear()
      await localforage.dropInstance({
        name: "iris-session-manager",
        storeName: "session-private",
      })

      // Reload
      location.reload()
    } catch (err) {
      console.error("Logout error:", err)
      setIsLoggingOut(false)
    }
  }

  const formatDeviceFoundDate = (timestamp?: number) => {
    if (!timestamp) return null
    const normalized = timestamp > 1e12 ? timestamp : timestamp * 1000
    return new Date(normalized).toLocaleString()
  }

  const buildDeviceList = (
    applicationKeys: ApplicationKeys,
    currentId: string | null
  ): DeviceInfo[] => {
    const activeDevices = applicationKeys.getAllDevices()

    const activeList: DeviceInfo[] = activeDevices.map((device: DeviceEntry) => ({
      id: device.identityPubkey,
      isCurrent: device.identityPubkey === currentId,
      createdAt: device.createdAt,
    }))

    // Sort: current device first, then by createdAt descending
    return activeList.sort((a, b) => {
      if (a.isCurrent) return -1
      if (b.isCurrent) return 1
      return b.createdAt - a.createdAt
    })
  }

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

    const unsubscribe = ApplicationKeys.fromUser(publicKey, subscribe, (list) => {
      setRemoteApplicationKeys(list)
      setLoadingRemoteList(false)
    })

    // Timeout fallback if no list found
    const timeout = setTimeout(() => setLoadingRemoteList(false), 3000)

    return () => {
      unsubscribe()
      clearTimeout(timeout)
    }
  }, [publicKey, isCurrentDeviceRegistered])

  const handleStartPrivateMessaging = () => {
    setPendingAction("start")
    setShowConfirmModal(true)
  }

  const handleAddThisDevice = () => {
    if (!remoteApplicationKeys) return
    setPendingAction("add")
    setShowConfirmModal(true)
  }

  const handleConfirmPublish = async () => {
    setShowConfirmModal(false)
    setIsRegistering(true)
    try {
      if (pendingAction === "start") {
        await registerCurrentDevice()
      } else if (pendingAction === "add" && remoteApplicationKeys) {
        await addDeviceToExistingList(remoteApplicationKeys)
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
  }

  const getDevicesToPublish = (): string[] => {
    if (pendingAction === "start") {
      // For start: just this device
      return currentDeviceId ? [currentDeviceId] : []
    } else if (pendingAction === "add" && remoteApplicationKeys) {
      // For add: existing devices + this device
      const existingIds = remoteApplicationKeys
        .getAllDevices()
        .map((d: DeviceEntry) => d.identityPubkey)
      if (currentDeviceId && !existingIds.includes(currentDeviceId)) {
        return [...existingIds, currentDeviceId]
      }
      return existingIds
    }
    return []
  }

  // Re-run when registration status changes
  useEffect(() => {
    if (!publicKey) {
      setRemoteDevices([])
      setLoading(false)
      return
    }

    let unsubscribe: (() => void) | null = null

    const setup = async () => {
      setLoading(true)

      try {
        // Get current device identity
        const delegateManager = await getDelegateManager()
        const deviceId = delegateManager.getIdentityPublicKey()

        // Subscribe to InviteList from relays
        const ndkInstance = ndk()
        const subscribe = createNostrSubscribe(ndkInstance)

        unsubscribe = ApplicationKeys.fromUser(publicKey, subscribe, (remoteList) => {
          setRemoteApplicationKeys(remoteList)
          setRemoteDevices(buildDeviceList(remoteList, deviceId))
          setLoading(false)
        })

        // Set loading to false after a short timeout if no events received
        setTimeout(() => setLoading(false), 2000)
      } catch (error) {
        console.error("Failed to load devices:", error)
        setRemoteDevices([])
        setLoading(false)
      }
    }

    setup()

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [publicKey, isCurrentDeviceRegistered])

  const handleDeleteDevice = async (identityPubkey: string) => {
    if (!(await confirm(`Revoke device ${identityPubkey.slice(0, 8)}?`))) {
      return
    }

    try {
      const deviceManager = await getDeviceManager()
      deviceManager.revokeDevice(identityPubkey)
      await deviceManager.publish()
    } catch (error) {
      console.error("Failed to revoke device:", error)
      await alert("Failed to revoke device")
    }
  }

  const handleAddDelegateDevice = async () => {
    if (!pairingCodeInput.trim()) {
      setPairingError("Please enter a pairing code")
      return
    }

    setAddingDevice(true)
    setPairingError("")

    try {
      let payload: DelegatePayload
      try {
        payload = JSON.parse(atob(pairingCodeInput.trim()))
      } catch {
        setPairingError("Invalid pairing code format")
        setAddingDevice(false)
        return
      }

      if (!payload.identityPubkey) {
        setPairingError("Pairing code is missing required identityPubkey field")
        setAddingDevice(false)
        return
      }

      const deviceManager = await getDeviceManager()
      deviceManager.addDevice(payload)
      await deviceManager.publish()
      handleClosePairingModal()
    } catch (error) {
      console.error("Failed to add delegate device:", error)
      setPairingError("Failed to add device. Please try again.")
    } finally {
      setAddingDevice(false)
    }
  }

  const handleClosePairingModal = () => {
    setShowPairingModal(false)
    setPairingCodeInput("")
    setPairingError("")
  }

  if (!publicKey) {
    return (
      <div className="p-4">
        <div className="text-center py-8 text-base-content/70">
          Please sign in to manage your devices.
        </div>
      </div>
    )
  }

  const renderDeviceCard = (device: DeviceInfo) => {
    const deviceFoundDate = formatDeviceFoundDate(device.createdAt)

    return (
      <div key={device.id} className="card bg-base-100 shadow-sm border border-base-300">
        <div className="card-body p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-mono text-sm truncate">
                  {formatDeviceId(device.id)}
                </span>
                {device.isCurrent && (
                  <span className="badge badge-primary badge-sm">Current</span>
                )}
                {device.isNotPublished && (
                  <span className="badge badge-warning badge-sm">Not published</span>
                )}
              </div>
              {deviceFoundDate && (
                <div className="text-xs text-base-content/50">
                  Added {deviceFoundDate}
                </div>
              )}
            </div>
            {!device.isCurrent && (
              <button
                onClick={() => handleDeleteDevice(device.id)}
                className="btn btn-ghost btn-sm text-error hover:bg-error/20"
                title="Revoke device"
              >
                <RiDeleteBin6Line size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Check if there are existing devices on relays
  const hasExistingDevices =
    remoteApplicationKeys && remoteApplicationKeys.getAllDevices().length > 0

  // Show registration prompt only if device is not registered AND no existing devices
  if (isCurrentDeviceRegistered === false && !hasExistingDevices && !loadingRemoteList) {
    return (
      <div className="p-4 space-y-4">
        {/* Main registration card */}
        <div className="card bg-base-100 border border-primary/30">
          <div className="card-body">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <RiShieldCheckLine size={24} className="text-primary" />
              </div>
              <h2 className="card-title">Enable Secure Messaging</h2>
            </div>
            <p className="text-base-content/70">
              Register this device to send and receive encrypted direct messages.
            </p>

            <div className="card-actions justify-end mt-4">
              <button
                className="btn btn-primary"
                onClick={handleStartPrivateMessaging}
                disabled={isRegistering}
              >
                {isRegistering ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Registering...
                  </>
                ) : (
                  "Start secure messaging"
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Confirmation modal */}
        {showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="card w-full max-w-md bg-base-100 shadow-xl m-4">
              <div className="card-body">
                <h2 className="card-title">Confirm Device Registration</h2>

                <p className="text-base-content/70 text-sm">
                  You&apos;re about to register this device for secure messaging.
                </p>

                {/* Show devices that will be in the list */}
                <div className="my-4">
                  <div className="text-sm font-medium mb-3">
                    Devices after registration:
                  </div>
                  <div className="space-y-2">
                    {getDevicesToPublish().map((id, index) => (
                      <div
                        key={id}
                        className="flex items-center gap-3 p-3 bg-base-200 rounded-lg"
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-base-300 text-base-content/70 text-sm font-medium">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono">
                              {formatDeviceId(id)}
                            </code>
                            {id === currentDeviceId && (
                              <span className="badge badge-primary badge-sm">
                                This device
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card-actions justify-end mt-4">
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setShowConfirmModal(false)
                      setPendingAction(null)
                    }}
                  >
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={handleConfirmPublish}>
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Show loading while checking for existing devices
  if (isCurrentDeviceRegistered === false && loadingRemoteList) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-center gap-3 p-4 bg-base-200 rounded-lg">
          <span className="loading loading-spinner loading-sm" />
          <span className="text-base-content/70">
            Searching for existing devices on relays...
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="mb-4">
        <p className="text-base-content/70 text-sm">
          Devices published to relays can send and receive your private messages.
        </p>
      </div>

      <div className="mb-4 flex gap-2">
        {isCurrentDeviceRegistered === false && hasExistingDevices && (
          <button
            className="btn btn-primary btn-sm"
            onClick={handleAddThisDevice}
            disabled={isRegistering}
          >
            {isRegistering ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              "Add this device"
            )}
          </button>
        )}
        <button
          className="btn btn-primary btn-sm gap-2"
          onClick={() => setShowPairingModal(true)}
        >
          <RiAddLine size={18} />
          Add Device
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-base-content/70">Loading devices...</div>
      ) : (
        <div className="space-y-2">
          {displayDevices.length === 0 ? (
            <div className="text-sm text-base-content/50 p-4 bg-base-200 rounded-lg">
              No devices published
            </div>
          ) : (
            displayDevices.map((device) => renderDeviceCard(device))
          )}
        </div>
      )}

      {isDelegate && (
        <div className="mt-8 pt-6 border-t border-base-300">
          <div className="text-xs font-semibold text-base-content/50 uppercase mb-3">
            This Device
          </div>
          <p className="text-sm text-base-content/70 mb-4">
            Log out to remove this device from your account. You can pair it again later
            from your main device.
          </p>
          <button
            className="btn btn-error btn-outline gap-2"
            onClick={handleDelegateLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              <RiLogoutBoxRLine size={18} />
            )}
            {isLoggingOut ? "Logging out..." : "Log out"}
          </button>
        </div>
      )}

      {showPairingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card w-full max-w-md bg-base-100 shadow-xl m-4">
            <div className="card-body">
              <h2 className="card-title">Add Device</h2>
              <p className="text-base-content/70 text-sm">
                Enter the pairing code from your other device to link it to your account.
              </p>

              <div className="form-control mt-4">
                <label className="label">
                  <span className="label-text">Pairing Code</span>
                </label>
                <textarea
                  className="textarea textarea-bordered h-24 font-mono text-xs"
                  placeholder="Paste pairing code here..."
                  value={pairingCodeInput}
                  onChange={(e) => setPairingCodeInput(e.target.value)}
                  disabled={addingDevice}
                />
              </div>

              {pairingError && (
                <div className="alert alert-error mt-2">
                  <span className="text-sm">{pairingError}</span>
                </div>
              )}

              <div className="card-actions justify-end mt-6">
                <button
                  className="btn btn-ghost"
                  onClick={handleClosePairingModal}
                  disabled={addingDevice}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleAddDelegateDevice}
                  disabled={addingDevice || !pairingCodeInput.trim()}
                >
                  {addingDevice ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : (
                    "Add Device"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card w-full max-w-md bg-base-100 shadow-xl m-4">
            <div className="card-body">
              <h2 className="card-title">Add This Device</h2>

              <p className="text-base-content/70 text-sm">
                You&apos;re about to add this device to your existing device list.
              </p>

              {/* Show devices that will be in the list */}
              <div className="my-4">
                <div className="text-sm font-medium mb-3">Devices after adding:</div>
                <div className="space-y-2">
                  {getDevicesToPublish().map((id, index) => (
                    <div
                      key={id}
                      className="flex items-center gap-3 p-3 bg-base-200 rounded-lg"
                    >
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-base-300 text-base-content/70 text-sm font-medium">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono">{formatDeviceId(id)}</code>
                          {id === currentDeviceId && (
                            <span className="badge badge-primary badge-sm">
                              This device
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card-actions justify-end mt-4">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowConfirmModal(false)
                    setPendingAction(null)
                  }}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleConfirmPublish}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DevicesTab
