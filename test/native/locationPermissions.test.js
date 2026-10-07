import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"

// src/native is a CommonJS subtree (see its package.json); load it with require from this ESM test.
const require = createRequire(import.meta.url)
const createAssetsPhase = require("../../src/native/buildAndroid/assets.js")

const here = path.dirname(fileURLToPath(import.meta.url))
const templateManifest = path.resolve(
    here,
    "../../src/native/androidProject/app/src/main/AndroidManifest.xml"
)

const LOCATION_LINES =
    /<uses-permission android:name="android\.permission\.ACCESS_(FINE|COARSE)_LOCATION" \/>/g

function fakeAndroidProject() {
    const pwd = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-location-"))
    const manifestDir = path.join(pwd, "androidProject", "app", "src", "main")
    fs.mkdirSync(manifestDir, { recursive: true })
    const manifestPath = path.join(manifestDir, "AndroidManifest.xml")
    fs.copyFileSync(templateManifest, manifestPath)
    const { processLocation } = createAssetsPhase({ pwd, progress: { log: () => {} } })
    const readManifest = () => fs.readFileSync(manifestPath, "utf8")
    return { processLocation, readManifest }
}

test("the template manifest declares no location permissions", () => {
    assert.equal((fs.readFileSync(templateManifest, "utf8").match(LOCATION_LINES) || []).length, 0)
})

test("location.enabled adds fine and coarse location permissions once, across repeated builds", async () => {
    const { processLocation, readManifest } = fakeAndroidProject()

    await processLocation({ location: { enabled: true } })
    await processLocation({ location: { enabled: true } })

    const manifest = readManifest()
    assert.equal((manifest.match(LOCATION_LINES) || []).length, 2)
    // Inserted with the other permissions, ahead of <uses-feature>
    assert.ok(manifest.indexOf("ACCESS_FINE_LOCATION") < manifest.indexOf("<uses-feature"))
})

test("location off (or missing) removes permissions a previous build added", async () => {
    const { processLocation, readManifest } = fakeAndroidProject()

    await processLocation({ location: { enabled: true } })
    await processLocation({})

    assert.equal((readManifest().match(LOCATION_LINES) || []).length, 0)
})
