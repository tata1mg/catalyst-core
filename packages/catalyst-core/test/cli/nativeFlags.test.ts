import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

// bin/catalyst.js runs on import, so it is exercised as a process: a copy sits
// in a temp package whose dist/native scripts just print the argv they get.
const here = path.dirname(fileURLToPath(import.meta.url))
const binSource = path.resolve(here, "../../bin/catalyst.js")

let root = ""

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-bin-flags-"))
    fs.mkdirSync(path.join(root, "bin"))
    fs.mkdirSync(path.join(root, "dist", "native"), { recursive: true })
    fs.copyFileSync(binSource, path.join(root, "bin", "catalyst.js"))
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module", version: "0.0.0" }))
    for (const name of ["buildAppAndroid", "buildAppIos", "androidSetup", "setupEmulatorIos"]) {
        fs.writeFileSync(
            path.join(root, "dist", "native", `${name}.js`),
            `console.log(JSON.stringify({ script: ${JSON.stringify(name)}, args: process.argv.slice(2) }))\n`
        )
    }
})

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
})

function run(args: string[]) {
    const out = execFileSync(process.execPath, [path.join(root, "bin", "catalyst.js"), ...args], {
        encoding: "utf8",
    })
    return out
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
}

describe("native build flags", () => {
    it("forwards --release and --build-number to the platform script", () => {
        expect(run(["buildApp:android", "--release", "--build-number", "7"])).toEqual([
            { script: "buildAppAndroid", args: ["--release", "--build-number", "7"] },
        ])
    })

    it("does not dispatch on a build number that names a command", () => {
        expect(run(["--build-number", "build", "buildApp:android"])).toEqual([
            { script: "buildAppAndroid", args: ["--build-number", "build"] },
        ])
        expect(run(["buildApp:android", "--build-number=serve"])).toEqual([
            { script: "buildAppAndroid", args: ["--build-number=serve"] },
        ])
    })

    it("keeps flags given before the command away from node", () => {
        expect(run(["--release", "buildApp:android", "--verbose"])).toEqual([
            { script: "buildAppAndroid", args: ["--release", "--verbose"] },
        ])
    })

    it("forwards iOS's --no-sign wherever it appears", () => {
        expect(run(["--no-sign", "buildApp:ios", "--release", "--build-number=7"])).toEqual([
            { script: "buildAppIos", args: ["--no-sign", "--release", "--build-number=7"] },
        ])
    })

    it("forwards setup's --yes and --accept-licenses wherever they appear", () => {
        expect(run(["--yes", "setupEmulator:android", "--accept-licenses"])).toEqual([
            { script: "androidSetup", args: ["--yes", "--accept-licenses"] },
        ])
        expect(run(["setupEmulator", "--yes"])).toEqual([
            { script: "setupEmulatorIos", args: ["--yes"] },
            { script: "androidSetup", args: ["--yes"] },
        ])
    })

    it("passes the flags to both platforms for buildApp", () => {
        expect(run(["buildApp", "--release", "--build-number", "3"])).toEqual([
            { script: "buildAppIos", args: ["--release", "--build-number", "3"] },
            { script: "buildAppAndroid", args: ["--release", "--build-number", "3"] },
        ])
    })
})
