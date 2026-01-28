import {VerifiedEvent} from "nostr-tools"
import {LocalForageStorageAdapter} from "../../session/StorageAdapter"
import {
  NostrPublish,
  NostrSubscribe,
  DelegateManager,
  InviteList,
  Invite,
  INVITE_LIST_EVENT_KIND,
} from "nostr-double-ratchet"
import NDK, {NDKEvent, NDKFilter} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {
  useDelegateDeviceStore,
  getDevicePrivateKeyBytes,
  DelegateDeviceCredentials,
} from "@/stores/delegateDevice"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {createNostrSubscribe, createDeferredSigningPublish} from "./nostrHelpers"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

const createLocalSubscribe = (ndkInstance: NDK) => {
  return (filter: NDKFilter, onEvent: (event: VerifiedEvent) => void) => {
    const subscription = ndkInstance.subscribe(filter)

    subscription.on("event", (event: NDKEvent) => {
      onEvent(event as unknown as VerifiedEvent)
    })

    subscription.start()

    return () => {
      subscription.stop()
    }
  }
}

const createPublish = (ndkInstance: NDK): NostrPublish => {
  return (async (event) => {
    const e = new NDKEvent(ndkInstance, event)
    await e.publish()
    return event
  }) as NostrPublish
}

let delegateManager: DelegateManager | null = null
let initPromise: Promise<DelegateManager | null> | null = null

/**
 * Get or create the DelegateManager for delegate device operation.
 * Note: For messaging, use getSessionManager() from SessionManagerService instead.
 * This is kept for initialization and revocation checks.
 */
export const getDelegateDeviceManager = async (): Promise<DelegateManager | null> => {
  if (delegateManager) return delegateManager

  if (initPromise) return initPromise

  const credentials = useDelegateDeviceStore.getState().credentials
  if (!credentials) {
    log("No delegate device credentials found")
    return null
  }

  initPromise = createDelegateDeviceManager(credentials).then((manager) => {
    delegateManager = manager
    return manager
  })
  return initPromise
}

/**
 * Create a DelegateManager from credentials.
 * Pre-populates storage with credentials so init() loads them.
 */
export const createDelegateDeviceManager = async (
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

  const manager = new DelegateManager({
    nostrSubscribe: createNostrSubscribe(ndkInstance),
    nostrPublish: delegatePublish,
    storage,
  })
  managerHolder.manager = manager

  return manager
}

/**
 * Initialize the delegate device and wait for activation.
 * Returns the owner's public key once activated.
 *
 * Note: This is used during the initial pairing flow. After activation,
 * use getSessionManager() from SessionManagerService and attachSessionEventListener()
 * from dmEventHandler for message handling.
 */
export const initializeDelegateDevice = async (timeoutMs = 60000): Promise<string> => {
  const dm = await getDelegateDeviceManager()
  if (!dm) {
    throw new Error("No delegate device credentials")
  }

  await dm.init()

  // Check if already activated (owner key stored)
  const ownerKey = dm.getOwnerPublicKey()
  if (ownerKey) {
    log("Delegate device already activated, owner:", ownerKey)
    useDelegateDeviceStore.getState().setOwnerPublicKey(ownerKey)
    useDelegateDeviceStore.getState().setActivated(true)
    return ownerKey
  }

  // Give NDK time to connect to relays
  log("Waiting for relay connections...")
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Wait for activation with timeout
  log("Waiting for delegate device activation...")
  const activatedOwnerKey = await dm.waitForActivation(timeoutMs)
  log("Delegate device activated by:", activatedOwnerKey)

  useDelegateDeviceStore.getState().setOwnerPublicKey(activatedOwnerKey)
  useDelegateDeviceStore.getState().setActivated(true)

  return activatedOwnerKey
}

/**
 * Check if the delegate device has been revoked
 */
export const checkDelegateDeviceRevoked = async (): Promise<boolean> => {
  const dm = await getDelegateDeviceManager()
  if (!dm) return false

  return dm.isRevoked()
}

/**
 * Clean up the delegate device manager.
 * Note: SessionManager cleanup is handled by resetSessionManager() in SessionManagerService.
 */
export const closeDelegateDevice = () => {
  if (delegateManager) {
    delegateManager.close()
    delegateManager = null
  }
  initPromise = null
}

/**
 * Clear all delegate device data and reset
 */
export const resetDelegateDevice = () => {
  closeDelegateDevice()
  useDelegateDeviceStore.getState().clear()
}

/**
 * Check if we're running as a delegate device
 */
export const isDelegateDevice = (): boolean => {
  const credentials = useDelegateDeviceStore.getState().credentials
  return credentials !== null
}

/**
 * Initiate a session with a recipient from the delegate device.
 * Uses two-step discovery: InviteList -> Invite events -> accept
 */
export const initiateSessionFromDelegate = async (
  recipientPublicKey: string
): Promise<boolean> => {
  const credentials = useDelegateDeviceStore.getState().credentials
  if (!credentials) {
    throw new Error("No delegate device credentials")
  }

  const ndkInstance = ndk()
  // Use local subscribe for our own event handling
  const localSubscribe = createLocalSubscribe(ndkInstance)
  // Use library-typed subscribe for library functions (cast as unknown to bypass type incompatibility)
  const librarySubscribe = createNostrSubscribe(ndkInstance) as unknown as NostrSubscribe
  const nostrPublish = createPublish(ndkInstance)

  log("Initiating session with:", recipientPublicKey)

  // Step 1: Fetch recipient's InviteList to get device identities
  const inviteList = await new Promise<InviteList | null>((resolve) => {
    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        unsubscribe()
        resolve(null)
      }
    }, 10000)

    const unsubscribe = localSubscribe(
      {
        kinds: [INVITE_LIST_EVENT_KIND],
        authors: [recipientPublicKey],
        "#d": ["double-ratchet/invite-list"],
        limit: 1,
      },
      (event: VerifiedEvent) => {
        if (resolved) return
        try {
          // Cast event for library function compatibility
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const list = InviteList.fromEvent(event as any)
          resolved = true
          clearTimeout(timeout)
          unsubscribe()
          resolve(list)
        } catch {
          // Invalid event, ignore
        }
      }
    )
  })

  if (!inviteList) {
    log("No InviteList found for recipient:", recipientPublicKey)
    return false
  }

  const devices = inviteList.getAllDevices()
  if (devices.length === 0) {
    log("Recipient has no devices in InviteList")
    return false
  }

  log("Found", devices.length, "devices for recipient")

  // Step 2: For each device, fetch their Invite event and accept it
  let sessionsCreated = 0
  for (const device of devices) {
    try {
      // Fetch the device's Invite event
      // In the new architecture, identityPubkey serves as both device identifier and deviceId
      const invite = await new Promise<Invite | null>((resolve) => {
        let resolved = false
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true
            unsubscribe()
            resolve(null)
          }
        }, 5000)

        const unsubscribe = Invite.fromUser(
          device.identityPubkey,
          librarySubscribe,
          (inv: Invite) => {
            // Accept invite matching this device's identity pubkey
            if (inv.deviceId === device.identityPubkey) {
              if (!resolved) {
                resolved = true
                clearTimeout(timeout)
                unsubscribe()
                resolve(inv)
              }
            }
          }
        )
      })

      if (!invite) {
        log("No Invite found for device:", device.identityPubkey.slice(0, 8))
        continue
      }

      // Accept the invite to establish session
      // inviteePublicKey serves as both identity and device ID
      const {event} = await invite.accept(
        librarySubscribe,
        credentials.devicePublicKey, // Our public key (also serves as device ID)
        getDevicePrivateKeyBytes(credentials), // Our private key for encryption
        credentials.ownerPublicKey! // Our owner's pubkey (for chat routing)
      )

      // Publish the invite response
      await nostrPublish(event)
      log("Published invite response to device:", device.identityPubkey.slice(0, 8))

      // The session is now active - SessionManager should pick it up via invite response listener
      sessionsCreated++
    } catch (err) {
      log("Failed to accept invite from device:", device.identityPubkey.slice(0, 8), err)
    }
  }

  log("Created", sessionsCreated, "sessions with recipient")
  return sessionsCreated > 0
}
