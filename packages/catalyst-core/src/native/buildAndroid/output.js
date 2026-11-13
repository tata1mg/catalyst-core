import fs from "fs"
import path from "path"
import {
    BUILD_OUTPUT_DIR,
    artifactBaseName,
    ensureBuildOutputIgnore,
    releaseFolderName,
} from "../releaseOutput.js"

/**
 * The Gradle tasks a release runs, in one Gradle run: the bundle for Play
 * and a universal APK for test installs. The release buildType's
 * signingConfig signs both, and the app sets no ABI splits, so the APK is
 * a single app-release.apk.
 */
const RELEASE_GRADLE_TASKS = ["clean", "bundleRelease", "assembleRelease"]

/** The note printed under a release APK. */
const RELEASE_APK_NOTE = "The APK is for test installs; uninstall a Play-installed copy first."

/**
 * A debug APK copied after a failed run must come from this run: a step
 * that fails before Gradle's clean leaves the previous run's APK in place.
 * The slack covers file systems that store mtimes in whole seconds.
 */
const MTIME_SLACK_MS = 2000

/** The name the AAB and APK files are given, before artifactBaseName makes it file-name safe. */
function artifactName(androidConfig = {}) {
    return androidConfig.newProjectName || androidConfig.appName || "app"
}

/**
 * Where Gradle writes its outputs in an Android project (androidProject or
 * the temp_build copy a release builds in).
 *
 * @param {string} projectPath
 */
function gradleOutputs(projectPath) {
    const outputs = path.join(projectPath, "app", "build", "outputs")
    return {
        debugApk: path.join(outputs, "apk", "debug", "app-debug.apk"),
        releaseAab: path.join(outputs, "bundle", "release", "app-release.aab"),
        releaseApk: path.join(outputs, "apk", "release", "app-release.apk"),
    }
}

/**
 * Where a release puts its files: build-output/android/<version>-<build>/
 * in the app, or <android.outputPath>/<version>-<build>/ when the config
 * sets an output path. One folder per build, so nothing is overwritten.
 *
 * @param {object} options
 * @param {string} [options.appRoot]
 * @param {{ outputPath?: string }} [options.androidConfig]
 * @param {{ versionName?: string, buildNumber: number | string }} options.version - resolveNativeConfig().version
 * @returns {string}
 */
function releaseOutputDir({ appRoot = process.cwd(), androidConfig = {}, version }) {
    const root = androidConfig.outputPath
        ? path.resolve(appRoot, androidConfig.outputPath)
        : path.join(appRoot, BUILD_OUTPUT_DIR, "android")
    return path.join(root, releaseFolderName(version))
}

/**
 * The release files in that folder: the bundle for Play, the APK for test
 * installs, and the upload certificate (PEM) that identifies the key that
 * signed both.
 *
 * @param {string} dir - releaseOutputDir()
 * @param {string} name - the app's name; made file-name safe here
 */
function releaseArtifactPaths(dir, name) {
    const base = artifactBaseName(name)
    return {
        aab: path.join(dir, `${base}.aab`),
        apk: path.join(dir, `${base}.apk`),
        certificate: path.join(dir, "upload_certificate.pem"),
    }
}

/** The APK beside an AAB: the same name with .apk. */
function apkBeside(aabPath) {
    return `${aabPath.replace(/\.aab$/i, "")}.apk`
}

/**
 * The signed release APK Gradle built, or a clear error. Without a signing
 * config Gradle names it app-release-unsigned.apk, which no phone installs.
 *
 * @param {string} projectPath
 * @returns {string}
 */
function builtReleaseApk(projectPath) {
    const { releaseApk } = gradleOutputs(projectPath)
    if (fs.existsSync(releaseApk)) return releaseApk
    const unsigned = path.join(path.dirname(releaseApk), "app-release-unsigned.apk")
    if (fs.existsSync(unsigned)) {
        throw new Error(
            `The release APK was built without the upload key (${unsigned}), so it cannot be installed`
        )
    }
    throw new Error(`Signed APK file was not generated at ${releaseApk}`)
}

/**
 * Where a debug build keeps its APK: build-output/android/debug/, under a
 * fixed name that each run overwrites. A build that loads this computer's
 * dev server gets its own name, since it only works here.
 *
 * @param {object} options
 * @param {string} [options.appRoot]
 * @param {string} [options.name] - the app's name; made file-name safe here
 * @param {boolean} [options.usesDevServer] - resolveNativeConfig().usesDevServer
 * @returns {{ dir: string, apk: string, stale: string }} `stale` is the other variant's file
 */
function debugApkPaths({ appRoot = process.cwd(), name, usesDevServer = false } = {}) {
    const dir = path.join(appRoot, BUILD_OUTPUT_DIR, "android", "debug")
    const base = artifactBaseName(name)
    const realHost = path.join(dir, `${base}-debug.apk`)
    const devServer = path.join(dir, `${base}-debug-devserver.apk`)
    return usesDevServer ? { dir, apk: devServer, stale: realHost } : { dir, apk: realHost, stale: devServer }
}

/**
 * Copy the debug APK Gradle built into build-output/android/debug/ and
 * remove the other variant's file there, so only the current one exists.
 * Returns null, and changes nothing, when there is no APK from this run.
 *
 * @param {object} options
 * @param {string} options.projectPath - the androidProject Gradle built in
 * @param {string} [options.appRoot]
 * @param {string} [options.name]
 * @param {boolean} [options.usesDevServer]
 * @param {number} [options.builtAfter] - ms timestamp; an older APK is from an earlier run
 * @returns {string | null} the saved APK's path
 */
function saveDebugApk({ projectPath, appRoot = process.cwd(), name, usesDevServer = false, builtAfter = 0 }) {
    const source = gradleOutputs(projectPath).debugApk
    let stat
    try {
        stat = fs.statSync(source)
    } catch (error) {
        return null
    }
    if (builtAfter && stat.mtimeMs < builtAfter - MTIME_SLACK_MS) return null

    const { dir, apk, stale } = debugApkPaths({ appRoot, name, usesDevServer })
    ensureBuildOutputIgnore(dir, appRoot)
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(source, apk)
    fs.rmSync(stale, { force: true })
    return apk
}

/** The lines printed under a debug APK in the build summary. */
function debugApkNotes(usesDevServer = false) {
    const notes = ["Test build: debuggable, for testing only."]
    if (usesDevServer) {
        notes.push(
            "Only works with this computer's dev server. To share, set WEBVIEW_CONFIG.LOCAL_IP to your site, or run android:release."
        )
    }
    return notes
}

export {
    RELEASE_GRADLE_TASKS,
    RELEASE_APK_NOTE,
    artifactName,
    gradleOutputs,
    releaseOutputDir,
    releaseArtifactPaths,
    apkBeside,
    builtReleaseApk,
    debugApkPaths,
    saveDebugApk,
    debugApkNotes,
}
