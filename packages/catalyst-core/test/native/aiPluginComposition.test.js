import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"

// src/native is a CommonJS subtree (see its package.json); load it with require from this ESM test.
const require = createRequire(import.meta.url)
const { composeIosPlugins } = require("../../src/native/pluginComposerIos.js")
const { resolveAIPluginSource, resolveInternalPluginsRoot } = require("../../src/native/internalPluginUtils.js")

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../../../..")
const coreRoot = path.resolve(here, "../..")
const aiPluginsRoot = path.join(repoRoot, "packages", "catalyst-ai", "plugins")

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-ai-compose-"))
}

// A fake app: <project>/node_modules/catalyst-ai/plugins -> the real in-repo plugin directory.
function fakeAppWithCatalystAI() {
    const project = tempDir()
    const pkgDir = path.join(project, "node_modules", "catalyst-ai")
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.symlinkSync(aiPluginsRoot, path.join(pkgDir, "plugins"))
    return project
}

test("resolveAIPluginSource: nothing happens unless ai.enabled is true", () => {
    const project = fakeAppWithCatalystAI()
    for (const config of [{}, { ai: {} }, { ai: { enabled: false } }, undefined]) {
        assert.deepEqual(resolveAIPluginSource(config, project), { roots: [], toggles: {} })
    }
})

test("resolveAIPluginSource: enabled + package present -> plugin root and ai toggle", () => {
    const project = fakeAppWithCatalystAI()
    const { roots, toggles } = resolveAIPluginSource({ ai: { enabled: true } }, project)
    assert.deepEqual(roots, [path.join(project, "node_modules", "catalyst-ai", "plugins")])
    assert.deepEqual(toggles, { ai: true })
})

test("resolveAIPluginSource: enabled but catalyst-ai missing -> warns and skips, build continues", () => {
    const logs = []
    const result = resolveAIPluginSource({ ai: { enabled: true } }, tempDir(), (message, status) =>
        logs.push([status, message])
    )
    assert.deepEqual(result, { roots: [], toggles: {} })
    assert.equal(logs.length, 1)
    assert.equal(logs[0][0], "warning")
    assert.match(logs[0][1], /catalyst-ai not found/)
})

test("composeIosPlugins: ai plugin contributes sources, registry entry, LiteRT-LM dependency and entitlement", () => {
    const iosProjectPath = tempDir()
    const composition = composeIosPlugins({
        corePluginsRoot: resolveInternalPluginsRoot(coreRoot),
        externalPluginRoots: [aiPluginsRoot],
        iosProjectPath,
        pluginConfig: { ai: true },
        log: () => {},
    })

    assert.equal(composition.pluginCount, 1)
    assert.deepEqual(
        composition.iosDependencies.map((d) => ({ url: d.url, products: d.products, requirement: d.requirement })),
        [
            {
                url: "https://github.com/google-ai-edge/LiteRT-LM",
                products: ["LiteRTLM"],
                requirement: { type: "exact", version: "0.17.1" },
            },
        ]
    )
    assert.deepEqual(composition.entitlements, { "com.apple.developer.kernel.increased-memory-limit": true })

    const index = fs.readFileSync(
        path.join(iosProjectPath, "Sources", "Core", "Plugins", "GeneratedPluginIndex.swift"),
        "utf8"
    )
    assert.match(index, /"io\.catalyst\.ai": \{ CatalystAIPlugin\(\) \}/)
    assert.match(index, /"io\.catalyst\.ai": Set\(\["clearConversation", "initAI"\]\)/)

    const copied = path.join(iosProjectPath, "Sources", "Core", "Plugins", "Internal", "io_catalyst_ai")
    for (const file of [
        "CatalystAIPlugin.swift",
        "CatalystAIBridge.swift",
        "NativeBridgeAI.swift",
        "FoundationModelsAI.swift",
        "AIBridge.swift",
        path.join("Support", "StreamDelta.swift"),
    ]) {
        assert.ok(fs.existsSync(path.join(copied, file)), `${file} should be copied into the app`)
    }
})

test("composeIosPlugins: ai plugin is NOT composed when the ai toggle is off", () => {
    const iosProjectPath = tempDir()
    const composition = composeIosPlugins({
        corePluginsRoot: resolveInternalPluginsRoot(coreRoot),
        externalPluginRoots: [aiPluginsRoot],
        iosProjectPath,
        pluginConfig: {},
        log: () => {},
    })
    assert.equal(composition.pluginCount, 0)
    assert.deepEqual(composition.iosDependencies, [])
    assert.deepEqual(composition.entitlements, {})
})
