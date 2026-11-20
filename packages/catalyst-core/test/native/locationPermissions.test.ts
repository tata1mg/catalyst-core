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
    return { processLocation, readManifest, manifestPath }
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

test("location.enabled fails the build when the permissions cannot be added", async () => {
    const { processLocation, manifestPath } = fakeAndroidProject()
    // No <uses-permission> block ahead of <uses-feature>: nowhere to insert.
    fs.writeFileSync(manifestPath, "<manifest><application /></manifest>")

    await expect(processLocation({ location: { enabled: true } })).rejects.toThrow(
        /Could not add location permissions to AndroidManifest\.xml/
    )
})

test("location off only warns when the manifest cannot be read", async () => {
    const { processLocation, manifestPath } = fakeAndroidProject()
    fs.rmSync(manifestPath)

    await expect(processLocation({})).resolves.toBeUndefined()
})
