// The app id and name every new app gets in config/config.json, derived from
// the project name, so they are visible (and easy to change) from day one.
// A release build refuses the com.example.* id until it is replaced.
const fs = require("fs")
const path = require("path")

// Java keywords and literals cannot be package-name segments.
const JAVA_RESERVED = new Set(
    (
        "abstract assert boolean break byte case catch char class const continue default do double else enum " +
        "extends false final finally float for goto if implements import instanceof int interface long native " +
        "new null package private protected public return short static strictfp super switch synchronized this " +
        "throw throws transient true try void volatile while"
    ).split(" ")
)

/** "@scope/my-shop" -> "com.example.myshop": valid on Android and iOS. */
function deriveAppId(projectName) {
    const base = String(projectName || "")
        .split("/")
        .pop()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
    let segment = base || "app"
    if (/^[0-9]/.test(segment)) segment = `app${segment}`
    if (JAVA_RESERVED.has(segment)) segment = `${segment}app`
    return `com.example.${segment}`
}

/** "my-cool_app" -> "My Cool App": the name shown under the app icon. */
function deriveAppName(projectName) {
    const words = String(projectName || "")
        .split("/")
        .pop()
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
    if (words.length === 0) return "Catalyst App"
    return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
}

/**
 * Set WEBVIEW_CONFIG.appId and appName in the new app's config/config.json
 * from the project name. The template carries both keys with placeholder
 * values; only those two values change, so the file keeps its layout. A
 * config without them gets them added under WEBVIEW_CONFIG.
 *
 * @param {string} projectDir
 * @param {string} projectName
 * @returns {boolean} whether the file was written
 */
function applyAppIdentity(projectDir, projectName) {
    const file = path.join(projectDir, "config", "config.json")
    let text
    let config
    try {
        text = fs.readFileSync(file, "utf8")
        config = JSON.parse(text)
    } catch {
        return false
    }
    const wv = config.WEBVIEW_CONFIG
    if (!wv || typeof wv !== "object" || Array.isArray(wv)) return false
    const appId = deriveAppId(projectName)
    const appName = deriveAppName(projectName)
    if (typeof wv.appId === "string" && typeof wv.appName === "string") {
        text = text
            .replace(/("appId"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(appId)}`)
            .replace(/("appName"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(appName)}`)
    } else {
        config.WEBVIEW_CONFIG = { appId, appName, ...wv }
        text = JSON.stringify(config, null, 4) + "\n"
    }
    fs.writeFileSync(file, text)
    return true
}

module.exports = { deriveAppId, deriveAppName, applyAppIdentity }
