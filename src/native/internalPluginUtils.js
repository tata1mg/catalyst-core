"use strict"

const fs = require("fs")
const path = require("path")

function isDir(dirPath) {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()
}

function mustBeNonEmptyString(value, fieldName, sourcePath) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Invalid '${fieldName}' in ${sourcePath}`)
    }

    return value.trim()
}

function readStringArray(value, fieldName, sourcePath, { required = false, nonEmpty = false } = {}) {
    if (!Array.isArray(value)) {
        if (required) {
            throw new Error(`'${fieldName}' is required and must be an array in ${sourcePath}`)
        }
        return []
    }

    const result = value.map((entry) => mustBeNonEmptyString(entry, `${fieldName}[]`, sourcePath))
    if (nonEmpty && result.length === 0) {
        throw new Error(`'${fieldName}' is required and must be non-empty in ${sourcePath}`)
    }

    return result
}

function readPlainObject(value, fieldName, sourcePath) {
    if (value == null) {
        return {}
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`'${fieldName}' must be an object in ${sourcePath}`)
    }
    return value
}

function cloneJsonValue(value, fieldName, sourcePath) {
    try {
        return JSON.parse(JSON.stringify(value))
    } catch (error) {
        throw new Error(`'${fieldName}' must be JSON-serializable in ${sourcePath}`)
    }
}

function readIosUrlSchemes(value, fieldName, sourcePath) {
    if (value == null) {
        return []
    }
    if (!Array.isArray(value)) {
        throw new Error(`'${fieldName}' must be an array in ${sourcePath}`)
    }

    return value.map((entry, index) => {
        const entryField = `${fieldName}[${index}]`
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`'${entryField}' must be an object in ${sourcePath}`)
        }

        return {
            name:
                entry.name == null
                    ? null
                    : mustBeNonEmptyString(entry.name, `${entryField}.name`, sourcePath),
            schemes: readStringArray(entry.schemes, `${entryField}.schemes`, sourcePath, {
                required: true,
                nonEmpty: true,
            }),
        }
    })
}

function readIosDependencies(value, fieldName, sourcePath) {
    if (value == null) {
        return []
    }

    if (!Array.isArray(value)) {
        throw new Error(`'${fieldName}' must be an array in ${sourcePath}`)
    }

    return value.map((entry, index) => {
        const entryField = `${fieldName}[${index}]`
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`'${entryField}' must be an object in ${sourcePath}`)
        }

        const url = mustBeNonEmptyString(entry.url, `${entryField}.url`, sourcePath)
        const packageIdentity =
            entry.package == null
                ? derivePackageIdentityFromUrl(url, `${entryField}.url`, sourcePath)
                : mustBeNonEmptyString(entry.package, `${entryField}.package`, sourcePath)
        const products = readStringArray(entry.products, `${entryField}.products`, sourcePath, {
            required: true,
            nonEmpty: true,
        })
        if (new Set(products).size !== products.length) {
            throw new Error(`Duplicate product(s) found in '${entryField}.products' in ${sourcePath}`)
        }

        const hasFrom = entry.from != null
        const hasExact = entry.exact != null
        if (hasFrom === hasExact) {
            throw new Error(
                `'${entryField}' must define exactly one version requirement: 'from' or 'exact' in ${sourcePath}`
            )
        }

        return {
            url,
            package: packageIdentity,
            products,
            requirement: hasFrom
                ? {
                      type: "from",
                      version: mustBeNonEmptyString(entry.from, `${entryField}.from`, sourcePath),
                  }
                : {
                      type: "exact",
                      version: mustBeNonEmptyString(entry.exact, `${entryField}.exact`, sourcePath),
                  },
        }
    })
}

function derivePackageIdentityFromUrl(url, fieldName, sourcePath) {
    const sanitizedUrl = url.replace(/\/+$/, "")
    const packageIdentity = sanitizedUrl
        .split("/")
        .pop()
        ?.replace(/\.git$/, "")

    if (!packageIdentity) {
        throw new Error(`Unable to derive package identity from '${fieldName}' in ${sourcePath}`)
    }

    return packageIdentity
}

function parsePluginManifest(pluginDir) {
    const manifestPath = path.join(pluginDir, "manifest.json")
    if (!fs.existsSync(manifestPath)) {
        return null
    }

    let manifestContent
    try {
        manifestContent = fs.readFileSync(manifestPath, "utf8")
    } catch (error) {
        throw new Error(`Failed to read plugin manifest at ${manifestPath}: ${error.message}`)
    }

    let manifest
    try {
        manifest = JSON.parse(manifestContent)
    } catch (error) {
        throw new Error(`Invalid JSON in plugin manifest ${manifestPath}: ${error.message}`)
    }

    const id = mustBeNonEmptyString(manifest.id, "id", manifestPath)
    const configKey = mustBeNonEmptyString(manifest.configKey, "configKey", manifestPath)
    const platforms = readStringArray(manifest.platforms, "platforms", manifestPath, {
        required: true,
        nonEmpty: true,
    })
    const androidConfig = platforms.includes("android") ? manifest.android : null
    const iosConfig = platforms.includes("ios") ? manifest.ios : null

    if (platforms.includes("android") && (!androidConfig || typeof androidConfig !== "object")) {
        throw new Error(`'android' config is required for plugin '${id}' in ${manifestPath}`)
    }
    if (platforms.includes("ios") && (!iosConfig || typeof iosConfig !== "object")) {
        throw new Error(`'ios' config is required for plugin '${id}' in ${manifestPath}`)
    }

    return {
        pluginDir,
        manifestPath,
        id,
        configKey,
        version: mustBeNonEmptyString(manifest.version, "version", manifestPath),
        displayName: mustBeNonEmptyString(manifest.displayName, "displayName", manifestPath),
        description: mustBeNonEmptyString(manifest.description, "description", manifestPath),
        category: mustBeNonEmptyString(manifest.category, "category", manifestPath),
        platforms,
        commands: readStringArray(manifest.commands, "commands", manifestPath, {
            required: true,
            nonEmpty: true,
        }),
        android: androidConfig
            ? {
                  sourceDir: path.join(pluginDir, "android"),
                  permissions: readStringArray(
                      androidConfig.permissions,
                      "android.permissions",
                      manifestPath
                  ),
                  dependencies: readStringArray(
                      androidConfig.dependencies,
                      "android.dependencies",
                      manifestPath
                  ),
                  className: mustBeNonEmptyString(androidConfig.className, "android.className", manifestPath),
              }
            : null,
        ios: iosConfig
            ? {
                  sourceDir: path.join(pluginDir, "ios"),
                  dependencies: readIosDependencies(iosConfig.dependencies, "ios.dependencies", manifestPath),
                  className: mustBeNonEmptyString(iosConfig.className, "ios.className", manifestPath),
                  infoPlist: cloneJsonValue(
                      readPlainObject(iosConfig.infoPlist, "ios.infoPlist", manifestPath),
                      "ios.infoPlist",
                      manifestPath
                  ),
                  urlSchemes: readIosUrlSchemes(iosConfig.urlSchemes, "ios.urlSchemes", manifestPath),
                  querySchemes: readStringArray(iosConfig.querySchemes, "ios.querySchemes", manifestPath),
                  entitlements: cloneJsonValue(
                      readPlainObject(iosConfig.entitlements, "ios.entitlements", manifestPath),
                      "ios.entitlements",
                      manifestPath
                  ),
                  resources: readStringArray(iosConfig.resources, "ios.resources", manifestPath),
              }
            : null,
    }
}

function discoverInternalPlugins(corePluginsRoot, log = () => {}) {
    if (!corePluginsRoot || !isDir(corePluginsRoot)) {
        log(`No internal plugin directory found at ${corePluginsRoot || "<empty>"}`, "info")
        return []
    }

    const plugins = []
    const entries = fs
        .readdirSync(corePluginsRoot, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue
        }

        const pluginDir = path.join(corePluginsRoot, entry.name)
        const parsed = parsePluginManifest(pluginDir)
        if (parsed) {
            plugins.push(parsed)
        }
    }

    log(`Discovered ${plugins.length} internal plugin manifest(s)`, "info")
    return plugins
}

function resolveInternalPluginsRoot(packageRoot) {
    const distPluginsPath = path.join(packageRoot, "dist", "native", "internal-plugins")
    const srcPluginsPath = path.join(packageRoot, "src", "native", "internal-plugins")

    return fs.existsSync(distPluginsPath) ? distPluginsPath : srcPluginsPath
}

function resolvePluginConfig(WEBVIEW_CONFIG) {
    const pluginConfig = {}

    if (WEBVIEW_CONFIG.plugins != null) {
        if (typeof WEBVIEW_CONFIG.plugins !== "object" || Array.isArray(WEBVIEW_CONFIG.plugins)) {
            throw new Error("'WEBVIEW_CONFIG.plugins' must be an object with boolean values")
        }

        for (const [key, value] of Object.entries(WEBVIEW_CONFIG.plugins)) {
            if (typeof value !== "boolean") {
                throw new Error(`'WEBVIEW_CONFIG.plugins.${key}' must be boolean`)
            }
            pluginConfig[key] = value
        }
    }

    return pluginConfig
}

module.exports = {
    discoverInternalPlugins,
    parsePluginManifest,
    resolvePluginConfig,
    resolveInternalPluginsRoot,
}
