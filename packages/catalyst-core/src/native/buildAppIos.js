const path = require("path")
const { execFileSync } = require("child_process")
const { createIosBuild, pwd } = require("./buildIos/index.js")
const { composeIosPlugins } = require("./pluginComposerIos.js")
const { resolveInternalPluginsRoot, resolvePluginConfig, resolveAIPluginSource } = require("./internalPluginUtils.js")
const { formatBuildError } = require("./buildErrorFormat.js")

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = require(`${process.cwd()}/config/config.json`)

// catalyst-ai's iOS module depends on LiteRT-LM, whose Swift package keeps files in Git LFS.
// Without git-lfs, SwiftPM fails deep inside package resolution with an opaque error, so check first.
// Thrown as a plain Error: src/native is CJS, and build failures surface as IOS-000 with this message verbatim.
function assertGitLfsAvailable() {
    try {
        execFileSync("git", ["lfs", "version"], { stdio: "ignore" }) // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - fixed command, no user input.
    } catch {
        throw new Error(
            "ai.enabled=true needs Git LFS to fetch the LiteRT-LM Swift package. " +
                "Install it with `brew install git-lfs && git lfs install`. " +
                "If Xcode still cannot find it, run `ln -s $(which git-lfs) $(xcode-select -p)/usr/bin/git-lfs`."
        )
    }
}

async function main() {
    const build = createIosBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH })
    const {
        progress,
        generateConfigConstants,
        updateInfoPlist,
        updateEntitlements,
        syncPluginResources,
        buildForIOS,
        PROJECT_DIR,
    } = build

    try {
        progress.log("Starting build process...", "info")
        const aiPlugin = resolveAIPluginSource(WEBVIEW_CONFIG, process.cwd(), (message, status = "info") =>
            progress.log(message, status)
        )
        if (aiPlugin.roots.length > 0) assertGitLfsAvailable()
        const pluginConfig = { ...resolvePluginConfig(WEBVIEW_CONFIG), ...aiPlugin.toggles }
        const pluginComposition = composeIosPlugins({
            corePluginsRoot: resolveInternalPluginsRoot(catalystCorePath),
            externalPluginRoots: aiPlugin.roots,
            iosProjectPath: PROJECT_DIR,
            pluginConfig,
            log: (message, status = "info") => progress.log(message, status),
        })
        await generateConfigConstants()
        await updateInfoPlist(pluginComposition)
        await updateEntitlements(pluginComposition)
        await syncPluginResources(pluginComposition)
        await buildForIOS(pluginComposition)
    } catch (error) {
        // progress.log() prefixes every call with an icon/color and does a
        // single console.log per invocation — it's built for single-line
        // status messages, not our multi-line boxed verbose/debug output
        // (piping a box through it would prefix an icon onto every border
        // line and break the box shape). Bypass it here and use plain
        // console.error instead, matching buildAppAndroid.js; progress.log
        // is unaffected everywhere else in this build.
        console.error(formatBuildError({ code: "IOS-000", category: "IOS", upstreamName: "Xcode/CocoaPods", error }))
        process.exit(1)
    }
    process.exit(0)
}

if (require.main === module) {
    main()
}

// Legacy re-exports for any tooling that imports from this file directly
module.exports = { createIosBuild, pwd }
