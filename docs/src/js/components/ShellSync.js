import { useEffect } from 'react'
import { useSafeArea } from 'catalyst-core/hooks'
import { useTheme } from './docs/ThemeContext'
import { isNativeShell } from './DocumentBootstrap'
import { loadPluginBridge } from './pluginBridge'

const SIDES = ['top', 'right', 'bottom', 'left']
const COMPANION_PLUGIN_ID = 'io.catalyst.companion'

/**
 * Keeps the Companion shell and the page in step:
 *
 *  - Safe area: publishes the native insets as --safe-area-* on <html>. The
 *    Companion renders edge-to-edge, and the env() insets read 0 there (the
 *    document has no viewport-fit=cover), so these inline values override the
 *    env() defaults docs.scss declares on :root.
 *  - Appearance: tells the shell which theme the page is in, so the native
 *    status and navigation bar icons stay readable over the edge-to-edge page.
 *    Runs on mount and on every theme toggle. Other Catalyst shells lack the
 *    plugin and answer with a bridge error event, which nothing listens for.
 */
const ShellSync = () => {
    const { isNative, top, right, bottom, left } = useSafeArea()
    const { theme } = useTheme()

    useEffect(() => {
        if (!isNative) return
        const values = { top, right, bottom, left }
        const root = document.documentElement
        SIDES.forEach((side) =>
            root.style.setProperty(`--safe-area-${side}`, `${values[side]}px`)
        )
    }, [isNative, top, right, bottom, left])

    useEffect(() => {
        if (!isNativeShell()) return
        let cancelled = false
        loadPluginBridge()
            .then((bridge) => {
                if (cancelled) return
                bridge.emit({
                    pluginId: COMPANION_PLUGIN_ID,
                    command: 'setAppearance',
                    data: { theme },
                })
            })
            .catch(() => {
                // Appearance sync is cosmetic; never break the page over it.
            })
        return () => {
            cancelled = true
        }
    }, [theme])

    return null
}

export default ShellSync
