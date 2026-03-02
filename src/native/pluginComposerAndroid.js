"use strict"

const fs = require("fs")
const path = require("path")

const APP_PLUGIN_DIRS = ["plugin", "plugins", "catalyst-plugins"]
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

function mustBeNonEmptyString(value, fieldName, manifestPath) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Invalid '${fieldName}' in ${manifestPath}`)
    }
    return value.trim()
}

function readStringArray(value, fieldName, manifestPath, { required = false, nonEmpty = false } = {}) {
    if (!Array.isArray(value)) {
        if (required) {
            throw new Error(`'${fieldName}' is required and must be an array in ${manifestPath}`)
        }
        return []
    }

    const result = value.map((entry) => mustBeNonEmptyString(entry, `${fieldName}[]`, manifestPath))
    if (nonEmpty && result.length === 0) {
        throw new Error(`'${fieldName}' is required and must be non-empty in ${manifestPath}`)
    }
    return result
}

function readManifest(pluginDir) {
    const manifestPath = path.join(pluginDir, "manifest.json")
    if (!fs.existsSync(manifestPath)) {
        return null
    }

    return {
        manifestPath,
        manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")),
    }
}

function discoverPlugins({ appRoot, corePluginsRoot, log }) {
    const roots = []
    if (corePluginsRoot && isDir(corePluginsRoot)) {
        roots.push({ root: corePluginsRoot, source: "core" })
    }

    for (const dirName of APP_PLUGIN_DIRS) {
        const absPath = path.join(appRoot, dirName)
        if (isDir(absPath)) {
            roots.push({ root: absPath, source: "app" })
        }
    }

    const discovered = []
    for (const { root, source } of roots) {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) {
                continue
            }

            const pluginDir = path.join(root, entry.name)
            const manifestData = readManifest(pluginDir)
            if (!manifestData) {
                continue
            }

            discovered.push({
                source,
                pluginDir,
                manifestPath: manifestData.manifestPath,
                manifest: manifestData.manifest,
            })
        }
    }

    log(`Discovered ${discovered.length} plugin manifest(s)`, "info")
    return discovered
}

function normalizePlugins(discovered) {
    const plugins = []

    for (const item of discovered) {
        const { manifest, manifestPath, pluginDir } = item
        if (manifest.enabled === false) {
            continue
        }

        const androidConfig = manifest.android
        if (!androidConfig || typeof androidConfig !== "object") {
            throw new Error(`'android' config is required for Android plugin in ${manifestPath}`)
        }

        plugins.push({
            ...item,
            id: mustBeNonEmptyString(manifest.id, "id", manifestPath),
            version: mustBeNonEmptyString(manifest.version, "version", manifestPath),
            pluginDir,
            commands: readStringArray(manifest.commands, "commands", manifestPath, {
                required: true,
                nonEmpty: true,
            }),
            callbacks: readStringArray(manifest.callbacks, "callbacks", manifestPath),
            permissions: readStringArray(androidConfig.permissions, "android.permissions", manifestPath),
            dependencies: readStringArray(androidConfig.dependencies, "android.dependencies", manifestPath),
            className: mustBeNonEmptyString(androidConfig.className, "android.className", manifestPath),
        })
    }

    return plugins
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

function validateCollisions(plugins) {
    const pluginIds = new Set()
    const dependencies = new Map()

    for (const plugin of plugins) {
        if (pluginIds.has(plugin.id)) {
            throw new Error(`Duplicate plugin id detected: ${plugin.id}`)
        }
        pluginIds.add(plugin.id)

        const uniqueCommands = new Set(plugin.commands)
        if (uniqueCommands.size !== plugin.commands.length) {
            throw new Error(`Duplicate command(s) detected within plugin '${plugin.id}'`)
        }

        const uniqueCallbacks = new Set(plugin.callbacks)
        if (uniqueCallbacks.size !== plugin.callbacks.length) {
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
    const externalRoot = path.join(javaRoot, ...PLUGINS_PACKAGE_PARTS, "external")
    fs.rmSync(externalRoot, { recursive: true, force: true })
    ensureDir(externalRoot)

    let copiedCount = 0
    for (const plugin of plugins) {
        const androidDir = path.join(plugin.pluginDir, "android")
        const pluginOutputDir = path.join(externalRoot, sanitizeForPath(plugin.id))
        const codeFiles = walkFiles(androidDir, (name) => name.endsWith(".kt") || name.endsWith(".java"))

        for (const sourcePath of codeFiles) {
            const targetPath = path.join(pluginOutputDir, path.relative(androidDir, sourcePath))
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

function asUniqueSorted(values) {
    return [...new Set(values)].sort()
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

function updateAndroidManifestPermissions(manifestPath, permissions) {
    const uniquePermissions = asUniqueSorted(permissions)
    if (uniquePermissions.length === 0) {
        return
    }

    let manifest = fs.readFileSync(manifestPath, "utf8")
    const permissionRegex = /<uses-permission\s+android:name="([^"]+)"[^>]*\/>/g
    const existingPermissions = new Set([...manifest.matchAll(permissionRegex)].map((match) => match[1]))
    const missingPermissions = uniquePermissions.filter((permission) => !existingPermissions.has(permission))

    if (missingPermissions.length === 0) {
        return
    }

    const permissionLines = missingPermissions
        .map((permission) => `    <uses-permission android:name="${permission}" />`)
        .join("\n")

    manifest = manifest.replace(/<application\b/, `${permissionLines}\n    <application`)
    fs.writeFileSync(manifestPath, manifest)
}

function findDependenciesBlockRange(gradleText, gradlePath) {
    const blockStart = gradleText.indexOf("\ndependencies {")
    if (blockStart === -1) {
        throw new Error(`Could not find main dependencies block in ${gradlePath}`)
    }

    const openBraceIndex = gradleText.indexOf("{", blockStart)
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

function updateGradleDependencies(gradlePath, dependencies) {
    const uniqueDependencies = asUniqueSorted(dependencies)
    if (uniqueDependencies.length === 0) {
        return
    }

    let gradle = fs.readFileSync(gradlePath, "utf8")
    const { openBraceIndex, blockEnd } = findDependenciesBlockRange(gradle, gradlePath)
    const blockBody = gradle.slice(openBraceIndex + 1, blockEnd)
    const missingDependencies = uniqueDependencies.filter(
        (dependency) => !blockBody.includes(`implementation("${dependency}")`)
    )

    if (missingDependencies.length === 0) {
        return
    }

    const linesToInsert = `\n${missingDependencies
        .map((dependency) => `    implementation("${dependency}")`)
        .join("\n")}\n`

    gradle = `${gradle.slice(0, blockEnd)}${linesToInsert}${gradle.slice(blockEnd)}`
    fs.writeFileSync(gradlePath, gradle)
}

function composeAndroidPlugins({ appRoot, corePluginsRoot, androidProjectPath, log }) {
    const discovered = discoverPlugins({ appRoot, corePluginsRoot, log })
    const plugins = normalizePlugins(discovered)
    validateCollisions(plugins)

    const javaRoot = path.join(androidProjectPath, "app", "src", "main", "java")
    const manifestPath = path.join(androidProjectPath, "app", "src", "main", "AndroidManifest.xml")
    const gradlePath = path.join(androidProjectPath, "app", "build.gradle.kts")

    copyAndroidPluginSources(plugins, javaRoot, log)
    copyPluginAssets(plugins, androidProjectPath, log)
    generatePluginRegistryFiles(plugins, javaRoot)
    updateAndroidManifestPermissions(
        manifestPath,
        plugins.flatMap((plugin) => plugin.permissions)
    )
    updateGradleDependencies(
        gradlePath,
        plugins.flatMap((plugin) => plugin.dependencies)
    )

    log(`Plugin composition complete (${plugins.length} enabled plugin(s))`, "success")
    return {
        pluginCount: plugins.length,
        commandCount: plugins.reduce((total, plugin) => total + plugin.commands.length, 0),
    }
}

module.exports = { composeAndroidPlugins }
