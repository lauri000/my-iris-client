import {useState, useEffect} from "react"
import {useUserStore} from "@/stores/user"
import {RiDeleteBin6Line, RiAddLine, RiShieldCheckLine} from "@remixicon/react"
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
import {DelegatePayload, InviteList, DeviceEntry} from "nostr-double-ratchet"
import {attachSessionEventListener} from "@/utils/dmEventHandler"

interface DeviceInfo {
  id: string
  isCurrent: boolean
  createdAt: number
  isRemoved?: boolean
  removedAt?: number
}

const DevicesTab = () => {
  const {publicKey} = useUserStore()
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showRemoved, setShowRemoved] = useState(false)
  const [showPairingModal, setShowPairingModal] = useState(false)
  const [pairingCodeInput, setPairingCodeInput] = useState("")
  const [addingDevice, setAddingDevice] = useState(false)
  const [pairingError, setPairingError] = useState("")
  const [isCurrentDeviceRegistered, setIsCurrentDeviceRegistered] = useState<
    boolean | null
  >(null)
  const [isRegistering, setIsRegistering] = useState(false)
  const [remoteInviteList, setRemoteInviteList] = useState<InviteList | null>(null)
  const [loadingRemoteList, setLoadingRemoteList] = useState(true)

  const formatDeviceFoundDate = (timestamp?: number) => {
    if (!timestamp) return null
    const normalized = timestamp > 1e12 ? timestamp : timestamp * 1000
    return new Date(normalized).toLocaleString()
  }

  const buildDeviceList = (
    inviteList: InviteList,
    currentId: string | null
  ): DeviceInfo[] => {
    const activeDevices = inviteList.getAllDevices()
    const removedDevices = inviteList.getRemovedDevices()

    const activeList: DeviceInfo[] = activeDevices.map((device: DeviceEntry) => ({
      id: device.identityPubkey,
      isCurrent: device.identityPubkey === currentId,
      createdAt: device.createdAt,
    }))

    const removedList: DeviceInfo[] = removedDevices.map((removed) => ({
      id: removed.identityPubkey,
      isCurrent: removed.identityPubkey === currentId,
      createdAt: 0,
      isRemoved: true,
      removedAt: removed.removedAt,
    }))

    // Sort: current device first, then by createdAt descending
    const sortedActive = activeList.sort((a, b) => {
      if (a.isCurrent) return -1
      if (b.isCurrent) return 1
      return b.createdAt - a.createdAt
    })

    return [...sortedActive, ...removedList]
  }

  // Check registration status on mount
  useEffect(() => {
    if (!publicKey) {
      setIsCurrentDeviceRegistered(null)
      return
    }
    isDeviceRegistered().then(setIsCurrentDeviceRegistered)
  }, [publicKey])

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

  const handleStartPrivateMessaging = async () => {
    setIsRegistering(true)
    try {
      await registerCurrentDevice()
      setIsCurrentDeviceRegistered(true)
      // Initialize the session listener now that device is registered
      await attachSessionEventListener()
    } catch (err) {
      console.error("Failed to register device:", err)
      await alert("Failed to register device")
    } finally {
      setIsRegistering(false)
    }
  }

  const handleAddThisDevice = async () => {
    if (!remoteInviteList) return
    setIsRegistering(true)
    try {
      await addDeviceToExistingList(remoteInviteList)
      setIsCurrentDeviceRegistered(true)
      // Initialize the session listener now that device is registered
      await attachSessionEventListener()
    } catch (err) {
      console.error("Failed to add device:", err)
      await alert("Failed to add device")
    } finally {
      setIsRegistering(false)
    }
  }

  useEffect(() => {
    if (!publicKey) {
      setDevices([])
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

        // Also load from local DeviceManager for immediate display
        const deviceManager = await getDeviceManager()
        const localList = deviceManager.getInviteList()
        if (localList) {
          setDevices(buildDeviceList(localList, deviceId))
        }

        // Subscribe to InviteList from relays
        const ndkInstance = ndk()
        const subscribe = createNostrSubscribe(ndkInstance)

        unsubscribe = InviteList.fromUser(publicKey, subscribe, (inviteList) => {
          setDevices(buildDeviceList(inviteList, deviceId))
          setLoading(false)
        })

        // Set loading to false after a short timeout if no events received
        setTimeout(() => setLoading(false), 2000)
      } catch (error) {
        console.error("Failed to load devices:", error)
        setDevices([])
        setLoading(false)
      }
    }

    setup()

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [publicKey])

  useEffect(() => {
    if (!devices.some((device) => device.isRemoved && !device.isCurrent)) {
      setShowRemoved(false)
    }
  }, [devices])

  const currentDevice = devices.find((device) => device.isCurrent)
  const otherActiveDevices = devices.filter(
    (device) => !device.isCurrent && !device.isRemoved
  )
  const removedDevices = devices.filter((device) => device.isRemoved && !device.isCurrent)

  const handleDeleteDevice = async (identityPubkey: string) => {
    if (!(await confirm(`Revoke device ${identityPubkey.slice(0, 8)}?`))) {
      return
    }

    try {
      setLoading(true)
      const deviceManager = await getDeviceManager()
      deviceManager.revokeDevice(identityPubkey)
      await deviceManager.publish()
      // List will update via subscription
      setLoading(false)
    } catch (error) {
      console.error("Failed to revoke device:", error)
      await alert("Failed to revoke device")
      setLoading(false)
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
      // List will update via subscription
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
    const removedDate = formatDeviceFoundDate(device.removedAt)

    return (
      <div key={device.id} className="card bg-base-100 shadow-sm border border-base-300">
        <div className="card-body p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-mono text-sm truncate">{device.id}</span>
                {device.isCurrent && (
                  <span className="badge badge-primary badge-sm">Current</span>
                )}
                {device.isRemoved && (
                  <span className="badge badge-warning badge-sm">Revoked</span>
                )}
              </div>
              {deviceFoundDate && !device.isRemoved && (
                <div className="text-xs text-base-content/50">
                  Added {deviceFoundDate}
                </div>
              )}
              {device.isRemoved && removedDate && (
                <div className="text-xs text-warning mt-1">Revoked {removedDate}</div>
              )}
            </div>
            {!device.isCurrent && !device.isRemoved && (
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

  // Show registration prompt if device is not registered
  if (isCurrentDeviceRegistered === false) {
    const hasExistingDevices =
      remoteInviteList && remoteInviteList.getAllDevices().length > 0

    return (
      <div className="p-4">
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
            <div className="card-actions justify-end mt-4 gap-2">
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
                  "Start using private messaging"
                )}
              </button>
              <button
                className="btn btn-outline"
                onClick={handleAddThisDevice}
                disabled={isRegistering || loadingRemoteList || !hasExistingDevices}
              >
                {loadingRemoteList ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Checking...
                  </>
                ) : (
                  "Add this device"
                )}
              </button>
            </div>
            {!loadingRemoteList && !hasExistingDevices && (
              <p className="text-xs text-base-content/50 mt-2 text-right">
                No existing devices found. Start fresh with the button above.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="mb-4">
        <p className="text-base-content/70 text-sm">
          Manage devices that can send and receive your private messages.
        </p>
      </div>

      <div className="mb-4">
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
        <div className="space-y-3">
          {currentDevice && (
            <div>
              <div className="text-xs font-semibold text-base-content/50 uppercase mb-2">
                This Device
              </div>
              {renderDeviceCard(currentDevice)}
            </div>
          )}

          {otherActiveDevices.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-base-content/50 uppercase mb-2">
                Other Devices
              </div>
              <div className="space-y-2">
                {otherActiveDevices.map((device) => renderDeviceCard(device))}
              </div>
            </div>
          )}

          {removedDevices.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowRemoved((prev) => !prev)}
                className="flex items-center gap-2 text-xs text-base-content/50 hover:text-base-content/70 mb-2"
              >
                <span>{showRemoved ? "▼" : "▶"}</span>
                <span>Revoked Devices ({removedDevices.length})</span>
              </button>
              {showRemoved && (
                <div className="space-y-2 opacity-60">
                  {removedDevices.map((device) => renderDeviceCard(device))}
                </div>
              )}
            </div>
          )}

          {!currentDevice &&
            otherActiveDevices.length === 0 &&
            removedDevices.length === 0 && (
              <div className="text-center py-8 text-base-content/70">
                No devices found.
              </div>
            )}
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
    </div>
  )
}

export default DevicesTab
