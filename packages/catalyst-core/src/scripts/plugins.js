"use strict"

const fs = require("fs")
const path = require("path")
const readline = require("node:readline")
const { bold, cyan, dim, green, red, yellow } = require("picocolors")
const { discoverInternalPlugins, resolveInternalPluginsRoot } = require("../native/internalPluginUtils.js")

const CONFIG_PATH = path.join(process.cwd(), "config", "config.json")
const TICK = "x"

function detectIndent(rawConfig) {
    const indentMatch = rawConfig.match(/\n([ \t]+)"/)
    return indentMatch ? indentMatch[1] : "    "
}

function readJsonFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`${label} not found at ${filePath}`)
    }

    const raw = fs.readFileSync(filePath, "utf8")

    try {
        return {
            raw,
            json: JSON.parse(raw),
        }
    } catch (error) {
        throw new Error(`Invalid JSON in ${filePath}: ${error.message}`)
    }
}

function ensureObject(value, label) {
    if (value == null) {
        return {}
    }

    if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object`)
    }

    return value
}

function splitPluginConfig(pluginConfig, plugins) {
    const selectorToPlugin = new Map()
    const matchesByConfigKey = new Map()
    const staleToggleKeys = []

    plugins.forEach((plugin) => {
        selectorToPlugin.set(plugin.configKey, plugin)
        selectorToPlugin.set(plugin.id, plugin)
    })

    for (const [key, value] of Object.entries(pluginConfig)) {
        if (typeof value !== "boolean") {
            throw new Error(`WEBVIEW_CONFIG.plugins.${key} must be boolean`)
        }

        const plugin = selectorToPlugin.get(key)
        if (!plugin) {
            staleToggleKeys.push(key)
            continue
        }

        const matches = matchesByConfigKey.get(plugin.configKey) || []
        matches.push({ key, value, plugin })
        matchesByConfigKey.set(plugin.configKey, matches)
    }

    const knownToggles = {}
    for (const plugin of plugins) {
        const matches = matchesByConfigKey.get(plugin.configKey) || []
        const uniqueValues = [...new Set(matches.map((entry) => entry.value))]
        if (uniqueValues.length > 1) {
            throw new Error(
                `Conflicting toggle values for plugin '${plugin.id}' across keys: ${matches
                    .map((entry) => `${entry.key}=${entry.value}`)
                    .join(", ")}`
            )
        }
        if (matches.length > 0) {
            knownToggles[plugin.configKey] = matches[0].value
        }
    }

    return { knownToggles, staleToggleKeys }
}

function createSession({ configPath, rawConfig, config, plugins, pluginsRoot }) {
    const webviewConfig =
        config.WEBVIEW_CONFIG == null ? {} : ensureObject(config.WEBVIEW_CONFIG, "WEBVIEW_CONFIG")
    const pluginConfig = ensureObject(webviewConfig.plugins, "WEBVIEW_CONFIG.plugins")
    const { knownToggles, staleToggleKeys } = splitPluginConfig(pluginConfig, plugins)

    return {
        configPath,
        config,
        indent: detectIndent(rawConfig),
        pluginsRoot,
        plugins: plugins.map((plugin) => ({
            ...plugin,
            enabled: knownToggles[plugin.configKey] ?? false,
        })),
        staleToggleKeys,
        notice: "",
        selectedIndex: 0,
    }
}

function buildPersistedPluginConfig(session) {
    const nextConfig = {}

    for (const plugin of session.plugins) {
        nextConfig[plugin.configKey] = plugin.enabled
    }

    return nextConfig
}

function renderSession(session) {
    if (typeof console.clear === "function") {
        console.clear()
    }

    console.log(bold("Catalyst Internal Plugins"))
    console.log(dim(`Config: ${session.configPath}`))
    console.log(dim(`Catalog: ${session.pluginsRoot}`))
    console.log("")

    if (session.staleToggleKeys.length > 0) {
        console.log(
            yellow(`Stale plugin toggle keys will be removed on save: ${session.staleToggleKeys.join(", ")}`)
        )
        console.log("")
    }

    session.plugins.forEach((plugin, index) => {
        const isSelected = index === session.selectedIndex
        const pointer = isSelected ? cyan(">") : " "
        const checkbox = plugin.enabled ? green(`[${TICK}]`) : dim("[ ]")
        const title = isSelected ? bold(plugin.displayName) : plugin.displayName
        const meta = dim(`(${plugin.configKey})`)

        console.log(`${pointer} ${checkbox} ${title} ${meta}`)
        console.log(`    ${plugin.description}`)
        console.log(dim(`    category: ${plugin.category} | platforms: ${plugin.platforms.join(", ")}`))
        console.log(dim(`    id: ${plugin.id}`))
        console.log("")
    })

    console.log("Controls: up/down move, space or enter toggle, a enable all, n disable all, s save, q quit")
    if (session.notice) {
        console.log("")
        console.log(session.notice)
    }
}

function saveSession(session) {
    if (session.config.WEBVIEW_CONFIG == null) {
        session.config.WEBVIEW_CONFIG = {}
    }

    session.config.WEBVIEW_CONFIG.plugins = buildPersistedPluginConfig(session)
    fs.writeFileSync(session.configPath, `${JSON.stringify(session.config, null, session.indent)}\n`)
}

async function runInteractiveSession(session) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        renderSession(session)
        console.log("")
        console.log(yellow("Interactive mode requires a TTY. Re-run this command in a terminal session."))
        return
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    readline.emitKeypressEvents(process.stdin, rl)
    if (typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(true)
    }

    try {
        renderSession(session)

        await new Promise((resolve) => {
            const finish = () => {
                process.stdin.off("keypress", onKeypress)
                resolve()
            }

            const onKeypress = (_, key = {}) => {
                if (key.ctrl && key.name === "c") {
                    session.notice = yellow("Exited without saving.")
                    renderSession(session)
                    finish()
                    return
                }

                if (key.name === "up") {
                    session.selectedIndex =
                        session.selectedIndex === 0 ? session.plugins.length - 1 : session.selectedIndex - 1
                    session.notice = ""
                    renderSession(session)
                    return
                }

                if (key.name === "down") {
                    session.selectedIndex =
                        session.selectedIndex === session.plugins.length - 1 ? 0 : session.selectedIndex + 1
                    session.notice = ""
                    renderSession(session)
                    return
                }

                if (key.name === "space" || key.name === "return") {
                    const plugin = session.plugins[session.selectedIndex]
                    plugin.enabled = !plugin.enabled
                    session.notice = green(
                        `${plugin.displayName} is now ${plugin.enabled ? "enabled" : "disabled"} in the pending config.`
                    )
                    renderSession(session)
                    return
                }

                if (key.name === "a") {
                    session.plugins.forEach((plugin) => {
                        plugin.enabled = true
                    })
                    session.notice = green("Enabled all discovered plugins.")
                    renderSession(session)
                    return
                }

                if (key.name === "n") {
                    session.plugins.forEach((plugin) => {
                        plugin.enabled = false
                    })
                    session.notice = yellow("Disabled all discovered plugins.")
                    renderSession(session)
                    return
                }

                if (key.name === "s") {
                    saveSession(session)
                    session.notice =
                        session.staleToggleKeys.length > 0
                            ? green(
                                  `Saved plugin toggles to config/config.json and removed stale keys: ${session.staleToggleKeys.join(", ")}.`
                              )
                            : green("Saved plugin toggles to config/config.json.")
                    renderSession(session)
                    finish()
                    return
                }

                if (key.name === "q") {
                    session.notice = yellow("Exited without saving.")
                    renderSession(session)
                    finish()
                    return
                }

                session.notice = red(`Unsupported key: ${key.name || "unknown"}`)
                renderSession(session)
            }

            process.stdin.on("keypress", onKeypress)
        })
    } finally {
        if (typeof process.stdin.setRawMode === "function") {
            process.stdin.setRawMode(false)
        }
        rl.close()
    }
}

async function main() {
    const { raw: rawConfig, json: config } = readJsonFile(CONFIG_PATH, "App config")
    const catalystCoreRoot = path.dirname(require.resolve("catalyst-core/package.json"))
    const pluginsRoot = resolveInternalPluginsRoot(catalystCoreRoot)
    const plugins = discoverInternalPlugins(pluginsRoot)

    if (plugins.length === 0) {
        console.log(yellow(`No internal plugins were discovered at ${pluginsRoot}`))
        return
    }

    const session = createSession({
        configPath: CONFIG_PATH,
        rawConfig,
        config,
        plugins,
        pluginsRoot,
    })

    await runInteractiveSession(session)
}

main().catch((error) => {
    console.error(red(`Plugin manager failed: ${error.message}`))
    process.exit(1)
})
