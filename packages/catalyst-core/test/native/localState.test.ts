import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

import {
    ensureLocalStateDir,
    getLastTarget,
    localStatePath,
    readLocalState,
    saveLastTarget,
    writeLocalState,
} from "../../src/native/localState.js"

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-local-state-"))
    temps.push(dir)
    return dir
}
afterEach(() => {
    for (const dir of temps.splice(0)) {
        fs.chmodSync(dir, 0o755)
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

describe("local state", () => {
    it("is empty when the file is missing or broken", () => {
        const cwd = tempDir()
        expect(readLocalState({ cwd })).toEqual({})
        fs.mkdirSync(path.join(cwd, ".catalyst"))
        fs.writeFileSync(localStatePath(cwd), "{not json")
        expect(readLocalState({ cwd })).toEqual({})
        fs.writeFileSync(localStatePath(cwd), "[1]")
        expect(readLocalState({ cwd })).toEqual({})
    })

    it("remembers the last target per platform and keeps the others", () => {
        const cwd = tempDir()
        expect(getLastTarget("android", { cwd })).toBeNull()
        expect(saveLastTarget("android", { target: "device", serial: "R58M" }, { cwd })).toBe(true)
        expect(saveLastTarget("ios", { target: "simulator", udid: "ABC", name: "iPhone 17" }, { cwd })).toBe(
            true
        )
        expect(getLastTarget("android", { cwd })).toEqual({ target: "device", serial: "R58M" })
        expect(saveLastTarget("android", { target: "emulator", avd: "Pixel_8" }, { cwd })).toBe(true)
        expect(readLocalState({ cwd })).toEqual({
            android: { target: "emulator", avd: "Pixel_8" },
            ios: { target: "simulator", udid: "ABC", name: "iPhone 17" },
        })
    })

    it("keeps the folder out of git on its own", () => {
        const cwd = tempDir()
        writeLocalState({ migrations: { lanAddresses: "now" } }, { cwd })
        expect(fs.readFileSync(path.join(cwd, ".catalyst", ".gitignore"), "utf8")).toBe("*\n")
    })

    it("keeps a .gitignore the folder already has", () => {
        const cwd = tempDir()
        fs.mkdirSync(path.join(cwd, ".catalyst"))
        fs.writeFileSync(path.join(cwd, ".catalyst", ".gitignore"), "*\n!keep.txt\n")
        expect(writeLocalState({ a: 1 }, { cwd })).toBe(true)
        expect(fs.readFileSync(path.join(cwd, ".catalyst", ".gitignore"), "utf8")).toBe("*\n!keep.txt\n")
        expect(ensureLocalStateDir(cwd)).toBe(path.join(cwd, ".catalyst"))
        expect(readLocalState({ cwd })).toEqual({ a: 1 })
    })

    it("never throws when it cannot write", () => {
        const cwd = tempDir()
        fs.chmodSync(cwd, 0o500)
        expect(writeLocalState({ a: 1 }, { cwd })).toBe(false)
        expect(saveLastTarget("android", { target: "emulator" }, { cwd })).toBe(false)
    })

    it("rejects a target without a kind", () => {
        expect(saveLastTarget("android", { serial: "x" } as any, { cwd: tempDir() })).toBe(false)
    })
})
