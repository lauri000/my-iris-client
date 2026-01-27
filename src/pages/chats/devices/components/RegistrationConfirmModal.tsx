import Modal from "@/shared/components/ui/Modal"
import {formatDeviceId} from "../utils/deviceUtils"

interface RegistrationConfirmModalProps {
  pendingAction: "start" | "add" | null
  currentDeviceId: string | null
  devicesToPublish: string[]
  onConfirm: () => void
  onCancel: () => void
}

const RegistrationConfirmModal = ({
  pendingAction,
  currentDeviceId,
  devicesToPublish,
  onConfirm,
  onCancel,
}: RegistrationConfirmModalProps) => {
  return (
    <Modal onClose={onCancel}>
      <h2 className="text-xl font-semibold mb-4">Confirm Device Registration</h2>

      <p className="text-base-content/70 text-sm">
        {pendingAction === "start"
          ? "You're about to register this device for secure messaging."
          : "You're about to add this device to your existing device list."}
      </p>

      {/* Show devices that will be in the list */}
      <div className="my-4">
        <div className="text-sm font-medium mb-3">Devices after registration:</div>
        <div className="space-y-2">
          {devicesToPublish.map((id, index) => (
            <div key={id} className="flex items-center gap-3 p-3 bg-base-200 rounded-lg">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-base-300 text-base-content/70 text-sm font-medium">
                {index + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono">{formatDeviceId(id)}</code>
                  {id === currentDeviceId && (
                    <span className="badge badge-primary badge-sm">This device</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Warning */}
      <div className="alert alert-warning">
        <span className="text-sm">
          Any devices not in this list will no longer receive your messages.
        </span>
      </div>

      <div className="flex justify-end gap-2 mt-6">
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onConfirm}>
          Confirm
        </button>
      </div>
    </Modal>
  )
}

export default RegistrationConfirmModal
