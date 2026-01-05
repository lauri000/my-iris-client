import {useState, useEffect, lazy, Suspense} from "react"
import {useUserStore} from "@/stores/user"
import {RiDeleteBin6Line, RiEdit2Line, RiQrCodeLine, RiAddLine} from "@remixicon/react"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {getSessionManager} from "@/shared/services/PrivateChats"
import {confirm, alert} from "@/utils/utils"
import CopyButton from "@/shared/components/button/CopyButton"
import {encodeDevicePayload, decodeDevicePayload} from "nostr-double-ratchet"
import {LoadingFallback} from "@/shared/components/LoadingFallback"

const QRScanner = lazy(() => import("@/shared/components/QRScanner"))

interface DeviceInfo {
  id: string
  label?: string
  isCurrent: boolean
  createdAt: number
  staleAt?: number
}

type ViewMode = "list" | "link" | "add" | "scan"

const ChatSettings = () => {
  const {publicKey} = useUserStore()
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showStale, setShowStale] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("list")
  const [linkCode, setLinkCode] = useState<string>("")
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("")
  const [addDeviceCode, setAddDeviceCode] = useState("")
  const [addDeviceError, setAddDeviceError] = useState<string | null>(null)
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState("")

  type SessionManagerInstance = NonNullable<ReturnType<typeof getSessionManager>>

  const formatDeviceFoundDate = (timestamp?: number) => {
    if (!timestamp) return null
    const normalized = timestamp > 1e12 ? timestamp : timestamp * 1000
    return new Date(normalized).toLocaleString()
  }

  const buildDeviceList = (manager: SessionManagerInstance): DeviceInfo[] => {
    if (!publicKey) return []

    const currentDeviceId = manager.getDeviceId()
    const deviceList: DeviceInfo[] = []

    // Get all own devices from InviteList (authoritative source)
    const ownDevices = manager.getOwnDevices()
    for (const device of ownDevices) {
      deviceList.push({
        id: device.deviceId,
        label: device.deviceLabel,
        isCurrent: device.deviceId === currentDeviceId,
        createdAt: device.createdAt,
      })
    }

    // Get stale devices from session records (they have the staleAt timestamp)
    const userRecord = manager.getUserRecords().get(publicKey)
    if (userRecord) {
      for (const [, device] of userRecord.devices.entries()) {
        if (device.staleAt !== undefined) {
          // Only add if not already in the list from InviteList
          if (!deviceList.some((d) => d.id === device.deviceId)) {
            deviceList.push({
              id: device.deviceId,
              isCurrent: false,
              createdAt: device.createdAt,
              staleAt: device.staleAt,
            })
          }
        }
      }
    }

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

      const manager = getSessionManager()
      if (!manager) {
        console.error("SessionManager not available")
        setDevices([])
        setLoading(false)
        return
      }

      try {
        await manager.init()
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

  // Generate link code for this device (Increment 5)
  const generateLinkCode = async () => {
    const manager = getSessionManager()
    if (!manager) return

    const ownDevice = manager.getOwnDevice()
    if (!ownDevice) return

    const payload = {
      ephemeralPubkey: ownDevice.ephemeralPublicKey,
      sharedSecret: ownDevice.sharedSecret,
      deviceId: ownDevice.deviceId,
      deviceLabel: ownDevice.deviceLabel,
    }

    const encoded = encodeDevicePayload(payload)
    setLinkCode(encoded)

    // Generate QR code
    try {
      const QRCode = await import("qrcode")
      const url = await new Promise<string>((resolve, reject) => {
        QRCode.toDataURL(encoded, (error, url) => {
          if (error) reject(error)
          else resolve(url)
        })
      })
      setQrCodeUrl(url)
    } catch (err) {
      console.error("Error generating QR code:", err)
    }

    setViewMode("link")
  }

  // Add device from code (Increment 6)
  const handleAddDevice = async () => {
    setAddDeviceError(null)

    const code = addDeviceCode.trim()
    if (!code) {
      setAddDeviceError("Please enter a device code")
      return
    }

    const payload = decodeDevicePayload(code)
    if (!payload) {
      setAddDeviceError("Invalid device code")
      return
    }

    try {
      setLoading(true)
      const manager = getSessionManager()
      if (!manager) throw new Error("SessionManager not available")

      await manager.addDevice(payload)
      await refreshDeviceList(manager)
      setAddDeviceCode("")
      setViewMode("list")
    } catch (error) {
      console.error("Failed to add device:", error)
      setAddDeviceError("Failed to add device")
    } finally {
      setLoading(false)
    }
  }

  // Handle QR scan success (Increment 7)
  const handleScanSuccess = async (scannedData: string) => {
    const payload = decodeDevicePayload(scannedData)
    if (!payload) {
      await alert("Invalid device code in QR")
      setViewMode("list")
      return
    }

    try {
      setLoading(true)
      const manager = getSessionManager()
      if (!manager) throw new Error("SessionManager not available")

      await manager.addDevice(payload)
      await refreshDeviceList(manager)
      setViewMode("list")
    } catch (error) {
      console.error("Failed to add device:", error)
      await alert("Failed to add device")
      setViewMode("list")
    } finally {
      setLoading(false)
    }
  }

  // Edit device label (Increment 8)
  const handleStartEdit = (device: DeviceInfo) => {
    setEditingDeviceId(device.id)
    setEditingLabel(device.label || device.id)
  }

  const handleSaveLabel = async () => {
    if (!editingDeviceId) return

    try {
      setLoading(true)
      const manager = getSessionManager()
      if (!manager) throw new Error("SessionManager not available")

      await manager.updateDeviceLabel(editingDeviceId, editingLabel)
      await refreshDeviceList(manager)
      setEditingDeviceId(null)
      setEditingLabel("")
    } catch (error) {
      console.error("Failed to update label:", error)
      await alert("Failed to update device label")
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setEditingDeviceId(null)
    setEditingLabel("")
  }

  const handleDeleteDevice = async (deviceId: string) => {
    if (!(await confirm(`Delete invite for device ${deviceId.slice(0, 8)}?`))) {
      return
    }

    try {
      setLoading(true)
      const manager = getSessionManager()
      await manager.revokeDevice(deviceId)
      await refreshDeviceList(manager)
      setLoading(false)
    } catch (error) {
      console.error("Failed to delete invite:", error)
      await alert("Failed to delete invite")
      setLoading(false)
    }
  }

  const renderDeviceItem = (device: DeviceInfo, isLast: boolean) => {
    const deviceFoundDate = formatDeviceFoundDate(device.createdAt)
    const staleSinceDate = formatDeviceFoundDate(device.staleAt)
    const isStale = device.staleAt !== undefined
    const isEditing = editingDeviceId === device.id

    return (
      <SettingsGroupItem key={device.id} isLast={isLast}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    className="input input-sm input-bordered"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveLabel()
                      if (e.key === "Escape") handleCancelEdit()
                    }}
                  />
                  <button onClick={handleSaveLabel} className="btn btn-sm btn-primary">
                    Save
                  </button>
                  <button onClick={handleCancelEdit} className="btn btn-sm btn-ghost">
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  {device.label ? (
                    <>
                      <span className="font-medium">{device.label}</span>
                      <span className="font-mono text-xs text-base-content/50">
                        {device.id}
                      </span>
                    </>
                  ) : (
                    <span className="font-medium font-mono text-sm">{device.id}</span>
                  )}
                  {device.isCurrent && (
                    <span className="badge badge-primary badge-sm">Current</span>
                  )}
                  {isStale && <span className="badge badge-warning badge-sm">Stale</span>}
                </>
              )}
            </div>
            {deviceFoundDate && !isEditing && (
              <div className="text-xs text-base-content/50">
                {device.isCurrent
                  ? `Created ${deviceFoundDate}`
                  : `We first found and messaged this device on ${deviceFoundDate}`}
              </div>
            )}
            {isStale && staleSinceDate && (
              <div className="text-xs text-warning">
                Marked as stale since {staleSinceDate}.
              </div>
            )}
            {isStale && (
              <div className="text-xs text-warning">
                This invite was revoked and will no longer receive messages.
              </div>
            )}
          </div>
          {!isEditing && !isStale && (
            <div className="flex items-center gap-1 ml-4">
              <button
                onClick={() => handleStartEdit(device)}
                className="btn btn-ghost btn-sm text-base-content/70 hover:bg-base-300"
                title="Edit device label"
              >
                <RiEdit2Line size={16} />
              </button>
              {!device.isCurrent && (
                <button
                  onClick={() => handleDeleteDevice(device.id)}
                  className="btn btn-ghost btn-sm text-error hover:bg-error/20"
                  title="Delete device / app invite"
                >
                  <RiDeleteBin6Line size={16} />
                </button>
              )}
            </div>
          )}
        </div>
      </SettingsGroupItem>
    )
  }

  const renderStaleDeviceRow = (device: DeviceInfo) => {
    const deviceFoundDate = formatDeviceFoundDate(device.createdAt)
    const staleSinceDate = formatDeviceFoundDate(device.staleAt)

    return (
      <div key={device.id} className="px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-medium font-mono text-sm">{device.id}</span>
            <span className="badge badge-warning badge-sm">Stale</span>
          </div>
          {staleSinceDate && (
            <span className="text-xs text-base-content/50">
              Stale since {staleSinceDate}
            </span>
          )}
        </div>
        {deviceFoundDate && (
          <div className="mt-2 text-xs text-base-content/60">
            We first found and messaged this device on {deviceFoundDate}
          </div>
        )}
        <div className="mt-1 text-xs text-base-content/60">
          This invite was revoked and will no longer receive messages.
        </div>
      </div>
    )
  }

  // Link Device View (Increment 5)
  const renderLinkView = () => (
    <div className="space-y-6">
      <SettingsGroup title="Link This Device">
        <SettingsGroupItem isLast>
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-sm text-base-content/70 text-center">
              Scan this QR code or enter the code on your main device to link this device.
            </p>
            {qrCodeUrl && (
              <div className="aspect-square w-48">
                <img
                  src={qrCodeUrl}
                  alt="Device Link QR Code"
                  className="w-full h-full rounded-2xl"
                />
              </div>
            )}
            {linkCode && (
              <div className="w-full">
                <p className="text-xs text-base-content/50 mb-2 text-center">
                  Or copy this code:
                </p>
                <div className="bg-base-200 rounded-lg p-3">
                  <p className="text-xs font-mono break-all select-all text-center">
                    {linkCode}
                  </p>
                </div>
                <div className="flex justify-center mt-3">
                  <CopyButton
                    className="btn btn-sm btn-neutral"
                    copyStr={linkCode}
                    text="Copy code"
                  />
                </div>
              </div>
            )}
            <button
              onClick={() => setViewMode("list")}
              className="btn btn-ghost btn-sm mt-4"
            >
              Back
            </button>
          </div>
        </SettingsGroupItem>
      </SettingsGroup>
    </div>
  )

  // Add Device View (Increment 6)
  const renderAddView = () => (
    <div className="space-y-6">
      <SettingsGroup title="Add Device">
        <SettingsGroupItem isLast>
          <div className="flex flex-col gap-4 py-4">
            <p className="text-sm text-base-content/70">
              Enter the device code from the device you want to add:
            </p>
            <input
              type="text"
              value={addDeviceCode}
              onChange={(e) => {
                setAddDeviceCode(e.target.value)
                setAddDeviceError(null)
              }}
              placeholder="Paste device code here"
              className="input input-bordered w-full font-mono text-sm"
            />
            {addDeviceError && <p className="text-sm text-error">{addDeviceError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleAddDevice}
                className="btn btn-primary flex-1"
                disabled={loading}
              >
                {loading ? "Adding..." : "Add Device"}
              </button>
              <button onClick={() => setViewMode("scan")} className="btn btn-neutral">
                <RiQrCodeLine size={20} />
                Scan QR
              </button>
            </div>
            <button
              onClick={() => {
                setAddDeviceCode("")
                setAddDeviceError(null)
                setViewMode("list")
              }}
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
          </div>
        </SettingsGroupItem>
      </SettingsGroup>
    </div>
  )

  // Scan QR View (Increment 7)
  const renderScanView = () => (
    <div className="space-y-6">
      <SettingsGroup title="Scan Device QR">
        <SettingsGroupItem isLast>
          <div className="flex flex-col items-center gap-4 py-4">
            <Suspense fallback={<LoadingFallback />}>
              <QRScanner onScanSuccess={handleScanSuccess} />
            </Suspense>
            <button
              onClick={() => setViewMode("add")}
              className="btn btn-ghost btn-sm mt-4"
            >
              Back to text input
            </button>
          </div>
        </SettingsGroupItem>
      </SettingsGroup>
    </div>
  )

  // Main list view
  const renderListView = () => (
    <>
      <div className="mb-6">
        <p className="text-base-content/70">
          Your devices / apps for private messaging. Each device / app has a unique invite
          that allows other users to establish secure sessions.
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={generateLinkCode}
          className="btn btn-neutral btn-sm flex items-center gap-2"
        >
          <RiQrCodeLine size={18} />
          Link This Device
        </button>
        <button
          onClick={() => setViewMode("add")}
          className="btn btn-primary btn-sm flex items-center gap-2"
        >
          <RiAddLine size={18} />
          Add Device
        </button>
      </div>

      {currentDevice && (
        <div className="mb-6">
          <SettingsGroup title="This Device">
            {renderDeviceItem(currentDevice, true)}
          </SettingsGroup>
        </div>
      )}

      <div className="space-y-6">
        <SettingsGroup title="Your Devices / Apps">
          {loading && (
            <SettingsGroupItem isLast>
              <div className="text-center py-4">
                <p className="text-base-content/70">Loading devices / apps...</p>
              </div>
            </SettingsGroupItem>
          )}
          {!loading && otherActiveDevices.length === 0 && staleDevices.length === 0 && (
            <SettingsGroupItem isLast>
              <div className="text-center py-4">
                <p className="text-base-content/70">No other devices / apps found.</p>
              </div>
            </SettingsGroupItem>
          )}
          {!loading && (otherActiveDevices.length > 0 || staleDevices.length > 0) && (
            <>
              {otherActiveDevices.map((device, index) => {
                const isLastActive =
                  index === otherActiveDevices.length - 1 && staleDevices.length === 0
                return renderDeviceItem(device, isLastActive)
              })}
              {staleDevices.length > 0 && (
                <SettingsGroupItem key="stale-section" isLast>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setShowStale((prev) => !prev)}
                      className="flex w-full items-center justify-between rounded-lg border border-base-300 bg-base-100 px-4 py-2 text-sm font-medium text-base-content/60 hover:bg-base-200"
                    >
                      <span>
                        {showStale ? "▼" : "▶"} Stale devices ({staleDevices.length})
                      </span>
                      <span className="text-xs text-base-content/50">
                        Revoked invites, kept for reference
                      </span>
                    </button>
                    {showStale && (
                      <div className="rounded-lg border border-base-300 bg-base-100 divide-y divide-base-300">
                        {staleDevices.map((device) => renderStaleDeviceRow(device))}
                      </div>
                    )}
                  </div>
                </SettingsGroupItem>
              )}
            </>
          )}
        </SettingsGroup>
      </div>
    </>
  )

  if (!publicKey) {
    return (
      <div className="bg-base-200 min-h-full">
        <div className="p-4">
          <div className="text-center py-8 text-base-content/70">
            Please sign in to manage your chat settings.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        {viewMode === "list" && renderListView()}
        {viewMode === "link" && renderLinkView()}
        {viewMode === "add" && renderAddView()}
        {viewMode === "scan" && renderScanView()}
      </div>
    </div>
  )
}

export default ChatSettings
