import fs from "fs"
import path from "path"
import { createServer as createViteServer } from "vite"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function toRoutePath(basePath, routePath, isIndex) {
    if (isIndex || routePath === undefined || routePath === null || routePath === "") {
        return basePath || "/"
    }

    const nextPath = String(routePath).startsWith("/") ? routePath : `${basePath}/${routePath}`
    return `/${nextPath}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/"
}

function routeRegex(pattern, exact = false) {
    if (pattern === "*" || pattern === "/*") return "^/.*$"
    if (pattern === "/") return exact ? "^/$" : "^/.*$"

    const parts = pattern.split("/").filter(Boolean)
    const regex = parts
        .map((part) => {
            if (part === "*") return ".*"
            if (part.startsWith(":")) return "[^/]+"
            return part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
        })
        .join("/")

    return exact ? `^/${regex}$` : `^/${regex}(?:/.*)?$`
}

export function collectOfflineRoutes(routes, basePath = "", parentOffline = false, result = []) {
    for (const route of Array.isArray(routes) ? routes : []) {
        if (!route || typeof route !== "object") continue

        const offline = Object.prototype.hasOwnProperty.call(route, "offline")
            ? route.offline === true
            : parentOffline
        const isIndexRoute = route.index === true || route.path === ""
        const pattern = toRoutePath(basePath, route.path, isIndexRoute)
        const regex = routeRegex(pattern, isIndexRoute)

        if (offline && !result.some((item) => item.pattern === pattern && item.regex === regex)) {
            result.push({ pattern, regex })
        }

        collectOfflineRoutes(route.children, pattern, offline, result)
    }

    return result
}

async function loadAppRoutes(appRoot) {
    // The shared dev config's `server` block wins over the inline options
    // below, and its isProduction is captured at module load so NODE_ENV
    // cannot be flipped here. This flag is the supported opt-out: without it
    // the manifest step opens an HMR websocket and prints "Port 24678 is
    // already in use" whenever a dev server happens to be running.
    const previousNoHmr = process.env.CATALYST_NO_HMR
    process.env.CATALYST_NO_HMR = "true"

    const vite = await createViteServer({
        configFile: path.resolve(__dirname, "../vite/vite.config.js"),
        root: appRoot,
        appType: "custom",
        logLevel: "error",
        server: {
            middlewareMode: true,
            hmr: false,
        },
        optimizeDeps: {
            noDiscovery: true,
        },
    })

    try {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - appRoot is the app's own build root and the remainder is a hardcoded literal path, not request input.
        const routesModule = await vite.ssrLoadModule(path.join(appRoot, "src/js/routes/utils.js"))
        return typeof routesModule.getRoutes === "function" ? routesModule.getRoutes() : []
    } finally {
        await vite.close()
        if (previousNoHmr === undefined) delete process.env.CATALYST_NO_HMR
        else process.env.CATALYST_NO_HMR = previousNoHmr
    }
}

function copyIfExists(source, destination) {
    if (fs.existsSync(source)) fs.copyFileSync(source, destination)
}

export async function generateOfflineManifest() {
    const appRoot = process.env.src_path
    const appConfig = JSON.parse(fs.readFileSync(path.join(appRoot, "config/config.json"), "utf8"))
    const buildDir = path.join(
        appRoot,
        process.env.BUILD_OUTPUT_PATH || appConfig.BUILD_OUTPUT_PATH || "build"
    )
    const routes = collectOfflineRoutes(await loadAppRoutes(appRoot))

    fs.mkdirSync(buildDir, { recursive: true })
    fs.writeFileSync(
        path.join(buildDir, "catalyst-offline-manifest.json"),
        `${JSON.stringify(
            {
                schemaVersion: 1,
                buildId: Date.now().toString(36),
                routes,
            },
            null,
            2
        )}\n`
    )

    copyIfExists(path.join(appRoot, "public/offline.html"), path.join(buildDir, "offline.html"))
    fs.copyFileSync(path.join(__dirname, "../offline/catalyst-sw.js"), path.join(buildDir, "catalyst-sw.js"))

    // The CLI reports this step; printing it here too duplicated the line.
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    generateOfflineManifest().catch((error) => {
        console.error("Failed to generate Catalyst offline manifest:", error)
        process.exit(1)
    })
}
