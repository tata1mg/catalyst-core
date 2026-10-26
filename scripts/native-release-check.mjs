#!/usr/bin/env node
// Release-build checks for the native CLI, run by the android-release-build
// and ios-release-archive CI jobs and runnable locally:
//
//   node scripts/native-release-check.mjs android <app-dir>
//   node scripts/native-release-check.mjs ios <app-dir>
//
// <app-dir> is a Catalyst app with catalyst-core installed (CI uses
// examples/catalyst-core-test with the packed local core). Each scenario
// writes its own WEBVIEW_CONFIG into config/config.json and runs the real
// `catalyst buildApp:<platform> --release`; the original config is restored
// at the end. Android signs with CATALYST_ANDROID_* from the environment, or
// with a throwaway keystore made here by keytool when those are not set.

import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const [platform, appArg] = process.argv.slice(2)
if (!["android", "ios"].includes(platform) || !appArg) {
    console.error("Usage: node scripts/native-release-check.mjs <android|ios> <app-dir>")
    process.exit(2)
}

const appDir = path.resolve(appArg)
const configPath = path.join(appDir, "config", "config.json")
const originalConfig = fs.readFileSync(configPath, "utf8")
const baseConfig = JSON.parse(originalConfig)
const outputRoot = path.join(appDir, baseConfig.BUILD_OUTPUT_PATH || "build")

const DEV_HOST = "192.168.1.20"
const PROD_HOST = "www.example.com"
const API_BASE_URL = "https://api.example.com/v1/"
const BUILD_NUMBER = "7"
const RELEASE_BLOCK = { LOCAL_IP: PROD_HOST, port: 443, useHttps: true }
// Private, loopback and link-local IPv4 addresses: none may reach a store build.
const PRIVATE_IP =
    /\b(?:10\.\d{1,3}|127\.\d{1,3}|192\.168|169\.254|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/

const failures = []
const tempDirs = []

function check(condition, message) {
    console.log(`${condition ? "  ok  " : "  FAIL"} ${message}`)
    if (!condition) failures.push(message)
}

function writeConfig(webviewConfig) {
    fs.writeFileSync(
        configPath,
        `${JSON.stringify({ ...baseConfig, WEBVIEW_CONFIG: webviewConfig }, null, 4)}\n`
    )
}

function tempDir(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
}

/** Run `catalyst buildApp:<platform>` in the app, streaming and capturing its output. */
function buildApp(args, env) {
    console.log(`\n$ catalyst buildApp:${platform} ${args.join(" ")}`)
    return new Promise((resolve) => {
        const child = spawn("npx", ["--no-install", "catalyst", `buildApp:${platform}`, ...args], {
            cwd: appDir,
            env: { ...env, CI: "true", NO_COLOR: "1", FORCE_COLOR: "0" },
            stdio: ["ignore", "pipe", "pipe"],
        })
        let output = ""
        const tee = (stream) => (chunk) => {
            output += chunk
            stream.write(chunk)
        }
        child.stdout.on("data", tee(process.stdout))
        child.stderr.on("data", tee(process.stderr))
        child.on("close", (status) => resolve({ status, output }))
    })
}

/** The environment without a build number, so each scenario chooses its own. */
function baseEnv() {
    const env = { ...process.env }
    delete env.CATALYST_BUILD_NUMBER
    return env
}

async function expectFailure(name, webviewConfig, args, code) {
    console.log(`\n== ${name}: expect ${code}`)
    writeConfig(webviewConfig)
    const { status, output } = await buildApp(args, baseEnv())
    check(status === 1, `${name}: exits 1 (got ${status})`)
    check(output.includes(code), `${name}: output names ${code}`)
}

// --- Android ---------------------------------------------------------------

function signingEnv() {
    if (process.env.CATALYST_ANDROID_KEYSTORE_BASE64) return {}
    const dir = tempDir("catalyst-ci-keystore-")
    const keystore = path.join(dir, "upload.jks")
    const password = randomBytes(18).toString("hex")
    const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", "keytool") : "keytool"
    const result = spawnSync(
        keytool,
        [
            "-genkeypair",
            "-keystore",
            keystore,
            "-storetype",
            "PKCS12",
            "-alias",
            "upload",
            "-keyalg",
            "RSA",
            "-keysize",
            "2048",
            "-validity",
            "3650",
            "-dname",
            "CN=Catalyst CI throwaway key",
            "-storepass:env",
            "CATALYST_CI_STOREPASS",
            "-keypass:env",
            "CATALYST_CI_STOREPASS",
        ],
        { env: { ...process.env, CATALYST_CI_STOREPASS: password }, encoding: "utf8" }
    )
    if (result.status !== 0) {
        throw new Error(`keytool could not create the throwaway keystore: ${result.stderr || result.error}`)
    }
    console.log("Signing with a throwaway keystore made by keytool")
    return {
        CATALYST_ANDROID_KEYSTORE_BASE64: fs.readFileSync(keystore).toString("base64"),
        CATALYST_ANDROID_STORE_PASSWORD: password,
        CATALYST_ANDROID_KEY_PASSWORD: password,
        CATALYST_ANDROID_KEY_ALIAS: "upload",
    }
}

/** Parse a Java .properties file (key=value, backslash escapes). */
function parseProperties(text) {
    const props = {}
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim() || /^\s*[#!]/.test(line)) continue
        const match = /^((?:\\.|[^=:\\])*)[=:](.*)$/.exec(line)
        if (!match) continue
        const unescape = (value) => value.replace(/\\(.)/g, "$1")
        props[unescape(match[1]).trim()] = unescape(match[2])
    }
    return props
}

function newestAab(since) {
    const dir = path.join(appDir, "build-output")
    if (!fs.existsSync(dir)) return null
    return (
        fs
            .readdirSync(dir)
            .filter((file) => file.endsWith(".aab"))
            .map((file) => path.join(dir, file))
            .filter((file) => fs.statSync(file).mtimeMs >= since)
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null
    )
}

function aabProperties(aab) {
    const result = spawnSync("unzip", ["-p", aab, "base/assets/webview_config.properties"], {
        encoding: "utf8",
    })
    if (result.status !== 0) throw new Error(`unzip could not read webview_config.properties from ${aab}`)
    return { text: result.stdout, props: parseProperties(result.stdout) }
}

async function expectAab(name, webviewConfig, { expectWarning = false } = {}) {
    console.log(`\n== ${name}: expect a signed AAB`)
    writeConfig(webviewConfig)
    const started = Date.now() - 1000
    const { status, output } = await buildApp(["--release", "--build-number", BUILD_NUMBER], {
        ...baseEnv(),
        ...signing,
    })
    check(status === 0, `${name}: exits 0 (got ${status})`)
    const warned = output.includes("WEBVIEW_CONFIG.release is not set")
    check(
        warned === expectWarning,
        `${name}: ${expectWarning ? "prints" : "does not print"} the deprecation warning`
    )
    const aab = newestAab(started)
    check(Boolean(aab), `${name}: wrote an .aab to build-output/`)
    if (!aab) return
    const { text, props } = aabProperties(aab)
    check(props.buildType === "release", `${name}: buildType=release (got ${props.buildType})`)
    check(props.LOCAL_IP === PROD_HOST, `${name}: LOCAL_IP=${PROD_HOST} (got ${props.LOCAL_IP})`)
    check(props.apiBaseUrl === API_BASE_URL, `${name}: apiBaseUrl preserved (got ${props.apiBaseUrl})`)
    const leaked = text.match(PRIVATE_IP)
    check(
        !leaked,
        `${name}: no private IP in webview_config.properties${leaked ? ` (found ${leaked[0]})` : ""}`
    )
}

let signing = {}

async function checkAndroid() {
    const android = {
        buildType: "debug",
        packageName: "com.catalyst.releasefixture",
        appName: "ReleaseFixture",
    }
    const dev = { LOCAL_IP: DEV_HOST, port: "3005", apiBaseUrl: API_BASE_URL, android }

    await expectFailure(
        "lan-host",
        { ...dev, release: { ...RELEASE_BLOCK, LOCAL_IP: DEV_HOST } },
        ["--release", "--build-number", BUILD_NUMBER],
        "ANDROID-002"
    )
    await expectFailure("no-build-number", { ...dev, release: RELEASE_BLOCK }, ["--release"], "ANDROID-003")

    signing = signingEnv()
    await expectAab("release-block", { ...dev, release: RELEASE_BLOCK })
    // Before 1.1.1 apps pointed LOCAL_IP itself at production: still builds, with a warning.
    await expectAab(
        "legacy-no-release-block",
        { ...dev, LOCAL_IP: PROD_HOST, port: "443", useHttps: true },
        { expectWarning: true }
    )
}

// --- iOS -------------------------------------------------------------------

function plistValue(file, keyPath) {
    const result = spawnSync("plutil", ["-extract", keyPath, "raw", "-o", "-", file], { encoding: "utf8" })
    return result.status === 0 ? result.stdout.trim() : null
}

async function checkIos() {
    const ios = {
        buildType: "debug",
        appBundleId: "com.catalyst.releasefixture",
        appName: "Release Fixture",
        version: { major: 2, minor: 5, patch: 0 },
    }
    const dev = { LOCAL_IP: DEV_HOST, port: "3005", apiBaseUrl: API_BASE_URL, ios }

    await expectFailure(
        "lan-host",
        { ...dev, release: { ...RELEASE_BLOCK, LOCAL_IP: DEV_HOST } },
        ["--release", "--no-sign", "--build-number", BUILD_NUMBER],
        "IOS-007"
    )
    await expectFailure(
        "no-build-number",
        { ...dev, release: RELEASE_BLOCK },
        ["--release", "--no-sign"],
        "IOS-008"
    )

    console.log("\n== release-block: expect an unsigned archive")
    writeConfig({ ...dev, release: RELEASE_BLOCK })
    const archive = path.join(
        outputRoot,
        "native",
        "ios",
        `2.5.0-${BUILD_NUMBER}`,
        "Release-Fixture.xcarchive"
    )
    fs.rmSync(archive, { recursive: true, force: true })
    const { status } = await buildApp(["--release", "--no-sign", "--build-number", BUILD_NUMBER], baseEnv())
    check(status === 0, `release-block: exits 0 (got ${status})`)
    check(fs.existsSync(archive), `release-block: archive at ${path.relative(appDir, archive)}`)
    if (!fs.existsSync(archive)) return

    const info = path.join(archive, "Info.plist")
    const build = plistValue(info, "ApplicationProperties.CFBundleVersion")
    const version = plistValue(info, "ApplicationProperties.CFBundleShortVersionString")
    check(build === BUILD_NUMBER, `release-block: CFBundleVersion=${BUILD_NUMBER} (got ${build})`)
    check(version === "2.5.0", `release-block: CFBundleShortVersionString=2.5.0 (got ${version})`)
    const bundleId = plistValue(info, "ApplicationProperties.CFBundleIdentifier")
    check(
        bundleId === ios.appBundleId,
        `release-block: CFBundleIdentifier=${ios.appBundleId} (got ${bundleId})`
    )

    const appsDir = path.join(archive, "Products", "Applications")
    const app = fs.existsSync(appsDir) ? fs.readdirSync(appsDir).find((file) => file.endsWith(".app")) : null
    check(Boolean(app), "release-block: archive contains an .app")
    if (app) {
        check(
            fs.existsSync(path.join(appsDir, app, "PrivacyInfo.xcprivacy")),
            `release-block: ${app}/PrivacyInfo.xcprivacy is bundled`
        )
    }

    const coreRoot = path.dirname(
        spawnSync(process.execPath, ["-p", 'require.resolve("catalyst-core/package.json")'], {
            cwd: appDir,
            encoding: "utf8",
        }).stdout.trim()
    )
    const constants = path.join(
        coreRoot,
        "dist/native/iosnativeWebView/CoreLogic/Sources/CatalystCoreLogic/Constants/ConfigConstants.swift"
    )
    const swift = fs.existsSync(constants) ? fs.readFileSync(constants, "utf8") : ""
    const expectedUrl = `public static let url = "https://${PROD_HOST}:443"`
    check(swift.includes(expectedUrl), `release-block: ConfigConstants has ${expectedUrl}`)
    check(swift.includes(`apiBaseUrl = "${API_BASE_URL}"`), "release-block: ConfigConstants keeps apiBaseUrl")
    const leaked = swift.match(PRIVATE_IP)
    check(!leaked, `release-block: no private IP in ConfigConstants${leaked ? ` (found ${leaked[0]})` : ""}`)
}

try {
    await (platform === "android" ? checkAndroid() : checkIos())
} catch (error) {
    failures.push(error.message)
    console.error(error)
} finally {
    fs.writeFileSync(configPath, originalConfig)
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
}

if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`)
    process.exit(1)
}
console.log(`\nAll ${platform} release checks passed.`)
