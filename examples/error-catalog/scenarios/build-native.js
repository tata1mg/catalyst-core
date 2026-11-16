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
    // NATIVE-001, -003, -004 and -010 fire while the release config is resolved,
    // before any Android tooling is touched, so they reproduce on a runner
    // without the SDK. android.buildType "release" stands in for --release
    // (scenarios run the script without extra arguments).
    {
        code: "NATIVE-001",
        title: "Release build whose url is a LAN address",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                url: "http://192.168.1.10:3005",
                appId: "com.acme.shop",
                android: { buildType: "release" },
            }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:android"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["NATIVE-001"], exitNonZero: true },
    },
    {
        code: "NATIVE-003",
        title: "Release build with the template's app id",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                url: "https://shop.acme.com",
                appId: "com.example.app",
                android: { buildType: "release" },
            }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:android"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["NATIVE-003"], exitNonZero: true },
    },
    {
        code: "NATIVE-010",
        title: "App id with a Java keyword in it",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                url: "https://shop.acme.com",
                appId: "com.acme.new",
                android: { buildType: "release" },
            }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:android"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["NATIVE-010"], exitNonZero: true },
    },
    {
        code: "NATIVE-004",
        title: "Production url with a path",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                url: "https://shop.acme.com/app",
                appId: "com.acme.shop",
                android: { buildType: "release" },
            }
            writeJson(confPath, conf)
        },
        run: { cmd: "catalyst", args: ["buildApp:android"], kind: "build-native" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["NATIVE-004"], exitNonZero: true },
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
    // IOS-010, IOS-011 and IOS-013 fire while buildApp:ios resolves the
    // release config, before Xcode is touched, so they reproduce on a Linux
    // runner.
    // ios.buildType "release" stands in for --release.
    {
        code: "IOS-010",
        title: "Signed release build with no development team",
        tier: "build-native",
        kind: "build-native",
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                url: "https://shop.acme.com",
                appId: "com.acme.shop",
                ios: { buildType: "release" },
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
        title: "App Store Connect API key with no issuer ID",
        tier: "build-native",
        kind: "build-native",
        // credentials/ios/ holds an AuthKey_<KEYID>.p8 (a fake one) but no
        // signing.properties with its ascIssuerId line.
        break: (appDir) => {
            const confPath = path.join(appDir, "config", "config.json")
            const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
            conf.WEBVIEW_CONFIG = {
                url: "https://shop.acme.com",
                appId: "com.acme.shop",
                ios: { buildType: "release", developmentTeam: "ABCDE12345" },
            }
            writeJson(confPath, conf)
            const keyDir = path.join(appDir, "credentials", "ios")
            fs.mkdirSync(keyDir, { recursive: true })
            fs.writeFileSync(path.join(keyDir, "AuthKey_ABC123.p8"), "not a real key\n")
        },
        run: { cmd: "catalyst", args: ["buildApp:ios"], kind: "build-native" },
        restore: (appDir) => {
            fs.rmSync(path.join(appDir, "credentials"), { recursive: true, force: true })
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
                url: "https://shop.acme.com",
                appId: "com.acme.shop",
                ios: {
                    buildType: "release",
                    developmentTeam: "ABCDE12345",
                    exportMethod: "app-store-please",
                },
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
