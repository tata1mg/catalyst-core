#!/usr/bin/env node
// Release-build checks for the native CLI, run by the android-release-build
// and ios-release-archive CI jobs and runnable locally:
//
//   node scripts/native-release-check.mjs android <app-dir>
//   node scripts/native-release-check.mjs ios <app-dir>
//   node scripts/native-release-check.mjs align <file.aab|file.apk>...
//
// <app-dir> is a Catalyst app with catalyst-core installed (CI uses
// examples/catalyst-core-test with the packed local core). Each scenario
// writes its own WEBVIEW_CONFIG into config/config.json and runs the real
// `catalyst buildApp:<platform> --release`; the original config is restored
// at the end. Android signs with CATALYST_ANDROID_CREDENTIALS from the
// environment, or with a throwaway key made here by keytool when it is not set.
// iOS has no unsigned release, so its signed IPA check needs real signing
// files: CATALYST_IOS_CREDENTIALS (`catalyst credentials:export ios`) plus
// RELEASE_CHECK_IOS_APP_ID, the bundle id they sign for, and for cloud
// signing RELEASE_CHECK_IOS_TEAM_ID. Without them only the iOS checks that
// fail before signing run, and the IPA check is skipped with a note.
// `align` checks the native libraries of built bundles or APKs for Google
// Play's 16 KB page size requirement (scripts/native-elf-alignment.mjs).

import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { checkNativeAlignment } from "./native-elf-alignment.mjs"

/** Print the 16 KB alignment of each native lib; returns the failures. */
function reportAlignment(file) {
    const { libs, failures } = checkNativeAlignment(file)
    for (const lib of libs) {
        const state = lib.ok ? "ok  " : lib.required ? "FAIL" : "note"
        console.log(
            `  ${state} ${lib.name} (${lib.bits}-bit, LOAD 0x${lib.minAlign.toString(16)})${lib.problem ? `: ${lib.problem}` : ""}`
        )
    }
    if (!libs.length) console.log(`  ok   ${path.basename(file)} has no native libraries`)
    return failures
}

if (process.argv[2] === "align") {
    const files = process.argv.slice(3)
    if (!files.length) {
        console.error("Usage: node scripts/native-release-check.mjs align <file.aab|file.apk>...")
        process.exit(2)
    }
    const failed = files.flatMap((file) => {
        console.log(`\n${file}`)
        return reportAlignment(file)
    })
    if (failed.length) {
        console.error(
            `\n${failed.length} 64-bit librar${failed.length === 1 ? "y is" : "ies are"} not 16 KB aligned:\n- ${failed.join("\n- ")}`
        )
        process.exit(1)
    }
    console.log("\nEvery 64-bit native library is 16 KB aligned.")
    process.exit(0)
}

const [platform, appArg] = process.argv.slice(2)
if (!["android", "ios"].includes(platform) || !appArg) {
    console.error("Usage: node scripts/native-release-check.mjs <android|ios> <app-dir>")
    process.exit(2)
}

const appDir = path.resolve(appArg)
const configPath = path.join(appDir, "config", "config.json")
const originalConfig = fs.readFileSync(configPath, "utf8")
const baseConfig = JSON.parse(originalConfig)

const DEV_HOST = "192.168.1.20"
// Not a reserved example domain: the release host guard refuses those.
const PROD_HOST = "shop.acme.com"
const API_BASE_URL = "https://api.acme.com/v1/"
const BUILD_NUMBER = "7"
const APP_ID = "com.catalyst.releasefixture"
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

/** The environment without a build number or credentials, so each scenario chooses its own. */
function baseEnv() {
    const env = { ...process.env }
    delete env.CATALYST_BUILD_NUMBER
    delete env.CATALYST_ANDROID_CREDENTIALS
    delete env.CATALYST_IOS_CREDENTIALS
    return env
}

/** build-output/<platform>/<version>-<build>/ for this app and BUILD_NUMBER. */
function releaseDir() {
    return path.join(appDir, "build-output", platform, `${appVersion()}-${BUILD_NUMBER}`)
}

function appVersion() {
    const pkg = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"))
    return pkg.version || "1.0.0"
}

async function expectFailure(name, webviewConfig, args, code) {
    console.log(`\n== ${name}: expect ${code}`)
    writeConfig(webviewConfig)
    const { status, output } = await buildApp(args, baseEnv())
    check(status === 1, `${name}: exits 1 (got ${status})`)
    check(output.includes(code), `${name}: output names ${code}`)
}

// --- Android ---------------------------------------------------------------

/** CATALYST_ANDROID_CREDENTIALS: the env value, or one packed from a throwaway key. */
function signingEnv() {
    if (process.env.CATALYST_ANDROID_CREDENTIALS) {
        return { CATALYST_ANDROID_CREDENTIALS: process.env.CATALYST_ANDROID_CREDENTIALS }
    }
    const dir = tempDir("catalyst-ci-credentials-")
    const password = randomBytes(18).toString("hex")
    const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", "keytool") : "keytool"
    const result = spawnSync(
        keytool,
        [
            "-genkeypair",
            "-keystore",
            path.join(dir, "upload.jks"),
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
    fs.writeFileSync(
        path.join(dir, "keystore.properties"),
        `storeFile=upload.jks\nkeyAlias=upload\nstorePassword=${password}\nkeyPassword=${password}\n`,
        { mode: 0o600 }
    )
    // The same shape `catalyst credentials:export android` prints.
    const tar = spawnSync("tar", ["-czf", "-", "-C", dir, "."], {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
    })
    if (tar.status !== 0) throw new Error(`tar could not pack the throwaway credentials: ${tar.stderr}`)
    console.log("Signing with a throwaway key made by keytool")
    return { CATALYST_ANDROID_CREDENTIALS: tar.stdout.toString("base64") }
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

function aabProperties(aab) {
    const result = spawnSync("unzip", ["-p", aab, "base/assets/webview_config.properties"], {
        encoding: "utf8",
    })
    if (result.status !== 0) throw new Error(`unzip could not read webview_config.properties from ${aab}`)
    return { text: result.stdout, props: parseProperties(result.stdout) }
}

async function expectAab(name, webviewConfig, { args = ["--release"], expectWarning = false } = {}) {
    console.log(`\n== ${name}: expect a signed AAB`)
    writeConfig(webviewConfig)
    const dir = releaseDir()
    fs.rmSync(dir, { recursive: true, force: true })
    const { status, output } = await buildApp(args, {
        ...baseEnv(),
        ...signing,
        CATALYST_BUILD_NUMBER: BUILD_NUMBER,
    })
    check(status === 0, `${name}: exits 0 (got ${status})`)
    const warned = output.includes("is deprecated")
    check(
        warned === expectWarning,
        `${name}: ${expectWarning ? "prints" : "does not print"} the buildType deprecation warning`
    )
    const aab = fs.existsSync(dir) ? fs.readdirSync(dir).find((file) => file.endsWith(".aab")) : null
    check(Boolean(aab), `${name}: wrote an .aab to ${path.relative(appDir, dir)}/`)
    check(
        fs.existsSync(path.join(dir, "upload_certificate.pem")),
        `${name}: wrote upload_certificate.pem beside the .aab`
    )
    if (!aab) return
    const aabPath = path.join(dir, aab)
    const { text, props } = aabProperties(aabPath)
    check(props.buildType === "release", `${name}: buildType=release (got ${props.buildType})`)
    check(props.LOCAL_IP === PROD_HOST, `${name}: LOCAL_IP=${PROD_HOST} (got ${props.LOCAL_IP})`)
    check(props.apiBaseUrl === API_BASE_URL, `${name}: apiBaseUrl preserved (got ${props.apiBaseUrl})`)
    const leaked = text.match(PRIVATE_IP)
    check(
        !leaked,
        `${name}: no private IP in webview_config.properties${leaked ? ` (found ${leaked[0]})` : ""}`
    )
    const unaligned = reportAlignment(aabPath)
    check(!unaligned.length, `${name}: every 64-bit native library is 16 KB aligned (#302)`)
}

let signing = {}

async function checkAndroid() {
    const android = { buildType: "debug", appName: "ReleaseFixture" }
    const dev = {
        appId: APP_ID,
        LOCAL_IP: "localhost",
        port: "3005",
        apiBaseUrl: API_BASE_URL,
        android,
    }

    await expectFailure("lan-host", { ...dev, url: `https://${DEV_HOST}` }, ["--release"], "NATIVE-001")
    await expectFailure(
        "placeholder-app-id",
        { ...dev, appId: "com.example.releasefixture", url: `https://${PROD_HOST}` },
        ["--release"],
        "NATIVE-003"
    )

    signing = signingEnv()
    await expectAab("url", { ...dev, url: `https://${PROD_HOST}` })
    // Apps before 1.3.0 pointed LOCAL_IP itself at production and set
    // buildType "release": still a release, with a deprecation warning.
    await expectAab(
        "legacy-host-and-build-type",
        {
            ...dev,
            LOCAL_IP: PROD_HOST,
            port: "443",
            useHttps: true,
            android: { ...android, buildType: "release" },
        },
        { args: [], expectWarning: true }
    )
}

// --- iOS -------------------------------------------------------------------

function plistValue(file, keyPath) {
    const result = spawnSync("plutil", ["-extract", keyPath, "raw", "-o", "-", file], { encoding: "utf8" })
    return result.status === 0 ? result.stdout.trim() : null
}

/** The .app's Info.plist from an IPA, copied to a temp file, and the .app's file list. */
function readIpa(ipa) {
    const listing = spawnSync("unzip", ["-Z1", ipa], { encoding: "utf8" })
    if (listing.status !== 0) throw new Error(`unzip could not list ${ipa}`)
    const entries = listing.stdout.split("\n").filter(Boolean)
    const infoEntry = entries.find((entry) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(entry))
    if (!infoEntry) throw new Error(`${ipa} has no Payload/<name>.app/Info.plist`)
    const appPrefix = infoEntry.slice(0, -"Info.plist".length)
    const plist = spawnSync("unzip", ["-p", ipa, infoEntry])
    if (plist.status !== 0) throw new Error(`unzip could not read ${infoEntry} from ${ipa}`)
    const infoPath = path.join(tempDir("catalyst-ios-ipa-"), "Info.plist")
    fs.writeFileSync(infoPath, plist.stdout)
    const files = entries
        .filter((entry) => entry.startsWith(appPrefix))
        .map((entry) => entry.slice(appPrefix.length))
    return { infoPath, files }
}

async function checkIos() {
    const ios = { buildType: "debug" }
    const dev = {
        appId: APP_ID,
        appName: "Release Fixture",
        LOCAL_IP: "localhost",
        port: "3005",
        apiBaseUrl: API_BASE_URL,
        ios,
    }

    // These fail while the config is resolved, before anything is signed.
    await expectFailure("lan-host", { ...dev, url: `https://${DEV_HOST}` }, ["--release"], "NATIVE-001")
    await expectFailure(
        "placeholder-app-id",
        { ...dev, appId: "com.example.releasefixture", url: `https://${PROD_HOST}` },
        ["--release"],
        "NATIVE-003"
    )
    await expectFailure("no-signing-team", { ...dev, url: `https://${PROD_HOST}` }, ["--release"], "IOS-010")

    const credentials = process.env.CATALYST_IOS_CREDENTIALS
    const appId = process.env.RELEASE_CHECK_IOS_APP_ID
    const teamId = process.env.RELEASE_CHECK_IOS_TEAM_ID
    if (!credentials || !appId) {
        console.log(
            "\n== signed-ipa: skipped. A signed IPA needs real signing files: set CATALYST_IOS_CREDENTIALS " +
                "(catalyst credentials:export ios) and RELEASE_CHECK_IOS_APP_ID (the bundle id they sign for), " +
                "plus RELEASE_CHECK_IOS_TEAM_ID for cloud signing with an App Store Connect API key."
        )
        return
    }

    const name = "signed-ipa"
    console.log(`\n== ${name}: expect a signed IPA`)
    writeConfig({
        ...dev,
        appId,
        url: `https://${PROD_HOST}`,
        ios: { ...ios, ...(teamId ? { developmentTeam: teamId } : {}) },
    })
    const dir = releaseDir()
    fs.rmSync(dir, { recursive: true, force: true })
    const { status } = await buildApp(["--release"], {
        ...baseEnv(),
        CATALYST_IOS_CREDENTIALS: credentials,
        CATALYST_BUILD_NUMBER: BUILD_NUMBER,
    })
    check(status === 0, `${name}: exits 0 (got ${status})`)
    const ipa = fs.existsSync(dir) ? fs.readdirSync(dir).find((file) => file.endsWith(".ipa")) : null
    check(Boolean(ipa), `${name}: wrote an .ipa to ${path.relative(appDir, dir)}/`)
    if (!ipa) return

    const { infoPath, files } = readIpa(path.join(dir, ipa))
    // CFBundleShortVersionString drops a pre-release suffix: 2.5.0-beta.1 ships as 2.5.0.
    const version = /^\d+(?:\.\d+){0,2}/.exec(appVersion())?.[0]
    const build = plistValue(infoPath, "CFBundleVersion")
    const shortVersion = plistValue(infoPath, "CFBundleShortVersionString")
    const bundleId = plistValue(infoPath, "CFBundleIdentifier")
    const encryption = plistValue(infoPath, "ITSAppUsesNonExemptEncryption")
    check(build === BUILD_NUMBER, `${name}: CFBundleVersion=${BUILD_NUMBER} (got ${build})`)
    check(shortVersion === version, `${name}: CFBundleShortVersionString=${version} (got ${shortVersion})`)
    check(bundleId === appId, `${name}: CFBundleIdentifier=${appId} (got ${bundleId})`)
    check(encryption === "false", `${name}: ITSAppUsesNonExemptEncryption=false (got ${encryption})`)
    check(files.includes("PrivacyInfo.xcprivacy"), `${name}: PrivacyInfo.xcprivacy is bundled`)

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
    check(swift.includes(expectedUrl), `${name}: ConfigConstants has ${expectedUrl}`)
    check(swift.includes(`apiBaseUrl = "${API_BASE_URL}"`), `${name}: ConfigConstants keeps apiBaseUrl`)
    const leaked = swift.match(PRIVATE_IP)
    check(!leaked, `${name}: no private IP in ConfigConstants${leaked ? ` (found ${leaked[0]})` : ""}`)
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
