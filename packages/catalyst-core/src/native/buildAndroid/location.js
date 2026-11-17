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
            manifestContent = manifestContent.replace(
                /(<uses-permission[^>]*>[\s\S]*?)(\s*<uses-feature)/,
                `$1\n${permissionsXml}$2`
            )
            progress.log("Added location permissions to AndroidManifest.xml", "success")
        }

        fs.writeFileSync(manifestPath, manifestContent)
    } catch (error) {
        progress.log(`Warning: Error processing location permissions: ${error.message}`, "warning")
    }
}

module.exports = { processLocation }
