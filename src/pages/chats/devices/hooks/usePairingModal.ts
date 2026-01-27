import {useState, useCallback} from "react"
import {getDeviceManager} from "@/shared/services/DeviceManagerService"
import {DelegatePayload} from "nostr-double-ratchet"

interface UsePairingModalResult {
  showPairingModal: boolean
  pairingCodeInput: string
  addingDevice: boolean
  pairingError: string
  openModal: () => void
  closeModal: () => void
  handleAddDelegateDevice: () => Promise<void>
  setPairingCodeInput: (value: string) => void
}

export function usePairingModal(): UsePairingModalResult {
  const [showPairingModal, setShowPairingModal] = useState(false)
  const [pairingCodeInput, setPairingCodeInput] = useState("")
  const [addingDevice, setAddingDevice] = useState(false)
  const [pairingError, setPairingError] = useState("")

  const openModal = useCallback(() => {
    setShowPairingModal(true)
  }, [])

  const closeModal = useCallback(() => {
    setShowPairingModal(false)
    setPairingCodeInput("")
    setPairingError("")
  }, [])

  const handleAddDelegateDevice = useCallback(async () => {
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
      closeModal()
    } catch (error) {
      console.error("Failed to add delegate device:", error)
      setPairingError("Failed to add device. Please try again.")
    } finally {
      setAddingDevice(false)
    }
  }, [pairingCodeInput, closeModal])

  return {
    showPairingModal,
    pairingCodeInput,
    addingDevice,
    pairingError,
    openModal,
    closeModal,
    handleAddDelegateDevice,
    setPairingCodeInput,
  }
}
