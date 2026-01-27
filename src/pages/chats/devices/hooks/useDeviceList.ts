import {useState, useEffect} from "react"
import {getDeviceManager} from "@/shared/services/DeviceManagerService"
import {getDelegateManager} from "@/shared/services/DelegateManagerService"
import {createNostrSubscribe} from "@/shared/services/nostrHelpers"
import {ndk} from "@/utils/ndk"
import {confirm, alert} from "@/utils/utils"
import {InviteList} from "nostr-double-ratchet"
import {DeviceInfo, buildDeviceList} from "../utils/deviceUtils"

interface UseDeviceListResult {
  devices: DeviceInfo[]
  loading: boolean
  currentDevice: DeviceInfo | undefined
  otherActiveDevices: DeviceInfo[]
  handleDeleteDevice: (identityPubkey: string) => Promise<void>
}

export function useDeviceList(
  publicKey: string | undefined,
  isRegistered?: boolean | null
): UseDeviceListResult {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)

  // Re-run when registration status changes to refresh from local DeviceManager
  useEffect(() => {
    void isRegistered // Used only as dependency to trigger re-run after registration
    if (!publicKey) {
      setDevices([])
      setLoading(false)
      return
    }

    let unsubscribe: (() => void) | null = null

    const setup = async () => {
      setLoading(true)

      try {
        // Get current device identity
        const delegateManager = await getDelegateManager()
        const deviceId = delegateManager.getIdentityPublicKey()

        // Also load from local DeviceManager for immediate display
        const deviceManager = await getDeviceManager()
        const localList = deviceManager.getInviteList()
        if (localList) {
          setDevices(buildDeviceList(localList, deviceId))
        }

        // Subscribe to InviteList from relays
        const ndkInstance = ndk()
        const subscribe = createNostrSubscribe(ndkInstance)

        unsubscribe = InviteList.fromUser(
          publicKey,
          subscribe,
          (inviteList: InviteList) => {
            setDevices(buildDeviceList(inviteList, deviceId))
            setLoading(false)
          }
        )

        // Set loading to false after a short timeout if no events received
        setTimeout(() => setLoading(false), 2000)
      } catch (error) {
        console.error("Failed to load devices:", error)
        setDevices([])
        setLoading(false)
      }
    }

    setup()

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [publicKey, isRegistered])

  const currentDevice = devices.find((device) => device.isCurrent)
  const otherActiveDevices = devices.filter((device) => !device.isCurrent)

  const handleDeleteDevice = async (identityPubkey: string) => {
    if (!(await confirm(`Revoke device ${identityPubkey.slice(0, 8)}?`))) {
      return
    }

    try {
      setLoading(true)
      const deviceManager = await getDeviceManager()
      deviceManager.revokeDevice(identityPubkey)
      await deviceManager.publish()
      // List will update via subscription
      setLoading(false)
    } catch (error) {
      console.error("Failed to revoke device:", error)
      await alert("Failed to revoke device")
      setLoading(false)
    }
  }

  return {
    devices,
    loading,
    currentDevice,
    otherActiveDevices,
    handleDeleteDevice,
  }
}
