const fs = require("fs")

const LOCATION_PERMISSIONS = [
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
]

// Location permissions are only declared when WEBVIEW_CONFIG.location.enabled is
// true, so apps that never use navigator.geolocation don't ship them. Kept out of
// assets.js so it loads without the rest of the build phase.
async function processLocation({ pwd, progress }, WEBVIEW_CONFIG) {
    const manifestPath = `${pwd}/androidProject/app/src/main/AndroidManifest.xml`
    try {
        let manifestContent = fs.readFileSync(manifestPath, "utf8")
        manifestContent = manifestContent
            .split("\n")
            .filter(
                (line) =>
                    !LOCATION_PERMISSIONS.some((permission) =>
                        line.includes(`<uses-permission android:name="${permission}"`)
                    )
            )
            .join("\n")

        if (WEBVIEW_CONFIG.location?.enabled) {
            const permissionsXml = LOCATION_PERMISSIONS.map(
                (permission) => `    <uses-permission android:name="${permission}" />`
            ).join("\n")
            const withPermissions = manifestContent.replace(
                /(<uses-permission[^>]*>[\s\S]*?)(\s*<uses-feature)/,
                `$1\n${permissionsXml}$2`
            )
            if (withPermissions === manifestContent) {
                throw new Error("no <uses-permission> block before <uses-feature> to insert them after")
            }
            manifestContent = withPermissions
            progress.log("Added location permissions to AndroidManifest.xml", "success")
        }

        fs.writeFileSync(manifestPath, manifestContent)
    } catch (error) {
        // With location on, an app built without the permissions fails only when
        // geolocation is used, so stop the build. With it off this is cleanup.
        if (WEBVIEW_CONFIG.location?.enabled) {
            throw new Error(`Could not add location permissions to AndroidManifest.xml: ${error.message}`)
        }
        progress.log(`Warning: Error processing location permissions: ${error.message}`, "warning")
    }
}

module.exports = { processLocation }
