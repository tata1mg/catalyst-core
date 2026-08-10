import { existsSync } from "fs"
import path from "path"
import { pathToFileURL } from "url"

const emptyConfig = {
    ssrPlugins: [],
    clientPlugins: [],
    /**
     * devServer lets apps tune the Vite dev server without editing framework
     * internals.  All fields are optional and map 1-to-1 onto Vite's `server`
     * config (https://vite.dev/config/server-options).
     *
     * The most common use-case is an app served under a sub-path behind an SSL
     * reverse proxy (nginx/caddy):
     *
     *   // buildConfig.js
     *   export default {
     *     devServer: {
     *       // Vite's base path — the single source of truth for the dev mount
     *       // path; must match the reverse-proxy location prefix. Defaults to "/".
     *       base: "/o-mweb",
     *
     *       // HMR WebSocket tuning when the browser connects via the proxy
     *       hmr: {
     *         clientPort: 443,   // port the browser uses (proxy's SSL port)
     *         path: "__vite_hmr" // WebSocket pathname (relative to base)
     *       },
     *
     *       // Vite 6 rejects requests whose Host header isn't localhost/127.0.0.1.
     *       // Add your proxy hostname here so the dev server accepts them.
     *       allowedHosts: ["local.odinweb.1mg.com"],
     *     },
     *   }
     */
    devServer: {},
}

export async function loadCustomViteConfig() {
    const configNames = ["buildConfig.js", "webpackConfig.js"]
    const configPath = configNames
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - configName is one of two hardcoded literals above, and process.env.src_path is the app root set by the framework's own build tooling, not request/user input.
        .map((configName) => path.join(process.env.src_path, configName))
        .find((candidatePath) => existsSync(candidatePath))

    if (!configPath) {
        return emptyConfig
    }

    const configModule = await import(pathToFileURL(configPath).href)
    return configModule.default || configModule
}
