import { useEffect, useRef } from "react"
import { useLocation } from "catalyst-core"

/**
 * Resets the window scroll position on route change. Without this, switching
 * bottom-nav tabs keeps the previous screen's scroll offset — and because
 * document height differs per tab, the browser clamps the offset and the
 * viewport lurches.
 *
 * The reset runs after the route swaps, underneath useNativeTransition's
 * snapshot/overlay, so it is never visible. Skipped when the target URL
 * carries a #hash (anchor navigation owns the scroll there), and on the very
 * first render of a page load (the browser's own restoration owns that one).
 * The first-load flag is module-scoped because layout roots remount when
 * moving between /app and the HubLayout routes.
 */
let isFirstRouteRender = true

const ScrollReset = () => {
    const location = useLocation()
    const lastPathname = useRef(location.pathname)

    useEffect(() => {
        if (isFirstRouteRender) {
            isFirstRouteRender = false
            lastPathname.current = location.pathname
            return
        }
        if (location.pathname === lastPathname.current) {
            return
        }
        lastPathname.current = location.pathname
        if (location.hash) {
            return
        }
        window.scrollTo(0, 0)
    }, [location.pathname, location.hash])

    return null
}

export default ScrollReset
