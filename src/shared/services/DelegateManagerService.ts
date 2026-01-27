import {DelegateManager} from "nostr-double-ratchet"
import {LocalForageStorageAdapter} from "@/session/StorageAdapter"
import {ndk} from "@/utils/ndk"
import {hexToBytes, bytesToHex} from "nostr-tools/utils"
import {createNostrSubscribe, createSigningPublish} from "./nostrHelpers"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

// Storage keys for delegate identity (main device uses same flow as delegate devices)
const DELEGATE_PUBKEY_KEY = "main-device-delegate-pubkey"
const DELEGATE_PRIVKEY_KEY = "main-device-delegate-privkey"

let delegateManagerInstance: DelegateManager | null = null
let initPromise: Promise<DelegateManager> | null = null

// Storage instance for delegate identity persistence
const delegateStorage = new LocalForageStorageAdapter()

/**
 * Get the DelegateManager instance, initializing if needed.
 * DelegateManager handles device identity - all devices including main use this.
 */
export const getDelegateManager = async (): Promise<DelegateManager> => {
  if (delegateManagerInstance) return delegateManagerInstance

  if (initPromise) return initPromise

  initPromise = initializeDelegateManager()
  return initPromise
}

/**
 * Synchronous getter - returns the manager if initialized, otherwise throws.
 * Use getDelegateManager() for most use cases.
 */
export const getDelegateManagerSync = (): DelegateManager => {
  if (!delegateManagerInstance) {
    throw new Error(
      "DelegateManager not yet initialized. Use getDelegateManager() instead."
    )
  }
  return delegateManagerInstance
}

const initializeDelegateManager = async (): Promise<DelegateManager> => {
  const ndkInstance = ndk()
  // NDK handles queuing publishes/subscriptions until relays connect, no need to wait

  // Check if we have stored delegate keys (read in parallel)
  const [storedPubkey, storedPrivkey] = await Promise.all([
    delegateStorage.get<string>(DELEGATE_PUBKEY_KEY),
    delegateStorage.get<string>(DELEGATE_PRIVKEY_KEY),
  ])

  if (storedPubkey && storedPrivkey) {
    // Restore existing delegate identity
    const devicePrivateKey = hexToBytes(storedPrivkey)
    const delegatePublish = await createSigningPublish(ndkInstance, devicePrivateKey)

    delegateManagerInstance = DelegateManager.restore({
      devicePublicKey: storedPubkey,
      devicePrivateKey,
      nostrSubscribe: createNostrSubscribe(ndkInstance),
      nostrPublish: delegatePublish,
      storage: new LocalForageStorageAdapter(),
    })

    log("Restored delegate identity:", storedPubkey.slice(0, 8))
  } else {
    // Create new delegate identity
    const {manager, payload} = DelegateManager.create({
      nostrSubscribe: createNostrSubscribe(ndkInstance),
      nostrPublish: async () => {
        throw new Error("Temporary publish - should not be called")
      },
      storage: new LocalForageStorageAdapter(),
    })

    // Get the private key and create proper publish function
    const devicePrivateKey = manager.getIdentityKey()
    const devicePublicKey = manager.getIdentityPublicKey()

    // Store keys for future sessions
    await delegateStorage.put(DELEGATE_PUBKEY_KEY, devicePublicKey)
    await delegateStorage.put(DELEGATE_PRIVKEY_KEY, bytesToHex(devicePrivateKey))

    // Create publish function that signs with delegate key
    const delegatePublish = await createSigningPublish(ndkInstance, devicePrivateKey)

    // Create new manager with proper publish function
    delegateManagerInstance = DelegateManager.restore({
      devicePublicKey,
      devicePrivateKey,
      nostrSubscribe: createNostrSubscribe(ndkInstance),
      nostrPublish: delegatePublish,
      storage: new LocalForageStorageAdapter(),
    })

    log("Created new delegate identity:", payload.identityPubkey.slice(0, 8))
  }

  await delegateManagerInstance.init()
  return delegateManagerInstance
}

/**
 * Get the stored delegate identity keys if they exist.
 */
export const getStoredDelegateKeys = async (): Promise<{
  publicKey: string
  privateKey: Uint8Array
} | null> => {
  const storedPubkey = await delegateStorage.get<string>(DELEGATE_PUBKEY_KEY)
  const storedPrivkey = await delegateStorage.get<string>(DELEGATE_PRIVKEY_KEY)

  if (storedPubkey && storedPrivkey) {
    return {
      publicKey: storedPubkey,
      privateKey: hexToBytes(storedPrivkey),
    }
  }
  return null
}

/**
 * Reset the DelegateManager instance (for logout/account switch).
 */
export const resetDelegateManager = (): void => {
  if (delegateManagerInstance) {
    delegateManagerInstance.close()
    delegateManagerInstance = null
  }
  initPromise = null
}

/**
 * Clear stored delegate keys (for full logout).
 */
export const clearDelegateKeys = async (): Promise<void> => {
  await delegateStorage.del(DELEGATE_PUBKEY_KEY)
  await delegateStorage.del(DELEGATE_PRIVKEY_KEY)
  resetDelegateManager()
}
