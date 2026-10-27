import { useCallback } from "react"
import { useNavigate } from "@tata1mg/router"

// Tracks the most recently started View Transition globally so other
// components (FadeImage in particular) can defer animations until
// after the cross-fade finishes. Without this, animations on the new
// page run concurrently with VTA's frozen-snapshot cross-fade, and the
// snapshot/live-DOM state mismatch at hand-off shows up as a visible
// jump on iOS WebView. See docs/MOTION-DIRECTION.md §5 framework note.
let currentViewTransition = null

export function getCurrentViewTransition() {
    return currentViewTransition
}

export function useViewTransitionNavigate() {
    const navigate = useNavigate()

    return useCallback(
        (...args) => {
            if (typeof document !== "undefined" && document.startViewTransition) {
                const vta = document.startViewTransition(() => navigate(...args))
                currentViewTransition = vta
                vta.finished.finally(() => {
                    if (currentViewTransition === vta) {
                        currentViewTransition = null
                    }
                })
            } else {
                navigate(...args)
            }
        },
        [navigate]
    )
}

export default useViewTransitionNavigate
