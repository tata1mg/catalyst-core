/**
 * Loads catalyst-core's PluginBridge on demand and resolves with the
 * initialized singleton. Imported dynamically so the server bundle never
 * evaluates it; depending on interop the singleton lands on `default` or
 * `default.default`.
 */
let bridgePromise = null

export const loadPluginBridge = () => {
    if (!bridgePromise) {
        bridgePromise = import('catalyst-core/PluginBridge').then((mod) => {
            const bridge =
                typeof mod.default?.emit === 'function'
                    ? mod.default
                    : mod.default?.default
            if (!bridge) {
                throw new Error('PluginBridge is unavailable')
            }
            bridge.init()
            return bridge
        })
    }
    return bridgePromise
}
