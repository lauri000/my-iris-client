import {DelegateManager} from "nostr-double-ratchet"
import {LocalForageStorageAdapter} from "@/session/StorageAdapter"
import {ndk} from "@/utils/ndk"
import {createNostrSubscribe, createDeferredSigningPublish} from "./nostrHelpers"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {useDelegateDeviceStore, DelegateDeviceCredentials} from "@/stores/delegateDevice"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

let delegateManagerInstance: DelegateManager | null = null
let initPromise: Promise<DelegateManager> | null = null

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

/**
 * Restore DelegateManager from paired delegate device credentials.
 * Used when this is a delegate device that was paired via QR code.
 */
const restoreFromDelegateCredentials = async (
  credentials: DelegateDeviceCredentials
): Promise<DelegateManager> => {
  const ndkInstance = ndk()
  const storage = new LocalForageStorageAdapter()

  // Pre-populate storage with credentials so init() loads them
  await storage.put("v1/device-manager/identity-public-key", credentials.devicePublicKey)
  await storage.put(
    "v1/device-manager/identity-private-key",
    Array.from(
      (await import("nostr-tools/utils")).hexToBytes(credentials.devicePrivateKey)
    )
  )

  // Holder pattern for signing key access during init
  const managerHolder: {manager: DelegateManager | null} = {manager: null}

  const delegatePublish = await createDeferredSigningPublish(
    ndkInstance,
    () => managerHolder.manager?.getIdentityKey() ?? null
  )

  delegateManagerInstance = new DelegateManager({
    nostrSubscribe: createNostrSubscribe(ndkInstance),
    nostrPublish: delegatePublish,
    storage,
  })
  managerHolder.manager = delegateManagerInstance

  log(
    "Restoring delegate identity from pairing credentials:",
    credentials.devicePublicKey.slice(0, 8)
  )
  await delegateManagerInstance.init()
  return delegateManagerInstance
}

/**
 * Create or restore DelegateManager from storage.
 * Used for main devices (nsec login).
 * Keys are automatically persisted to storage by the library.
 */
const createOrRestoreFromStorage = async (): Promise<DelegateManager> => {
  const ndkInstance = ndk()

  // Storage adapter handles key persistence automatically
  const storage = new LocalForageStorageAdapter()

  // Holder pattern for signing key access during init
  const managerHolder: {manager: DelegateManager | null} = {manager: null}

  const delegatePublish = await createDeferredSigningPublish(
    ndkInstance,
    () => managerHolder.manager?.getIdentityKey() ?? null
  )

  delegateManagerInstance = new DelegateManager({
    nostrSubscribe: createNostrSubscribe(ndkInstance),
    nostrPublish: delegatePublish,
    storage,
  })
  managerHolder.manager = delegateManagerInstance

  await delegateManagerInstance.init() // Auto-loads or generates keys

  log("Delegate identity:", delegateManagerInstance.getIdentityPublicKey().slice(0, 8))
  return delegateManagerInstance
}

const initializeDelegateManager = async (): Promise<DelegateManager> => {
  // Check if this is a paired delegate device (QR code flow)
  const delegateCredentials = useDelegateDeviceStore.getState().credentials

  if (delegateCredentials) {
    // Delegate device flow - restore from pairing credentials
    return restoreFromDelegateCredentials(delegateCredentials)
  }

  // Main device flow - create/restore from storage
  return createOrRestoreFromStorage()
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
 * Keys are managed by the library in storage, so just reset the manager.
 */
export const clearDelegateKeys = async (): Promise<void> => {
  // Clear the library's storage keys
  const storage = new LocalForageStorageAdapter()
  await storage.del("v1/device-manager/identity-public-key")
  await storage.del("v1/device-manager/identity-private-key")
  await storage.del("v1/device-manager/invite")
  await storage.del("v1/device-manager/owner-pubkey")
  resetDelegateManager()
}
