import {RiDeleteBin6Line} from "@remixicon/react"
import {DeviceInfo, formatDeviceFoundDate} from "../utils/deviceUtils"

interface DeviceCardProps {
  device: DeviceInfo
  onDelete?: (identityPubkey: string) => void
}

const DeviceCard = ({device, onDelete}: DeviceCardProps) => {
  const deviceFoundDate = formatDeviceFoundDate(device.createdAt)

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-sm truncate">{device.id}</span>
              {device.isCurrent && (
                <span className="badge badge-primary badge-sm">Current</span>
              )}
            </div>
            {deviceFoundDate && (
              <div className="text-xs text-base-content/50">Added {deviceFoundDate}</div>
            )}
          </div>
          {!device.isCurrent && onDelete && (
            <button
              onClick={() => onDelete(device.id)}
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

export default DeviceCard
