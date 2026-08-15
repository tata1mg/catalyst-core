import React, { useCallback, useRef } from "react"
import { Link } from "react-router-dom"
import { observeOnceVisible } from "./SplitInview.jsx"
import { getOrRunLoaderPromise } from "../loader/loaderCache.js"

const buildPrefetchKey = (to, params) => `prefetch:${to}:${JSON.stringify(params || {})}`

/**
 * Warms a route's chunk and/or loader data ahead of navigation — the actual
 * prefetch logic, kept separate from the component below so it's callable
 * (and testable) directly, without needing a DOM to dispatch a real hover/
 * focus/intersection event through.
 *
 * @param {{ to: string, component?: { load: () => Promise<any> }, loader?: Function, params?: Record<string, string> }} args
 */
export const warmPrefetch = ({ to, component, loader, params }) => {
    component?.load?.()

    if (loader) {
        return getOrRunLoaderPromise(buildPrefetchKey(to, params), () =>
            loader({ params: params || {}, searchParams: new URLSearchParams(), context: {} })
        )
    }

    return undefined
}

/**
 * A `<Link>` that calls `warmPrefetch` ahead of navigation, so the eventual
 * `navigate()` there finds the route's chunk and/or loader data already in
 * flight (or already resolved) instead of starting cold.
 *
 * Deliberately explicit about *what* to prefetch (`component`/`loader` props)
 * rather than resolving them by matching `to` against the app's full route
 * tree: nothing else in this codebase exposes that tree to arbitrary
 * components today, and inventing a route registry only this one component
 * would use is exactly the kind of speculative machinery this framework's own
 * conventions warn against. The route config that already knows its own
 * `component`/`loader` is the natural place to pass them through.
 *
 * @param {Object} props
 * @param {string} props.to
 * @param {"intent" | "viewport" | "none"} [props.prefetch="intent"] - "intent" fires on hover/focus; "viewport" fires once the link scrolls into view (shares SplitInview's IntersectionObserver); "none" behaves like a plain Link
 * @param {{ load: () => Promise<any> }} [props.component] - the target route's `split()`-wrapped component
 * @param {(args: { params: any, searchParams: URLSearchParams, context: any }) => Promise<any>} [props.loader] - the target route's own loader
 * @param {Record<string, string>} [props.params] - params to pass the loader, if it needs any
 */
const PrefetchLink = ({ to, prefetch = "intent", component, loader, params, ...linkProps }) => {
    const hasPrefetchedRef = useRef(false)

    const runPrefetch = useCallback(() => {
        if (hasPrefetchedRef.current) return
        hasPrefetchedRef.current = true
        warmPrefetch({ to, component, loader, params })
    }, [to, component, loader, params])

    const setViewportRef = useCallback(
        (node) => {
            if (!node) return undefined
            return observeOnceVisible(node, runPrefetch)
        },
        [runPrefetch]
    )

    if (prefetch === "none") {
        return <Link to={to} {...linkProps} />
    }

    if (prefetch === "viewport") {
        return <Link to={to} ref={setViewportRef} {...linkProps} />
    }

    return <Link to={to} onMouseEnter={runPrefetch} onFocus={runPrefetch} {...linkProps} />
}

export default PrefetchLink
