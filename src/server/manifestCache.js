import fs from "fs"
import path from "path"

let manifest = null
let assetManifest = null
let loaded = false

const isProduction = process.env.NODE_ENV === "production"

function loadManifests() {
    if (loaded) return
    loaded = true

    if (!isProduction) return

    const buildPath = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build")
    try {
        const manifestPath = path.join(buildPath, ".vite", "manifest.json")
        const assetManifestPath = path.join(buildPath, ".vite", "asset-categories.json")

        if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
        }
        if (fs.existsSync(assetManifestPath)) {
            assetManifest = JSON.parse(fs.readFileSync(assetManifestPath, "utf-8"))
        }
    } catch (error) {
        console.warn("Could not load build manifests:", error.message)
    }
}

loadManifests()

export const getManifest = () => manifest
export const getAssetManifest = () => assetManifest
