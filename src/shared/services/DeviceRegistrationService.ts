import {getDeviceManager} from "./DeviceManagerService"
import {getDelegateManager} from "./DelegateManagerService"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {ApplicationKeys} from "nostr-double-ratchet"
import {useUserStore} from "@/stores/user"
import {ndk} from "@/utils/ndk"
import {createNostrSubscribe} from "./nostrHelpers"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

/**
 * Check if the current device is registered in the ApplicationKeys.
 * Does NOT trigger auto-registration.
 * First checks local storage (fast), then falls back to relay query if not found.
 */
export const isDeviceRegistered = async (): Promise<boolean> => {
  try {
    const deviceManager = await getDeviceManager()
    const delegateManager = await getDelegateManager()
    const delegatePubkey = delegateManager.getIdentityPublicKey()

    // First check local storage (fast path)
    const localDevices = deviceManager.getOwnDevices()
    const isLocallyRegistered = localDevices.some(
      (d: {identityPubkey: string}) => d.identityPubkey === delegatePubkey
    )
    if (isLocallyRegistered) return true

    // Not found locally - check relays with timeout
    const {publicKey} = useUserStore.getState()
    if (!publicKey) return false

    const ndkInstance = ndk()
    const subscribe = createNostrSubscribe(ndkInstance)

    const remoteApplicationKeys = await ApplicationKeys.waitFor(
      publicKey,
      subscribe,
      5000
    )
    if (!remoteApplicationKeys) return false

    const device = remoteApplicationKeys.getDevice(delegatePubkey)
    if (device) {
      // Found on relay - sync to local storage
      await deviceManager.setApplicationKeys(remoteApplicationKeys)
      log("Device found on relay, synced to local storage:", delegatePubkey.slice(0, 8))
      return true
    }

    return false
  } catch {
    return false
  }
}

/**
 * Register the current device in the ApplicationKeys.
 * This creates a new ApplicationKeys with this device as authority.
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
 * Add the current device to an existing ApplicationKeys.
 * This preserves existing devices and adds this device to the list.
 * Use this when joining an existing device setup.
 */
export const addDeviceToExistingList = async (
  remoteApplicationKeys: ApplicationKeys
): Promise<void> => {
  const deviceManager = await getDeviceManager()
  const delegateManager = await getDelegateManager()
  const delegatePubkey = delegateManager.getIdentityPublicKey()

  // Set the remote list as our local list (preserves existing devices)
  await deviceManager.setApplicationKeys(remoteApplicationKeys)

  // Add this device to the list
  deviceManager.addDevice({identityPubkey: delegatePubkey})
  await deviceManager.publish()
  log("Added device to existing list:", delegatePubkey.slice(0, 8))
}
