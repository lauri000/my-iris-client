import {VerifiedEvent} from "nostr-tools"
import {NostrPublish, NostrSubscribe} from "nostr-double-ratchet"
import NDK, {NDKEvent, NDKFilter} from "@/lib/ndk"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

/**
 * Wait for at least one relay to be connected before proceeding.
 * Polls every 100ms for up to 10 seconds.
 */
export const waitForRelayConnection = async (
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

/**
 * Create a NostrSubscribe function for the library using NDK.
 * Note: Uses cast to handle nostr-tools version mismatch between client and library.
 */
export const createNostrSubscribe = (ndkInstance: NDK): NostrSubscribe => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((filter: NDKFilter, onEvent: (event: any) => void) => {
    const subscription = ndkInstance.subscribe(filter)

    subscription.on("event", (event: NDKEvent) => {
      onEvent(event as unknown as VerifiedEvent)
    })

    subscription.start()

    return () => {
      subscription.stop()
    }
  }) as NostrSubscribe
}

/**
 * Create a NostrPublish function for the library using NDK.
 * Uses NDK's signer for event signing.
 */
export const createNostrPublish = (ndkInstance: NDK): NostrPublish => {
  return (async (event) => {
    const e = new NDKEvent(ndkInstance, event)
    await e.publish()
    return event
  }) as NostrPublish
}

/**
 * Create a NostrPublish function that signs with a specific private key.
 * Used for delegate devices that sign with their own identity key.
 */
export const createSigningPublish = async (
  ndkInstance: NDK,
  privateKey: Uint8Array
): Promise<NostrPublish> => {
  const {finalizeEvent} = await import("nostr-tools")

  return (async (event) => {
    if (!("sig" in event) || !event.sig) {
      const signedEvent = finalizeEvent(event, privateKey)
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
}

/**
 * Create a NostrPublish function that uses a deferred signing key.
 * The key getter is called at publish time, allowing the key to be set after init().
 * Used when the signing key isn't available until after DelegateManager.init().
 */
export const createDeferredSigningPublish = async (
  ndkInstance: NDK,
  getPrivateKey: () => Uint8Array | null
): Promise<NostrPublish> => {
  const {finalizeEvent} = await import("nostr-tools")

  return (async (event) => {
    if (!("sig" in event) || !event.sig) {
      const privateKey = getPrivateKey()
      if (!privateKey) {
        throw new Error("Signing key not available")
      }
      const signedEvent = finalizeEvent(event, privateKey)
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
}
