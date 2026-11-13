import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
    copyProjectWithoutOutputs,
    copyWebBuild,
    findFiles,
    removeEmptyDirectories,
    removeTree,
    renameWithRetry,
    walkTree,
} = createRequire(import.meta.url)("../../src/native/projectFiles.js")

let root: string
const write = (relative: string, content = "x") => {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    return file
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst project files "))
})
afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
})

describe("walkTree", () => {
    it("lists children before their parent, so a rename cannot invalidate what follows", () => {
        write("a/b/c.txt")
        const paths = walkTree(root).map((entry: { path: string }) => path.relative(root, entry.path))
        expect(paths).toEqual([path.join("a", "b", "c.txt"), path.join("a", "b"), "a"])
    })

    it("does not follow a symlink out of the tree", () => {
        write("outside/secret.txt")
        fs.mkdirSync(path.join(root, "inside"))
        try {
            fs.symlinkSync(path.join(root, "outside"), path.join(root, "inside", "link"), "junction")
        } catch {
            return // Creating links can need privileges; nothing to check without one.
        }
        const entries = walkTree(path.join(root, "inside"))
        expect(entries.map((entry: { name: string }) => entry.name)).toEqual(["link"])
        expect(entries[0].isDirectory).toBe(false)
    })
})

describe("findFiles", () => {
    it("finds files by name and never returns a directory", () => {
        const kept = write("app/src/Main.kt")
        write("app/src/Main.xml")
        fs.mkdirSync(path.join(root, "app", "folder.kt"))
        expect(findFiles(root, (name: string) => name.endsWith(".kt"))).toEqual([kept])
    })

    it("skips a symlinked file, so nothing written to a result leaves the tree", () => {
        const outside = write("outside/Main.kt")
        const kept = write("app/Real.kt")
        try {
            fs.symlinkSync(outside, path.join(root, "app", "Linked.kt"))
        } catch {
            return // Creating links can need privileges; nothing to check without one.
        }
        expect(findFiles(path.join(root, "app"), (name: string) => name.endsWith(".kt"))).toEqual([kept])
    })
})

describe("removeEmptyDirectories", () => {
    it("removes chains left empty, and keeps anything with a file in it", () => {
        write("java/io/yourname/.keep")
        fs.rmSync(path.join(root, "java", "io", "yourname", ".keep"))
        write("java/com/example/Main.kt")
        removeEmptyDirectories(path.join(root, "java"))
        expect(fs.existsSync(path.join(root, "java", "io"))).toBe(false)
        expect(fs.existsSync(path.join(root, "java", "com", "example", "Main.kt"))).toBe(true)
    })
})

describe("removeTree", () => {
    it("removes a tree, and does not mind one that is already gone", () => {
        write("gone/deep/file.txt")
        removeTree(path.join(root, "gone"))
        expect(fs.existsSync(path.join(root, "gone"))).toBe(false)
        expect(() => removeTree(path.join(root, "gone"))).not.toThrow()
    })
})

describe("renameWithRetry", () => {
    it("rides out a file a scanner has open for a moment", () => {
        const from = write("from.txt")
        const to = path.join(root, "to.txt")
        const rename = fs.renameSync
        let failures = 2
        vi.spyOn(fs, "renameSync").mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
            if (failures-- > 0) throw Object.assign(new Error("busy"), { code: "EBUSY" })
            return rename(...args)
        })
        renameWithRetry(from, to)
        expect(fs.existsSync(to)).toBe(true)
    })

    it("does not retry what waiting cannot fix", () => {
        const spy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
            throw Object.assign(new Error("missing"), { code: "ENOENT" })
        })
        expect(() => renameWithRetry("a", "b")).toThrow("missing")
        expect(spy).toHaveBeenCalledTimes(1)
    })
})

describe("copyProjectWithoutOutputs", () => {
    it("copies the project but none of its build outputs", () => {
        write("project/gradlew")
        write("project/local.properties")
        write("project/app/src/main/AndroidManifest.xml")
        write("project/app/src/main/build/kept-because-it-is-source.txt")
        write("project/app/build/outputs/huge.apk")
        write("project/build/reports/report.html")
        write("project/.gradle/8.13/lock")

        const destination = path.join(root, "temp build")
        copyProjectWithoutOutputs(path.join(root, "project"), destination)

        const copied = (relative: string) => fs.existsSync(path.join(destination, relative))
        expect(copied("gradlew")).toBe(true)
        expect(copied("local.properties")).toBe(true)
        expect(copied("app/src/main/AndroidManifest.xml")).toBe(true)
        expect(copied("app/src/main/build/kept-because-it-is-source.txt")).toBe(true)
        expect(copied("app/build")).toBe(false)
        expect(copied("build")).toBe(false)
        expect(copied(".gradle")).toBe(false)
    })

    it("copies through a linked project rather than recreating the link", () => {
        write("real/gradlew")
        write("real/app/build/huge.apk")
        try {
            fs.symlinkSync(path.join(root, "real"), path.join(root, "linked"), "junction")
        } catch {
            return // Creating links can need privileges; nothing to check without one.
        }
        const destination = path.join(root, "copy")
        copyProjectWithoutOutputs(path.join(root, "linked"), destination)
        expect(fs.lstatSync(destination).isSymbolicLink()).toBe(false)
        expect(fs.existsSync(path.join(destination, "gradlew"))).toBe(true)
        expect(fs.existsSync(path.join(destination, "app", "build"))).toBe(false)
    })

    it("handles a source path written with forward slashes, as the build passes it", () => {
        write("project/app/build/huge.apk")
        write("project/gradlew")
        const destination = path.join(root, "copy")
        copyProjectWithoutOutputs(`${root}/project`.replace(/\\/g, "/"), destination)
        expect(fs.existsSync(path.join(destination, "gradlew"))).toBe(true)
        expect(fs.existsSync(path.join(destination, "app", "build"))).toBe(false)
    })
})

// With buildOptimisation the web build ships inside the app, minus the route
// manifests. This was rm -rf and rsync, neither of which exist on Windows.
describe("copyWebBuild", () => {
    const excluded = new Set(["route-manifest.json.gz", "route-manifest.json.br"])
    const dest = () => path.join(root, "assets", "build")
    const copied = (relative: string) => fs.existsSync(path.join(dest(), relative))

    it("copies the build, leaves out the manifests at any depth, and drops stale files", () => {
        write("build/client/main.js")
        write("build/route-manifest.json.gz")
        write("build/client/route-manifest.json.br")
        write("build/client/route-manifest.json")
        write("assets/build/stale.js")

        copyWebBuild(path.join(root, "build"), dest(), excluded)

        expect(copied("client/main.js")).toBe(true)
        expect(copied("client/route-manifest.json")).toBe(true)
        expect(copied("route-manifest.json.gz")).toBe(false)
        expect(copied("client/route-manifest.json.br")).toBe(false)
        expect(copied("stale.js")).toBe(false)
    })

    it("copies through a linked build folder, still leaving out the manifests", () => {
        write("elsewhere/client/main.js")
        write("elsewhere/route-manifest.json.gz")
        try {
            fs.symlinkSync(path.join(root, "elsewhere"), path.join(root, "build"), "junction")
        } catch {
            return // Creating links can need privileges; nothing to check without one.
        }

        copyWebBuild(path.join(root, "build"), dest(), excluded)

        expect(fs.lstatSync(dest()).isSymbolicLink()).toBe(false)
        expect(copied("client/main.js")).toBe(true)
        expect(copied("route-manifest.json.gz")).toBe(false)
    })

    it("throws for a build that does not exist", () => {
        expect(() => copyWebBuild(path.join(root, "missing"), dest(), excluded)).toThrow(/ENOENT/)
    })
})
