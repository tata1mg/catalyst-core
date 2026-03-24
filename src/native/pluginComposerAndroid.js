"use strict"

const fs = require("fs")
const path = require("path")
const { discoverInternalPlugins } = require("./internalPluginUtils.js")

const PLUGINS_PACKAGE_PARTS = ["io", "yourname", "androidproject", "plugins"]

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
    const selected = []

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

        const enabled = matches.length === 0 ? false : matches[0].value
        if (enabled) {
            selected.push(plugin)
        } else {
            log(`Plugin disabled by config: ${plugin.id}`, "info")
        }
    }

    const unknownKeys = Object.keys(toggles).filter((key) => !matchedKeys.has(key))
    if (unknownKeys.length > 0) {
        throw new Error(`Unknown plugin toggle key(s) in WEBVIEW_CONFIG.plugins: ${unknownKeys.join(", ")}`)
    }

    return selected
}

function parseDependency(dependency, pluginId) {
    const parts = dependency.split(":")
    if (parts.length < 3) {
        throw new Error(
            `Dependency '${dependency}' in plugin '${pluginId}' must be in 'group:artifact:version' format`
        )
    }

    return {
        key: `${parts[0]}:${parts[1]}`,
        version: parts.slice(2).join(":"),
    }
}

function validatePlugins(plugins) {
    const pluginIds = new Set()
    const configKeys = new Set()
    const dependencies = new Map()
    const selectorKeys = new Map()

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

        for (const dependency of plugin.dependencies) {
            const parsed = parseDependency(dependency, plugin.id)
            const existing = dependencies.get(parsed.key)
            if (existing && existing.version !== parsed.version) {
                throw new Error(
                    `Dependency version conflict for '${parsed.key}': '${existing.version}' in '${existing.pluginId}', '${parsed.version}' in '${plugin.id}'`
                )
            }
            if (!existing) {
                dependencies.set(parsed.key, { version: parsed.version, pluginId: plugin.id })
            }
        }
    }
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
    const relativePath = plugin.className.split(".").join(path.sep)
    const candidates = [
        path.join(plugin.androidDir, `${relativePath}.kt`),
        path.join(plugin.androidDir, `${relativePath}.java`),
    ]

    return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function validateSelectedPluginSources(plugins) {
    for (const plugin of plugins) {
        if (!isDir(plugin.androidDir)) {
            throw new Error(`Android source directory missing for selected plugin '${plugin.id}'`)
        }

        const codeFiles = walkFiles(
            plugin.androidDir,
            (name) => name.endsWith(".kt") || name.endsWith(".java")
        )
        if (codeFiles.length === 0) {
            throw new Error(`No Android source files found for selected plugin '${plugin.id}'`)
        }

        if (!resolvePluginClassSourcePath(plugin)) {
            throw new Error(
                `Declared class '${plugin.className}' for selected plugin '${plugin.id}' was not found under ${plugin.androidDir}`
            )
        }
    }
}

function copyTree(sourceDir, targetDir) {
    if (!isDir(sourceDir)) {
        return
    }

    ensureDir(targetDir)
    for (const filePath of walkFiles(sourceDir, () => true)) {
        const targetPath = path.join(targetDir, path.relative(sourceDir, filePath))
        ensureDir(path.dirname(targetPath))
        fs.copyFileSync(filePath, targetPath)
    }
}

function copyAndroidPluginSources(plugins, javaRoot, log) {
    const internalRoot = path.join(javaRoot, ...PLUGINS_PACKAGE_PARTS, "internal")
    fs.rmSync(internalRoot, { recursive: true, force: true })
    ensureDir(internalRoot)

    let copiedCount = 0
    for (const plugin of plugins) {
        const pluginOutputDir = path.join(internalRoot, sanitizeForPath(plugin.id))
        const codeFiles = walkFiles(
            plugin.androidDir,
            (name) => name.endsWith(".kt") || name.endsWith(".java")
        )

        for (const sourcePath of codeFiles) {
            const targetPath = path.join(pluginOutputDir, path.relative(plugin.androidDir, sourcePath))
            ensureDir(path.dirname(targetPath))
            fs.copyFileSync(sourcePath, targetPath)
            copiedCount++
        }
    }

    log(`Copied ${copiedCount} Android plugin source file(s)`, "info")
}

function copyPluginAssets(plugins, androidProjectPath, log) {
    const baseAssetsDir = path.join(androidProjectPath, "app", "src", "main", "assets", "plugins")
    fs.rmSync(baseAssetsDir, { recursive: true, force: true })
    ensureDir(baseAssetsDir)

    for (const plugin of plugins) {
        const pluginAssetsDir = path.join(baseAssetsDir, sanitizeForPath(plugin.id))
        copyTree(path.join(plugin.pluginDir, "assets", "common"), path.join(pluginAssetsDir, "common"))
        copyTree(path.join(plugin.pluginDir, "assets", "android"), path.join(pluginAssetsDir, "android"))
    }

    log("Plugin assets copied to app/src/main/assets/plugins", "info")
}

function formatKotlinMap(entries, emptyLiteral = "emptyMap()") {
    return entries.length === 0 ? emptyLiteral : `mapOf(\n${entries.join(",\n")}\n    )`
}

function generatePluginRegistryFiles(plugins, javaRoot) {
    const pluginIdToClassName = {}
    const pluginToCommands = {}
    const pluginToCallbacks = {}

    for (const plugin of plugins) {
        pluginIdToClassName[plugin.id] = plugin.className
        pluginToCommands[plugin.id] = asUniqueSorted(plugin.commands)
        pluginToCallbacks[plugin.id] = asUniqueSorted(plugin.callbacks)
    }

    const classEntries = Object.keys(pluginIdToClassName)
        .sort()
        .map(
            (pluginId) =>
                `        ${JSON.stringify(pluginId)} to ${JSON.stringify(pluginIdToClassName[pluginId])}`
        )

    const commandEntries = Object.keys(pluginToCommands)
        .sort()
        .map((pluginId) => {
            const commands = pluginToCommands[pluginId]
            const commandSet = commands.length
                ? `setOf(${commands.map((value) => JSON.stringify(value)).join(", ")})`
                : "emptySet()"
            return `        ${JSON.stringify(pluginId)} to ${commandSet}`
        })

    const callbackEntries = Object.keys(pluginToCallbacks)
        .sort()
        .map((pluginId) => {
            const callbacks = pluginToCallbacks[pluginId]
            const callbackSet = callbacks.length
                ? `setOf(${callbacks.map((value) => JSON.stringify(value)).join(", ")})`
                : "emptySet()"
            return `        ${JSON.stringify(pluginId)} to ${callbackSet}`
        })

    const indexContent = `package io.yourname.androidproject.plugins

object GeneratedPluginIndex {
    val pluginIdToClassName: Map<String, String> = ${formatKotlinMap(classEntries)}
    val pluginToCommands: Map<String, Set<String>> = ${formatKotlinMap(commandEntries)}
    val pluginToCallbacks: Map<String, Set<String>> = ${formatKotlinMap(callbackEntries)}
}
`

    const pluginsDir = path.join(javaRoot, ...PLUGINS_PACKAGE_PARTS)
    ensureDir(pluginsDir)
    fs.writeFileSync(path.join(pluginsDir, "GeneratedPluginIndex.kt"), indexContent)
    fs.rmSync(path.join(pluginsDir, "GeneratedPluginMeta.kt"), { force: true })
}

function escapeRegexLiteral(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function updateAndroidManifestPermissions(manifestPath, selectedPermissions, allKnownPluginPermissions) {
    const uniquePermissions = asUniqueSorted(selectedPermissions)
    const knownPermissions = asUniqueSorted(allKnownPluginPermissions)
    let manifest = fs.readFileSync(manifestPath, "utf8")

    const beginMarker = "<!-- CATALYST_PLUGIN_PERMISSIONS_START -->"
    const endMarker = "<!-- CATALYST_PLUGIN_PERMISSIONS_END -->"
    const markerRegex =
        /[ \t]*<!-- CATALYST_PLUGIN_PERMISSIONS_START -->[\s\S]*?<!-- CATALYST_PLUGIN_PERMISSIONS_END -->\s*/g
    manifest = manifest.replace(markerRegex, "")

    // Migration cleanup for legacy entries previously written without markers.
    for (const permission of knownPermissions) {
        const escaped = escapeRegexLiteral(permission)
        const legacyRegex = new RegExp(
            `^[ \\t]*<uses-permission\\s+android:name="${escaped}"\\s*/>\\s*\\n?`,
            "gm"
        )
        manifest = manifest.replace(legacyRegex, "")
    }

    if (uniquePermissions.length > 0) {
        const permissionLines = uniquePermissions
            .map((permission) => `    <uses-permission android:name="${permission}" />`)
            .join("\n")
        const managedBlock = `    ${beginMarker}\n${permissionLines}\n    ${endMarker}\n`
        manifest = manifest.replace(/<application\b/, `${managedBlock}    <application`)
    }

    fs.writeFileSync(manifestPath, manifest)
}

function findDependenciesBlockRange(gradleText, gradlePath) {
    const headerMatch = gradleText.match(/^\s*dependencies\s*\{/m)
    if (!headerMatch || headerMatch.index == null) {
        throw new Error(`Could not find dependencies block in ${gradlePath}`)
    }

    const openBraceIndex = gradleText.indexOf("{", headerMatch.index)
    if (openBraceIndex === -1) {
        throw new Error(`Malformed dependencies block in ${gradlePath}`)
    }

    let depth = 0
    for (let index = openBraceIndex; index < gradleText.length; index++) {
        const ch = gradleText[index]
        if (ch === "{") depth++
        if (ch === "}") depth--
        if (depth === 0) {
            return { openBraceIndex, blockEnd: index }
        }
    }

    throw new Error(`Could not find end of dependencies block in ${gradlePath}`)
}

function updateGradleDependencies(gradlePath, selectedDependencies, allKnownPluginDependencies) {
    const uniqueDependencies = asUniqueSorted(selectedDependencies)
    const knownDependencies = asUniqueSorted(allKnownPluginDependencies)
    let gradle = fs.readFileSync(gradlePath, "utf8")
    const { openBraceIndex, blockEnd } = findDependenciesBlockRange(gradle, gradlePath)
    let blockBody = gradle.slice(openBraceIndex + 1, blockEnd)

    const beginMarker = "// CATALYST_PLUGIN_DEPENDENCIES_START"
    const endMarker = "// CATALYST_PLUGIN_DEPENDENCIES_END"
    const markerRegex =
        /[ \t]*\/\/ CATALYST_PLUGIN_DEPENDENCIES_START[\s\S]*?\/\/ CATALYST_PLUGIN_DEPENDENCIES_END\s*/g
    blockBody = blockBody.replace(markerRegex, "")

    // Migration cleanup for legacy entries previously written without markers.
    for (const dependency of knownDependencies) {
        const escaped = escapeRegexLiteral(dependency)
        const legacyRegex = new RegExp(`^[ \\t]*implementation\\("${escaped}"\\)\\s*\\n?`, "gm")
        blockBody = blockBody.replace(legacyRegex, "")
    }

    if (uniqueDependencies.length > 0) {
        const managedLines = uniqueDependencies
            .map((dependency) => `    implementation("${dependency}")`)
            .join("\n")
        blockBody = `${blockBody}\n    ${beginMarker}\n${managedLines}\n    ${endMarker}\n`
    }

    gradle = `${gradle.slice(0, openBraceIndex + 1)}${blockBody}${gradle.slice(blockEnd)}`
    fs.writeFileSync(gradlePath, gradle)
}

function composeAndroidPlugins({ corePluginsRoot, androidProjectPath, pluginConfig, log }) {
    const discovered = discoverInternalPlugins(corePluginsRoot, log)
    validatePlugins(discovered)
    const selected = selectPluginsByConfig(discovered, pluginConfig, log)
    validateSelectedPluginSources(selected)

    const javaRoot = path.join(androidProjectPath, "app", "src", "main", "java")
    const manifestPath = path.join(androidProjectPath, "app", "src", "main", "AndroidManifest.xml")
    const gradlePath = path.join(androidProjectPath, "app", "build.gradle.kts")

    copyAndroidPluginSources(selected, javaRoot, log)
    copyPluginAssets(selected, androidProjectPath, log)
    generatePluginRegistryFiles(selected, javaRoot)
    updateAndroidManifestPermissions(
        manifestPath,
        selected.flatMap((plugin) => plugin.permissions),
        discovered.flatMap((plugin) => plugin.permissions)
    )
    updateGradleDependencies(
        gradlePath,
        selected.flatMap((plugin) => plugin.dependencies),
        discovered.flatMap((plugin) => plugin.dependencies)
    )

    log(`Plugin composition complete (${selected.length} enabled plugin(s))`, "success")
    return {
        pluginCount: selected.length,
        commandCount: selected.reduce((total, plugin) => total + plugin.commands.length, 0),
    }
}

module.exports = { composeAndroidPlugins }
