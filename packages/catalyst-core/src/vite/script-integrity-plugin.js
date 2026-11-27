/**
 * Vite plugin for Subresource Integrity (SRI) on the scripts Catalyst renders.
 *
 * With SCRIPT_INTEGRITY_ENABLE set to true in config/config.json, this hashes
 * every JS file listed in the client build manifest and writes
 * build/.vite/integrity.json as { "<file>": "sha384-<base64>" }. The server
 * reads that file at startup and adds integrity and crossorigin to its script
 * and modulepreload tags (see server/manifestCache.ts and renderer/extract.ts).
 **/
import crypto from "crypto"
import fs from "fs"
import path from "path"

export const INTEGRITY_FILE = "integrity.json"

export const isScriptIntegrityEnabled = (value) => value === true || value === "true"

export const hashFile = (filePath) =>
    `sha384-${crypto.createHash("sha384").update(fs.readFileSync(filePath)).digest("base64")}`

/**
 * Hash the JS files of a finished client build.
 * @param {string} buildDir - Build output directory on disk.
 * @param {object} viteManifest - Parsed build/.vite/manifest.json.
 * @returns {Record<string, string>} Hashes keyed by the manifest `file` path.
 */
export const collectScriptIntegrity = (buildDir, viteManifest = {}) => {
    const integrity = {}
    for (const entry of Object.values(viteManifest)) {
        const file = entry?.file
        if (typeof file !== "string" || !/\.m?js$/.test(file) || integrity[file]) continue
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - file comes from the Vite build manifest written by this build, never from a request.
        const filePath = path.join(buildDir, file)
        // A file the manifest lists but the build did not write throws here and
        // fails the build, so no script ships without the hash the flag promises.
        integrity[file] = hashFile(filePath)
    }
    return integrity
}

export function scriptIntegrityPlugin() {
    return {
        name: "script-integrity",
        // Rollup runs closeBundle hooks in parallel. Sorting this one last and
        // making it sequential waits for every other plugin's closeBundle, so a
        // plugin that rewrites JS there has finished before the files are hashed.
        enforce: "post",

        closeBundle: {
            order: "post",
            sequential: true,
            // Runs after the bundle and manifest.json are on disk.
            handler() {
                const buildDir = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build")
                const outputPath = path.join(buildDir, ".vite", INTEGRITY_FILE)

                // The build directory is not emptied between builds, so a file from
                // an earlier build with the flag on must not outlive the flag.
                if (!isScriptIntegrityEnabled(process.env.SCRIPT_INTEGRITY_ENABLE)) {
                    fs.rmSync(outputPath, { force: true })
                    return
                }

                const manifestPath = path.join(buildDir, ".vite", "manifest.json")
                // A missing manifest means the bundle itself failed; that error is reported elsewhere.
                if (!fs.existsSync(manifestPath)) return

                const viteManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
                fs.writeFileSync(
                    outputPath,
                    JSON.stringify(collectScriptIntegrity(buildDir, viteManifest), null, 2)
                )
            },
        },
    }
}
