import {useState, useEffect, useRef} from "react"
import {RiFileCopyLine, RiCheckLine, RiRefreshLine} from "@remixicon/react"
import {
  initializeDelegateDevice,
  closeDelegateDevice,
} from "@/shared/services/DelegateDevice"
import {useDelegateDeviceStore, DelegateDeviceCredentials} from "@/stores/delegateDevice"
import {DelegateManager, DelegatePayload} from "nostr-double-ratchet"
import {LocalForageStorageAdapter} from "@/session/StorageAdapter"
import {bytesToHex} from "@noble/hashes/utils"
import {ndk} from "@/utils/ndk"
import {
  createNostrSubscribe,
  createDeferredSigningPublish,
} from "@/shared/services/nostrHelpers"

interface DelegateSetupProps {
  onActivated: () => void
}

type SetupStep = "generating" | "showCode" | "error"

/**
 * Create pairing code from stored credentials (identity info only)
 * Note: Ephemeral keys are no longer in the pairing code - they're published
 * separately in the device's Invite event
 */
function createPairingCodeFromCredentials(
  credentials: DelegateDeviceCredentials
): string {
  // New simplified payload - only identityPubkey needed
  const payload: DelegatePayload = {
    identityPubkey: credentials.devicePublicKey,
  }
  return btoa(JSON.stringify(payload))
}

export default function DelegateSetup({onActivated}: DelegateSetupProps) {
  const credentials = useDelegateDeviceStore((s) => s.credentials)
  const setCredentials = useDelegateDeviceStore((s) => s.setCredentials)

  // If credentials exist, restore pairing code and show it
  const [step, setStep] = useState<SetupStep>(() =>
    credentials ? "showCode" : "generating"
  )
  const [pairingCode, setPairingCode] = useState(() =>
    credentials ? createPairingCodeFromCredentials(credentials) : ""
  )
  const [deviceLabel, setDeviceLabel] = useState(() => credentials?.deviceLabel ?? "")
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")
  const [isWaiting, setIsWaiting] = useState(false)
  const activationStarted = useRef(false)

  // Start waiting for activation as soon as we have credentials and are showing code
  useEffect(() => {
    if (step !== "showCode" || !credentials || activationStarted.current) return

    activationStarted.current = true
    setIsWaiting(true)

    initializeDelegateDevice(120000) // 2 minute timeout
      .then(() => {
        onActivated()
      })
      .catch((err) => {
        console.error("Activation failed:", err)
        setError(err.message || "Activation timed out")
        setStep("error")
        setIsWaiting(false)
      })

    // NOTE: No cleanup on unmount - the SessionManager should persist after successful
    // activation. closeDelegateDevice() is only called explicitly on "Start Over".
  }, [step, credentials, onActivated])

  // Note: deviceLabel is no longer used in the protocol, but kept for local display
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const generatePairingCode = async (_label: string) => {
    const ndkInstance = ndk()

    // Use dedicated storage for this delegate device
    const storage = new LocalForageStorageAdapter()

    // Holder pattern for signing key access during init
    const managerHolder: {manager: DelegateManager | null} = {manager: null}

    const nostrSubscribe = createNostrSubscribe(ndkInstance)
    const nostrPublish = await createDeferredSigningPublish(
      ndkInstance,
      () => managerHolder.manager?.getIdentityKey() ?? null
    )

    // Create manager with new API - keys generated during init()
    const manager = new DelegateManager({
      nostrSubscribe,
      nostrPublish,
      storage,
    })
    managerHolder.manager = manager

    // Initialize the manager - this generates keys and publishes the Invite event
    await manager.init()

    // Get the registration payload after init
    const payload: DelegatePayload = manager.getRegistrationPayload()
    const devicePrivateKey = manager.getIdentityKey()

    // Get ephemeral keys from the Invite
    const invite = manager.getInvite()
    if (!invite || !invite.inviterEphemeralPrivateKey) {
      throw new Error("Invite not created properly")
    }

    // Store credentials locally (including private keys from Invite)
    // Note: deviceId/deviceLabel kept for backwards compatibility with local storage
    const newCredentials = {
      devicePublicKey: manager.getIdentityPublicKey(),
      devicePrivateKey: bytesToHex(devicePrivateKey),
      ephemeralPublicKey: invite.inviterEphemeralPublicKey,
      ephemeralPrivateKey: bytesToHex(invite.inviterEphemeralPrivateKey),
      sharedSecret: invite.sharedSecret,
      deviceId: manager.getIdentityPublicKey(), // Use identityPubkey as deviceId
      deviceLabel: manager.getIdentityPublicKey().slice(0, 8), // Short label from pubkey
    }
    setCredentials(newCredentials)

    // Create pairing code with identity info only (DelegatePayload)
    // Ephemeral keys are published separately in the Invite event
    const code = btoa(JSON.stringify(payload))
    setPairingCode(code)
    setStep("showCode")
  }

  const handleGenerate = async () => {
    if (!deviceLabel.trim()) {
      setError("Please enter a device name")
      return
    }
    setError("")
    try {
      await generatePairingCode(deviceLabel.trim())
    } catch (err) {
      console.error("Failed to generate pairing code:", err)
      setError(err instanceof Error ? err.message : "Failed to generate pairing code")
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pairingCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("Failed to copy to clipboard")
    }
  }

  const handleStartOver = () => {
    activationStarted.current = false
    closeDelegateDevice()
    useDelegateDeviceStore.getState().clear()
    setPairingCode("")
    setDeviceLabel("")
    setError("")
    setStep("generating")
  }

  if (step === "generating") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-base-200">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Setup Delegate Device</h2>
            <p className="text-base-content/70 text-sm">
              This device will generate a pairing code that you will enter on your main
              Iris app to authorize this delegate device for encrypted messaging.
            </p>

            <div className="form-control mt-4">
              <label className="label">
                <span className="label-text">Device Name</span>
              </label>
              <input
                type="text"
                className={`input input-bordered ${error ? "input-error" : ""}`}
                placeholder="e.g., Work laptop, Phone"
                value={deviceLabel}
                onChange={(e) => {
                  setDeviceLabel(e.target.value)
                  setError("")
                }}
              />
              {error && (
                <label className="label">
                  <span className="label-text-alt text-error">{error}</span>
                </label>
              )}
            </div>

            <div className="form-control mt-6">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!deviceLabel.trim()}
                onClick={handleGenerate}
              >
                Generate Pairing Code
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (step === "showCode") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-base-200">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Pairing Code Ready</h2>
            <p className="text-base-content/70 text-sm">
              Copy this code and paste it in the Iris app on your main device to authorize
              this delegate.
            </p>

            <div className="mt-4 relative">
              <textarea
                className="textarea textarea-bordered w-full h-24 font-mono text-xs"
                value={pairingCode}
                readOnly
              />
              <button
                className="btn btn-sm btn-ghost absolute top-2 right-2 gap-1"
                onClick={handleCopy}
              >
                {copied ? (
                  <>
                    <RiCheckLine size={14} />
                    Copied
                  </>
                ) : (
                  <>
                    <RiFileCopyLine size={14} />
                    Copy
                  </>
                )}
              </button>
            </div>

            <div className="alert alert-info mt-4">
              <span className="text-sm">
                This code only contains public information. Your private keys stay on this
                device.
              </span>
            </div>

            {isWaiting && (
              <div className="flex items-center gap-3 mt-4 p-3 bg-base-200 rounded-lg">
                <span className="loading loading-spinner loading-sm" />
                <span className="text-sm text-base-content/70">
                  Waiting for your main device to authorize...
                </span>
              </div>
            )}

            <div className="flex gap-2 mt-6">
              <button className="btn btn-ghost flex-1" onClick={handleStartOver}>
                <RiRefreshLine size={16} />
                Start Over
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // error state
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-base-200">
      <div className="card w-full max-w-md bg-base-100 shadow-xl">
        <div className="card-body text-center">
          <h2 className="card-title justify-center text-error">Error</h2>
          <p className="text-base-content/70">{error}</p>
          <button className="btn btn-primary mt-4" onClick={handleStartOver}>
            Start Over
          </button>
        </div>
      </div>
    </div>
  )
}
