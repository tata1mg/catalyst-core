import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { expect, test } from "vitest"
import { createRequire } from "module"

// The CJS build module loads with require, as in iosConfigPhase.test.ts.
const require = createRequire(import.meta.url)
const { processLocation: processLocationIn } = require("../../src/native/buildAndroid/location.js")

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
    const processLocation = (config: object) =>
        processLocationIn({ pwd, progress: { log: () => {} } }, config)
    const readManifest = () => fs.readFileSync(manifestPath, "utf8")
    return { processLocation, readManifest }
}

test("the template manifest declares no location permissions", () => {
    expect(fs.readFileSync(templateManifest, "utf8").match(LOCATION_LINES) || []).toHaveLength(0)
})

test("location.enabled adds fine and coarse location permissions once, across repeated builds", async () => {
    const { processLocation, readManifest } = fakeAndroidProject()

    await processLocation({ location: { enabled: true } })
    await processLocation({ location: { enabled: true } })

    const manifest = readManifest()
    expect(manifest.match(LOCATION_LINES) || []).toHaveLength(2)
    // Inserted with the other permissions, ahead of <uses-feature>
    expect(manifest.indexOf("ACCESS_FINE_LOCATION")).toBeLessThan(manifest.indexOf("<uses-feature"))
})

test("location off (or missing) removes permissions a previous build added", async () => {
    const { processLocation, readManifest } = fakeAndroidProject()

    await processLocation({ location: { enabled: true } })
    await processLocation({})

    expect(readManifest().match(LOCATION_LINES) || []).toHaveLength(0)
})
