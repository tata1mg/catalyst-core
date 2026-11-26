import fs from "fs"
import path from "path"

let manifest = null
let assetManifest = null
let integrityManifest: Record<string, string> = {}
let loaded = false

const isProduction = process.env.NODE_ENV === "production"
const isScriptIntegrityEnabled = [true, "true"].includes(process.env.SCRIPT_INTEGRITY_ENABLE as any)

// integrity.json is keyed by build file path. Scripts are rendered by URL, so
// re-key it with the same public path ChunkExtractor uses to build those URLs.
function toUrlKeys(files: Record<string, string>) {
    const baseUrl = `${process.env.PUBLIC_STATIC_ASSET_URL || ""}${process.env.PUBLIC_STATIC_ASSET_PATH || ""}`
    const publicPath = `${baseUrl.replace(/\/+$/, "")}/`
    const byUrl: Record<string, string> = {}
    for (const [file, integrity] of Object.entries(files || {})) {
        byUrl[`${publicPath}${file.replace(/^\/+/, "")}`] = integrity
    }
    return byUrl
}

function loadManifests() {
    if (loaded) return

    if (!isProduction) return

    const buildPath = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build")
    try {
        const manifestPath = path.join(buildPath, ".vite", "manifest.json")
        const assetManifestPath = path.join(buildPath, ".vite", "asset-categories.json")
        const integrityPath = path.join(buildPath, ".vite", "integrity.json")

        if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
        }
        if (fs.existsSync(assetManifestPath)) {
            assetManifest = JSON.parse(fs.readFileSync(assetManifestPath, "utf-8"))
        }
        if (isScriptIntegrityEnabled && fs.existsSync(integrityPath)) {
            integrityManifest = toUrlKeys(JSON.parse(fs.readFileSync(integrityPath, "utf-8")))
        }
        loaded = true
    } catch (error) {
        loaded = false
        console.warn("Could not load build manifests:", error.message)
    }
}

loadManifests()

export const getManifest = () => manifest
export const getAssetManifest = () => assetManifest

/**
 * Subresource Integrity hashes keyed by script URL, from the build's
 * `.vite/integrity.json`. Empty unless SCRIPT_INTEGRITY_ENABLE is true and the
 * build wrote the file.
 */
export const getIntegrityManifest = () => integrityManifest
