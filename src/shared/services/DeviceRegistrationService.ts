import {getDeviceManager} from "./DeviceManagerService"
import {getDelegateManager} from "./DelegateManagerService"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

/**
 * Check if the current device is registered in the InviteList.
 * Does NOT trigger auto-registration.
 */
export const isDeviceRegistered = async (): Promise<boolean> => {
  try {
    const deviceManager = await getDeviceManager()
    const delegateManager = await getDelegateManager()

    const devices = deviceManager.getOwnDevices()
    const delegatePubkey = delegateManager.getIdentityPublicKey()

    return devices.some(
      (d: {identityPubkey: string}) => d.identityPubkey === delegatePubkey
    )
  } catch {
    return false
  }
}

/**
 * Register the current device in the InviteList.
 * This is an explicit action - call this when the user clicks "Register This Device".
 */
export const registerCurrentDevice = async (): Promise<void> => {
  const deviceManager = await getDeviceManager()
  const delegateManager = await getDelegateManager()
  const delegatePubkey = delegateManager.getIdentityPublicKey()

  deviceManager.addDevice({identityPubkey: delegatePubkey})
  await deviceManager.publish()
  log("Registered device:", delegatePubkey.slice(0, 8))
}
