// Native (Android/iOS) setup for a new app: the "Native platforms" answer and
// the app id become WEBVIEW_CONFIG entries, a placeholder icon, a credentials/
// ignore rule and a CI workflow. Nothing here runs for a web-only app.
const fs = require("fs")
const path = require("path")

const PLATFORMS = ["android", "ios"]

// Fails the release-host check (a .localhost name) until it is replaced, so a
// release can never ship pointing at a placeholder.
const RELEASE_HOST_PLACEHOLDER = "your-production-host.localhost"

// Java keywords and literals cannot be package-name segments.
const JAVA_RESERVED = new Set(
    (
        "abstract assert boolean break byte case catch char class const continue default do double else enum " +
        "extends false final finally float for goto if implements import instanceof int interface long native " +
        "new null package private protected public return short static strictfp super switch synchronized this " +
        "throw throws transient true try void volatile while"
    ).split(" ")
)

/**
 * `--native` value to a platform list: none, android, ios, both, or a comma
 * list such as "android,ios". Null when the value is not one of those.
 *
 * @param {string} value
 * @returns {string[] | null}
 */
function parseNativeOption(value) {
    const parts = String(value)
        .toLowerCase()
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    if (parts.length === 0) return null
    const chosen = new Set()
    for (const part of parts) {
        if (part === "none") continue
        if (part === "both") PLATFORMS.forEach((platform) => chosen.add(platform))
        else if (PLATFORMS.includes(part)) chosen.add(part)
        else return null
    }
    if (parts.includes("none") && chosen.size > 0) return null
    return PLATFORMS.filter((platform) => chosen.has(platform))
}

/** "@scope/my-app" -> "com.example.myapp": a valid default the user is asked to change. */
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
 * Why `appId` cannot be the Android application id and/or iOS bundle id for
 * the chosen platforms, or undefined when it can. Android: two or more
 * dot-separated segments, each a letter then letters, digits or underscores,
 * no Java keyword. iOS: letters, digits, hyphens and dots. For both, only a
 * letter-led alphanumeric segment satisfies the two.
 *
 * @param {string} appId
 * @param {string[]} platforms
 * @returns {string | undefined}
 */
function validateAppId(appId, platforms) {
    const id = String(appId || "").trim()
    if (!id) return "Enter an app id such as com.yourcompany.myapp"
    if (id.length > 155) return "The app id must be at most 155 characters"
    const segments = id.split(".")
    if (segments.length < 2)
        return "Use reverse-DNS form with at least two parts, such as com.yourcompany.myapp"
    if (segments.some((segment) => segment === ""))
        return "The app id cannot have empty parts (.. or a leading or trailing dot)"

    if (platforms.includes("android")) {
        for (const segment of segments) {
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(segment)) {
                return `"${segment}": each part of an Android package name starts with a letter and has only letters, digits and underscores`
            }
            if (JAVA_RESERVED.has(segment))
                return `"${segment}" is a Java keyword and cannot be part of an Android package name`
        }
    }
    if (platforms.includes("ios") && !/^[A-Za-z0-9.-]+$/.test(id)) {
        return "An iOS bundle id has only letters, digits, hyphens and dots"
    }
    return undefined
}

/** package.json "1.2.3" -> { major: 1, minor: 2, patch: 3 }; 1.0.0 when unreadable. */
function versionFromPackage(projectDir) {
    try {
        const { version } = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"))
        const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version))
        if (match) return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
    } catch {
        // Fall through to the default.
    }
    return { major: 1, minor: 0, patch: 0 }
}

// Pinned by commit; the comment is the release tag. Same pins as Catalyst's own CI.
const ACTIONS = {
    checkout: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    setupNode: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
    setupJava: "actions/setup-java@b6effb05e454b25005698d916606bdc6ffcbf961 # v5.7.0",
    setupGradle: "gradle/actions/setup-gradle@3f5f9adaf7d9fecd50b5935e54106014257a94e6 # v6.4.0",
    uploadArtifact: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
}
const XCODE_APP = "/Applications/Xcode_26.5.app"

/**
 * .github/workflows/catalyst-native.yml for the chosen platforms.
 *
 * @param {string[]} platforms
 * @returns {string}
 */
function renderWorkflow(platforms) {
    const android = platforms.includes("android")
    const ios = platforms.includes("ios")
    const lines = [
        "# Release builds of the native apps, uploaded as workflow artifacts. Nothing is",
        "# published: download the artifacts and upload them to the stores yourself.",
        "#",
        "# Before the first run, set WEBVIEW_CONFIG.release.LOCAL_IP in config/config.json",
        "# to your production host (the build refuses the placeholder), and add these",
        "# repository secrets under Settings > Secrets and variables > Actions.",
    ]
    if (android) {
        lines.push(
            "#",
            "# Android upload key. Create it once with `npm run buildApp:android -- --release",
            "# --build-number 1` in a terminal, which writes credentials/android/, and keep a",
            "# backup: Google Play only accepts updates signed with it.",
            "#   CATALYST_ANDROID_KEYSTORE_BASE64  base64 < credentials/android/upload.jks",
            "#   CATALYST_ANDROID_STORE_PASSWORD   storePassword from credentials/android/keystore.properties",
            "#   CATALYST_ANDROID_KEY_PASSWORD     keyPassword from the same file",
            "#   CATALYST_ANDROID_KEY_ALIAS        keyAlias from the same file"
        )
    }
    if (ios) {
        lines.push(
            "#",
            "# iOS manual signing: an Apple Distribution certificate exported from Keychain",
            "# Access as a .p12 (with its private key), and an App Store provisioning profile",
            "# for this app's bundle id. The profile also supplies the team id.",
            "#   CATALYST_IOS_P12_BASE64      base64 < distribution.p12",
            "#   CATALYST_IOS_P12_PASSWORD    the password chosen when exporting the .p12",
            "#   CATALYST_IOS_PROFILE_BASE64  base64 < AppStore.mobileprovision"
        )
    }
    lines.push(
        "#",
        "# The build number is the workflow run number. Each store needs it higher than",
        "# the last upload; if yours is already past that, change CATALYST_BUILD_NUMBER.",
        "",
        "name: Catalyst native release",
        "",
        "on:",
        "    workflow_dispatch:",
        "    push:",
        '        tags: ["v*"]',
        "",
        "permissions:",
        "    contents: read",
        "",
        "jobs:"
    )
    if (android) {
        lines.push(
            "    android:",
            "        runs-on: ubuntu-latest",
            "        steps:",
            `            - uses: ${ACTIONS.checkout}`,
            `            - uses: ${ACTIONS.setupNode}`,
            "              with:",
            "                  node-version: 22",
            "                  cache: npm",
            "            - run: npm ci",
            `            - uses: ${ACTIONS.setupJava}`,
            "              with:",
            "                  distribution: temurin",
            '                  java-version: "17"',
            `            - uses: ${ACTIONS.setupGradle}`,
            "              with:",
            "                  cache-provider: basic",
            "            # The app loads your deployed site, so the web build is not bundled. If you",
            "            # turn on android.buildOptimisation, add `- run: npm run build` before this step.",
            "            - name: Build the signed AAB",
            "              run: npx catalyst buildApp:android --release",
            "              env:",
            "                  CATALYST_BUILD_NUMBER: ${{ github.run_number }}",
            "                  CATALYST_ANDROID_KEYSTORE_BASE64: ${{ secrets.CATALYST_ANDROID_KEYSTORE_BASE64 }}",
            "                  CATALYST_ANDROID_STORE_PASSWORD: ${{ secrets.CATALYST_ANDROID_STORE_PASSWORD }}",
            "                  CATALYST_ANDROID_KEY_PASSWORD: ${{ secrets.CATALYST_ANDROID_KEY_PASSWORD }}",
            "                  CATALYST_ANDROID_KEY_ALIAS: ${{ secrets.CATALYST_ANDROID_KEY_ALIAS }}",
            `            - uses: ${ACTIONS.uploadArtifact}`,
            "              with:",
            "                  name: android-aab",
            "                  path: build-output/*.aab",
            "                  if-no-files-found: error"
        )
    }
    if (android && ios) lines.push("")
    if (ios) {
        lines.push(
            "    ios:",
            "        runs-on: macos-26",
            "        steps:",
            `            - uses: ${ACTIONS.checkout}`,
            "            # Pinned so an image update does not change the SDK the app is built with.",
            `            - run: sudo xcode-select -s ${XCODE_APP}`,
            `            - uses: ${ACTIONS.setupNode}`,
            "              with:",
            "                  node-version: 22",
            "                  cache: npm",
            "            - run: npm ci",
            "            - name: Build the signed IPA",
            "              run: npx catalyst buildApp:ios --release",
            "              env:",
            "                  CATALYST_BUILD_NUMBER: ${{ github.run_number }}",
            "                  CATALYST_IOS_P12_BASE64: ${{ secrets.CATALYST_IOS_P12_BASE64 }}",
            "                  CATALYST_IOS_P12_PASSWORD: ${{ secrets.CATALYST_IOS_P12_PASSWORD }}",
            "                  CATALYST_IOS_PROFILE_BASE64: ${{ secrets.CATALYST_IOS_PROFILE_BASE64 }}",
            `            - uses: ${ACTIONS.uploadArtifact}`,
            "              with:",
            "                  name: ios-ipa",
            "                  path: |",
            "                      build/native/ios/*/*.ipa",
            "                      build/native/ios/*/*-dSYMs.zip",
            "                  if-no-files-found: error"
        )
    }
    return `${lines.join("\n")}\n`
}

/** JSON with 4-space indent, keeping short arrays of strings on one line as the template does. */
function formatJson(value) {
    return JSON.stringify(value, null, 4).replace(
        /\[\n\s+("[^"\n]*"(?:,\n\s+"[^"\n]*")*)\n\s+\]/g,
        (match, items) => {
            const inline = `[${items.split(/,\n\s+/).join(", ")}]`
            return inline.length <= 80 ? inline : match
        }
    )
}

/** Append `credentials/` (the Android upload key's home) to .gitignore unless already there. */
function ignoreCredentials(projectDir) {
    const file = path.join(projectDir, ".gitignore")
    const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
    const lines = content.split(/\r?\n/).map((line) => line.trim())
    if (
        ["credentials", "credentials/", "/credentials", "/credentials/"].some((entry) =>
            lines.includes(entry)
        )
    )
        return
    const prefix = content && !content.endsWith("\n") ? "\n" : ""
    fs.writeFileSync(file, `${content}${prefix}credentials/\n`)
}

/**
 * Write the native setup into a freshly extracted app.
 *
 * @param {string} projectDir
 * @param {object} options
 * @param {string[]} options.platforms - subset of ["android", "ios"]; empty does nothing
 * @param {string} options.appId
 * @param {string} options.appName
 * @param {string} [options.iconSource] - PNG copied to public/icon.png
 * @returns {string[]} the files written, relative to projectDir
 */
function applyNativeSetup(
    projectDir,
    { platforms, appId, appName, iconSource = path.join(__dirname, "..", "templates", "native", "icon.png") }
) {
    if (!platforms || platforms.length === 0) return []
    const written = []

    const configPath = path.join(projectDir, "config", "config.json")
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    const webview = config.WEBVIEW_CONFIG || {}
    const version = versionFromPackage(projectDir)
    if (platforms.includes("android")) {
        webview.android = { ...webview.android, packageName: appId, appName, version: { ...version } }
    }
    if (platforms.includes("ios")) {
        webview.ios = { ...webview.ios, appBundleId: appId, appName, version: { ...version } }
    }
    webview.release = { LOCAL_IP: RELEASE_HOST_PLACEHOLDER, port: 443, useHttps: true }
    config.WEBVIEW_CONFIG = webview
    fs.writeFileSync(configPath, `${formatJson(config)}\n`)
    written.push("config/config.json")

    const iconPath = path.join(projectDir, "public", "icon.png")
    if (!fs.existsSync(iconPath)) {
        fs.mkdirSync(path.dirname(iconPath), { recursive: true })
        fs.copyFileSync(iconSource, iconPath)
        written.push("public/icon.png")
    }

    ignoreCredentials(projectDir)
    written.push(".gitignore")

    const workflowPath = path.join(projectDir, ".github", "workflows", "catalyst-native.yml")
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true })
    fs.writeFileSync(workflowPath, renderWorkflow(platforms))
    written.push(".github/workflows/catalyst-native.yml")

    return written
}

module.exports = {
    PLATFORMS,
    RELEASE_HOST_PLACEHOLDER,
    parseNativeOption,
    deriveAppId,
    deriveAppName,
    validateAppId,
    renderWorkflow,
    applyNativeSetup,
}
