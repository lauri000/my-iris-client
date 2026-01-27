import {VerifiedEvent, finalizeEvent} from "nostr-tools"
import {LocalForageStorageAdapter} from "../../session/StorageAdapter"
import {
  NostrPublish,
  NostrSubscribe,
  DelegateManager,
  SessionManager,
  InviteList,
  Invite,
  INVITE_LIST_EVENT_KIND,
  Rumor,
} from "nostr-double-ratchet"
import NDK, {NDKEvent, NDKFilter} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {
  useDelegateDeviceStore,
  getDevicePrivateKeyBytes,
  DelegateDeviceCredentials,
} from "@/stores/delegateDevice"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {getTag} from "@/utils/tagUtils"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

let unsubscribeEvents: (() => void) | null = null

/**
 * Attach event listener to handle incoming messages on delegate device.
 * Uses event.pubkey (actual sender) to determine the conversation party,
 * not the session pubkey which only tells us how the message was delivered.
 */
const attachDelegateEventListener = (
  sessionManager: SessionManager,
  ownerPublicKey: string
) => {
  unsubscribeEvents?.()
  const credentials = useDelegateDeviceStore.getState().credentials
  const delegatePubkey = credentials?.devicePublicKey

  log("[DelegateDevice] attachDelegateEventListener called", {
    deviceId: sessionManager.getDeviceId(),
    ownerPublicKey: ownerPublicKey?.slice(0, 8),
    delegatePubkey: delegatePubkey?.slice(0, 8),
  })

  unsubscribeEvents = sessionManager.onEvent((event: Rumor, sessionPubkey: string) => {
    log("[DelegateDevice] received event:", {
      eventPubkey: event.pubkey?.slice(0, 8),
      sessionPubkey: sessionPubkey?.slice(0, 8),
      ownerPublicKey: ownerPublicKey?.slice(0, 8),
      delegatePubkey: delegatePubkey?.slice(0, 8),
      content: event.content?.slice(0, 20),
    })

    const pTag = getTag("p", event.tags)
    if (!pTag) return

    // Check if message is from us:
    // 1. event.pubkey matches owner or this delegate device's pubkey (direct match)
    // 2. sessionPubkey matches owner pubkey (self-sync session - message from sibling device)
    const isFromUs =
      event.pubkey === ownerPublicKey ||
      (delegatePubkey && event.pubkey === delegatePubkey) ||
      sessionPubkey === ownerPublicKey

    // Calculate chatId using the resolved owner pubkey from SessionManager
    // sessionPubkey is already resolved to owner pubkey (not device identity)
    // - If we sent it: chatId = recipient (pTag)
    // - If we received it: chatId = sender's owner pubkey (sessionPubkey)
    const chatId = isFromUs ? pTag : sessionPubkey

    if (!chatId) return

    log("[DelegateDevice] DM identity resolution:", {
      chatId: chatId?.slice(0, 8),
      isFromUs,
      eventPubkey: event.pubkey?.slice(0, 8),
      sessionPubkey: sessionPubkey?.slice(0, 8),
      pTag: pTag?.slice(0, 8),
    })

    // Normalize pubkey for messages from us so they display on correct side
    const normalizedEvent = isFromUs ? {...event, pubkey: ownerPublicKey} : event
    void usePrivateMessagesStore
      .getState()
      .upsert(chatId, ownerPublicKey, normalizedEvent)
    log("[DelegateDevice] upsert called for chat:", chatId?.slice(0, 8))
  })
}

const createSubscribe = (ndkInstance: NDK): NostrSubscribe => {
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
let sessionManager: SessionManager | null = null

/**
 * Get or create the DelegateManager for delegate device operation
 */
export const getDelegateDeviceManager = (): DelegateManager | null => {
  if (delegateManager) return delegateManager

  const credentials = useDelegateDeviceStore.getState().credentials
  if (!credentials) {
    log("No delegate device credentials found")
    return null
  }

  delegateManager = createDelegateDeviceManager(credentials)
  return delegateManager
}

/**
 * Get or create the SessionManager for delegate device operation
 */
export const getDelegateSessionManager = (): SessionManager | null => {
  if (sessionManager) {
    log("[DelegateDevice] getDelegateSessionManager returning existing", {
      deviceId: sessionManager.getDeviceId(),
    })
    return sessionManager
  }

  const dm = getDelegateDeviceManager()
  if (!dm) return null

  const credentials = useDelegateDeviceStore.getState().credentials
  if (!credentials) return null
  if (!credentials.ownerPublicKey) return null // Must be activated first

  log("[DelegateDevice] getDelegateSessionManager creating new SessionManager", {
    devicePublicKey: credentials.devicePublicKey?.slice(0, 8),
    ownerPublicKey: credentials.ownerPublicKey?.slice(0, 8),
  })

  // Use DeviceManager to create properly configured SessionManager
  // This gets ephemeral keys from the stored Invite
  sessionManager = dm.createSessionManager(new LocalForageStorageAdapter())

  return sessionManager
}

/**
 * Create a DelegateManager from credentials
 */
export const createDelegateDeviceManager = (
  credentials: DelegateDeviceCredentials
): DelegateManager => {
  const ndkInstance = ndk()
  const devicePrivateKey = getDevicePrivateKeyBytes(credentials)

  // Create a publish function that can sign events with the delegate's key
  const delegatePublish: NostrPublish = (async (event) => {
    // Sign unsigned events (like Invite)
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

  return DelegateManager.restore({
    devicePublicKey: credentials.devicePublicKey,
    devicePrivateKey,
    nostrSubscribe: createSubscribe(ndkInstance),
    nostrPublish: delegatePublish,
    storage: new LocalForageStorageAdapter(),
  })
}

/**
 * Initialize the delegate device and wait for activation
 * Returns the owner's public key once activated
 */
export const initializeDelegateDevice = async (timeoutMs = 60000): Promise<string> => {
  const dm = getDelegateDeviceManager()
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

    // Initialize and attach session manager
    const sm = getDelegateSessionManager()
    if (sm) {
      await sm.init()
      attachDelegateEventListener(sm, ownerKey)
    }
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

  // Initialize and attach session manager for incoming messages
  const sm = getDelegateSessionManager()
  if (sm) {
    await sm.init()
    attachDelegateEventListener(sm, activatedOwnerKey)
  }

  return activatedOwnerKey
}

/**
 * Resume a previously activated delegate device.
 * This is a lighter initialization than initializeDelegateDevice() -
 * it only initializes the SessionManager and attaches event listeners,
 * without re-initializing the DeviceManager or waiting for activation.
 */
export const resumeDelegateDevice = async (ownerPublicKey: string): Promise<void> => {
  const sm = getDelegateSessionManager()
  if (!sm) {
    throw new Error("No delegate session manager")
  }

  await sm.init()
  attachDelegateEventListener(sm, ownerPublicKey)
  log("Delegate device resumed for owner:", ownerPublicKey)
}

/**
 * Check if the delegate device has been revoked
 */
export const checkDelegateDeviceRevoked = async (): Promise<boolean> => {
  const dm = getDelegateDeviceManager()
  if (!dm) return false

  return dm.isRevoked()
}

/**
 * Clean up the delegate device manager
 */
export const closeDelegateDevice = () => {
  if (delegateManager) {
    delegateManager.close()
    delegateManager = null
  }
  if (sessionManager) {
    sessionManager.close()
    sessionManager = null
  }
}

/**
 * Clear all delegate device data and reset
 */
export const resetDelegateDevice = () => {
  closeDelegateDevice()
  useDelegateDeviceStore.getState().clear()
}

/**
 * Send a message from the delegate device.
 * If no session exists, will attempt to initiate one first.
 * Also syncs the message to the owner's other devices.
 */
export const sendDelegateMessage = async (
  recipientPublicKey: string,
  content: string
) => {
  const sm = getDelegateSessionManager()
  if (!sm) {
    throw new Error("Delegate device not initialized")
  }

  const credentials = useDelegateDeviceStore.getState().credentials
  const ownerPublicKey = credentials?.ownerPublicKey
  if (!ownerPublicKey) {
    throw new Error("Delegate device not activated (no owner public key)")
  }

  // First try to send with existing session
  let rumor = await sm.sendMessage(recipientPublicKey, content)

  if (!rumor) {
    // No session - try to initiate one
    log("No session with recipient, attempting to initiate...")
    const initiated = await initiateSessionFromDelegate(recipientPublicKey)

    if (!initiated) {
      throw new Error("Could not establish session with recipient")
    }

    // Wait a moment for session to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Try sending again
    rumor = await sm.sendMessage(recipientPublicKey, content)

    if (!rumor) {
      throw new Error("Session initiated but message still failed to send")
    }
  }

  log("Delegate device sent message to:", recipientPublicKey)

  // Sync to owner's other devices (if recipient isn't the owner)
  // This ensures the owner's main device sees messages sent from the delegate
  // Use normalized pubkey (owner's) so all devices recognize it as "ours"
  if (recipientPublicKey !== ownerPublicKey) {
    log("Syncing message to owner's devices...")
    const normalizedRumor = {...rumor, pubkey: ownerPublicKey}
    sm.sendEvent(ownerPublicKey, normalizedRumor).catch((err) => {
      log("Failed to sync to owner devices:", err)
    })
  }

  return rumor
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
  const nostrSubscribe = createSubscribe(ndkInstance)
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

    const unsubscribe = nostrSubscribe(
      {
        kinds: [INVITE_LIST_EVENT_KIND],
        authors: [recipientPublicKey],
        "#d": ["double-ratchet/invite-list"],
        limit: 1,
      },
      (event: VerifiedEvent) => {
        if (resolved) return
        try {
          const list = InviteList.fromEvent(event)
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
          nostrSubscribe,
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
        nostrSubscribe,
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
