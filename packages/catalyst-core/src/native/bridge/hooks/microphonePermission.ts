import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS, PERMISSION_STATUS } from "../constants/NativeInterfaces.js"

// The same wait the native shells apply to any bridge command (COMMAND_TIMEOUT_SECONDS / commandTimeout).
const NO_ANSWER_MS = 30_000

/**
 * Asks the native shell (Android or iOS) for microphone permission, so the page can record with getUserMedia({ audio }).
 *
 * Resolves "GRANTED" once the app holds it, and rejects when the user refuses. Resolves null when there is nothing to ask
 * or nobody answers: a plain browser (it prompts by itself), a page where WebBridge is not set up, or a shell built before
 * the command existed (Android reports that at once; iOS stays silent, so the wait ends after 30 s). In those cases
 * getUserMedia decides.
 */
export const requestMicrophonePermission = (): Promise<string | null> => {
    // WebBridge keeps one handler per event, so two overlapping requests would replace and unregister each other's
    // callback and leave one of them waiting for the timeout. Callers share the one request that is in flight.
    if (!inFlight) inFlight = requestOnce().finally(() => { inFlight = null })
    return inFlight
}

let inFlight: Promise<string | null> | null = null

const requestOnce = (): Promise<string | null> => {
    if (typeof window === "undefined" || !(window as any).WebBridge) return Promise.resolve(null)

    return new Promise((resolve, reject) => {
        const bridge = (window as any).WebBridge
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (settle: () => void) => {
            if (timer) clearTimeout(timer)
            bridge.unregister?.(NATIVE_CALLBACKS.MICROPHONE_PERMISSION_STATUS)
            settle()
        }
        try {
            if (!nativeBridge.isAvailable()) {
                resolve(null)
                return
            }

            bridge.register(NATIVE_CALLBACKS.MICROPHONE_PERMISSION_STATUS, (status: string) => {
                finish(() => (status === PERMISSION_STATUS.GRANTED ? resolve(status) : reject(new Error(`Microphone permission ${String(status).toLowerCase()}`))))
            })
            // false = the shell has no such method; nothing will answer, so do not wait for it.
            if (nativeBridge.microphone.requestPermission() === false) {
                finish(() => resolve(null))
                return
            }
            timer = setTimeout(() => finish(() => resolve(null)), NO_ANSWER_MS)
        } catch (error) {
            finish(() => reject(error))
        }
    })
}
