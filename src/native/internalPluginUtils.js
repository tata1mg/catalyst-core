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

function parsePluginManifest(pluginDir) {
    const manifestPath = path.join(pluginDir, "manifest.json")
    if (!fs.existsSync(manifestPath)) {
        return null
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    const androidConfig = manifest.android
    if (!androidConfig || typeof androidConfig !== "object") {
        throw new Error(`'android' config is required for Android plugin in ${manifestPath}`)
    }

    const id = mustBeNonEmptyString(manifest.id, "id", manifestPath)
    const configKey = mustBeNonEmptyString(manifest.configKey, "configKey", manifestPath)
    const platforms = readStringArray(manifest.platforms, "platforms", manifestPath, {
        required: true,
        nonEmpty: true,
    })

    if (!platforms.includes("android")) {
        throw new Error(`Internal plugin '${id}' must declare support for 'android' in ${manifestPath}`)
    }

    return {
        pluginDir,
        androidDir: path.join(pluginDir, "android"),
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
        callbacks: readStringArray(manifest.callbacks, "callbacks", manifestPath),
        permissions: readStringArray(androidConfig.permissions, "android.permissions", manifestPath),
        dependencies: readStringArray(androidConfig.dependencies, "android.dependencies", manifestPath),
        className: mustBeNonEmptyString(androidConfig.className, "android.className", manifestPath),
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

module.exports = {
    discoverInternalPlugins,
    parsePluginManifest,
    resolveInternalPluginsRoot,
}
