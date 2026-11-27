import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

import {
    RELEASE_APK_NOTE,
    RELEASE_GRADLE_TASKS,
    apkBeside,
    artifactName,
    builtReleaseApk,
    debugApkNotes,
    debugApkPaths,
    gradleOutputs,
    releaseArtifactPaths,
    releaseOutputDir,
    saveDebugApk,
} from "../../src/native/buildAndroid/output.js"
import { assertReleaseFolderFree, ensureBuildOutputIgnore } from "../../src/native/releaseOutput.js"

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-android-output-"))
    temps.push(dir)
    return dir
}
afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** An app folder and an androidProject whose Gradle "built" the given outputs. */
function fixture() {
    const appRoot = tempDir()
    const projectPath = path.join(tempDir(), "androidProject")
    const outputs = gradleOutputs(projectPath)
    const write = (file: string, content = "apk") => {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, content)
    }
    return { appRoot, projectPath, outputs, write }
}

const debugDir = (appRoot: string) => path.join(appRoot, "build-output", "android", "debug")

describe("artifact names", () => {
    it("uses newProjectName, then appName, then app", () => {
        expect(artifactName({ newProjectName: "Shop", appName: "Other" })).toBe("Shop")
        expect(artifactName({ appName: "My Shop" })).toBe("My Shop")
        expect(artifactName({})).toBe("app")
        expect(artifactName()).toBe("app")
    })

    it("knows where Gradle writes the APKs and the bundle", () => {
        const outputs = gradleOutputs("/p")
        expect(outputs.debugApk).toBe(path.join("/p", "app/build/outputs/apk/debug/app-debug.apk"))
        expect(outputs.releaseAab).toBe(path.join("/p", "app/build/outputs/bundle/release/app-release.aab"))
        expect(outputs.releaseApk).toBe(path.join("/p", "app/build/outputs/apk/release/app-release.apk"))
    })
})

describe("debug APK", () => {
    it("is named for a real host or for this computer's dev server", () => {
        const real = debugApkPaths({ appRoot: "/app", name: "My Shop", usesDevServer: false })
        expect(real.dir).toBe(debugDir("/app"))
        expect(real.apk).toBe(path.join(debugDir("/app"), "My-Shop-debug.apk"))
        expect(real.stale).toBe(path.join(debugDir("/app"), "My-Shop-debug-devserver.apk"))

        const dev = debugApkPaths({ appRoot: "/app", name: "My Shop", usesDevServer: true })
        expect(dev.apk).toBe(path.join(debugDir("/app"), "My-Shop-debug-devserver.apk"))
        expect(dev.stale).toBe(path.join(debugDir("/app"), "My-Shop-debug.apk"))

        expect(debugApkPaths({ appRoot: "/app" }).apk).toBe(path.join(debugDir("/app"), "app-debug.apk"))
    })

    it("copies the APK, overwrites the last one and removes the other variant", () => {
        const { appRoot, projectPath, outputs, write } = fixture()
        write(outputs.debugApk, "first")
        const dev = saveDebugApk({ projectPath, appRoot, name: "shop", usesDevServer: true })
        expect(dev).toBe(path.join(debugDir(appRoot), "shop-debug-devserver.apk"))
        expect(fs.readFileSync(dev!, "utf8")).toBe("first")

        write(outputs.debugApk, "second")
        const real = saveDebugApk({ projectPath, appRoot, name: "shop", usesDevServer: false })
        expect(real).toBe(path.join(debugDir(appRoot), "shop-debug.apk"))
        expect(fs.readFileSync(real!, "utf8")).toBe("second")
        expect(fs.existsSync(dev!)).toBe(false)

        write(outputs.debugApk, "third")
        saveDebugApk({ projectPath, appRoot, name: "shop", usesDevServer: false })
        expect(fs.readFileSync(real!, "utf8")).toBe("third")
        expect(fs.readdirSync(debugDir(appRoot))).toEqual(["shop-debug.apk"])
    })

    it("saves nothing, and keeps the folder as it is, when Gradle built no APK", () => {
        const { appRoot, projectPath } = fixture()
        fs.mkdirSync(debugDir(appRoot), { recursive: true })
        fs.writeFileSync(path.join(debugDir(appRoot), "shop-debug-devserver.apk"), "old")
        expect(saveDebugApk({ projectPath, appRoot, name: "shop" })).toBeNull()
        expect(fs.readdirSync(debugDir(appRoot))).toEqual(["shop-debug-devserver.apk"])
    })

    it("ignores an APK left by an earlier run (a failure before Gradle's clean)", () => {
        const { appRoot, projectPath, outputs, write } = fixture()
        write(outputs.debugApk)
        const hourAgo = new Date(Date.now() - 3600 * 1000)
        fs.utimesSync(outputs.debugApk, hourAgo, hourAgo)
        expect(saveDebugApk({ projectPath, appRoot, name: "shop", builtAfter: Date.now() })).toBeNull()
        expect(fs.existsSync(path.join(appRoot, "build-output"))).toBe(false)
    })

    it("still saves an APK from this run when the install failed afterwards", () => {
        // buildApp records the start time, Gradle packages the APK, then
        // installDebug fails: the APK is newer than the start and is kept.
        const { appRoot, projectPath, outputs, write } = fixture()
        const builtAfter = Date.now()
        write(outputs.debugApk, "packaged")
        const saved = saveDebugApk({ projectPath, appRoot, name: "shop", usesDevServer: true, builtAfter })
        expect(saved).toBe(path.join(debugDir(appRoot), "shop-debug-devserver.apk"))
        expect(fs.readFileSync(saved!, "utf8")).toBe("packaged")
    })

    it("gives build-output/ its own * .gitignore", () => {
        const { appRoot, projectPath, outputs, write } = fixture()
        write(outputs.debugApk)
        saveDebugApk({ projectPath, appRoot, name: "shop" })
        expect(fs.readFileSync(path.join(appRoot, "build-output", ".gitignore"), "utf8")).toBe("*\n")
    })

    it("prints a test-only line, and the dev server line for the dev server build", () => {
        expect(debugApkNotes(false)).toEqual(["Test build: debuggable, for testing only."])
        expect(debugApkNotes()).toHaveLength(1)
        const dev = debugApkNotes(true)
        expect(dev[0]).toBe("Test build: debuggable, for testing only.")
        expect(dev[1]).toContain("Only works with this computer's dev server")
        expect(dev[1]).toContain("WEBVIEW_CONFIG.LOCAL_IP")
        expect(dev[1]).toContain("android:release")
    })
})

describe("release APK", () => {
    it("builds the bundle and the APK in the same Gradle run", () => {
        expect(RELEASE_GRADLE_TASKS).toEqual(["clean", "bundleRelease", "assembleRelease"])
    })

    it("sits next to the AAB under the same name", () => {
        const dir = releaseOutputDir({ appRoot: "/app", version: { versionName: "1.2.0", buildNumber: 9 } })
        const names = releaseArtifactPaths(dir, "My Shop")
        expect(names.aab).toBe(path.join(dir, "My-Shop.aab"))
        expect(names.apk).toBe(path.join(dir, "My-Shop.apk"))
        expect(apkBeside(names.aab)).toBe(names.apk)
        // The standalone script's dated name.
        expect(apkBeside("/out/shop-release-2026-11-05.aab")).toBe("/out/shop-release-2026-11-05.apk")
        expect(apkBeside("/out/SHOP.AAB")).toBe("/out/SHOP.apk")
    })

    it("finds the signed APK Gradle built", () => {
        const { projectPath, outputs, write } = fixture()
        write(outputs.releaseApk)
        expect(builtReleaseApk(projectPath)).toBe(outputs.releaseApk)
    })

    it("fails clearly when Gradle built no APK", () => {
        const { projectPath, outputs } = fixture()
        expect(() => builtReleaseApk(projectPath)).toThrow(
            `Signed APK file was not generated at ${outputs.releaseApk}`
        )
    })

    it("fails clearly when the APK was built unsigned", () => {
        const { projectPath, outputs, write } = fixture()
        write(path.join(path.dirname(outputs.releaseApk), "app-release-unsigned.apk"))
        expect(() => builtReleaseApk(projectPath)).toThrow(/without the upload key/)
    })

    it("refuses a release folder that already holds an APK (NATIVE-011)", () => {
        const dir = tempDir()
        fs.writeFileSync(path.join(dir, "shop.apk"), "apk")
        expect(() => assertReleaseFolderFree(dir, [".aab", ".apk"])).toThrow(/shop\.apk/)
    })

    it("has a note for test installs", () => {
        expect(RELEASE_APK_NOTE).toBe("The APK is for test installs; uninstall a Play-installed copy first.")
    })
})

describe("ensureBuildOutputIgnore", () => {
    it("creates build-output/.gitignore with * for a folder inside it", () => {
        const appRoot = tempDir()
        const file = ensureBuildOutputIgnore(
            path.join(appRoot, "build-output", "android", "1.0.0-1"),
            appRoot
        )
        expect(file).toBe(path.join(appRoot, "build-output", ".gitignore"))
        expect(fs.readFileSync(file!, "utf8")).toBe("*\n")
        // build-output/ itself, and a path relative to the app, count too.
        expect(ensureBuildOutputIgnore("build-output", appRoot)).toBe(file)
    })

    it("does not overwrite an existing .gitignore", () => {
        const appRoot = tempDir()
        fs.mkdirSync(path.join(appRoot, "build-output"))
        fs.writeFileSync(path.join(appRoot, "build-output", ".gitignore"), "*.aab\n")
        ensureBuildOutputIgnore(path.join(appRoot, "build-output", "android", "debug"), appRoot)
        expect(fs.readFileSync(path.join(appRoot, "build-output", ".gitignore"), "utf8")).toBe("*.aab\n")
    })

    it("leaves a custom output path outside build-output/ alone", () => {
        const appRoot = tempDir()
        expect(ensureBuildOutputIgnore(path.join(appRoot, "dist", "store"), appRoot)).toBeNull()
        expect(ensureBuildOutputIgnore(path.join(appRoot, "build-output-old"), appRoot)).toBeNull()
        expect(ensureBuildOutputIgnore(path.join(tempDir(), "build-output"), appRoot)).toBeNull()
        expect(fs.existsSync(path.join(appRoot, "build-output"))).toBe(false)
    })

    it("rethrows a write failure other than an existing file", () => {
        const appRoot = tempDir()
        const root = path.join(appRoot, "build-output")
        fs.mkdirSync(root)
        fs.chmodSync(root, 0o500)
        try {
            expect(() => ensureBuildOutputIgnore(root, appRoot)).toThrow(
                expect.objectContaining({ code: "EACCES" })
            )
        } finally {
            fs.chmodSync(root, 0o755)
        }
    })
})
