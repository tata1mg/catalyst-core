import React, { useState, useEffect, useRef } from "react"

// Single shared IntersectionObserver instance.
// Each observed element is tracked via a Map of element → callback.
// When an element intersects, its callback fires and it is unobserved.
const callbacks = new Map()
let sharedObserver = null

function getObserver() {
    if (sharedObserver) return sharedObserver
    sharedObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const cb = callbacks.get(entry.target)
                if (cb) {
                    cb()
                    callbacks.delete(entry.target)
                    sharedObserver.unobserve(entry.target)
                }
            }
        })
    })
    return sharedObserver
}

function observe(node, callback) {
    callbacks.set(node, callback)
    getObserver().observe(node)
}

function unobserve(node) {
    callbacks.delete(node)
    if (sharedObserver) sharedObserver.unobserve(node)
}

/**
 * Defers rendering of children until the placeholder enters the viewport.
 * Once visible, it stays visible. All instances share a single
 * IntersectionObserver — each component registers as an observed entry.
 *
 * On the server or when IntersectionObserver is unavailable, children render immediately.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.fallback - Shown while the component is outside the viewport
 * @param {React.ReactNode} props.children - Rendered once the placeholder scrolls into view
 */
const SplitInview = ({ fallback = null, children }) => {
    const isServer = typeof window === "undefined"
    const [isVisible, setIsVisible] = useState(() => {
        if (isServer) return true
        if (!window.IntersectionObserver) return true
        return false
    })
    const ref = useRef(null)

    useEffect(() => {
        if (isVisible) return
        const node = ref.current
        if (!node) return

        observe(node, () => setIsVisible(true))
        return () => unobserve(node)
    }, [isVisible])

    if (isVisible) return children

    return <div ref={ref}>{fallback}</div>
}

export default SplitInview
