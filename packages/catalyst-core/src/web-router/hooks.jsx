import { useCallback, useTransition } from "react"
import { useNavigate } from "react-router-dom"

/**
 * `navigate()` wrapped in React's own `startTransition` — a client-side
 * navigation that suspends (a loader's critical data isn't resolved yet)
 * keeps the current page on screen instead of unmounting it into a Suspense
 * fallback, and `isPending` flips true for the duration. This is what the
 * commented-out `document.startViewTransition`-based implementation this
 * replaced was reaching for (a signal that a navigation is in flight) without
 * needing a separate view-transition/animation system to get it — React 19's
 * built-in `useTransition` already provides exactly that pending signal, no
 * loader/animation-specific plumbing required. RFC 0001 deliberately doesn't
 * build view-transition animation support; a real one would layer on top of
 * this hook, not replace it.
 *
 * Returns a tuple, not a plain function, unlike this hook's previous no-op
 * version (`() => useNavigate()`) — that was a dead stub with zero real
 * callers in this repo, so this isn't a breaking change to a working API.
 *
 * @returns {[(to: any, options?: any) => void, boolean]} `[navigateWithTransition, isPending]`
 */
export const useNavigateWithTransition = () => {
    const navigate = useNavigate()
    const [isPending, startTransition] = useTransition()

    const navigateWithTransition = useCallback(
        (to, options) => {
            startTransition(() => {
                navigate(to, options)
            })
        },
        [navigate, startTransition]
    )

    return [navigateWithTransition, isPending]
}
