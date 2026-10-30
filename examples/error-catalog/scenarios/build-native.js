import fs from "fs"
import path from "path"
import { restoreBaselineConfig } from "./_baseline.js"

// break() paths read the live config, mutate one key, and re-write it (a
// deliberately broken variant — byte formatting doesn't matter). restore()
// writes the committed config bytes back via restoreBaselineConfig().

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4))
}

export const buildNativeScenarios = [
    {
        code: "ANDROID-000",
        title: "Android build failed in upstream toolchain step",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            delete conf.WEBVIEW_CONFIG
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:android"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["ANDROID-000"], exitNonZero: true },
    },
    {
        code: "IOS-000",
        title: "iOS build failed in upstream toolchain step",
        tier: "build-native",
        kind: "build-native",
        // Anywhere else buildApp:ios stops at IOS-002, before any toolchain runs.
        platforms: ["darwin"],
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = { ios: {} }
            delete conf.BUILD_OUTPUT_PATH
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:ios"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["IOS-000"], exitNonZero: true },
    },
    {
        code: "IOS-002",
        title: "iOS build on a machine that is not a Mac",
        tier: "build-native",
        kind: "build-native",
        platforms: ["linux", "win32"],
        // Nothing to break: being on this machine is the mistake.
        break: () => {},
        restore: () => {},
        run: { cmd: "catalyst", args: ["buildApp:ios"], kind: "build-native" },
        expect: { inOutput: ["IOS-002", "macOS"], exitNonZero: true },
    },
]

export default buildNativeScenarios
