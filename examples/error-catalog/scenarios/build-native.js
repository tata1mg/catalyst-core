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
    // ANDROID-002..004 fire while the release config is resolved, before any
    // Android tooling is touched, so they reproduce on a runner without the SDK.
    // android.buildType "release" stands in for --release (scenarios run the
    // script without extra arguments).
    {
        code: "ANDROID-002",
        title: "Release build points at a LAN address",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = { port: 3005, LOCAL_IP: "192.168.1.10", android: { buildType: "release" } }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:android"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["ANDROID-002"], exitNonZero: true },
    },
    {
        code: "ANDROID-003",
        title: "Release build without a build number",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                port: 3005,
                android: { buildType: "release" },
                release: { LOCAL_IP: "www.example.com", useHttps: true, port: 443 },
            }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:android"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["ANDROID-003"], exitNonZero: true },
    },
    {
        code: "ANDROID-004",
        title: "Release build number of 0",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                port: 3005,
                android: { buildType: "release", version: { major: 1, buildNumber: 0 } },
                release: { LOCAL_IP: "www.example.com", useHttps: true, port: 443 },
            }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:android"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["ANDROID-004"], exitNonZero: true },
    },
    {
        code: "IOS-000",
        title: "iOS build failed in upstream toolchain step",
        tier: "build-native",
        kind: "build-native",
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
]

export default buildNativeScenarios
