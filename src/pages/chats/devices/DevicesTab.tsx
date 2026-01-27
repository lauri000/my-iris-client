import {useUserStore} from "@/stores/user"
import {useDeviceRegistration, useDeviceList, usePairingModal} from "./hooks"
import {DeviceList, RegistrationPrompt, PairingModal} from "./components"

interface DevicesTabProps {
  onRegistered?: () => void
}

const DevicesTab = ({onRegistered}: DevicesTabProps = {}) => {
  const {publicKey} = useUserStore()
  const {isCurrentDeviceRegistered} = useDeviceRegistration(publicKey, onRegistered)

  // Always subscribe to device list so we catch updates after registration
  const {loading, currentDevice, otherActiveDevices, handleDeleteDevice} = useDeviceList(
    publicKey,
    isCurrentDeviceRegistered
  )

  const {
    showPairingModal,
    pairingCodeInput,
    addingDevice,
    pairingError,
    openModal,
    closeModal,
    handleAddDelegateDevice,
    setPairingCodeInput,
  } = usePairingModal()

  if (!publicKey) {
    return (
      <div className="p-4">
        <div className="text-center py-8 text-base-content/70">
          Please sign in to manage your devices.
        </div>
      </div>
    )
  }

  // Show registration prompt if device is not registered
  if (isCurrentDeviceRegistered === false) {
    return <RegistrationPrompt publicKey={publicKey} onRegistered={onRegistered} />
  }

  // Loading state while checking registration
  if (isCurrentDeviceRegistered === null) {
    return (
      <div className="p-4">
        <div className="text-center py-8 text-base-content/70">
          Checking registration status...
        </div>
      </div>
    )
  }

  return (
    <>
      <DeviceList
        loading={loading}
        currentDevice={currentDevice}
        otherActiveDevices={otherActiveDevices}
        onAddDevice={openModal}
        onDeleteDevice={handleDeleteDevice}
      />
      {showPairingModal && (
        <PairingModal
          pairingCodeInput={pairingCodeInput}
          addingDevice={addingDevice}
          pairingError={pairingError}
          onClose={closeModal}
          onAddDevice={handleAddDelegateDevice}
          onInputChange={setPairingCodeInput}
        />
      )}
    </>
  )
}

export default DevicesTab
