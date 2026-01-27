import Modal from "@/shared/components/ui/Modal"

interface PairingModalProps {
  pairingCodeInput: string
  addingDevice: boolean
  pairingError: string
  onClose: () => void
  onAddDevice: () => void
  onInputChange: (value: string) => void
}

const PairingModal = ({
  pairingCodeInput,
  addingDevice,
  pairingError,
  onClose,
  onAddDevice,
  onInputChange,
}: PairingModalProps) => {
  return (
    <Modal onClose={onClose}>
      <h2 className="text-xl font-semibold mb-2">Add Device</h2>
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
          onChange={(e) => onInputChange(e.target.value)}
          disabled={addingDevice}
        />
      </div>

      {pairingError && (
        <div className="alert alert-error mt-2">
          <span className="text-sm">{pairingError}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-6">
        <button className="btn btn-ghost" onClick={onClose} disabled={addingDevice}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={onAddDevice}
          disabled={addingDevice || !pairingCodeInput.trim()}
        >
          {addingDevice ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            "Add Device"
          )}
        </button>
      </div>
    </Modal>
  )
}

export default PairingModal
