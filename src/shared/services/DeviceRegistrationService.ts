import {getDeviceManager} from "./DeviceManagerService"
import {getDelegateManager} from "./DelegateManagerService"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {InviteList} from "nostr-double-ratchet"

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
 * This creates a new InviteList with this device as authority.
 * Use this when starting fresh or becoming the authority device.
 */
export const registerCurrentDevice = async (): Promise<void> => {
  const deviceManager = await getDeviceManager()
  const delegateManager = await getDelegateManager()
  const delegatePubkey = delegateManager.getIdentityPublicKey()

  deviceManager.addDevice({identityPubkey: delegatePubkey})
  await deviceManager.publish()
  log("Registered device as authority:", delegatePubkey.slice(0, 8))
}

/**
 * Add the current device to an existing InviteList.
 * This preserves existing devices and adds this device to the list.
 * Use this when joining an existing device setup.
 */
export const addDeviceToExistingList = async (
  remoteInviteList: InviteList
): Promise<void> => {
  const deviceManager = await getDeviceManager()
  const delegateManager = await getDelegateManager()
  const delegatePubkey = delegateManager.getIdentityPublicKey()

  // Set the remote list as our local list (preserves existing devices)
  await deviceManager.setInviteList(remoteInviteList)

  // Add this device to the list
  deviceManager.addDevice({identityPubkey: delegatePubkey})
  await deviceManager.publish()
  log("Added device to existing list:", delegatePubkey.slice(0, 8))
}
