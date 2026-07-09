const fs = require("fs")
const path = require("path")

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

function collectOfflineRoutes(routes, basePath = "", parentOffline = false, result = []) {
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

function loadAppRoutes() {
    require("./loadScriptsBeforeServerStarts.js")

    const emptyModule = () => null
    ;[".css", ".scss", ".sass", ".less", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"].forEach((ext) => {
        require.extensions[ext] = emptyModule
    })

    require("@babel/register")({
        babelrc: false,
        extensions: [".js", ".jsx", ".ts", ".tsx"],
        ignore: [/node_modules/],
        presets: [
            ["@babel/preset-env", { targets: { node: "current" } }],
            ["@babel/preset-react", { runtime: "automatic" }],
            ["@babel/preset-typescript", { isTSX: true, allExtensions: true }],
        ],
        plugins: ["@loadable/babel-plugin"],
    })

    const { getRoutes } = require(path.join(process.env.src_path, "src/js/routes/utils.js"))
    return typeof getRoutes === "function" ? getRoutes() : []
}

function copyIfExists(source, destination) {
    if (fs.existsSync(source)) fs.copyFileSync(source, destination)
}

function main() {
    const appConfig = require(path.join(process.env.src_path, "config/config.json"))
    const publicDir = path.join(
        process.env.src_path,
        process.env.BUILD_OUTPUT_PATH || appConfig.BUILD_OUTPUT_PATH,
        "public"
    )
    const routes = collectOfflineRoutes(loadAppRoutes())

    fs.mkdirSync(publicDir, { recursive: true })
    fs.writeFileSync(
        path.join(publicDir, "catalyst-offline-manifest.json"),
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

    copyIfExists(path.join(process.env.src_path, "public/offline.html"), path.join(publicDir, "offline.html"))
    fs.copyFileSync(path.join(__dirname, "../offline/catalyst-sw.js"), path.join(publicDir, "catalyst-sw.js"))

    console.log(`Catalyst offline manifest generated: ${routes.length} route(s)`)
}

main()
