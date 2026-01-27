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

  // 1. Initialize DeviceManager and DelegateManager in parallel
  // DeviceManager = InviteList authority, DelegateManager = device identity
  const [deviceManager, delegateManager] = await Promise.all([
    getDeviceManager(),
    getDelegateManager(),
  ])

  // 2. Check if this device is registered in the InviteList
  const devices = deviceManager.getOwnDevices()
  const delegatePubkey = delegateManager.getIdentityPublicKey()
  const isDeviceInList = devices.some(
    (d: {identityPubkey: string}) => d.identityPubkey === delegatePubkey
  )

  if (!isDeviceInList) {
    // Device not registered - throw error instead of auto-registering
    // User must explicitly register via DevicesTab
    throw new Error(
      "Device not registered. Please register this device in Settings > Devices."
    )
  }

  // 3. Activate directly - we know we're the owner, no need to fetch from relay
  // (For delegate devices on other machines, they use waitForActivation() instead)
  await delegateManager.activate(publicKey)

  // 4. Create SessionManager from DelegateManager
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
