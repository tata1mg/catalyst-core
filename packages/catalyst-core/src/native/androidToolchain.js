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
    isInteractiveTerminal,
    promptUser,
    confirm as confirmUser,
} from "./utils.js"

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

const MIN_JAVA_MAJOR = 17

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
 * Where JDK 17+ lives, without touching any shell profile: JAVA_HOME, then
 * macOS's /usr/libexec/java_home, then the JBR bundled with Android Studio,
 * then (off macOS) the `java` on PATH. Each candidate must run and report 17+.
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
    if (env.JAVA_HOME) candidates.push([env.JAVA_HOME, "JAVA_HOME"])
    if (platform === "darwin") {
        const found = run("/usr/libexec/java_home", ["-v", `${MIN_JAVA_MAJOR}+`])
        if (found && found.trim()) candidates.push([found.trim().split("\n")[0], "java_home"])
        candidates.push(
            ["/Applications/Android Studio.app/Contents/jbr/Contents/Home", "Android Studio"],
            [path.join(home, "Applications/Android Studio.app/Contents/jbr/Contents/Home"), "Android Studio"]
        )
    } else if (platform === "linux") {
        candidates.push(
            ["/opt/android-studio/jbr", "Android Studio"],
            [path.join(home, "android-studio", "jbr"), "Android Studio"]
        )
        const java = run("sh", ["-c", 'readlink -f "$(command -v java)"'])
        if (java && java.trim()) candidates.push([path.dirname(path.dirname(java.trim())), "PATH"])
    }

    const exe = platform === "win32" ? "java.exe" : "java"
    for (const [candidate, source] of candidates) {
        const bin = path.join(candidate, "bin", exe)
        if (!exists(bin)) {
            if (source === "JAVA_HOME") onSkip(candidate, "has no bin/java")
            continue
        }
        const version = parseJavaMajor(run(bin, ["-version"]))
        if (version && version >= MIN_JAVA_MAJOR) return { home: candidate, version, source }
        onSkip(candidate, version ? `is Java ${version}` : "did not run")
    }
    return null
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
 * Find JDK 17+, or install Zulu 17 with Homebrew after a terminal confirm.
 * Without a terminal (or on Linux) this is ANDROID-007.
 */
async function ensureJava({
    platform = process.platform,
    isTTY = isInteractiveTerminal(),
    confirm = confirmUser,
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
            "install a JDK 17+ (e.g. sudo apt install openjdk-17-jdk) and set JAVA_HOME"
        )
    }
    if (!isTTY) throw nativeError("ANDROID-007", "no JDK 17+ found and no terminal to confirm an install")
    if (!hasCommand("brew")) {
        throw nativeError("ANDROID-007", "no JDK 17+ found and Homebrew is not installed")
    }
    const yes = await confirm("Install the Zulu JDK 17 with Homebrew (brew install --cask zulu@17)")
    if (!yes) throw nativeError("ANDROID-007", "install declined")
    await runInherited("brew", ["install", "--cask", "zulu@17"])
    java = resolve({ onSkip })
    if (!java) throw nativeError("ANDROID-007", "Homebrew finished but no JDK 17+ was found")
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

/** The SDK packages a Catalyst app needs, plus the system image when an AVD is to be created. */
function requiredAndroidPackages({ arch = os.arch(), withSystemImage = false } = {}) {
    const packages = ["platform-tools", "emulator", `platforms;android-${ANDROID_API}`, "build-tools;36.0.0"]
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
 * cmdline-tools, licences, the platform/build/emulator packages, and an AVD.
 *
 * Downloads and the AVD only happen after a terminal confirm or `--yes`;
 * licences only after an interactive `sdkmanager --licenses` or
 * `--accept-licenses`. Without either, ANDROID-008 names the flags.
 *
 * @param {object} options
 * @param {string} options.sdkPath
 * @param {string} [options.emulatorName] - the configured AVD, if any
 * @param {boolean} [options.yes]
 * @param {boolean} [options.acceptLicenses]
 * @param {boolean} [options.isTTY]
 * @param {string} [options.arch]
 * @param {string} [options.platform]
 * @param {(question: string) => Promise<boolean>} [options.confirm]
 * @param {(question: string, options?: object) => Promise<string>} [options.prompt]
 * @param {(command: string, args: string[], responses?: object) => Promise<string>} [options.run] - captured output
 * @param {(command: string, args: string[]) => Promise<void>} [options.runInherited] - on the user's terminal
 * @param {(sdkPath: string, options?: object) => Promise<unknown>} [options.installTools] - installs cmdline-tools
 * @param {(sdkPath: string) => string[]} [options.listAvds]
 * @param {(message: string, type?: string) => void} [options.log]
 * @returns {Promise<{ sdkPath: string, emulatorName: string, installed: string[], createdAvd: boolean }>}
 */
async function ensureAndroidSdk({
    sdkPath,
    emulatorName,
    yes = false,
    acceptLicenses = false,
    isTTY = isInteractiveTerminal(),
    arch = os.arch(),
    platform = process.platform,
    confirm = confirmUser,
    prompt = promptUser,
    run = (command, args, responses) => runInteractiveCommand(command, args, responses),
    runInherited = runInheritedCommand,
    installTools = (dir, options) => installCmdlineTools(dir, options),
    listAvds: avdLister = (dir) => knownAvds(dir),
    log = () => {},
}) {
    const avds = avdLister(sdkPath)
    let avdName = emulatorName && avds.includes(emulatorName) ? emulatorName : null
    if (emulatorName && !avdName) {
        log(`The configured emulator "${emulatorName}" does not exist; using ${AVD_NAME}`, "warning")
    } else if (!emulatorName && avds.length) {
        // An existing AVD is reused rather than downloading a new image for it.
        const chosen =
            isTTY && !yes ? await prompt("Android emulator (AVD) name", { defaultValue: avds[0] }) : avds[0]
        if (avds.includes(chosen)) avdName = chosen
        else log(`No emulator named "${chosen}"; using ${AVD_NAME}`, "warning")
    }
    if (!avdName && avds.includes(AVD_NAME)) avdName = AVD_NAME
    const createAvd = !avdName
    if (createAvd) avdName = AVD_NAME

    const packages = requiredAndroidPackages({ arch, withSystemImage: createAvd })
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
    if (!yes) {
        if (!isTTY) {
            throw nativeError(
                "ANDROID-008",
                `${sdkPath} needs ${plan.join(", ")}; pass --yes to install them`
            )
        }
        log(`The Android SDK at ${sdkPath} needs: ${plan.join(", ")}`, "note")
        const ok = await confirm(
            `Download and install ${plan.length === 1 ? "it" : "them"}${createAvd ? " (the system image is about 1.5 GB)" : ""}`
        )
        if (!ok) throw nativeError("ANDROID-008", "declined")
    }

    if (needTools) {
        await installTools(sdkPath, { log })
        sdkmanager = cmdlineTool(sdkPath, "sdkmanager", { platform })
        if (!sdkmanager)
            throw nativeError("ANDROID-009", `no sdkmanager under ${sdkPath}/cmdline-tools/latest`)
    }

    const sdkRoot = `--sdk_root=${sdkPath}`
    if (missing.length && !licensesAccepted(sdkPath)) {
        if (acceptLicenses) {
            await run(sdkmanager, [sdkRoot, "--licenses"], { "(y/N)": "y" })
        } else if (isTTY) {
            log("Review and accept the Android SDK licences", "note")
            await runInherited(sdkmanager, [sdkRoot, "--licenses"])
        }
        if (!licensesAccepted(sdkPath)) {
            throw nativeError(
                "ANDROID-008",
                "the Android SDK licences are not accepted; pass --accept-licenses to accept them"
            )
        }
    }

    if (missing.length) {
        log(`Installing ${missing.join(", ")}`)
        if (isTTY && !acceptLicenses) {
            // On the terminal: the download progress shows, and a licence
            // this package adds is asked about, not answered for the user.
            await runInherited(sdkmanager, [sdkRoot, ...missing])
        } else {
            await run(sdkmanager, [sdkRoot, ...missing], { "(y/N)": acceptLicenses ? "y" : "n" })
        }
        const still = missingAndroidPackages(sdkPath, missing)
        if (still.length) throw new Error(`sdkmanager did not install ${still.join(", ")}`)
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
    cmdlineTool,
    licensesAccepted,
    sha256File,
    installCmdlineTools,
    knownAvds,
    ensureAndroidSdk,
}
