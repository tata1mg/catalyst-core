"use strict"

const fs = require("fs")
const path = require("path")
const { discoverInternalPlugins } = require("./internalPluginUtils.js")

function isDir(dirPath) {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
    }
}

function sanitizeForPath(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function mustBeNonEmptyString(value, fieldName, sourcePath) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Invalid '${fieldName}' in ${sourcePath}`)
    }
    return value.trim()
}

function asUniqueSorted(values) {
    return [...new Set(values)].sort()
}

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function deepEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right)
}

function mergeStructuredValues(existing, incoming, fieldName) {
    if (existing === undefined) {
        return JSON.parse(JSON.stringify(incoming))
    }

    if (Array.isArray(existing) && Array.isArray(incoming)) {
        const merged = []
        const seen = new Set()
        for (const value of [...existing, ...incoming]) {
            const key = JSON.stringify(value)
            if (seen.has(key)) {
                continue
            }
            seen.add(key)
            merged.push(value)
        }
        return merged
    }

    if (isPlainObject(existing) && isPlainObject(incoming)) {
        const merged = { ...existing }
        for (const [key, value] of Object.entries(incoming)) {
            merged[key] = mergeStructuredValues(merged[key], value, `${fieldName}.${key}`)
        }
        return merged
    }

    if (deepEqual(existing, incoming)) {
        return existing
    }

    throw new Error(`Conflicting values for '${fieldName}' while composing selected iOS plugins`)
}

function dependencyKey(dependency) {
    return dependency.url
}

function requirementKey(dependency) {
    return `${dependency.requirement.type}:${dependency.requirement.version}`
}

function packageKey(dependency) {
    return dependency.package
}

function resolveManifestPath(pluginDir, relativePath, fieldName) {
    const resolvedPath = path.resolve(pluginDir, relativePath)
    const normalizedPluginDir = fs.realpathSync(path.resolve(pluginDir))
    if (
        resolvedPath !== normalizedPluginDir &&
        !resolvedPath.startsWith(`${normalizedPluginDir}${path.sep}`)
    ) {
        throw new Error(`'${fieldName}' must stay within plugin directory: ${relativePath}`)
    }

    if (!fs.existsSync(resolvedPath)) {
        return resolvedPath
    }

    const realResolvedPath = fs.realpathSync(resolvedPath)
    if (
        realResolvedPath !== normalizedPluginDir &&
        !realResolvedPath.startsWith(`${normalizedPluginDir}${path.sep}`)
    ) {
        throw new Error(`'${fieldName}' resolves outside plugin directory: ${relativePath}`)
    }

    return realResolvedPath
}

function parsePluginToggleConfig(pluginConfig) {
    if (pluginConfig == null) {
        return {}
    }

    if (typeof pluginConfig !== "object" || Array.isArray(pluginConfig)) {
        throw new Error("'WEBVIEW_CONFIG.plugins' must be an object with boolean values")
    }

    const toggles = {}
    for (const [key, value] of Object.entries(pluginConfig)) {
        const normalizedKey = mustBeNonEmptyString(key, "plugins.<key>", "WEBVIEW_CONFIG")
        if (typeof value !== "boolean") {
            throw new Error(`'WEBVIEW_CONFIG.plugins.${normalizedKey}' must be boolean`)
        }
        toggles[normalizedKey] = value
    }

    return toggles
}

function selectPluginsByConfig(plugins, pluginConfig, log) {
    const toggles = parsePluginToggleConfig(pluginConfig)
    const matchedKeys = new Set()
    const enabled = []

    for (const plugin of plugins) {
        const selectorKeys = plugin.configKey ? [plugin.configKey, plugin.id] : [plugin.id]
        const matches = []

        for (const key of selectorKeys) {
            if (Object.prototype.hasOwnProperty.call(toggles, key)) {
                matches.push({ key, value: toggles[key] })
                matchedKeys.add(key)
            }
        }

        const uniqueValues = [...new Set(matches.map((entry) => entry.value))]
        if (uniqueValues.length > 1) {
            throw new Error(
                `Conflicting toggle values for plugin '${plugin.id}' across keys: ${matches
                    .map((entry) => `${entry.key}=${entry.value}`)
                    .join(", ")}`
            )
        }

        const isEnabled = matches.length === 0 ? false : matches[0].value
        if (isEnabled) {
            enabled.push(plugin)
        } else {
            log(`Plugin disabled by config: ${plugin.id}`, "info")
        }
    }

    const unknownKeys = Object.keys(toggles).filter((key) => !matchedKeys.has(key))
    if (unknownKeys.length > 0) {
        throw new Error(`Unknown plugin toggle key(s) in WEBVIEW_CONFIG.plugins: ${unknownKeys.join(", ")}`)
    }

    return enabled
}

function validatePlugins(plugins) {
    const pluginIds = new Set()
    const configKeys = new Set()
    const selectorKeys = new Map()
    const dependencies = new Map()

    for (const plugin of plugins) {
        if (pluginIds.has(plugin.id)) {
            throw new Error(`Duplicate plugin id detected: ${plugin.id}`)
        }
        pluginIds.add(plugin.id)

        if (plugin.configKey) {
            if (configKeys.has(plugin.configKey)) {
                throw new Error(`Duplicate configKey detected: ${plugin.configKey}`)
            }
            configKeys.add(plugin.configKey)
        }

        for (const [field, selector] of [
            ["id", plugin.id],
            ["configKey", plugin.configKey],
        ]) {
            if (!selector) {
                continue
            }
            const existing = selectorKeys.get(selector)
            if (existing && existing.pluginId !== plugin.id) {
                throw new Error(
                    `Plugin selector collision for '${selector}': '${existing.pluginId}' (${existing.field}) conflicts with '${plugin.id}' (${field})`
                )
            }
            selectorKeys.set(selector, { pluginId: plugin.id, field })
        }

        if (new Set(plugin.commands).size !== plugin.commands.length) {
            throw new Error(`Duplicate command(s) detected within plugin '${plugin.id}'`)
        }

        if (new Set(plugin.callbacks).size !== plugin.callbacks.length) {
            throw new Error(`Duplicate callback(s) detected within plugin '${plugin.id}'`)
        }

        if (Object.prototype.hasOwnProperty.call(plugin.ios?.infoPlist || {}, "CFBundleURLTypes")) {
            throw new Error(
                `Plugin '${plugin.id}' must use 'ios.urlSchemes' instead of 'ios.infoPlist.CFBundleURLTypes'`
            )
        }

        if (
            Object.prototype.hasOwnProperty.call(plugin.ios?.infoPlist || {}, "LSApplicationQueriesSchemes")
        ) {
            throw new Error(
                `Plugin '${plugin.id}' must use 'ios.querySchemes' instead of 'ios.infoPlist.LSApplicationQueriesSchemes'`
            )
        }

        for (const dependency of plugin.ios?.dependencies || []) {
            const existing = dependencies.get(dependencyKey(dependency))
            if (existing && requirementKey(existing.dependency) !== requirementKey(dependency)) {
                throw new Error(
                    `iOS dependency version conflict for '${dependency.url}': '${existing.dependency.requirement.type}:${existing.dependency.requirement.version}' in '${existing.pluginId}', '${dependency.requirement.type}:${dependency.requirement.version}' in '${plugin.id}'`
                )
            }
            if (existing && packageKey(existing.dependency) !== packageKey(dependency)) {
                throw new Error(
                    `iOS dependency package identity conflict for '${dependency.url}': '${existing.dependency.package}' in '${existing.pluginId}', '${dependency.package}' in '${plugin.id}'`
                )
            }
            if (!existing) {
                dependencies.set(dependencyKey(dependency), { dependency, pluginId: plugin.id })
            }
        }

        for (const resourcePath of plugin.ios?.resources || []) {
            const resolvedPath = resolveManifestPath(
                plugin.pluginDir,
                resourcePath,
                `ios.resources for '${plugin.id}'`
            )
            if (!fs.existsSync(resolvedPath)) {
                throw new Error(`iOS resource path not found for plugin '${plugin.id}': ${resourcePath}`)
            }
        }
    }
}

function selectPluginsForPlatform(plugins, platform, log) {
    const selected = []

    for (const plugin of plugins) {
        if (plugin.platforms.includes(platform)) {
            selected.push(plugin)
            continue
        }
        log(`Plugin enabled but not supported on ${platform}: ${plugin.id}`, "info")
    }

    return selected
}

function walkFiles(rootDir, predicate, results = []) {
    if (!isDir(rootDir)) {
        return results
    }

    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        const fullPath = path.join(rootDir, entry.name)
        if (entry.isDirectory()) {
            walkFiles(fullPath, predicate, results)
            continue
        }
        if (predicate(entry.name, fullPath)) {
            results.push(fullPath)
        }
    }

    return results
}

function resolvePluginClassSourcePath(plugin) {
    const className = plugin.ios.className.split(".").pop()
    const candidateName = `${className}.swift`
    const candidates = walkFiles(plugin.ios.sourceDir, (name) => name === candidateName)
    return candidates[0] || null
}

function validateSelectedPluginSources(plugins) {
    for (const plugin of plugins) {
        if (!plugin.ios) {
            throw new Error(`iOS config missing for selected plugin '${plugin.id}'`)
        }
        if (!isDir(plugin.ios.sourceDir)) {
            throw new Error(`iOS source directory missing for selected plugin '${plugin.id}'`)
        }

        const codeFiles = walkFiles(plugin.ios.sourceDir, (name) => name.endsWith(".swift"))
        if (codeFiles.length === 0) {
            throw new Error(`No iOS source files found for selected plugin '${plugin.id}'`)
        }

        if (!resolvePluginClassSourcePath(plugin)) {
            throw new Error(
                `Declared class '${plugin.ios.className}' for selected plugin '${plugin.id}' was not found under ${plugin.ios.sourceDir}`
            )
        }
    }
}

function collectIosDependencies(plugins) {
    const dependenciesByUrl = new Map()

    for (const plugin of plugins) {
        for (const dependency of plugin.ios?.dependencies || []) {
            const existing = dependenciesByUrl.get(dependency.url)
            if (!existing) {
                dependenciesByUrl.set(dependency.url, {
                    url: dependency.url,
                    package: dependency.package,
                    requirement: dependency.requirement,
                    products: [...dependency.products],
                })
                continue
            }

            if (requirementKey(existing) !== requirementKey(dependency)) {
                throw new Error(
                    `iOS dependency version conflict for '${dependency.url}' while composing selected plugins`
                )
            }
            if (packageKey(existing) !== packageKey(dependency)) {
                throw new Error(
                    `iOS dependency package identity conflict for '${dependency.url}' while composing selected plugins`
                )
            }

            existing.products = asUniqueSorted([...existing.products, ...dependency.products])
        }
    }

    return [...dependenciesByUrl.values()].sort((left, right) => left.url.localeCompare(right.url))
}

function normalizeResourceRelativePath(plugin, absolutePath) {
    const relativePath = path.relative(plugin.pluginDir, absolutePath)
    if (relativePath.startsWith(`ios${path.sep}resources${path.sep}`)) {
        return relativePath.slice(`ios${path.sep}resources${path.sep}`.length)
    }
    if (relativePath.startsWith(`ios${path.sep}`)) {
        return relativePath.slice(`ios${path.sep}`.length)
    }
    return relativePath
}

function validateBundleRelativePath(pluginId, bundleRelativePath) {
    const normalizedPath = path.posix.normalize(bundleRelativePath)
    const expectedPrefix = `PluginResources/${sanitizeForPath(pluginId)}`

    if (
        path.posix.isAbsolute(normalizedPath) ||
        normalizedPath === ".." ||
        normalizedPath.startsWith("../")
    ) {
        throw new Error(`Invalid bundled resource path for plugin '${pluginId}': ${bundleRelativePath}`)
    }

    if (normalizedPath !== expectedPrefix && !normalizedPath.startsWith(`${expectedPrefix}/`)) {
        throw new Error(
            `Bundled resource path escaped managed directory for plugin '${pluginId}': ${bundleRelativePath}`
        )
    }

    return normalizedPath
}

function collectIosResources(plugins) {
    const resources = []

    for (const plugin of plugins) {
        for (const resourcePath of plugin.ios?.resources || []) {
            const resolvedPath = resolveManifestPath(
                plugin.pluginDir,
                resourcePath,
                `ios.resources for '${plugin.id}'`
            )
            const entries = fs.statSync(resolvedPath).isDirectory()
                ? walkFiles(resolvedPath, () => true)
                : [resolvedPath]

            for (const entryPath of entries) {
                const normalizedRelativePath = normalizeResourceRelativePath(plugin, entryPath)
                const bundleRelativePath = validateBundleRelativePath(
                    plugin.id,
                    path
                        .join("PluginResources", sanitizeForPath(plugin.id), normalizedRelativePath)
                        .split(path.sep)
                        .join("/")
                )

                resources.push({
                    pluginId: plugin.id,
                    sourcePath: entryPath,
                    bundleRelativePath,
                })
            }
        }
    }

    return resources.sort((left, right) => left.bundleRelativePath.localeCompare(right.bundleRelativePath))
}

function collectIosInfoPlist(plugins) {
    let infoPlist = {}
    for (const plugin of plugins) {
        infoPlist = mergeStructuredValues(
            infoPlist,
            plugin.ios?.infoPlist || {},
            `ios.infoPlist for '${plugin.id}'`
        )
    }
    return infoPlist
}

function collectIosEntitlements(plugins) {
    let entitlements = {}
    for (const plugin of plugins) {
        entitlements = mergeStructuredValues(
            entitlements,
            plugin.ios?.entitlements || {},
            `ios.entitlements for '${plugin.id}'`
        )
    }
    return entitlements
}

function collectIosUrlSchemes(plugins) {
    const entries = []
    for (const plugin of plugins) {
        for (const entry of plugin.ios?.urlSchemes || []) {
            entries.push({
                name: entry.name || plugin.id,
                schemes: asUniqueSorted(entry.schemes),
            })
        }
    }
    return entries
}

function collectIosQuerySchemes(plugins) {
    return asUniqueSorted(plugins.flatMap((plugin) => plugin.ios?.querySchemes || []))
}

function copyIosPluginSources(plugins, iosProjectPath, log) {
    const internalRoot = path.join(iosProjectPath, "Sources", "Core", "Plugins", "Internal")
    fs.rmSync(internalRoot, { recursive: true, force: true })
    ensureDir(internalRoot)

    let copiedCount = 0
    for (const plugin of plugins) {
        const pluginOutputDir = path.join(internalRoot, sanitizeForPath(plugin.id))
        const codeFiles = walkFiles(plugin.ios.sourceDir, (name) => name.endsWith(".swift"))

        for (const sourcePath of codeFiles) {
            const targetPath = path.join(pluginOutputDir, path.relative(plugin.ios.sourceDir, sourcePath))
            ensureDir(path.dirname(targetPath))
            fs.copyFileSync(sourcePath, targetPath)
            copiedCount++
        }
    }

    log(`Copied ${copiedCount} iOS plugin source file(s)`, "info")
}

function formatSwiftDictionary(entries, emptyLiteral = "[:]") {
    return entries.length === 0 ? emptyLiteral : `[\n${entries.join(",\n")}\n    ]`
}

function generatePluginRegistryFiles(plugins, iosProjectPath) {
    const pluginFactories = {}
    const pluginToCommands = {}
    const pluginToCallbacks = {}

    for (const plugin of plugins) {
        pluginFactories[plugin.id] = plugin.ios.className
        pluginToCommands[plugin.id] = asUniqueSorted(plugin.commands)
        pluginToCallbacks[plugin.id] = asUniqueSorted(plugin.callbacks)
    }

    const factoryEntries = Object.keys(pluginFactories)
        .sort()
        .map((pluginId) => `        ${JSON.stringify(pluginId)}: { ${pluginFactories[pluginId]}() }`)

    const commandEntries = Object.keys(pluginToCommands)
        .sort()
        .map((pluginId) => {
            const commands = pluginToCommands[pluginId]
            const commandSet = commands.length
                ? `Set([${commands.map((value) => JSON.stringify(value)).join(", ")}])`
                : "[]"
            return `        ${JSON.stringify(pluginId)}: ${commandSet}`
        })

    const callbackEntries = Object.keys(pluginToCallbacks)
        .sort()
        .map((pluginId) => {
            const callbacks = pluginToCallbacks[pluginId]
            const callbackSet = callbacks.length
                ? `Set([${callbacks.map((value) => JSON.stringify(value)).join(", ")}])`
                : "[]"
            return `        ${JSON.stringify(pluginId)}: ${callbackSet}`
        })

    const indexContent = `import Foundation

enum GeneratedPluginIndex {
    static let pluginFactories: [String: () -> CatalystPlugin] = ${formatSwiftDictionary(factoryEntries)}
    static let pluginToCommands: [String: Set<String>] = ${formatSwiftDictionary(commandEntries)}
    static let pluginToCallbacks: [String: Set<String>] = ${formatSwiftDictionary(callbackEntries)}
}
`

    const pluginsDir = path.join(iosProjectPath, "Sources", "Core", "Plugins")
    ensureDir(pluginsDir)
    fs.writeFileSync(path.join(pluginsDir, "GeneratedPluginIndex.swift"), indexContent)
}

function composeIosPlugins({ corePluginsRoot, iosProjectPath, pluginConfig, log }) {
    const discovered = discoverInternalPlugins(corePluginsRoot, log)
    validatePlugins(discovered)
    const enabled = selectPluginsByConfig(discovered, pluginConfig, log)
    const selected = selectPluginsForPlatform(enabled, "ios", log)
    validateSelectedPluginSources(selected)
    const iosDependencies = collectIosDependencies(selected)
    const infoPlist = collectIosInfoPlist(selected)
    const urlSchemes = collectIosUrlSchemes(selected)
    const querySchemes = collectIosQuerySchemes(selected)
    const entitlements = collectIosEntitlements(selected)
    const resources = collectIosResources(selected)
    copyIosPluginSources(selected, iosProjectPath, log)
    generatePluginRegistryFiles(selected, iosProjectPath)

    log(`Plugin composition complete (${selected.length} enabled iOS plugin(s))`, "success")
    return {
        pluginCount: selected.length,
        commandCount: selected.reduce((total, plugin) => total + plugin.commands.length, 0),
        iosDependencies,
        infoPlist,
        urlSchemes,
        querySchemes,
        entitlements,
        resources,
    }
}

module.exports = { composeIosPlugins }
