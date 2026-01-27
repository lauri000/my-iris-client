import {RiAddLine} from "@remixicon/react"
import DeviceCard from "./DeviceCard"
import {DeviceInfo} from "../utils/deviceUtils"

interface DeviceListProps {
  loading: boolean
  currentDevice: DeviceInfo | undefined
  otherActiveDevices: DeviceInfo[]
  onAddDevice: () => void
  onDeleteDevice: (identityPubkey: string) => Promise<void>
}

const DeviceList = ({
  loading,
  currentDevice,
  otherActiveDevices,
  onAddDevice,
  onDeleteDevice,
}: DeviceListProps) => {
  return (
    <div className="p-4">
      <div className="mb-4">
        <p className="text-base-content/70 text-sm">
          Manage devices that can send and receive your private messages.
        </p>
      </div>

      <div className="mb-4">
        <button className="btn btn-primary btn-sm gap-2" onClick={onAddDevice}>
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
              <DeviceCard device={currentDevice} />
            </div>
          )}

          {otherActiveDevices.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-base-content/50 uppercase mb-2">
                Other Devices
              </div>
              <div className="space-y-2">
                {otherActiveDevices.map((device) => (
                  <DeviceCard key={device.id} device={device} onDelete={onDeleteDevice} />
                ))}
              </div>
            </div>
          )}

          {!currentDevice && otherActiveDevices.length === 0 && (
            <div className="text-center py-8 text-base-content/70">No devices found.</div>
          )}
        </div>
      )}
    </div>
  )
}

export default DeviceList
