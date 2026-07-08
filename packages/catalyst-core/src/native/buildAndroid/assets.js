"use strict"

const fs = require("fs")
const path = require("path")

function createAssetsPhase(ctx) {
    const { configPath, publicPath, pwd, progress } = ctx

    async function copyBuildAssets(androidConfig, buildOptimisation = false) {
        if (!buildOptimisation) return

        progress.log("Copying build assets to Android project...", "info")
        try {
            const sourcePath = `${process.cwd()}/build/`
            const destPath = `${pwd}/androidProject/app/src/main/assets/build/`

            ctx.runCommand(`mkdir -p ${destPath}`)
            ctx.runCommand(`rm -rf ${destPath}/*`)

            const excludePatterns = ["route-manifest.json.gz", "route-manifest.json.br"]

            if (buildOptimisation) {
                progress.log("Running with build optimization...", "info")
                const excludeParams = excludePatterns.map((pattern) => `--exclude="${pattern}"`).join(" ")
                const rsyncCommand = `rsync -av ${excludeParams} ${sourcePath} ${destPath}`
                progress.log("Executing rsync command with exclusions...", "info")
                ctx.runCommand(rsyncCommand)

                for (const pattern of excludePatterns) {
                    const checkCommand = `find ${destPath} -name "${pattern}" | wc -l`
                    const count = parseInt(ctx.runCommand(checkCommand).trim(), 10)
                    if (count > 0) {
                        progress.log(
                            `Warning: Found ${count} instances of excluded file ${pattern}`,
                            "warning"
                        )
                        ctx.runCommand(`find ${destPath} -name "${pattern}" -delete`)
                    }
                }
                progress.log(
                    "Build assets copied with optimization (excluded route-manifest JSON files)",
                    "success"
                )
            } else {
                progress.log("Running without build optimization...", "info")
                const exclusions = excludePatterns.map((pattern) => `-not -name "${pattern}"`).join(" ")
                const copyCommand = `find ${sourcePath} -type f ${exclusions} -exec cp --parents {} ${destPath} \\;`
                progress.log(`Executing copy command with exclusions...`, "info")
                ctx.runCommand(copyCommand)
                progress.log("Build assets copied successfully!", "success")
            }
        } catch (error) {
            throw new Error("Error copying build assets: " + error.message)
        }
    }

    async function copySplashscreenAssets() {
        try {
            const destPath = `${pwd}/androidProject/app/src/main/res`
            const configFile = fs.readFileSync(configPath, "utf8")
            const config = JSON.parse(configFile)
            const { WEBVIEW_CONFIG = {} } = config

            if (!WEBVIEW_CONFIG.splashScreen) return

            const androidPublicPath = `${process.cwd()}/public/android`
            const imageFormats = ["png", "jpg", "jpeg", "gif", "bmp", "webp"]

            if (fs.existsSync(androidPublicPath)) {
                const drawableDir = `${destPath}/drawable`
                if (!fs.existsSync(drawableDir)) {
                    fs.mkdirSync(drawableDir, { recursive: true })
                }

                for (const format of imageFormats) {
                    const existingPath = `${destPath}/drawable/splashscreen.${format}`
                    if (fs.existsSync(existingPath)) {
                        fs.unlinkSync(existingPath)
                    }
                }

                for (const format of imageFormats) {
                    const sourcePath = `${androidPublicPath}/splashscreen.${format}`
                    if (fs.existsSync(sourcePath)) {
                        fs.copyFileSync(sourcePath, `${destPath}/drawable/splashscreen.${format}`)
                        break
                    }
                }
            }

            const backgroundColor = WEBVIEW_CONFIG.splashScreen.backgroundColor || "#ffffff"
            const themeFiles = [`${destPath}/values/themes.xml`, `${destPath}/values-night/themes.xml`]

            for (const themesFile of themeFiles) {
                try {
                    let content = fs.readFileSync(themesFile, "utf8")

                    content = content.replace(
                        /<item name="android:windowBackground">.*?<\/item>/,
                        `<item name="android:windowBackground">${backgroundColor}</item>`
                    )

                    content = content.replace(
                        /<item name="android:windowSplashScreenBackground" tools:targetApi="31">.*?<\/item>/,
                        `<item name="android:windowSplashScreenBackground" tools:targetApi="31">${backgroundColor}</item>`
                    )

                    fs.writeFileSync(themesFile, content)
                } catch (e) {
                    if (e.code !== "ENOENT") throw e
                }
            }
        } catch (error) {
            progress.log(`Error processing splash screen: ${error.message}`, "warning")
        }
    }

    async function copyOfflinePage() {
        try {
            const sourcePath = `${process.cwd()}/public/offline.html`
            const destDir = `${pwd}/androidProject/app/src/main/assets/offline`
            const destPath = `${destDir}/offline.html`

            if (!fs.existsSync(sourcePath)) {
                progress.log("offline.html not found in public/; skipping offline asset copy", "warning")
                return
            }

            ctx.runCommand(`mkdir -p ${destDir}`)
            fs.copyFileSync(sourcePath, destPath)
            progress.log("offline.html copied to Android assets", "success")
        } catch (error) {
            progress.log(`Warning: Error copying offline.html: ${error.message}`, "warning")
        }
    }

    async function copyIconAssets() {
        try {
            const destPath = `${pwd}/androidProject/app/src/main/res`
            const manifestPath = `${pwd}/androidProject/app/src/main/AndroidManifest.xml`
            const androidIconDir = path.join(publicPath, "android", "appIcons") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - publicPath is process.cwd()/public, a trusted internal path.
            const fallbackIconPath = path.join(__dirname, "../assets", "catalyst.png") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - __dirname is a fixed module path, not user input.
            const fallbackExists = fs.existsSync(fallbackIconPath)
            const extensions = ["png", "jpg", "jpeg"]

            if (!fs.existsSync(publicPath)) {
                progress.log(`Warning: Public directory not found at ${publicPath}`, "warning")
                return
            }

            const densities = [
                { key: "mdpi", dir: "mipmap-mdpi" },
                { key: "hdpi", dir: "mipmap-hdpi" },
                { key: "xhdpi", dir: "mipmap-xhdpi" },
                { key: "xxhdpi", dir: "mipmap-xxhdpi" },
                { key: "xxxhdpi", dir: "mipmap-xxxhdpi" },
            ]

            const hasIconDirectory =
                fs.existsSync(androidIconDir) && fs.lstatSync(androidIconDir).isDirectory()

            const cleanDensityDir = (dir) => {
                if (!fs.existsSync(dir)) return
                for (const file of fs.readdirSync(dir)) {
                    if (file.startsWith("icon.")) {
                        fs.unlinkSync(path.join(dir, file)) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - dir is derived from pwd/destPath (internal), file comes from fs.readdirSync on that same dir.
                    }
                }
            }

            const findIconForDensity = (densityKey) => {
                if (!hasIconDirectory) return null
                for (const ext of extensions) {
                    const candidate = path.join(androidIconDir, `icon-${densityKey}.${ext}`) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - androidIconDir is derived from publicPath (internal); densityKey and ext are fixed internal strings.
                    if (fs.existsSync(candidate)) return { path: candidate, ext }
                }
                return null
            }

            let hasCustomIcons = false
            let usedFallback = false

            for (const density of densities) {
                const targetDir = path.join(destPath, density.dir) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - destPath is derived from pwd (internal); density.dir is a fixed string from the densities array.
                const source = findIconForDensity(density.key)

                cleanDensityDir(targetDir)

                if (source) {
                    fs.mkdirSync(targetDir, { recursive: true })
                    const destination = path.join(targetDir, `icon.${source.ext}`) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - targetDir is derived from pwd (internal); source.ext is from a fixed extensions array.
                    fs.copyFileSync(source.path, destination)
                    hasCustomIcons = true
                }
            }

            if (!hasCustomIcons && fallbackExists) {
                const targetDir = path.join(destPath, "mipmap-xxxhdpi") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - destPath is derived from pwd (internal); "mipmap-xxxhdpi" is a fixed literal.
                fs.mkdirSync(targetDir, { recursive: true })
                cleanDensityDir(targetDir)
                const destination = path.join(targetDir, "icon.png") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - targetDir is derived from pwd (internal); "icon.png" is a fixed literal.
                fs.copyFileSync(fallbackIconPath, destination)
                usedFallback = true
            }

            const setManifestIcons = (iconValue, roundIconValue) => {
                let current
                try {
                    current = fs.readFileSync(manifestPath, "utf8")
                } catch (e) {
                    if (e.code === "ENOENT") return
                    throw e
                }
                const updated = current
                    .replace(/android:icon="[^"]*"/g, `android:icon="${iconValue}"`)
                    .replace(/android:roundIcon="[^"]*"/g, `android:roundIcon="${roundIconValue}"`)
                if (updated !== current) fs.writeFileSync(manifestPath, updated)
            }

            if (!hasCustomIcons && !usedFallback) {
                progress.log("No custom Android icons found; using default template icons.", "info")
                setManifestIcons("@mipmap/ic_launcher", "@mipmap/ic_launcher_round")
                return
            }

            setManifestIcons("@mipmap/icon", "@mipmap/icon")

            if (hasCustomIcons) {
                progress.log("Applied Android launcher icons from public/android/appIcons.", "success")
            }
            if (usedFallback) {
                progress.log("Used bundled Catalyst fallback icon for launcher.", "info")
            }
        } catch (error) {
            progress.log(`Warning: Error copying app icon assets: ${error.message}`, "warning")
        }
    }

    async function configureAppName(androidConfig) {
        try {
            const destPath = `${pwd}/androidProject/app/src/main/res`
            const stringsFile = `${destPath}/values/strings.xml`

            let stringsContent = fs.readFileSync(stringsFile, "utf8")

            if (androidConfig.appName) {
                stringsContent = stringsContent.replace(
                    /<string name="app_name">.*?<\/string>/,
                    `<string name="app_name">${androidConfig.appName}</string>`
                )
                fs.writeFileSync(stringsFile, stringsContent)
                progress.log(`App display name configured: ${androidConfig.appName}`, "success")
            } else {
                stringsContent = stringsContent.replace(
                    /<string name="app_name">.*?<\/string>/,
                    `<string name="app_name">Catalyst Application</string>`
                )
                fs.writeFileSync(stringsFile, stringsContent)
                progress.log("App display name reverted to default: Catalyst Application", "info")
            }
        } catch (error) {
            progress.log(`Warning: Error configuring app name: ${error.message}`, "warning")
        }
    }

    // ── Notification helpers ──────────────────────────────────────────────────

    async function handleGoogleServicesJson() {
        try {
            const rootGoogleServicesPath = `${process.cwd()}/google-services.json`
            const androidGoogleServicesPath = `${pwd}/androidProject/app/google-services.json`

            if (fs.existsSync(rootGoogleServicesPath)) {
                progress.log("Found google-services.json in root directory", "info")
                const appDir = `${pwd}/androidProject/app`
                if (!fs.existsSync(appDir)) {
                    fs.mkdirSync(appDir, { recursive: true })
                }
                fs.copyFileSync(rootGoogleServicesPath, androidGoogleServicesPath)
                progress.log("Copied google-services.json to androidProject/app/", "success")
                return true
            } else if (fs.existsSync(androidGoogleServicesPath)) {
                progress.log("google-services.json already exists in androidProject/app/", "info")
                return true
            } else {
                progress.log(
                    "google-services.json not found - Firebase push notifications will not work",
                    "warning"
                )
                progress.log(
                    "Place google-services.json in project root or src/native/androidProject/app/",
                    "info"
                )
                return false
            }
        } catch (error) {
            progress.log(`Warning: Error handling google-services.json: ${error.message}`, "warning")
            return false
        }
    }

    async function processNotifications(WEBVIEW_CONFIG) {
        const hasNotificationConfig = !!WEBVIEW_CONFIG.notifications?.enabled

        try {
            await cleanupNotificationPermissions()
            await cleanupNotificationResources()
            await cleanupNotificationMetadata()
            await cleanupNotificationAssets()

            if (!hasNotificationConfig) {
                progress.log("Notifications disabled - cleaned up notification configurations", "info")
                return
            }

            const hasGoogleServices = await handleGoogleServicesJson()
            if (!hasGoogleServices) {
                progress.log("Continuing without Firebase - only local notifications will work", "warning")
            }

            await addNotificationPermissions()
            await generateNotificationResources(WEBVIEW_CONFIG.notifications)
            await addNotificationMetadata()
            await processNotificationAssets()
            progress.log("Notification configuration completed successfully!", "success")
        } catch (error) {
            progress.log(`Warning: Error processing notifications: ${error.message}`, "warning")
        }
    }

    async function addNotificationPermissions() {
        try {
            const manifestPath = `${pwd}/androidProject/app/src/main/AndroidManifest.xml`
            let manifestContent = fs.readFileSync(manifestPath, "utf8")

            const permissionsXml = `    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />`

            manifestContent = manifestContent.replace(
                /(<uses-permission[^>]*>[\s\S]*?)(\s*<uses-feature)/,
                `$1\n${permissionsXml}$2`
            )

            fs.writeFileSync(manifestPath, manifestContent)
            progress.log("Added notification permissions to AndroidManifest.xml", "success")
        } catch (error) {
            throw new Error(`Failed to add notification permissions: ${error.message}`)
        }
    }

    async function generateNotificationResources(notificationConfig) {
        try {
            const colorsPath = `${pwd}/androidProject/app/src/main/res/values/colors.xml`
            let colorsContent = fs.readFileSync(colorsPath, "utf8")

            const notificationColorXml = `    <color name="notification_color">${notificationConfig.color || "#007AFF"}</color>`

            if (!colorsContent.includes('name="notification_color"')) {
                colorsContent = colorsContent.replace(/(<\/resources>)/, `${notificationColorXml}\n$1`)
                fs.writeFileSync(colorsPath, colorsContent)
                progress.log("Added notification color to colors.xml", "success")
            }
        } catch (error) {
            throw new Error(`Failed to generate notification resources: ${error.message}`)
        }
    }

    async function addNotificationMetadata() {
        try {
            const manifestPath = `${pwd}/androidProject/app/src/main/AndroidManifest.xml`
            let manifestContent = fs.readFileSync(manifestPath, "utf8")

            const metadataXml = `
        <!-- Default notification configuration -->
        <meta-data
            android:name="default_notification_channel_id"
            android:value="default_notifications" />
        <meta-data
            android:name="default_notification_icon"
            android:resource="@drawable/ic_notification" />
        <meta-data
            android:name="default_notification_color"
            android:resource="@color/notification_color" />

        <!-- Firebase default notification configuration -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_channel_id"
            android:value="default" />
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@drawable/ic_notification" />
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_sound"
            android:resource="@raw/notification_sound_default" />

        <!-- Push Notification Service -->
        <service
            android:name="io.yourname.androidproject.utils.PushNotificationUtils"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>`

            manifestContent = manifestContent.replace(/(\s*<\/application>)/, `${metadataXml}\n$1`)
            fs.writeFileSync(manifestPath, manifestContent)
            progress.log(
                "Added notification metadata and push notification service to AndroidManifest.xml",
                "success"
            )
        } catch (error) {
            throw new Error(`Failed to add notification metadata: ${error.message}`)
        }
    }

    async function processNotificationAssets() {
        try {
            const destPath = `${pwd}/androidProject/app/src/main/res`
            const imageFormats = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"]
            const audioFormats = ["mp3", "wav", "ogg"]

            let assetsProcessed = 0

            const notificationIcons = [
                { sourceName: "notification-icon", resourceName: "ic_notification" },
                { sourceName: "notification-large", resourceName: "ic_notification_large" },
            ]

            const notificationSounds = [
                { sourceName: "notification-sound-default", resourceName: "notification_sound_default" },
                { sourceName: "notification-sound-urgent", resourceName: "notification_sound_urgent" },
            ]

            for (const icon of notificationIcons) {
                for (const format of imageFormats) {
                    const existingIconPath = `${destPath}/drawable/${icon.resourceName}.${format}`
                    if (fs.existsSync(existingIconPath)) {
                        fs.unlinkSync(existingIconPath)
                        progress.log(`Removed existing ${icon.resourceName}.${format}`, "info")
                    }
                }
            }

            for (const sound of notificationSounds) {
                for (const format of audioFormats) {
                    const existingSoundPath = `${destPath}/raw/${sound.resourceName}.${format}`
                    if (fs.existsSync(existingSoundPath)) {
                        fs.unlinkSync(existingSoundPath)
                        progress.log(`Removed existing ${sound.resourceName}.${format}`, "info")
                    }
                }
            }

            let iconFound = false
            for (const icon of notificationIcons) {
                for (const format of imageFormats) {
                    const iconImagePath = `${publicPath}/${icon.sourceName}.${format}`
                    if (fs.existsSync(iconImagePath)) {
                        const destImagePath = `${destPath}/drawable/${icon.resourceName}.${format}`
                        fs.copyFileSync(iconImagePath, destImagePath)
                        progress.log(
                            `Notification icon copied: ${icon.sourceName}.${format} -> ${icon.resourceName}.${format}`,
                            "success"
                        )
                        assetsProcessed++
                        if (icon.sourceName === "notification-icon") {
                            iconFound = true
                        }
                        break
                    }
                }
            }

            if (!iconFound) {
                generateNotificationIconDrawable("ic_notification", destPath)
                progress.log("Generated default notification icon", "info")
            }

            const rawDir = `${destPath}/raw`
            if (!fs.existsSync(rawDir)) {
                fs.mkdirSync(rawDir, { recursive: true })
            }

            for (const sound of notificationSounds) {
                for (const format of audioFormats) {
                    const soundImagePath = `${publicPath}/${sound.sourceName}.${format}`
                    if (fs.existsSync(soundImagePath)) {
                        const destSoundPath = `${destPath}/raw/${sound.resourceName}.${format}`
                        fs.copyFileSync(soundImagePath, destSoundPath)
                        progress.log(
                            `Notification sound copied: ${sound.sourceName}.${format} -> ${sound.resourceName}.${format}`,
                            "success"
                        )
                        assetsProcessed++
                        break
                    }
                }
            }

            if (assetsProcessed > 0) {
                progress.log(`Processed ${assetsProcessed} notification assets from public/`, "success")
            } else {
                progress.log("No notification assets found in public/ - using defaults", "info")
            }
        } catch (error) {
            throw new Error(`Failed to process notification assets: ${error.message}`)
        }
    }

    function generateNotificationIconDrawable(iconName, destPath) {
        const iconXml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="?attr/colorOnPrimary">
  <path
      android:fillColor="@android:color/white"
      android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.9,2 2,2zM18,16v-5c0,-3.07 -1.64,-5.64 -4.5,-6.32V4c0,-0.83 -0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.63,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z"/>
</vector>`

        fs.writeFileSync(`${destPath}/drawable/${iconName}.xml`, iconXml)
    }

    async function cleanupNotificationPermissions() {
        try {
            const manifestPath = `${pwd}/androidProject/app/src/main/AndroidManifest.xml`
            let manifestContent = fs.readFileSync(manifestPath, "utf8")

            const notificationPermissions = [
                "android.permission.POST_NOTIFICATIONS",
                "android.permission.VIBRATE",
                "android.permission.WAKE_LOCK",
                "android.permission.RECEIVE_BOOT_COMPLETED",
            ]

            manifestContent = manifestContent
                .split("\n")
                .filter((line) => {
                    return !notificationPermissions.some((permission) =>
                        line.includes(`<uses-permission android:name="${permission}"`)
                    )
                })
                .join("\n")

            fs.writeFileSync(manifestPath, manifestContent)
        } catch (error) {
            progress.log(`Warning: Error cleaning notification permissions: ${error.message}`, "warning")
        }
    }

    async function cleanupNotificationResources() {
        try {
            const colorsPath = `${pwd}/androidProject/app/src/main/res/values/colors.xml`
            let colorsContent = fs.readFileSync(colorsPath, "utf8")

            const existingColorLine = colorsContent
                .split("\n")
                .find((line) => line.includes('name="notification_color"'))

            if (existingColorLine) {
                colorsContent = colorsContent.replace(existingColorLine, "")
                fs.writeFileSync(colorsPath, colorsContent)
            }
        } catch (error) {
            progress.log(`Warning: Error cleaning notification resources: ${error.message}`, "warning")
        }
    }

    async function cleanupNotificationMetadata() {
        try {
            const manifestPath = `${pwd}/androidProject/app/src/main/AndroidManifest.xml`
            let manifestContent = fs.readFileSync(manifestPath, "utf8")

            const metadataNames = [
                "default_notification_channel_id",
                "default_notification_icon",
                "default_notification_color",
                "com.google.firebase.messaging.default_notification_channel_id",
                "com.google.firebase.messaging.default_notification_icon",
                "com.google.firebase.messaging.default_notification_sound",
            ]

            manifestContent = manifestContent
                .split("\n")
                .filter((line) => {
                    return !metadataNames.some((metadataName) =>
                        line.includes(`android:name="${metadataName}"`)
                    )
                })
                .join("\n")

            const serviceRegex =
                /\s*<!--\s*Push Notification Service\s*-->\s*<service[^>]*android:name="[^"]*PushNotificationUtils"[\s\S]*?<\/service>/gi
            manifestContent = manifestContent.replace(serviceRegex, "")

            manifestContent = manifestContent.replace(
                /\s*<!--\s*Default notification configuration\s*-->/gi,
                ""
            )
            manifestContent = manifestContent.replace(
                /\s*<!--\s*Firebase default notification configuration\s*-->/gi,
                ""
            )
            manifestContent = manifestContent.replace(/\s*<!--\s*Push Notification Service\s*-->/gi, "")

            fs.writeFileSync(manifestPath, manifestContent)
        } catch (error) {
            progress.log(`Warning: Error cleaning notification metadata: ${error.message}`, "warning")
        }
    }

    async function cleanupNotificationAssets() {
        try {
            const destPath = `${pwd}/androidProject/app/src/main/res`
            const imageFormats = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "xml"]
            const audioFormats = ["mp3", "wav", "ogg"]

            const notificationIcons = ["ic_notification", "ic_notification_large"]
            const notificationSounds = ["notification_sound_default", "notification_sound_urgent"]

            for (const icon of notificationIcons) {
                for (const format of imageFormats) {
                    const iconPath = `${destPath}/drawable/${icon}.${format}`
                    if (fs.existsSync(iconPath)) {
                        fs.unlinkSync(iconPath)
                    }
                }
            }

            const rawDir = `${destPath}/raw`
            if (fs.existsSync(rawDir)) {
                for (const sound of notificationSounds) {
                    for (const format of audioFormats) {
                        const soundPath = `${rawDir}/${sound}.${format}`
                        if (fs.existsSync(soundPath)) {
                            fs.unlinkSync(soundPath)
                        }
                    }
                }
            }
        } catch (error) {
            progress.log(`Warning: Error cleaning notification assets: ${error.message}`, "warning")
        }
    }

    return {
        copyBuildAssets,
        copySplashscreenAssets,
        copyOfflinePage,
        copyIconAssets,
        configureAppName,
        processNotifications,
    }
}

module.exports = createAssetsPhase
