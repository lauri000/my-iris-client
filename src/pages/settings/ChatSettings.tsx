import {useState, useEffect} from "react"
import {useUserStore} from "@/stores/user"
import {RiDeleteBin6Line, RiEdit2Line} from "@remixicon/react"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {getSessionManager} from "@/shared/services/PrivateChats"
import {confirm, alert} from "@/utils/utils"

interface DeviceInfo {
  id: string
  label?: string
  isCurrent: boolean
  createdAt: number
  staleAt?: number
}

const ChatSettings = () => {
  const {publicKey} = useUserStore()
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showStale, setShowStale] = useState(false)
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

  // Edit device label
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
        <div className="mb-6">
          <p className="text-base-content/70">
            Your devices / apps for private messaging. Each device / app has a unique
            invite that allows other users to establish secure sessions.
          </p>
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
      </div>
    </div>
  )
}

export default ChatSettings
