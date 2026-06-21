import React, { useState, useEffect, useRef } from "react"

// Load components 75% of viewport below the fold so they're ready by the time
// the user scrolls to them. Matches react-loadable-visibility's default.
const DEFAULT_ROOT_MARGIN = "0px 0px 75% 0px"

// Shared IntersectionObserver for the default (no rootOptions) path.
// Each observed element maps to a callback that fires once and unobserves.
const callbacks = new Map()
let sharedObserver = null

function getSharedObserver() {
    if (sharedObserver) return sharedObserver
    sharedObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting || entry.intersectionRatio > 0) {
                    const cb = callbacks.get(entry.target)
                    if (cb) {
                        cb()
                        callbacks.delete(entry.target)
                        sharedObserver.unobserve(entry.target)
                    }
                }
            })
        },
        { rootMargin: DEFAULT_ROOT_MARGIN },
    )
    return sharedObserver
}

const hasCustomOptions = (o) =>
    o &&
    typeof o === "object" &&
    (o.root != null || o.rootMargin != null || o.threshold != null)

/**
 * Defers rendering of children until the placeholder enters the viewport.
 * Once visible, it stays visible.
 *
 * On the server or when IntersectionObserver is unavailable, children render immediately.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.fallback - Shown while the component is outside the viewport
 * @param {React.ReactNode} props.children - Rendered once the placeholder scrolls into view
 * @param {Object=} props.rootOptions - Optional IntersectionObserver options for parity with react-loadable-visibility
 * @param {Function=} props.onVisible - Called once when the placeholder enters the viewport
 */
const SplitInview = ({ fallback = null, children, rootOptions, onVisible }) => {
    const isServer = typeof window === "undefined"
    const [isVisible, setIsVisible] = useState(() => {
        if (isServer) return true
        if (!window.IntersectionObserver) return true
        return false
    })
    const ref = useRef(null)
    // Freeze rootOptions at mount. IO options are not expected to change mid-lifecycle,
    // so we avoid array/object identity churn (e.g. inline `threshold: [0, 0.5, 1]`).
    const rootOptionsRef = useRef(rootOptions)
    const onVisibleRef = useRef(onVisible)
    onVisibleRef.current = onVisible

    useEffect(() => {
        if (isVisible) return
        const node = ref.current
        if (!node) return

        const opts = rootOptionsRef.current
        const fire = () => {
            setIsVisible(true)
            onVisibleRef.current?.()
        }

        if (!hasCustomOptions(opts)) {
            callbacks.set(node, fire)
            getSharedObserver().observe(node)
            return () => {
                callbacks.delete(node)
                if (sharedObserver) sharedObserver.unobserve(node)
            }
        }

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting || entry.intersectionRatio > 0) {
                        fire()
                        observer.unobserve(entry.target)
                    }
                })
            },
            {
                root: opts.root ?? null,
                rootMargin: opts.rootMargin ?? DEFAULT_ROOT_MARGIN,
                threshold: opts.threshold,
            },
        )

        observer.observe(node)
        return () => observer.disconnect()
    }, [isVisible])

    if (isVisible) return children

    return <div ref={ref}>{fallback}</div>
}

export default SplitInview
