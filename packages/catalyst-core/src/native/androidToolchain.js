import { execFileSync, spawnSync } from "child_process"
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import {
    nativeError,
    listAvds,
    runInteractiveCommand,
    runInheritedCommand,
    isInteractive,
    promptUser,
    askConsent,
    detectAndroidSdk,
    expandHome,
} from "./utils.js"

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

// Gradle 8.13 runs on JDK 17 to 23. A newer JDK is skipped, not used: Gradle
// fails on it with an "Unsupported class file major version" error.
const MIN_JAVA_MAJOR = 17
const MAX_JAVA_MAJOR = 23
// The LTS releases in range, best first.
const PREFERRED_JAVA_MAJORS = [21, 17]

/** The major version in `java -version` output: "17.0.9" -> 17, "1.8.0_392" -> 8. */
function parseJavaMajor(output) {
    const match = /version "(\d+)(?:\.(\d+))?/.exec(String(output || ""))
    if (!match) return null
    const major = Number(match[1])
    return major === 1 && match[2] ? Number(match[2]) : major
}

/** `java -version` writes to stderr, so both streams are read. */
function defaultRun(command, args) {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Fixed probe commands (java -version, java_home) with argv arrays.
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 15000 })
    if (result.error || result.status !== 0) return null
    return `${result.stdout || ""}${result.stderr || ""}`
}

/**
 * Where a JDK Gradle 8.13 can run on (17 to 23) lives, without touching any
 * shell profile: JAVA_HOME, then macOS's /usr/libexec/java_home, then the JBR
 * bundled with Android Studio, then (off macOS) the `java` on PATH. Each
 * candidate must run and report a version in range; JDK 21 is preferred,
 * then 17, then any other in range. A JDK 24 or newer is skipped.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.platform]
 * @param {(command: string, args: string[]) => string | null} [options.run] - combined output, or null on failure
 * @param {(file: string) => boolean} [options.exists]
 * @param {(candidate: string, reason: string) => void} [options.onSkip]
 * @returns {{ home: string, version: number, source: string } | null}
 */
function resolveJavaHome({
    env = process.env,
    platform = process.platform,
    run = defaultRun,
    exists = fs.existsSync,
    onSkip = () => {},
} = {}) {
    const home = os.homedir()
    const candidates = []
    const add = (dir, source) => {
        if (dir && !candidates.some(([known]) => known === dir)) candidates.push([dir, source])
    }
    if (env.JAVA_HOME) add(env.JAVA_HOME, "JAVA_HOME")
    if (platform === "darwin") {
        // Ask for the preferred majors by name: a bare `-v 17+` answers with
        // the newest JDK, which may be one Gradle cannot use.
        for (const version of [...PREFERRED_JAVA_MAJORS.map(String), `${MIN_JAVA_MAJOR}+`]) {
            const found = run("/usr/libexec/java_home", ["-v", version])
            if (found && found.trim()) add(found.trim().split("\n")[0], "java_home")
        }
        add("/Applications/Android Studio.app/Contents/jbr/Contents/Home", "Android Studio")
        add(path.join(home, "Applications/Android Studio.app/Contents/jbr/Contents/Home"), "Android Studio")
    } else if (platform === "linux") {
        add("/opt/android-studio/jbr", "Android Studio")
        add(path.join(home, "android-studio", "jbr"), "Android Studio")
        const java = run("sh", ["-c", 'readlink -f "$(command -v java)"'])
        if (java && java.trim()) add(path.dirname(path.dirname(java.trim())), "PATH")
    }

    const exe = platform === "win32" ? "java.exe" : "java"
    const usable = []
    for (const [candidate, source] of candidates) {
        const bin = path.join(candidate, "bin", exe)
        if (!exists(bin)) {
            if (source === "JAVA_HOME") onSkip(candidate, "has no bin/java")
            continue
        }
        const version = parseJavaMajor(run(bin, ["-version"]))
        if (!version) {
            onSkip(candidate, "did not run")
        } else if (version < MIN_JAVA_MAJOR) {
            onSkip(candidate, `is Java ${version}, older than ${MIN_JAVA_MAJOR}`)
        } else if (version > MAX_JAVA_MAJOR) {
            onSkip(
                candidate,
                `is Java ${version}, newer than Gradle 8.13 supports (${MIN_JAVA_MAJOR} to ${MAX_JAVA_MAJOR})`
            )
        } else {
            const java = { home: candidate, version, source }
            if (version === PREFERRED_JAVA_MAJORS[0]) return java
            usable.push(java)
        }
    }
    for (const major of PREFERRED_JAVA_MAJORS) {
        const match = usable.find((java) => java.version === major)
        if (match) return match
    }
    return usable[0] || null
}

/** Point this process (and so every child it spawns) at a JDK. No profile is edited. */
function applyJavaHome(java, env = process.env) {
    if (!java?.home) return env
    env.JAVA_HOME = java.home
    const bin = path.join(java.home, "bin")
    const parts = String(env.PATH || "").split(path.delimiter)
    if (parts[0] !== bin)
        env.PATH = [bin, ...parts.filter((part) => part && part !== bin)].join(path.delimiter)
    return env
}

/**
 * Find a usable JDK (17 to 23), or install Zulu 17 with Homebrew once the
 * install is agreed to (a terminal yes, or `--yes`). Without a terminal and
 * without `--yes` the question fails with NATIVE-005; off macOS, without
 * Homebrew, or when declined it is ANDROID-007.
 *
 * @param {object} [options]
 * @param {string} [options.platform]
 * @param {{ yes?: boolean }} [options.flags] - from parseNativeArgs
 * @param {boolean} [options.isTTY]
 * @param {(kind: "install" | "licence" | "key", question: string, options?: object) => Promise<boolean>} [options.ask]
 * @param {(question: string, options?: object) => Promise<string>} [options.prompt]
 * @param {(command: string, args: string[]) => Promise<void>} [options.runInherited]
 * @param {(options: { onSkip: (candidate: string, reason: string) => void }) => { home: string, version: number, source: string } | null} [options.resolve]
 * @param {(name: string) => boolean} [options.hasCommand]
 * @param {(message: string, type?: string) => void} [options.log]
 * @returns {Promise<{ home: string, version: number, source: string }>}
 */
async function ensureJava({
    platform = process.platform,
    flags = {},
    isTTY,
    ask = askConsent,
    prompt = promptUser,
    runInherited = runInheritedCommand,
    resolve = resolveJavaHome,
    hasCommand = (name) => defaultRun("sh", ["-c", `command -v ${name}`]) !== null,
    log = () => {},
} = {}) {
    const onSkip = (candidate, reason) => log(`Skipping ${candidate}: it ${reason}`, "note")
    let java = resolve({ onSkip })
    if (java) return java

    if (platform !== "darwin") {
        throw nativeError(
            "ANDROID-007",
            "install a JDK 17 or 21 (e.g. sudo apt install openjdk-17-jdk) and set JAVA_HOME"
        )
    }
    if (!hasCommand("brew")) {
        throw nativeError("ANDROID-007", "no JDK 17 to 23 found and Homebrew is not installed")
    }
    const yes = await ask(
        "install",
        "No JDK 17 to 23 found. Install the Zulu JDK 17 with Homebrew (brew install --cask zulu@17)",
        { flags, isTTY, prompt }
    )
    if (!yes) throw nativeError("ANDROID-007", "install declined")
    await runInherited("brew", ["install", "--cask", "zulu@17"])
    java = resolve({ onSkip })
    if (!java) throw nativeError("ANDROID-007", "Homebrew finished but no JDK 17 to 23 was found")
    return java
}

// ---------------------------------------------------------------------------
// Android SDK
// ---------------------------------------------------------------------------

// Pinned from https://developer.android.com/studio#command-tools (build
// 15859902). The archive is verified against the published SHA-256 before it
// is unpacked.
const CMDLINE_TOOLS = {
    build: "15859902",
    archives: {
        "darwin-arm64": {
            file: "commandlinetools-mac_arm64-15859902_latest.zip",
            sha256: "835b62a26162b229b441d1f6d4680383815a270809eb33522c0d480fa5002c4e",
        },
        "darwin-x64": {
            file: "commandlinetools-mac_x86_64-15859902_latest.zip",
            sha256: "c5a6378ab5cf7e0d5701921405115befff13e9ff7417fb588389338f8bd050f3",
        },
        linux: {
            file: "commandlinetools-linux-15859902_latest.zip",
            sha256: "4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583",
        },
        win32: {
            file: "commandlinetools-win-15859902_latest.zip",
            sha256: "90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a",
        },
    },
}
const REPOSITORY_URL = "https://dl.google.com/android/repository"

const ANDROID_API = 36
const AVD_NAME = `catalyst-api${ANDROID_API}`
const AVD_DEVICE = "pixel_7"

/** The pinned cmdline-tools archive for this machine. */
function cmdlineToolsArchive(platform = process.platform, arch = os.arch()) {
    const key = platform === "darwin" ? `darwin-${arch === "arm64" ? "arm64" : "x64"}` : platform
    const archive = CMDLINE_TOOLS.archives[key]
    if (!archive) throw new Error(`No Android command-line tools for ${platform}/${arch}`)
    return { ...archive, url: `${REPOSITORY_URL}/${archive.file}` }
}

/** The emulator system image that runs natively on this CPU. */
function systemImageFor(arch = os.arch()) {
    const abi = arch === "arm64" ? "arm64-v8a" : "x86_64"
    return `system-images;android-${ANDROID_API};google_apis;${abi}`
}

/**
 * The SDK packages a Catalyst app needs: the emulator only when the app runs
 * on one (not for a release or a connected phone), plus the system image
 * when an AVD is to be created.
 */
function requiredAndroidPackages({ arch = os.arch(), withSystemImage = false, withEmulator = true } = {}) {
    const packages = [
        "platform-tools",
        ...(withEmulator ? ["emulator"] : []),
        `platforms;android-${ANDROID_API}`,
        "build-tools;36.0.0",
    ]
    return withSystemImage ? [...packages, systemImageFor(arch)] : packages
}

/** sdkmanager installs `a;b;c` at <sdk>/a/b/c, with a package.xml beside it. */
function isPackageInstalled(sdkPath, id, exists = fs.existsSync) {
    return exists(path.join(sdkPath, ...id.split(";"), "package.xml"))
}

function missingAndroidPackages(sdkPath, packages, exists = fs.existsSync) {
    return packages.filter((id) => !isPackageInstalled(sdkPath, id, exists))
}

/** Where the SDK goes when none is configured or detected. */
function defaultSdkPath(env = process.env, platform = process.platform) {
    if (env.ANDROID_HOME) return env.ANDROID_HOME
    if (env.ANDROID_SDK_ROOT) return env.ANDROID_SDK_ROOT
    return platform === "darwin"
        ? path.join(os.homedir(), "Library", "Android", "sdk")
        : path.join(os.homedir(), "Android", "Sdk")
}

/**
 * The SDK this app builds with: WEBVIEW_CONFIG.android.sdkPath, then
 * ANDROID_HOME, ANDROID_SDK_ROOT and the default location (the first that has
 * adb), else where a new SDK goes. Read only: never asked for, never written.
 *
 * @param {{ sdkPath?: string }} [androidConfig]
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveSdkPath(androidConfig = {}, env = process.env) {
    return expandHome(androidConfig.sdkPath) || detectAndroidSdk(env) || defaultSdkPath(env)
}

const toolExt = (platform) => (platform === "win32" ? ".bat" : "")

/** sdkmanager/avdmanager from cmdline-tools/latest, else any versioned cmdline-tools dir. */
function cmdlineTool(sdkPath, tool, { platform = process.platform, exists = fs.existsSync } = {}) {
    const name = `${tool}${toolExt(platform)}`
    const latest = path.join(sdkPath, "cmdline-tools", "latest", "bin", name)
    if (exists(latest)) return latest
    try {
        for (const dir of fs.readdirSync(path.join(sdkPath, "cmdline-tools")).sort().reverse()) {
            const candidate = path.join(sdkPath, "cmdline-tools", dir, "bin", name)
            if (exists(candidate)) return candidate
        }
    } catch (error) {
        // No cmdline-tools directory yet.
    }
    return null
}

/** The SDK licence sdkmanager writes once it has been accepted. */
function licensesAccepted(sdkPath, exists = fs.existsSync) {
    return exists(path.join(sdkPath, "licenses", "android-sdk-license"))
}

function sha256File(file) {
    const hash = crypto.createHash("sha256")
    const fd = fs.openSync(file, "r")
    try {
        const chunk = Buffer.alloc(1024 * 1024)
        let read
        while ((read = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0)
            hash.update(chunk.subarray(0, read))
    } finally {
        fs.closeSync(fd)
    }
    return hash.digest("hex")
}

/** curl honours the system proxy and certificate store, which Node's fetch does not. */
async function curlDownload(url, dest) {
    await runInteractiveCommand("curl", ["-fsSL", "--retry", "2", "-o", dest, url])
}

function unzipArchive(zip, dest) {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - unzip with an argv array on a checksum-verified archive.
    execFileSync("unzip", ["-q", "-o", zip, "-d", dest], { stdio: ["ignore", "ignore", "pipe"] })
}

/**
 * Download the pinned cmdline-tools, check the SHA-256, and unpack them to
 * <sdk>/cmdline-tools/latest. Any failure is ANDROID-009.
 */
async function installCmdlineTools(
    sdkPath,
    { archive = cmdlineToolsArchive(), download = curlDownload, unzip = unzipArchive, log = () => {} } = {}
) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-cmdline-tools-"))
    const toolsRoot = path.join(sdkPath, "cmdline-tools")
    // Unpacked beside its destination so the final move is a rename, not a copy across devices.
    let staging = null
    try {
        const zip = path.join(tmp, archive.file)
        log(`Downloading ${archive.file}`)
        try {
            await download(archive.url, zip)
        } catch (error) {
            const output = String(error.output || "").trim()
            throw nativeError("ANDROID-009", `download of ${archive.url} failed: ${output || error.message}`)
        }
        const actual = sha256File(zip)
        if (actual !== archive.sha256) {
            throw nativeError(
                "ANDROID-009",
                `${archive.file} has SHA-256 ${actual}, expected ${archive.sha256}`
            )
        }
        fs.mkdirSync(toolsRoot, { recursive: true })
        staging = fs.mkdtempSync(path.join(toolsRoot, ".catalyst-"))
        try {
            unzip(zip, staging)
        } catch (error) {
            throw nativeError(
                "ANDROID-009",
                `could not unpack ${archive.file}: ${error.stderr || error.message}`
            )
        }
        const unpacked = path.join(staging, "cmdline-tools")
        if (!fs.existsSync(unpacked))
            throw nativeError("ANDROID-009", `${archive.file} has no cmdline-tools folder`)
        const latest = path.join(toolsRoot, "latest")
        fs.rmSync(latest, { recursive: true, force: true })
        fs.renameSync(unpacked, latest)
        return latest
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
        if (staging) fs.rmSync(staging, { recursive: true, force: true })
    }
}

/** True when `child` is strictly inside `parent`. */
function isInside(parent, child) {
    const relative = path.relative(parent, child)
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative)
}

/**
 * Remove what an interrupted sdkmanager left in <sdk>/.temp. A stale partial
 * download there makes the next install fail (#301).
 *
 * @param {string} sdkPath
 * @param {{ log?: (message: string, type?: string) => void }} [options]
 * @returns {string[]} the entries removed
 */
function cleanSdkTemp(sdkPath, { log = () => {} } = {}) {
    const temp = path.join(sdkPath, ".temp")
    let entries = []
    try {
        entries = fs.readdirSync(temp)
    } catch {
        return []
    }
    for (const entry of entries) fs.rmSync(path.join(temp, entry), { recursive: true, force: true })
    if (entries.length) log(`Removed ${entries.length} stale partial download(s) from ${temp}`, "note")
    return entries
}

/**
 * The folders of `ids` that an earlier install left half done: the folder is
 * there but its package.xml is not. Also the folder a FileAlreadyExistsException
 * in `output` names, when it is one of those packages or under <sdk>/.temp.
 * Nothing outside the SDK, and never a folder another package lives in.
 */
function halfInstalledPaths(sdkPath, ids, output = "", exists = fs.existsSync) {
    const targets = ids.map((id) => path.join(sdkPath, ...id.split(";")))
    const found = new Set(targets.filter((dir) => exists(dir) && !exists(path.join(dir, "package.xml"))))
    for (const match of String(output).matchAll(/FileAlreadyExistsException:\s*(.+)/g)) {
        const named = path.resolve(match[1].trim())
        if (targets.includes(named) || isInside(path.join(sdkPath, ".temp"), named)) found.add(named)
    }
    return [...found].filter((dir) => isInside(sdkPath, dir))
}

/**
 * Run an sdkmanager install of `ids`, cleaning <sdk>/.temp first. When it
 * fails or leaves a package half installed (FileAlreadyExistsException, #301),
 * the half-installed folders are removed and the install runs once more.
 *
 * @param {string} sdkPath
 * @param {string[]} ids
 * @param {() => Promise<unknown>} install - one sdkmanager run; may reject with `output`
 * @param {{ log?: (message: string, type?: string) => void }} [options]
 */
async function installSdkPackages(sdkPath, ids, install, { log = () => {} } = {}) {
    let lastError = null
    for (let attempt = 1; attempt <= 2; attempt++) {
        cleanSdkTemp(sdkPath, { log })
        let output = ""
        lastError = null
        try {
            output = String((await install()) || "")
        } catch (error) {
            lastError = error
            output = String(error.output || error.message || "")
        }
        const still = missingAndroidPackages(sdkPath, ids)
        if (!still.length) return
        const stale = halfInstalledPaths(sdkPath, still, output)
        if (attempt === 2 || (!stale.length && !/FileAlreadyExistsException/.test(output))) {
            if (lastError) throw lastError
            throw new Error(`sdkmanager did not install ${still.join(", ")}`)
        }
        for (const dir of stale) fs.rmSync(dir, { recursive: true, force: true })
        log(
            `sdkmanager left ${stale.map((dir) => path.relative(sdkPath, dir)).join(", ") || "a package"} half installed; removed it and retrying once`,
            "warning"
        )
    }
}

/** AVDs from the emulator, or from ~/.android/avd when the emulator isn't installed yet. */
function knownAvds(sdkPath, { env = process.env } = {}) {
    const names = new Set(listAvds(sdkPath))
    const avdHome =
        env.ANDROID_AVD_HOME || path.join(env.ANDROID_USER_HOME || path.join(os.homedir(), ".android"), "avd")
    try {
        for (const file of fs.readdirSync(avdHome)) if (file.endsWith(".ini")) names.add(file.slice(0, -4))
    } catch (error) {
        // No AVDs yet.
    }
    return [...names]
}

/**
 * Bring the Android SDK to what a Catalyst app needs, from nothing if need be:
 * cmdline-tools, licences, the platform/build packages and, when the app runs
 * on an emulator, the emulator and an AVD.
 *
 * Downloads and the AVD only happen after a terminal yes or `--yes`;
 * licences only after a terminal yes (then sdkmanager shows them) or
 * `--accept-licenses`. Without a terminal and without the flag, NATIVE-005
 * names it; a "no" is ANDROID-008.
 *
 * The AVD: the configured `emulatorName` if it exists, else `preferredAvd`
 * (the last one used), else catalyst-api36, else the first existing one;
 * only when there is none is catalyst-api36 created.
 *
 * @param {object} options
 * @param {string} options.sdkPath
 * @param {string} [options.emulatorName] - WEBVIEW_CONFIG.android.emulatorName, if any
 * @param {string} [options.preferredAvd] - the AVD the last run used
 * @param {boolean} [options.needEmulator] - false for a release or a connected phone
 * @param {{ yes?: boolean, acceptLicenses?: boolean }} [options.flags] - from parseNativeArgs
 * @param {boolean} [options.isTTY]
 * @param {string} [options.arch]
 * @param {string} [options.platform]
 * @param {(kind: "install" | "licence" | "key", question: string, options?: object) => Promise<boolean>} [options.ask]
 * @param {typeof promptUser} [options.prompt]
 * @param {(command: string, args: string[], responses?: object) => Promise<string>} [options.run] - captured output
 * @param {(command: string, args: string[]) => Promise<void>} [options.runInherited] - on the user's terminal
 * @param {(sdkPath: string, options?: object) => Promise<unknown>} [options.installTools] - installs cmdline-tools
 * @param {(sdkPath: string) => string[]} [options.listAvds]
 * @param {(message: string, type?: string) => void} [options.log]
 * @returns {Promise<{ sdkPath: string, emulatorName: string | null, installed: string[], createdAvd: boolean }>}
 */
async function ensureAndroidSdk({
    sdkPath,
    emulatorName,
    preferredAvd,
    needEmulator = true,
    flags = {},
    isTTY = isInteractive(),
    arch = os.arch(),
    platform = process.platform,
    ask = askConsent,
    prompt = promptUser,
    run = (command, args, responses) => runInteractiveCommand(command, args, responses),
    runInherited = runInheritedCommand,
    installTools = (dir, options) => installCmdlineTools(dir, options),
    listAvds: avdLister = (dir) => knownAvds(dir),
    log = () => {},
}) {
    let avdName = null
    let createAvd = false
    if (needEmulator) {
        const avds = avdLister(sdkPath)
        if (emulatorName && avds.includes(emulatorName)) avdName = emulatorName
        else {
            if (emulatorName) log(`The configured emulator "${emulatorName}" does not exist`, "warning")
            avdName =
                [preferredAvd, AVD_NAME].find((name) => name && avds.includes(name)) || avds[0] || null
        }
        createAvd = !avdName
        if (createAvd) avdName = AVD_NAME
    }

    const packages = requiredAndroidPackages({ arch, withSystemImage: createAvd, withEmulator: needEmulator })
    const missing = missingAndroidPackages(sdkPath, packages)
    let sdkmanager = cmdlineTool(sdkPath, "sdkmanager", { platform })
    const needTools = !sdkmanager && (missing.length > 0 || createAvd)

    if (!missing.length && !createAvd)
        return { sdkPath, emulatorName: avdName, installed: [], createdAvd: false }

    // One question for everything that downloads or creates.
    const plan = [
        ...(needTools ? [`Android command-line tools ${CMDLINE_TOOLS.build}`] : []),
        ...missing,
        ...(createAvd ? [`emulator "${avdName}" (${AVD_DEVICE})`] : []),
    ]
    const install = await ask(
        "install",
        `The Android SDK at ${sdkPath} needs ${plan.join(", ")}. Download and install ${plan.length === 1 ? "it" : "them"}${createAvd ? " (the system image is about 1.5 GB)" : ""}`,
        { flags, isTTY, prompt }
    )
    if (!install) throw nativeError("ANDROID-008", `${sdkPath} still needs ${plan.join(", ")}`)

    if (needTools) {
        await installTools(sdkPath, { log })
        sdkmanager = cmdlineTool(sdkPath, "sdkmanager", { platform })
        if (!sdkmanager)
            throw nativeError("ANDROID-009", `no sdkmanager under ${sdkPath}/cmdline-tools/latest`)
    }

    const sdkRoot = `--sdk_root=${sdkPath}`
    if (missing.length && !licensesAccepted(sdkPath)) {
        const accept = await ask(
            "licence",
            "Review and accept the Android SDK licences (https://developer.android.com/studio/terms)",
            { flags, isTTY, prompt }
        )
        if (!accept) throw nativeError("ANDROID-008", "the Android SDK licences were not accepted")
        if (flags.acceptLicenses) {
            await run(sdkmanager, [sdkRoot, "--licenses"], { "(y/N)": "y" })
        } else {
            // On the terminal, so the person reads and answers each licence.
            await runInherited(sdkmanager, [sdkRoot, "--licenses"])
        }
        if (!licensesAccepted(sdkPath)) {
            throw nativeError("ANDROID-008", "the Android SDK licences were not accepted")
        }
    }

    if (missing.length) {
        log(`Installing ${missing.join(", ")}`)
        await installSdkPackages(
            sdkPath,
            missing,
            () =>
                isTTY && !flags.acceptLicenses
                    ? // On the terminal: the download progress shows, and a licence
                      // this package adds is asked about, not answered for the user.
                      runInherited(sdkmanager, [sdkRoot, ...missing])
                    : run(sdkmanager, [sdkRoot, ...missing], { "(y/N)": flags.acceptLicenses ? "y" : "n" }),
            { log }
        )
    }

    if (createAvd) {
        const avdmanager = cmdlineTool(sdkPath, "avdmanager", { platform })
        if (!avdmanager)
            throw nativeError("ANDROID-009", `no avdmanager under ${sdkPath}/cmdline-tools/latest`)
        log(`Creating the "${avdName}" emulator`)
        await run(
            avdmanager,
            ["create", "avd", "-n", avdName, "-k", systemImageFor(arch), "-d", AVD_DEVICE],
            { "custom hardware profile": "no" }
        )
    }

    return { sdkPath, emulatorName: avdName, installed: missing, createdAvd: createAvd }
}

export {
    MIN_JAVA_MAJOR,
    MAX_JAVA_MAJOR,
    parseJavaMajor,
    resolveJavaHome,
    applyJavaHome,
    ensureJava,
    CMDLINE_TOOLS,
    ANDROID_API,
    AVD_NAME,
    cmdlineToolsArchive,
    systemImageFor,
    requiredAndroidPackages,
    missingAndroidPackages,
    defaultSdkPath,
    resolveSdkPath,
    cmdlineTool,
    licensesAccepted,
    sha256File,
    installCmdlineTools,
    knownAvds,
    cleanSdkTemp,
    halfInstalledPaths,
    installSdkPackages,
    ensureAndroidSdk,
}
