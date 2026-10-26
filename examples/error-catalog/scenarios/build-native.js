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
    // IOS-007..011 and IOS-013 fire while buildApp:ios resolves the release
    // config, before Xcode is touched, so they reproduce on a Linux runner.
    // ios.buildType "release" stands in for --release.
    {
        code: "IOS-007",
        title: "Release build points at a LAN address",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = { port: 3005, LOCAL_IP: "192.168.1.10", ios: { buildType: "release" } }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:ios"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["IOS-007"], exitNonZero: true },
    },
    {
        code: "IOS-008",
        title: "Release build without a build number",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                port: 3005,
                ios: { buildType: "release" },
                release: { LOCAL_IP: "www.example.com", useHttps: true, port: 443 },
            }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:ios"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["IOS-008"], exitNonZero: true },
    },
    {
        code: "IOS-009",
        title: "Release build number of 0",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                port: 3005,
                ios: { buildType: "release", version: { major: 1, buildNumber: 0 } },
                release: { LOCAL_IP: "www.example.com", useHttps: true, port: 443 },
            }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:ios"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["IOS-009"], exitNonZero: true },
    },
    {
        code: "IOS-010",
        title: "Signed release build with no development team",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                port: 3005,
                ios: { buildType: "release", version: { major: 1, buildNumber: 7 } },
                release: { LOCAL_IP: "www.example.com", useHttps: true, port: 443 },
            }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:ios"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["IOS-010"], exitNonZero: true },
    },
    {
        code: "IOS-011",
        title: "App Store Connect API key with only a key ID",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                port: 3005,
                ios: {
                    buildType: "release",
                    version: { major: 1, buildNumber: 7 },
                    developmentTeam: "ABCDE12345",
                    ascApiKey: { keyId: "ABC123" },
                },
                release: { LOCAL_IP: "www.example.com", useHttps: true, port: 443 },
            }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:ios"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["IOS-011"], exitNonZero: true },
    },
    {
        code: "IOS-013",
        title: "Unknown iOS export method",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                port: 3005,
                ios: {
                    buildType: "release",
                    version: { major: 1, buildNumber: 7 },
                    developmentTeam: "ABCDE12345",
                    exportMethod: "app-store-please",
                },
                release: { LOCAL_IP: "www.example.com", useHttps: true, port: 443 },
            }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:ios"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["IOS-013"], exitNonZero: true },
    },
]

export default buildNativeScenarios
