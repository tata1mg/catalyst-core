// Keeps the native model download in step with the connection. The page learns about connectivity from
// useNetworkStatus (offline, back online) and passes it down as `network`; this turns changes into pause/resume
// commands. Native keeps its own safety net (retry with backoff, weak-link detection), so a missed command only
// delays recovery.
import { useEffect, useRef } from "react"
import { pauseNativeDownload, resumeNativeDownload } from "./nativeTransport.js"

/** "pause" | "resume" | null: what to tell native given the connection and whether we already paused it. */
export function nextDownloadCommand({ online, paused }) {
    if (online === false && !paused) return "pause"
    if (online !== false && paused) return "resume"
    return null
}

/**
 * @param {{ active: boolean, network?: { online?: boolean } | null }} args
 *   active: a model download may be running (native AI enabled and not ready yet)
 *   network: the useNetworkStatus result, or undefined when the caller does not track it (then this does nothing)
 */
export function useNativeDownloadControl({ active, network }) {
    const pausedRef = useRef(false)
    const online = network ? network.online : undefined

    useEffect(() => {
        if (online === undefined) return
        // Only start pausing while a download can be running; always allow the resume that undoes our own pause.
        if (!active && !pausedRef.current) return
        const command = nextDownloadCommand({ online, paused: pausedRef.current })
        if (command === "pause") {
            pausedRef.current = pauseNativeDownload("offline")
        } else if (command === "resume") {
            resumeNativeDownload()
            pausedRef.current = false
        }
    }, [online, active])

    // Leaving the page must not leave the shared download paused for whoever mounts next.
    useEffect(
        () => () => {
            if (pausedRef.current) {
                resumeNativeDownload()
                pausedRef.current = false
            }
        },
        []
    )
}
