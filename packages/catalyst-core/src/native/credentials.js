import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { nativeError } from "./utils.js"

// Signing files live in git-ignored credentials/<platform>/ in the app. CI
// gets the same folder from one secret per platform, CATALYST_<PLATFORM>_CREDENTIALS:
// a base64 gzipped tar of that folder, made by `catalyst credentials:export`.
// Everything that reads credentials goes through resolveCredentials, so the
// folder and the secret behave the same.

const PLATFORMS = ["android", "ios"]

// GitHub's limit for one secret value.
const MAX_CREDENTIALS_SECRET_BYTES = 48 * 1024

// macOS tar adds AppleDouble (._*) files for extended attributes unless told not to.
const TAR_ENV = { ...process.env, COPYFILE_DISABLE: "1" }

function assertPlatform(platform) {
    if (!PLATFORMS.includes(platform)) {
        throw new Error(`Unknown platform "${platform}": expected android or ios`)
    }
}

/** @param {"android"|"ios"} platform */
function credentialsEnvName(platform) {
    assertPlatform(platform)
    return `CATALYST_${platform.toUpperCase()}_CREDENTIALS`
}

/**
 * The project's credentials folder for a platform (it may not exist).
 *
 * @param {"android"|"ios"} platform
 * @param {object} [options]
 * @param {string} [options.cwd]
 */
function credentialsDir(platform, { cwd = process.cwd() } = {}) {
    assertPlatform(platform)
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - platform is one of two fixed names; cwd is the app root.
    return path.join(cwd, "credentials", platform)
}

function isDirectory(dir) {
    try {
        return fs.statSync(dir).isDirectory()
    } catch (error) {
        return false
    }
}

/** GitHub Actions' escaping for workflow command data. */
function escapeCommandData(value) {
    return String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
}

/**
 * Hide a secret in GitHub Actions logs from here on. A no-op elsewhere.
 * Call it for every password read from credentials before it can reach a
 * log line or a child process's echoed output.
 *
 * @param {string} value
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {(text: string) => void} [options.write]
 * @returns {boolean} whether a mask was printed
 */
function maskSecret(value, { env = process.env, write = (text) => process.stdout.write(text) } = {}) {
    if (env.GITHUB_ACTIONS !== "true" || value === undefined || value === null || value === "") return false
    write(`::add-mask::${escapeCommandData(value)}\n`)
    return true
}

/**
 * Pack credentials/<platform>/ into the CATALYST_<PLATFORM>_CREDENTIALS value.
 *
 * @param {"android"|"ios"} platform
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @returns {string} base64 of a gzipped tar of the folder's contents
 */
function packCredentials(platform, { cwd = process.cwd() } = {}) {
    const dir = credentialsDir(platform, { cwd })
    const files = isDirectory(dir) ? fs.readdirSync(dir).filter((name) => name !== ".DS_Store") : []
    if (files.length === 0) {
        throw nativeError("NATIVE-008", `credentials/${platform}/ is missing or empty in ${cwd}`)
    }
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - fixed tar argv; dir is the app's own credentials folder.
    const archive = execFileSync("tar", ["-czf", "-", "--exclude", ".DS_Store", "-C", dir, "."], {
        env: TAR_ENV,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
    })
    const value = archive.toString("base64")
    if (value.length > MAX_CREDENTIALS_SECRET_BYTES) {
        throw nativeError(
            "NATIVE-009",
            `credentials/${platform}/ packs to ${Math.ceil(value.length / 1024)} KB; the limit is 48 KB`
        )
    }
    return value
}

/** Tar entries that could write outside the destination, or are links. */
function unsafeEntries(listing, verbose) {
    const names = listing.split("\n").filter(Boolean)
    const bad = names.filter((name) => {
        const clean = name.replace(/^\.\//, "")
        return clean.startsWith("/") || clean.split("/").includes("..")
    })
    // Long listings start each line with the entry type: "-" file, "d" folder.
    const links = verbose
        .split("\n")
        .filter(Boolean)
        .filter((line) => !/^[-d]/.test(line))
    return [...bad, ...links]
}

/**
 * Unpack a CATALYST_<PLATFORM>_CREDENTIALS value into `destDir`.
 * Only plain files and folders inside `destDir` are accepted.
 *
 * @param {string} value
 * @param {string} destDir - created when missing
 * @param {object} [options]
 * @param {string} [options.envName] - for the error message
 */
function unpackCredentials(value, destDir, { envName = "the credentials secret" } = {}) {
    const archive = Buffer.from(String(value || "").trim(), "base64")
    if (archive.length < 2 || archive[0] !== 0x1f || archive[1] !== 0x8b) {
        throw nativeError("NATIVE-007", `${envName} is not a base64 gzipped tar`)
    }
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-credentials-archive-"))
    try {
        const file = path.join(work, "credentials.tgz")
        fs.writeFileSync(file, archive, { mode: 0o600 })
        let listing
        let verbose
        try {
            // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - fixed tar argv on a temp file.
            listing = execFileSync("tar", ["-tzf", file], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            })
            // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - fixed tar argv on a temp file.
            verbose = execFileSync("tar", ["-tvzf", file], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            })
        } catch (error) {
            throw nativeError("NATIVE-007", `${envName} could not be read as a tar archive`)
        }
        const unsafe = unsafeEntries(listing, verbose)
        if (unsafe.length) {
            throw nativeError("NATIVE-007", `${envName} holds links or paths outside the folder`)
        }
        fs.mkdirSync(destDir, { recursive: true, mode: 0o700 })
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - fixed tar argv; entries were checked above.
        execFileSync("tar", ["-xzf", file, "-C", destDir], { stdio: ["ignore", "pipe", "pipe"] })
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

/**
 * Run `cleanup` on SIGINT and SIGTERM too: a Ctrl+C ends the process
 * without running any `finally`, which would leave unpacked secrets in the
 * temp folder. After cleaning up it exits (130 or 143), unless another
 * handler for the signal is still to run, in which case that one exits.
 *
 * @param {() => void} cleanup
 * @param {object} [options]
 * @param {{ once: Function, removeListener: Function, listenerCount?: Function }} [options.signals]
 * @param {(code: number) => void} [options.exit]
 * @returns {() => void} removes the handlers; call it from the normal cleanup
 */
function cleanupOnSignal(cleanup, { signals = process, exit = (code) => process.exit(code) } = {}) {
    const release = () => {
        signals.removeListener("SIGINT", onSignal)
        signals.removeListener("SIGTERM", onSignal)
    }
    function onSignal(signal) {
        release()
        cleanup()
        const others = typeof signals.listenerCount === "function" ? signals.listenerCount(signal) : 0
        if (others === 0) exit(signal === "SIGINT" ? 130 : 143)
    }
    signals.once("SIGINT", onSignal)
    signals.once("SIGTERM", onSignal)
    return release
}

/**
 * Where this build reads its credentials for a platform.
 *
 * 1. credentials/<platform>/ in the app, when it exists.
 * 2. Otherwise CATALYST_<PLATFORM>_CREDENTIALS, unpacked into a private temp
 *    folder that `cleanup()` removes, and that an interrupted build (Ctrl+C,
 *    SIGTERM) removes too. The project folder is never written.
 * 3. Otherwise `source: "none"` and `dir` is the (missing) project folder,
 *    where a first-time setup should create it.
 *
 * The caller still masks each password it reads with maskSecret().
 *
 * @param {"android"|"ios"} platform
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {(message: string, type?: string) => void} [options.log]
 * @param {object} [options.signals] - for tests; see cleanupOnSignal
 * @param {(code: number) => void} [options.exit] - for tests
 * @returns {{ dir: string, source: "folder" | "env" | "none", envName: string, cleanup: () => void }}
 */
function resolveCredentials(
    platform,
    { cwd = process.cwd(), env = process.env, log = () => {}, signals, exit } = {}
) {
    const dir = credentialsDir(platform, { cwd })
    const envName = credentialsEnvName(platform)
    if (isDirectory(dir)) return { dir, source: "folder", envName, cleanup: () => {} }
    const value = env[envName]
    if (value && String(value).trim()) {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), `catalyst-${platform}-credentials-`))
        fs.chmodSync(temp, 0o700)
        try {
            unpackCredentials(value, temp, { envName })
        } catch (error) {
            fs.rmSync(temp, { recursive: true, force: true })
            throw error
        }
        log(`Using ${platform} credentials from ${envName}`, "info")
        const remove = () => fs.rmSync(temp, { recursive: true, force: true })
        const releaseSignals = cleanupOnSignal(remove, {
            ...(signals ? { signals } : {}),
            ...(exit ? { exit } : {}),
        })
        return {
            dir: temp,
            source: "env",
            envName,
            cleanup: () => {
                releaseSignals()
                remove()
            },
        }
    }
    return { dir, source: "none", envName, cleanup: () => {} }
}

export {
    MAX_CREDENTIALS_SECRET_BYTES,
    credentialsEnvName,
    credentialsDir,
    maskSecret,
    packCredentials,
    unpackCredentials,
    resolveCredentials,
    cleanupOnSignal,
}
