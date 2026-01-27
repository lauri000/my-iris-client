import {RiShieldCheckLine} from "@remixicon/react"
import {DeviceEntry} from "nostr-double-ratchet"
import {useDeviceRegistration} from "../hooks/useDeviceRegistration"
import {formatDeviceId, formatDeviceFoundDate} from "../utils/deviceUtils"
import RegistrationConfirmModal from "./RegistrationConfirmModal"

interface RegistrationPromptProps {
  publicKey: string
  onRegistered?: () => void
}

const RegistrationPrompt = ({publicKey, onRegistered}: RegistrationPromptProps) => {
  const {
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
  } = useDeviceRegistration(publicKey, onRegistered)

  const hasExistingDevices =
    remoteInviteList && remoteInviteList.getAllDevices().length > 0
  const existingDevices = remoteInviteList?.getAllDevices() || []

  return (
    <div className="p-4 space-y-4">
      {/* Search status - always visible while loading */}
      {loadingRemoteList && (
        <div className="flex items-center justify-center gap-3 p-4 bg-base-200 rounded-lg">
          <span className="loading loading-spinner loading-sm" />
          <span className="text-base-content/70">
            Searching for existing devices on relays...
          </span>
        </div>
      )}

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

          <div className="card-actions justify-end mt-4 gap-2">
            {/* Always show "Start secure messaging" */}
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

            {/* Only show "Add this device" when existing devices found */}
            {hasExistingDevices && (
              <button
                className="btn btn-outline"
                onClick={handleAddThisDevice}
                disabled={isRegistering}
              >
                Add this device
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Show existing devices when found */}
      {hasExistingDevices && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-base-content/50 uppercase">
            Your existing devices ({existingDevices.length})
          </div>
          {existingDevices.map((device: DeviceEntry, index: number) => (
            <div
              key={device.identityPubkey}
              className="flex items-center gap-3 p-3 bg-base-100 rounded-lg border border-base-300"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-base-200 text-base-content/70 text-sm font-medium">
                {index + 1}
              </div>
              <div className="flex-1 min-w-0">
                <code className="text-sm font-mono">
                  {formatDeviceId(device.identityPubkey)}
                </code>
                {device.createdAt && (
                  <div className="text-xs text-base-content/50 mt-1">
                    Added {formatDeviceFoundDate(device.createdAt)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No devices found message */}
      {!loadingRemoteList && !hasExistingDevices && (
        <div className="text-center text-base-content/50 text-sm">
          No existing devices found. Click &quot;Start secure messaging&quot; to begin.
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirmModal && (
        <RegistrationConfirmModal
          pendingAction={pendingAction}
          currentDeviceId={currentDeviceId}
          devicesToPublish={getDevicesToPublish()}
          onConfirm={handleConfirmPublish}
          onCancel={handleCancelConfirm}
        />
      )}
    </div>
  )
}

export default RegistrationPrompt
