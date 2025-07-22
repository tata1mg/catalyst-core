import React, { Suspense, lazy } from "react"

/**
 * Split component that wraps React's lazy and Suspense for SSR compatibility
 * @param {Object} props
 * @param {boolean} props.ssr - Whether to render the component on the server
 * @param {React.ComponentType|React.ReactElement} props.fallback - Fallback component for loading state
 * @param {Function} props.children - Function that returns the lazy component import
 * @param {string} props.cacheKey - Resolved path for better asset tracking
 */
const Split = ({ importFn, ssr = true, fallback = null, cacheKey, children, ...props }) => {
    // Check if we're on the server
    const isServer = typeof window === "undefined"
    if (isServer) {
        if (ssr) {
            // On server with SSR enabled: actually load and render the component
            try {
                // Track this component for asset extraction
                if (global.__CHUNK_EXTRACTOR__) {
                    global.__CHUNK_EXTRACTOR__.addComponent(cacheKey)
                }

                // Load the component and wait for it to resolve

                return <Suspense fallback={fallback}>{children}</Suspense>
            } catch (error) {
                console.warn("Error loading component for SSR:", error)
                return fallback
            }
        } else {
            // On server with SSR disabled: return fallback, don't track
            return fallback
        }
    } else {
        if (ssr) {
            return children
        } else {
        return <Suspense fallback={fallback}>{children}</Suspense>
        }
    }
}

/**
 * Higher-order function to create a split component
 * @param {Function} importFn - Function that returns a dynamic import
 * @param {Object} options - Configuration options
 * @param {boolean} options.ssr - Whether to enable SSR for this component
 * @param {React.ComponentType|React.ReactElement} options.fallback - Fallback component
 * @param {string} cacheKey - Resolved path for better asset tracking (injected by plugin)
 */
export const createSplit = (importFn, { ssr = true, fallback = null, key } = {}, cacheKey) => {
    const LazyComponent = lazy(importFn)

    return (props) => (
        <Split importFn={importFn} ssr={ssr} fallback={fallback} cacheKey={cacheKey} {...props}>
            <LazyComponent {...props} />
        </Split>
    )
}

/**
 * Utility function to create a split component with explicit SSR control
 * @param {Function} importFn - Function that returns a dynamic import
 * @param {React.ComponentType|React.ReactElement} fallback - Fallback component
 * @param {boolean} ssr - Whether to enable SSR
 */
export const split = (importFn, fallback = null, ssr = true) => {
    return createSplit(importFn, { ssr, fallback })
}

export default Split
