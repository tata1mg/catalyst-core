/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS } from "../constants/NativeInterfaces.js"


const DEFAULT_DURATION = 300
const DEFAULT_TIMEOUT_MULTIPLIER = 3
const MIN_TIMEOUT = 800

/**
 * Wraps useNavigate with native slide/fade transitions using a snapshot overlay pattern.
 *
 * Native path:
 *   navigate(to, opts) → startTransition → native snapshots screen → router.navigate(to) →
 *   commitTransition → native animates overlay out revealing new page.
 *
 * Safety net: native-side timer (configurable via opts.timeout, default max(duration*3, 800ms))
 *   force-fades the overlay if commitTransition is never called.
 *
 * Web fallback: CSS overlay on document.body, driven by the same state machine.
 *
 * @param {Object} defaults - Default transition options applied to every navigate call
 *   type: 'slide' | 'fade' (default: 'slide')
 *   direction: 'left' | 'right' | 'up' | 'down' (default: 'left')
 *   duration: ms (default: 300)
 *   timeout: ms safety timer (default: max(duration*3, 800))
 */
export const useNativeTransition = (defaults = {}) => {
    const router = useNavigate()
    const isNative = typeof window !== "undefined" && nativeBridge.isAvailable()

    const [transitioning, setTransitioning] = useState(false)
    const overlayRef = useRef(null)
    const webTimeoutRef = useRef(null)
    const pendingCommitRef = useRef(null)

    // Register native callbacks once
    useEffect(() => {
        if (typeof window === "undefined" || !window.WebBridge) return

        window.WebBridge.register(NATIVE_CALLBACKS.ON_TRANSITION_COMMITTED, () => {
            setTransitioning(false)
        })

        window.WebBridge.register(NATIVE_CALLBACKS.ON_TRANSITION_CANCELLED, () => {
            setTransitioning(false)
        })

        window.WebBridge.register(NATIVE_CALLBACKS.ON_TRANSITION_TIMEOUT, () => {
            console.warn("🔀 useNativeTransition: native safety timeout fired — overlay force-faded")
            setTransitioning(false)
        })

        return () => {
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_TRANSITION_COMMITTED)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_TRANSITION_CANCELLED)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_TRANSITION_TIMEOUT)
        }
    }, [])

    // Web fallback: create/remove a CSS overlay on document.body
    const _showWebOverlay = useCallback((duration) => {
        if (typeof document === "undefined") return

        const overlay = document.createElement("div")
        overlay.style.cssText = [
            "position:fixed",
            "inset:0",
            "z-index:9999",
            "background:var(--transition-overlay-color,#fff)",
            `transition:opacity ${duration}ms ease`,
            "opacity:0",
            "pointer-events:none",
        ].join(";")

        document.body.appendChild(overlay)
        overlayRef.current = overlay

        // Trigger enter animation (fade in)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                overlay.style.opacity = "1"
            })
        })
    }, [])

    const _hideWebOverlay = useCallback((duration) => {
        const overlay = overlayRef.current
        if (!overlay) return

        overlay.style.opacity = "0"
        const cleanup = () => {
            overlay.remove()
            overlayRef.current = null
            setTransitioning(false)
        }

        // Use transitionend when possible, fallback to setTimeout
        overlay.addEventListener("transitionend", cleanup, { once: true })
        webTimeoutRef.current = setTimeout(cleanup, duration + 50)
    }, [])

    // Cancel any in-flight web transition (e.g. safety timeout path)
    const _cancelWebOverlay = useCallback(() => {
        clearTimeout(webTimeoutRef.current)
        if (overlayRef.current) {
            overlayRef.current.remove()
            overlayRef.current = null
        }
        setTransitioning(false)
    }, [])

    /**
     * navigate(to, options)
     *
     * Options (in addition to standard react-router NavigateOptions):
     *   type: 'slide' | 'fade'
     *   direction: 'left' | 'right' | 'up' | 'down'
     *   duration: ms
     *   timeout: ms (native safety timer; web safety timer uses duration*3)
     *   replace: boolean (passed to router)
     *   state: any (passed to router)
     */
    const navigate = useCallback(
        (to, options = {}) => {
            const {
                type = defaults.type ?? "slide",
                direction = defaults.direction ?? "left",
                duration = defaults.duration ?? DEFAULT_DURATION,
                timeout = defaults.timeout ?? Math.max(duration * DEFAULT_TIMEOUT_MULTIPLIER, MIN_TIMEOUT),
                replace = false,
                state,
                ...rest
            } = options

            const routerOpts = { replace, state, ...rest }

            setTransitioning(true)

            if (isNative) {
                try {
                    nativeBridge.transition.start({ type, direction, duration, timeout })

                    // Route swap happens immediately — native overlay hides the skeleton
                    router(to, routerOpts)

                    // Give the new page one frame to mount before committing
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            try {
                                nativeBridge.transition.commit()
                            } catch (err) {
                                console.error("🔀 useNativeTransition: commitTransition failed:", err)
                                nativeBridge.transition.cancel()
                                setTransitioning(false)
                            }
                        })
                    })
                } catch (err) {
                    console.error("🔀 useNativeTransition: startTransition failed, falling back to plain navigate:", err)
                    setTransitioning(false)
                    router(to, routerOpts)
                }
            } else {
                // Web fallback — CSS overlay
                _showWebOverlay(duration)

                const webSafetyTimeout = Math.max(duration * DEFAULT_TIMEOUT_MULTIPLIER, MIN_TIMEOUT)
                pendingCommitRef.current = { duration, webSafetyTimeout }

                // Route swap after overlay is visible
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        router(to, routerOpts)

                        // Commit: fade overlay back out
                        requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                                _hideWebOverlay(duration)
                            })
                        })
                    })
                })

                // Web safety timeout
                webTimeoutRef.current = setTimeout(() => {
                    console.warn("🔀 useNativeTransition: web safety timeout — removing overlay")
                    _cancelWebOverlay()
                }, webSafetyTimeout)
            }
        },
        [isNative, defaults, router, _showWebOverlay, _hideWebOverlay, _cancelWebOverlay]
    )

    /**
     * Imperatively cancel an in-flight transition (e.g. error boundary).
     * On native: fires cancelTransition bridge command.
     * On web: removes overlay immediately.
     */
    const cancelTransition = useCallback(() => {
        if (isNative) {
            try {
                nativeBridge.transition.cancel()
            } catch (_) { /* swallow — cancel is best-effort */ }
        } else {
            _cancelWebOverlay()
        }
        setTransitioning(false)
    }, [isNative, _cancelWebOverlay])

    return {
        navigate,
        cancelTransition,
        transitioning,
        isNative,
        isWeb: !isNative,
    }
}
