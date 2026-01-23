import {VerifiedEvent, finalizeEvent} from "nostr-tools"
import {LocalForageStorageAdapter} from "../../session/StorageAdapter"
import {
  NostrPublish,
  NostrSubscribe,
  SessionManager,
  DeviceManager,
  DelegateManager,
} from "nostr-double-ratchet/src"
import NDK, {NDKEvent, NDKFilter} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {useUserStore} from "../../stores/user"
import {hexToBytes, bytesToHex} from "nostr-tools/utils"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

// Storage keys for delegate identity (main device uses same flow as delegate devices)
const DELEGATE_PUBKEY_KEY = "main-device-delegate-pubkey"
const DELEGATE_PRIVKEY_KEY = "main-device-delegate-privkey"

/**
 * Wait for at least one relay to be connected before proceeding.
 * Polls every 100ms for up to 10 seconds.
 */
const waitForRelayConnection = async (
  ndkInstance: NDK,
  timeoutMs = 10000
): Promise<void> => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const connectedRelays = ndkInstance.pool.connectedRelays()
    if (connectedRelays.length > 0) {
      log("Relay connected, proceeding with initialization")
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  log("Warning: No relays connected after timeout, proceeding anyway")
}

const createSubscribe = (ndk: NDK): NostrSubscribe => {
  return (filter: NDKFilter, onEvent: (event: VerifiedEvent) => void) => {
    const subscription = ndk.subscribe(filter)

    subscription.on("event", (event: NDKEvent) => {
      onEvent(event as unknown as VerifiedEvent)
    })

    subscription.start()

    return () => {
      subscription.stop()
    }
  }
}

// NDK-compatible publish function - TODO: remove "as" by handling nostr-tools version mismatch between lib and app
const createPublish = (ndk: NDK): NostrPublish => {
  return (async (event) => {
    const e = new NDKEvent(ndk, event)
    await e.publish()
    return event
  }) as NostrPublish
}

let deviceManagerInstance: DeviceManager | null = null
let delegateManagerInstance: DelegateManager | null = null
let sessionManagerInstance: SessionManager | null = null
let initPromise: Promise<void> | null = null

// Storage instance for delegate identity persistence
const delegateStorage = new LocalForageStorageAdapter()

/**
 * Get or create the DeviceManager (InviteList authority).
 * Uses main key only for signing InviteList events.
 */
export const getDeviceManager = (): DeviceManager => {
  if (deviceManagerInstance) return deviceManagerInstance

  const {publicKey, privateKey} = useUserStore.getState()
  const ndkInstance = ndk()

  // DeviceManager needs identityKey for signing InviteList
  // For NIP-07, the signing happens via NDK's signer in nostrPublish
  if (privateKey) {
    deviceManagerInstance = new DeviceManager({
      ownerPublicKey: publicKey,
      identityKey: hexToBytes(privateKey),
      nostrSubscribe: createSubscribe(ndkInstance),
      nostrPublish: createPublish(ndkInstance),
      storage: new LocalForageStorageAdapter(),
    })
  } else {
    // NIP-07 login - signing happens via NDK signer
    // Pass a dummy key since actual signing is done by nostrPublish
    deviceManagerInstance = new DeviceManager({
      ownerPublicKey: publicKey,
      identityKey: new Uint8Array(32), // Placeholder - signing via NDK
      nostrSubscribe: createSubscribe(ndkInstance),
      nostrPublish: createPublish(ndkInstance),
      storage: new LocalForageStorageAdapter(),
    })
  }

  return deviceManagerInstance
}

/**
 * Get or create the DelegateManager (device identity).
 * All devices including main use this for their device identity.
 */
export const getDelegateManager = async (): Promise<DelegateManager> => {
  if (delegateManagerInstance) return delegateManagerInstance

  const ndkInstance = ndk()

  // Check if we have stored delegate keys
  const storedPubkey = await delegateStorage.get<string>(DELEGATE_PUBKEY_KEY)
  const storedPrivkey = await delegateStorage.get<string>(DELEGATE_PRIVKEY_KEY)

  if (storedPubkey && storedPrivkey) {
    // Restore existing delegate identity
    const devicePrivateKey = hexToBytes(storedPrivkey)

    // Create publish function that signs with delegate key
    const delegatePublish: NostrPublish = (async (event) => {
      if (!("sig" in event) || !event.sig) {
        const signedEvent = finalizeEvent(event, devicePrivateKey)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = new NDKEvent(ndkInstance, signedEvent as any)
        await e.publish()
        return signedEvent
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = new NDKEvent(ndkInstance, event as any)
      await e.publish()
      return event
    }) as NostrPublish

    delegateManagerInstance = DelegateManager.restore({
      devicePublicKey: storedPubkey,
      devicePrivateKey,
      nostrSubscribe: createSubscribe(ndkInstance),
      nostrPublish: delegatePublish,
      storage: new LocalForageStorageAdapter(),
    })

    log("Restored delegate identity:", storedPubkey.slice(0, 8))
  } else {
    // Create new delegate identity
    const {manager, payload} = DelegateManager.create({
      nostrSubscribe: createSubscribe(ndkInstance),
      nostrPublish: createPublish(ndkInstance), // Temporary - will update after getting key
      storage: new LocalForageStorageAdapter(),
    })

    // Get the private key and create proper publish function
    const devicePrivateKey = manager.getIdentityKey()
    const devicePublicKey = manager.getIdentityPublicKey()

    // Store keys for future sessions
    await delegateStorage.put(DELEGATE_PUBKEY_KEY, devicePublicKey)
    await delegateStorage.put(DELEGATE_PRIVKEY_KEY, bytesToHex(devicePrivateKey))

    // Create publish function that signs with delegate key
    const delegatePublish: NostrPublish = (async (event) => {
      if (!("sig" in event) || !event.sig) {
        const signedEvent = finalizeEvent(event, devicePrivateKey)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = new NDKEvent(ndkInstance, signedEvent as any)
        await e.publish()
        return signedEvent
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = new NDKEvent(ndkInstance, event as any)
      await e.publish()
      return event
    }) as NostrPublish

    // Create new manager with proper publish function
    delegateManagerInstance = DelegateManager.restore({
      devicePublicKey,
      devicePrivateKey,
      nostrSubscribe: createSubscribe(ndkInstance),
      nostrPublish: delegatePublish,
      storage: new LocalForageStorageAdapter(),
    })

    log("Created new delegate identity:", payload.identityPubkey.slice(0, 8))
  }

  return delegateManagerInstance
}

/**
 * Initialize DeviceManager + DelegateManager and create SessionManager.
 * Uses the same flow as delegate devices:
 * 1. DeviceManager handles InviteList (authority)
 * 2. DelegateManager handles device identity (same as any device)
 * 3. Add device to InviteList
 * 4. Wait for activation
 * 5. Create SessionManager from DelegateManager
 */
const initializeManagers = async (): Promise<void> => {
  if (sessionManagerInstance) return

  // Wait for at least one relay to be connected before initializing
  const ndkInstance = ndk()
  await waitForRelayConnection(ndkInstance)

  // 1. Initialize DeviceManager (InviteList authority)
  const deviceManager = getDeviceManager()
  await deviceManager.init()

  // 2. For main device, store owner pubkey BEFORE DelegateManager.init()
  // This makes waitForActivation() return immediately since init() will find it
  // (For delegate devices on other machines, they discover owner via subscription)
  const {publicKey} = useUserStore.getState()
  const ownerPubkeyKey = "v3/device-manager/owner-pubkey"
  const mainDelegateStorage = new LocalForageStorageAdapter()
  await mainDelegateStorage.put(ownerPubkeyKey, publicKey)

  // 3. Get or create DelegateManager (device identity)
  const delegateManager = await getDelegateManager()
  await delegateManager.init() // Will find owner pubkey in storage

  // 4. Check if this device is already in the InviteList
  const devices = deviceManager.getOwnDevices()
  const delegatePubkey = delegateManager.getIdentityPublicKey()
  const isDeviceInList = devices.some((d) => d.identityPubkey === delegatePubkey)

  if (!isDeviceInList) {
    // Add this device to InviteList (same as adding any delegate device)
    await deviceManager.addDevice({identityPubkey: delegatePubkey})
    log("Added main device to InviteList:", delegatePubkey.slice(0, 8))
  }

  // 5. Wait for activation (instant since owner pubkey already in storage)
  await delegateManager.waitForActivation(5000)

  // 6. Create SessionManager from DelegateManager
  sessionManagerInstance = delegateManager.createSessionManager()
  await sessionManagerInstance!.init()
}

/**
 * Get or create the SessionManager instance.
 * If called before initialization completes, waits for init.
 */
export const getSessionManagerAsync = async (): Promise<SessionManager> => {
  // Start initialization if not already started
  if (!initPromise) {
    initPromise = initializeManagers().catch((e) => {
      console.error("Failed to initialize managers:", e)
      initPromise = null // Allow retry on error
      throw e
    })
  }

  await initPromise

  if (!sessionManagerInstance) {
    throw new Error("SessionManager not initialized")
  }

  return sessionManagerInstance
}

/**
 * Synchronous getter - returns the manager if initialized, otherwise throws.
 * Prefer getSessionManagerAsync() for most use cases.
 */
export const getSessionManager = (): SessionManager => {
  // Start initialization in background if not started
  if (!initPromise) {
    initPromise = initializeManagers().catch((e) => {
      console.error("Failed to initialize managers:", e)
      initPromise = null
    })
  }

  if (!sessionManagerInstance) {
    throw new Error(
      "SessionManager not yet initialized. Use getSessionManagerAsync() or ensure init has completed."
    )
  }

  return sessionManagerInstance
}

export const revokeCurrentDevice = async (): Promise<void> => {
  const {publicKey} = useUserStore.getState()
  if (!publicKey) return

  const deviceManager = getDeviceManager()
  await deviceManager.init()

  // Get our delegate identity pubkey (device identifier)
  const delegateManager = await getDelegateManager()
  const identityPubkey = delegateManager.getIdentityPublicKey()

  await deviceManager.revokeDevice(identityPubkey)
}

/**
 * Publishes a tombstone event to nullify a device's chat invite
 * Makes the invite invisible to other devices
 * @param identityPubkey - The device's identity pubkey (used as device identifier)
 */
export const deleteDeviceInvite = async (identityPubkey: string) => {
  const {publicKey} = useUserStore.getState()

  // Publish tombstone event - same kind and d tag, empty content
  // identityPubkey is now used as the device identifier in invite d-tags
  const dTag = `double-ratchet/invites/${identityPubkey}`

  const {NDKEvent} = await import("@/lib/ndk")
  const deletionEvent = new NDKEvent(ndk(), {
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
  const {LocalForageStorageAdapter} = await import("../../session/StorageAdapter")
  const storage = new LocalForageStorageAdapter()
  await storage.del(`v3/device-manager/invite`) // New storage key format
}

/**
 * Deletes the current device's invite (convenience wrapper)
 */
export const deleteCurrentDeviceInvite = async () => {
  try {
    const delegateManager = await getDelegateManager()
    const identityPubkey = delegateManager.getIdentityPublicKey()
    await deleteDeviceInvite(identityPubkey)
  } catch {
    log("No delegate manager, skipping invite tombstone")
  }
}
