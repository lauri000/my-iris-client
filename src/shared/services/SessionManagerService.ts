import {SessionManager} from "nostr-double-ratchet"
import {useUserStore} from "@/stores/user"
import {getDeviceManager} from "./DeviceManagerService"
import {getDelegateManager} from "./DelegateManagerService"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

let sessionManagerInstance: SessionManager | null = null
let initPromise: Promise<SessionManager> | null = null

/**
 * Get the SessionManager instance, initializing all managers if needed.
 * This orchestrates initialization of DeviceManager, DelegateManager, and SessionManager.
 */
export const getSessionManager = async (): Promise<SessionManager> => {
  if (sessionManagerInstance) return sessionManagerInstance

  if (initPromise) return initPromise

  initPromise = initializeSessionManager()
  return initPromise
}

/**
 * Synchronous getter - returns the manager if initialized, otherwise throws.
 * Use getSessionManager() for most use cases.
 */
export const getSessionManagerSync = (): SessionManager => {
  if (!sessionManagerInstance) {
    throw new Error(
      "SessionManager not yet initialized. Use getSessionManager() instead."
    )
  }
  return sessionManagerInstance
}

/**
 * Initialize all managers and create SessionManager.
 * Uses the same flow as delegate devices:
 * 1. DeviceManager handles InviteList (authority)
 * 2. DelegateManager handles device identity (same as any device)
 * 3. Add device to InviteList if not already there
 * 4. Activate the device
 * 5. Create SessionManager from DelegateManager
 */
const initializeSessionManager = async (): Promise<SessionManager> => {
  const {publicKey} = useUserStore.getState()

  if (!publicKey) {
    throw new Error("No public key available")
  }

  // 1. Initialize DeviceManager (InviteList authority)
  const deviceManager = await getDeviceManager()

  // 2. Initialize DelegateManager (device identity)
  const delegateManager = await getDelegateManager()

  // 3. Check if this device is already in the InviteList
  const devices = deviceManager.getOwnDevices()
  const delegatePubkey = delegateManager.getIdentityPublicKey()
  const isDeviceInList = devices.some(
    (d: {identityPubkey: string}) => d.identityPubkey === delegatePubkey
  )

  if (!isDeviceInList) {
    // Add this device to InviteList (same as adding any delegate device)
    await deviceManager.addDevice({identityPubkey: delegatePubkey})
    log("Added main device to InviteList:", delegatePubkey.slice(0, 8))
  }

  // 4. Activate directly - we know we're the owner, no need to fetch from relay
  // (For delegate devices on other machines, they use waitForActivation() instead)
  await delegateManager.activate(publicKey)

  // 5. Create SessionManager from DelegateManager
  sessionManagerInstance = delegateManager.createSessionManager()
  await sessionManagerInstance.init()

  log("SessionManager initialized for:", publicKey.slice(0, 8))
  return sessionManagerInstance
}

/**
 * Reset the SessionManager instance (for logout/account switch).
 */
export const resetSessionManager = (): void => {
  sessionManagerInstance = null
  initPromise = null
}
