import {useState, useEffect} from "react"
import {useUserStore} from "@/stores/user"
import {RiDeleteBin6Line, RiAddLine} from "@remixicon/react"
import {getDeviceManager} from "@/shared/services/DeviceManagerService"
import {getSessionManager} from "@/shared/services/SessionManagerService"
import {confirm, alert} from "@/utils/utils"
import {DelegatePayload} from "nostr-double-ratchet"

interface DeviceInfo {
  id: string
  isCurrent: boolean
  createdAt: number
  staleAt?: number
}

type SessionManagerInstance = Awaited<ReturnType<typeof getSessionManager>>

const DevicesTab = () => {
  const {publicKey} = useUserStore()
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showStale, setShowStale] = useState(false)
  const [showPairingModal, setShowPairingModal] = useState(false)
  const [pairingCodeInput, setPairingCodeInput] = useState("")
  const [addingDevice, setAddingDevice] = useState(false)
  const [pairingError, setPairingError] = useState("")

  const formatDeviceFoundDate = (timestamp?: number) => {
    if (!timestamp) return null
    const normalized = timestamp > 1e12 ? timestamp : timestamp * 1000
    return new Date(normalized).toLocaleString()
  }

  const buildDeviceList = (manager: SessionManagerInstance): DeviceInfo[] => {
    if (!publicKey) return []

    const currentDeviceId = manager.getDeviceId()
    const userRecord = manager.getUserRecords().get(publicKey)

    if (!userRecord) return []

    const currentDevice = userRecord.devices.get(currentDeviceId)
    const otherDevices = Array.from(userRecord.devices.entries()).filter(
      ([deviceId]) => deviceId !== currentDeviceId
    )

    const deviceList = [currentDevice, ...otherDevices.map(([, d]) => d)]
      .filter((device) => device !== undefined)
      .map((device) => ({
        id: device.deviceId,
        isCurrent: device.deviceId === currentDeviceId,
        createdAt: device.createdAt,
        staleAt: device.staleAt,
      }))

    return deviceList
  }

  const refreshDeviceList = async (manager: SessionManagerInstance) => {
    const list = buildDeviceList(manager)
    setDevices(list)
  }

  useEffect(() => {
    const loadDeviceInfo = async () => {
      if (!publicKey) {
        setDevices([])
        setLoading(false)
        return
      }

      setLoading(true)

      try {
        const manager = await getSessionManager()
        await refreshDeviceList(manager)
      } catch (error) {
        console.error("Failed to load devices:", error)
        setDevices([])
      } finally {
        setLoading(false)
      }
    }

    loadDeviceInfo()
  }, [publicKey])

  useEffect(() => {
    if (!devices.some((device) => device.staleAt !== undefined && !device.isCurrent)) {
      setShowStale(false)
    }
  }, [devices])

  const currentDevice = devices.find((device) => device.isCurrent)
  const otherActiveDevices = devices.filter(
    (device) => !device.isCurrent && device.staleAt === undefined
  )
  const staleDevices = devices.filter(
    (device) => device.staleAt !== undefined && !device.isCurrent
  )

  const handleDeleteDevice = async (identityPubkey: string) => {
    if (!(await confirm(`Delete invite for device ${identityPubkey.slice(0, 8)}?`))) {
      return
    }

    try {
      setLoading(true)
      const deviceManager = await getDeviceManager()
      deviceManager.revokeDevice(identityPubkey)
      await deviceManager.publish()
      const sessionManager = await getSessionManager()
      await refreshDeviceList(sessionManager)
      setLoading(false)
    } catch (error) {
      console.error("Failed to delete invite:", error)
      await alert("Failed to delete invite")
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

      const sessionManager = await getSessionManager()
      await refreshDeviceList(sessionManager)
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
    const staleSinceDate = formatDeviceFoundDate(device.staleAt)
    const isStale = device.staleAt !== undefined

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
                {isStale && <span className="badge badge-warning badge-sm">Stale</span>}
              </div>
              {deviceFoundDate && (
                <div className="text-xs text-base-content/50">
                  Added {deviceFoundDate}
                </div>
              )}
              {isStale && staleSinceDate && (
                <div className="text-xs text-warning mt-1">Revoked {staleSinceDate}</div>
              )}
            </div>
            {!device.isCurrent && !isStale && (
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

          {staleDevices.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowStale((prev) => !prev)}
                className="flex items-center gap-2 text-xs text-base-content/50 hover:text-base-content/70 mb-2"
              >
                <span>{showStale ? "▼" : "▶"}</span>
                <span>Revoked Devices ({staleDevices.length})</span>
              </button>
              {showStale && (
                <div className="space-y-2 opacity-60">
                  {staleDevices.map((device) => renderDeviceCard(device))}
                </div>
              )}
            </div>
          )}

          {!currentDevice &&
            otherActiveDevices.length === 0 &&
            staleDevices.length === 0 && (
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
