import {SessionManager} from "nostr-double-ratchet"
import {useUserStore} from "@/stores/user"
import {useDelegateDeviceStore} from "@/stores/delegateDevice"
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
 * Initialize SessionManager for a delegate device (QR code paired).
 * Handles activation (waiting if needed) and creates SessionManager.
 */
const initializeForDelegateDevice = async (): Promise<SessionManager> => {
  const credentials = useDelegateDeviceStore.getState().credentials
  if (!credentials) {
    throw new Error("No delegate device credentials")
  }

  const delegateManager = await getDelegateManager()

  // Activate - either immediately if we know owner, or wait for activation
  if (credentials.ownerPublicKey) {
    // Already activated - just activate the manager
    await delegateManager.activate(credentials.ownerPublicKey)
    log("Delegate device activated for owner:", credentials.ownerPublicKey.slice(0, 8))
  } else {
    // Need to wait for activation from owner
    log("Waiting for delegate device activation...")
    const ownerKey = await delegateManager.waitForActivation(60000)
    useDelegateDeviceStore.getState().setOwnerPublicKey(ownerKey)
    useDelegateDeviceStore.getState().setActivated(true)
    log("Delegate device activated by owner:", ownerKey.slice(0, 8))
  }

  // Create SessionManager from DelegateManager
  sessionManagerInstance = delegateManager.createSessionManager()
  await sessionManagerInstance.init()

  const ownerKey = credentials.ownerPublicKey || delegateManager.getOwnerPublicKey()
  log("SessionManager initialized for delegate device, owner:", ownerKey?.slice(0, 8))
  return sessionManagerInstance
}

/**
 * Initialize SessionManager for a main device (nsec login).
 * Checks ApplicationKeys registration and activates directly.
 */
const initializeForMainDevice = async (): Promise<SessionManager> => {
  const {publicKey} = useUserStore.getState()

  if (!publicKey) {
    throw new Error("No public key available")
  }

  // Initialize DeviceManager and DelegateManager in parallel
  // DeviceManager = ApplicationKeys authority, DelegateManager = device identity
  const [deviceManager, delegateManager] = await Promise.all([
    getDeviceManager(),
    getDelegateManager(),
  ])

  // Check if this device is registered in the ApplicationKeys
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

  // Activate directly - we know we're the owner, no need to fetch from relay
  await delegateManager.activate(publicKey)

  // Create SessionManager from DelegateManager
  sessionManagerInstance = delegateManager.createSessionManager()
  await sessionManagerInstance.init()

  log("SessionManager initialized for main device:", publicKey.slice(0, 8))
  return sessionManagerInstance
}

/**
 * Initialize all managers and create SessionManager.
 * Handles both main devices (nsec login) and delegate devices (QR paired).
 */
const initializeSessionManager = async (): Promise<SessionManager> => {
  // Check if this is a delegate device (QR code paired)
  const credentials = useDelegateDeviceStore.getState().credentials

  if (credentials) {
    return initializeForDelegateDevice()
  }

  return initializeForMainDevice()
}

/**
 * Reset the SessionManager instance (for logout/account switch).
 */
export const resetSessionManager = (): void => {
  sessionManagerInstance = null
  initPromise = null
}
