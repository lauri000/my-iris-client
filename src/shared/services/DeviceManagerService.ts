import {DeviceManager} from "nostr-double-ratchet"
import {LocalForageStorageAdapter} from "@/session/StorageAdapter"
import {useUserStore} from "@/stores/user"
import {ndk} from "@/utils/ndk"
import {hexToBytes} from "nostr-tools/utils"
import {
  createNostrPublish,
  createNostrSubscribe,
  waitForRelayConnection,
} from "./nostrHelpers"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

let deviceManagerInstance: DeviceManager | null = null
let initPromise: Promise<DeviceManager> | null = null

/**
 * Get the DeviceManager instance, initializing if needed.
 * DeviceManager is the authority for InviteList (which devices are authorized).
 */
export const getDeviceManager = async (): Promise<DeviceManager> => {
  if (deviceManagerInstance) return deviceManagerInstance

  if (initPromise) return initPromise

  initPromise = initializeDeviceManager()
  return initPromise
}

/**
 * Synchronous getter - returns the manager if initialized, otherwise throws.
 * Use getDeviceManager() for most use cases.
 */
export const getDeviceManagerSync = (): DeviceManager => {
  if (!deviceManagerInstance) {
    throw new Error("DeviceManager not yet initialized. Use getDeviceManager() instead.")
  }
  return deviceManagerInstance
}

const initializeDeviceManager = async (): Promise<DeviceManager> => {
  const {publicKey, privateKey} = useUserStore.getState()

  if (!publicKey) {
    throw new Error("No public key available")
  }

  const ndkInstance = ndk()
  await waitForRelayConnection(ndkInstance)

  // DeviceManager needs identityKey for signing InviteList
  // For NIP-07, the signing happens via NDK's signer in nostrPublish
  if (privateKey) {
    deviceManagerInstance = new DeviceManager({
      ownerPublicKey: publicKey,
      identityKey: hexToBytes(privateKey),
      nostrSubscribe: createNostrSubscribe(ndkInstance),
      nostrPublish: createNostrPublish(ndkInstance),
      storage: new LocalForageStorageAdapter(),
    })
  } else {
    // NIP-07 login - signing happens via NDK signer
    // Pass a dummy key since actual signing is done by nostrPublish
    deviceManagerInstance = new DeviceManager({
      ownerPublicKey: publicKey,
      identityKey: new Uint8Array(32), // Placeholder - signing via NDK
      nostrSubscribe: createNostrSubscribe(ndkInstance),
      nostrPublish: createNostrPublish(ndkInstance),
      storage: new LocalForageStorageAdapter(),
    })
  }

  await deviceManagerInstance.init()
  log("DeviceManager initialized for:", publicKey.slice(0, 8))

  return deviceManagerInstance
}

/**
 * Reset the DeviceManager instance (for logout/account switch).
 */
export const resetDeviceManager = (): void => {
  if (deviceManagerInstance) {
    deviceManagerInstance.close()
    deviceManagerInstance = null
  }
  initPromise = null
}

/**
 * Revoke the current device from the InviteList.
 */
export const revokeCurrentDevice = async (): Promise<void> => {
  const {publicKey} = useUserStore.getState()
  if (!publicKey) return

  const {getDelegateManager} = await import("./DelegateManagerService")

  const deviceManager = await getDeviceManager()
  const delegateManager = await getDelegateManager()
  const identityPubkey = delegateManager.getIdentityPublicKey()

  await deviceManager.revokeDevice(identityPubkey)
}

/**
 * Publishes a tombstone event to nullify a device's chat invite.
 * Makes the invite invisible to other devices.
 * @param identityPubkey - The device's identity pubkey (used as device identifier)
 */
export const deleteDeviceInvite = async (identityPubkey: string): Promise<void> => {
  const {publicKey} = useUserStore.getState()
  const ndkInstance = ndk()

  // Publish tombstone event - same kind and d tag, empty content
  const dTag = `double-ratchet/invites/${identityPubkey}`

  const {NDKEvent} = await import("@/lib/ndk")
  const deletionEvent = new NDKEvent(ndkInstance, {
    kind: 30078, // INVITE_EVENT_KIND
    pubkey: publicKey,
    content: "",
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", dTag]],
  })

  await deletionEvent.sign()
  await deletionEvent.publish()

  log("Published invite tombstone for device:", identityPubkey.slice(0, 8))

  // Delete invite from our local persistence to prevent republishing
  const storage = new LocalForageStorageAdapter()
  await storage.del(`v3/device-manager/invite`)
}

/**
 * Deletes the current device's invite (convenience wrapper).
 */
export const deleteCurrentDeviceInvite = async (): Promise<void> => {
  try {
    const {getDelegateManager} = await import("./DelegateManagerService")
    const delegateManager = await getDelegateManager()
    const identityPubkey = delegateManager.getIdentityPublicKey()
    await deleteDeviceInvite(identityPubkey)
  } catch {
    log("No delegate manager, skipping invite tombstone")
  }
}
