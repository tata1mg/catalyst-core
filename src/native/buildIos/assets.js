"use strict"

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const GOOGLE_SERVICES_FILENAME = "GoogleService-Info.plist"
const NOTIFICATION_ICONS = [
    { sourceName: "notification-icon", resourceName: "NotificationIcon" },
    { sourceName: "notification-large", resourceName: "NotificationLargeIcon" },
]
const NOTIFICATION_SOUNDS = [
    { sourceName: "notification-sound-default", resourceName: "notification_sound_default" },
    { sourceName: "notification-sound-urgent", resourceName: "notification_sound_urgent" },
]

function generateProjectObjectId(identifier, suffix = "") {
    return crypto.createHash("md5").update(`${identifier}:${suffix}`).digest("hex").substring(0, 24).toUpperCase()
}

module.exports = function createAssetsPhase(ctx) {
    const { WEBVIEW_CONFIG, PROJECT_DIR, PROJECT_NAME, PUBLIC_PATH, progress, getXcodeProjectFilePath } = ctx

    // ─── Google Services ─────────────────────────────────────────────────────

    async function addGoogleServicesPlistToXcodeProject() {
        try {
            const projectFilePath = getXcodeProjectFilePath()
            let projectContent
            try { projectContent = fs.readFileSync(projectFilePath, "utf8") } catch { progress.log("Xcode project file not found while adding GoogleService-Info.plist", "warning"); return }
            if (projectContent.includes(`/* ${GOOGLE_SERVICES_FILENAME} */`)) { progress.log("GoogleService-Info.plist already registered in Xcode project", "info"); return }
            const fileRefId = generateProjectObjectId(GOOGLE_SERVICES_FILENAME, "_ref")
            const buildFileId = generateProjectObjectId(GOOGLE_SERVICES_FILENAME, "_build")
            const fileRefEntry = `\t\t${fileRefId} /* ${GOOGLE_SERVICES_FILENAME} */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = ${GOOGLE_SERVICES_FILENAME}; sourceTree = "<group>"; };`
            projectContent = projectContent.replace(/(\/\* End PBXFileReference section \*\/)/, `${fileRefEntry}\n$1`)
            const buildFileEntry = `\t\t${buildFileId} /* ${GOOGLE_SERVICES_FILENAME} in Resources */ = {isa = PBXBuildFile; fileRef = ${fileRefId} /* ${GOOGLE_SERVICES_FILENAME} */; };`
            projectContent = projectContent.replace(/(\/\* End PBXBuildFile section \*\/)/, `${buildFileEntry}\n$1`)
            const groupPattern = /(\/\* iosnativeWebView \*\/ = \{[^}]*children = \([^)]*)/
            if (groupPattern.test(projectContent)) projectContent = projectContent.replace(groupPattern, `$1\n\t\t\t\t${fileRefId} /* ${GOOGLE_SERVICES_FILENAME} */,`)
            const resourcesPattern = /(\/\* Resources \*\/ = \{[^}]*files = \([^)]*)/
            if (resourcesPattern.test(projectContent)) projectContent = projectContent.replace(resourcesPattern, `$1\n\t\t\t\t${buildFileId} /* ${GOOGLE_SERVICES_FILENAME} in Resources */,`)
            fs.writeFileSync(projectFilePath, projectContent, "utf8")
            progress.log("Registered GoogleService-Info.plist with Xcode project", "success")
        } catch (error) {
            progress.log(`Warning: Failed to register GoogleService-Info.plist in Xcode project: ${error.message}`, "warning")
        }
    }

    async function removeGoogleServicesPlistFromXcodeProject() {
        try {
            const projectFilePath = getXcodeProjectFilePath()
            let projectContent
            try { projectContent = fs.readFileSync(projectFilePath, "utf8") } catch { return }
            const regexes = [
                new RegExp(`\\t\\t[A-F0-9]+ \\/\\* ${GOOGLE_SERVICES_FILENAME} \\*\\/ = \\{isa = PBXFileReference;[^}]*\\};\\n`, "g"),
                new RegExp(`\\t\\t[A-F0-9]+ \\/\\* ${GOOGLE_SERVICES_FILENAME} in Resources \\*\\/ = \\{isa = PBXBuildFile;[^}]*\\};\\n`, "g"),
                new RegExp(`\\t\\t\\t\\t[A-F0-9]+ \\/\\* ${GOOGLE_SERVICES_FILENAME} \\*\\/,\\n`, "g"),
                new RegExp(`\\t\\t\\t\\t[A-F0-9]+ \\/\\* ${GOOGLE_SERVICES_FILENAME} in Resources \\*\\/,\\n`, "g"),
            ]
            let modified = false
            for (const regex of regexes) {
                if (regex.test(projectContent)) { projectContent = projectContent.replace(regex, ""); modified = true }
            }
            if (modified) { fs.writeFileSync(projectFilePath, projectContent, "utf8"); progress.log("Removed GoogleService-Info.plist references from Xcode project", "info") }
        } catch (error) {
            progress.log(`Warning: Failed to clean GoogleService-Info.plist from Xcode project: ${error.message}`, "warning")
        }
    }

    async function handleGoogleServicesPlist() {
        try {
            const rootPath = `${process.cwd()}/GoogleService-Info.plist`
            const iosPath = `${PROJECT_DIR}/${PROJECT_NAME}/GoogleService-Info.plist`
            if (fs.existsSync(rootPath)) {
                progress.log("Found GoogleService-Info.plist in root directory", "info")
                const targetDir = path.dirname(iosPath)
                if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })
                fs.copyFileSync(rootPath, iosPath)
                progress.log("Copied GoogleService-Info.plist to iOS project", "success")
                await addGoogleServicesPlistToXcodeProject()
                return true
            } else if (fs.existsSync(iosPath)) {
                progress.log("GoogleService-Info.plist already exists in iOS project", "info")
                await addGoogleServicesPlistToXcodeProject()
                return true
            } else {
                await removeGoogleServicesPlistFromXcodeProject()
                progress.log("GoogleService-Info.plist not found - Firebase push notifications will not work", "warning")
                progress.log("Place GoogleService-Info.plist in project root", "info")
                return false
            }
        } catch (error) {
            const rootPath = `${process.cwd()}/GoogleService-Info.plist`
            if (error.code === "EACCES" && fs.existsSync(rootPath)) throw new Error(`Permission denied copying GoogleService-Info.plist: ${error.message}`)
            await removeGoogleServicesPlistFromXcodeProject()
            progress.log(`Warning: Error handling GoogleService-Info.plist: ${error.message}`, "warning")
            return false
        }
    }

    // ─── Notification assets ─────────────────────────────────────────────────

    async function validateNotificationAsset(filePath, assetType) {
        const stats = fs.statSync(filePath)
        const fileSizeKB = stats.size / 1024
        if (assetType === "icon" && fileSizeKB > 100) progress.log(`Warning: Notification icon ${path.basename(filePath)} is ${fileSizeKB.toFixed(1)}KB (recommended <100KB for optimal performance)`, "warning")
        else if (assetType === "sound" && fileSizeKB > 1024) progress.log(`Warning: Notification sound ${path.basename(filePath)} is ${fileSizeKB.toFixed(1)}KB (recommended <1MB)`, "warning")
    }

    async function processNotificationIcons() {
        try {
            const assetsPath = `${PROJECT_DIR}/${PROJECT_NAME}/Assets.xcassets`
            const imageFormats = ["png", "jpg", "jpeg", "webp"]
            let iconsProcessed = 0
            if (!fs.existsSync(PUBLIC_PATH)) { progress.log(`Public directory not found at ${PUBLIC_PATH}`, "info"); return 0 }
            if (!fs.existsSync(assetsPath)) fs.mkdirSync(assetsPath, { recursive: true })
            for (const icon of NOTIFICATION_ICONS) {
                const imagesetPath = `${assetsPath}/${icon.resourceName}.imageset`
                if (fs.existsSync(imagesetPath)) { fs.rmSync(imagesetPath, { recursive: true, force: true }); progress.log(`Removed existing ${icon.resourceName}.imageset`, "info") }
            }
            for (const icon of NOTIFICATION_ICONS) {
                for (const format of imageFormats) {
                    const iconImagePath = `${PUBLIC_PATH}/${icon.sourceName}.${format}`
                    if (fs.existsSync(iconImagePath)) {
                        validateNotificationAsset(iconImagePath, "icon")
                        const imagesetPath = `${assetsPath}/${icon.resourceName}.imageset`
                        if (!fs.existsSync(imagesetPath)) fs.mkdirSync(imagesetPath, { recursive: true })
                        fs.copyFileSync(iconImagePath, `${imagesetPath}/${icon.sourceName}.${format}`)
                        const contentsJson = { images: [{ filename: `${icon.sourceName}.${format}`, idiom: "universal", scale: "1x" }, { idiom: "universal", scale: "2x" }, { idiom: "universal", scale: "3x" }], info: { author: "xcode", version: 1 } }
                        fs.writeFileSync(`${imagesetPath}/Contents.json`, JSON.stringify(contentsJson, null, 2))
                        progress.log(`Notification icon copied: ${icon.sourceName}.${format} -> ${icon.resourceName}`, "success")
                        iconsProcessed++
                        break
                    }
                }
            }
            if (iconsProcessed > 0) progress.log(`Processed ${iconsProcessed} notification icon(s) from public/`, "success")
            else progress.log("No notification icons found in public/ - using default bell icon", "info")
            return iconsProcessed
        } catch (error) {
            if (error.code === "EACCES") throw new Error(`Permission denied accessing notification icons: ${error.message}. Check directory permissions.`)
            if (error.code === "ENOSPC") throw new Error(`Insufficient disk space to process notification icons: ${error.message}`)
            progress.log(`Warning: Could not process notification icons: ${error.message}`, "warning")
            return 0
        }
    }

    async function processNotificationSounds() {
        try {
            const bundlePath = `${PROJECT_DIR}/${PROJECT_NAME}`
            const audioFormats = ["mp3", "wav", "m4a", "caf"]
            let soundsProcessed = 0
            if (!fs.existsSync(PUBLIC_PATH)) { progress.log(`Public directory not found at ${PUBLIC_PATH}`, "info"); return 0 }
            for (const sound of NOTIFICATION_SOUNDS) {
                for (const format of audioFormats) {
                    const existingSoundPath = `${bundlePath}/${sound.resourceName}.${format}`
                    if (fs.existsSync(existingSoundPath)) { fs.unlinkSync(existingSoundPath); progress.log(`Removed existing ${sound.resourceName}.${format}`, "info") }
                }
            }
            for (const sound of NOTIFICATION_SOUNDS) {
                for (const format of audioFormats) {
                    const soundPath = `${PUBLIC_PATH}/${sound.sourceName}.${format}`
                    if (fs.existsSync(soundPath)) {
                        validateNotificationAsset(soundPath, "sound")
                        fs.copyFileSync(soundPath, `${bundlePath}/${sound.resourceName}.${format}`)
                        progress.log(`Notification sound copied: ${sound.sourceName}.${format} -> ${sound.resourceName}.${format}`, "success")
                        soundsProcessed++
                        break
                    }
                }
            }
            if (soundsProcessed > 0) progress.log(`Processed ${soundsProcessed} notification sound(s) from public/`, "success")
            else progress.log("No notification sounds found in public/ - using system default sounds", "info")
            return soundsProcessed
        } catch (error) {
            if (error.code === "EACCES") throw new Error(`Permission denied accessing notification sounds: ${error.message}. Check directory permissions.`)
            if (error.code === "ENOSPC") throw new Error(`Insufficient disk space to process notification sounds: ${error.message}`)
            progress.log(`Warning: Could not process notification sounds: ${error.message}`, "warning")
            return 0
        }
    }

    async function removeSoundFilesFromXcodeProject() {
        try {
            const projectFilePath = path.join(PROJECT_DIR, `${PROJECT_NAME}.xcodeproj`, "project.pbxproj") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            let projectContent
            try { projectContent = fs.readFileSync(projectFilePath, "utf8") } catch { return }
            let modified = false
            for (const sound of NOTIFICATION_SOUNDS) {
                const p = sound.resourceName
                const regexes = [
                    new RegExp(`\\t\\t[A-F0-9]+ \\/\\* ${p}\\.[a-z0-9]+ \\*\\/ = \\{isa = PBXFileReference;[^}]*\\};\\n`, "g"),
                    new RegExp(`\\t\\t[A-F0-9]+ \\/\\* ${p}\\.[a-z0-9]+ in Resources \\*\\/ = \\{isa = PBXBuildFile;[^}]*\\};\\n`, "g"),
                    new RegExp(`\\t\\t\\t\\t[A-F0-9]+ \\/\\* ${p}\\.[a-z0-9]+ \\*\\/,\\n`, "g"),
                    new RegExp(`\\t\\t\\t\\t[A-F0-9]+ \\/\\* ${p}\\.[a-z0-9]+ in Resources \\*\\/,\\n`, "g"),
                ]
                for (const regex of regexes) {
                    if (regex.test(projectContent)) { projectContent = projectContent.replace(regex, ""); modified = true }
                }
            }
            if (modified) { fs.writeFileSync(projectFilePath, projectContent, "utf8"); progress.log("Removed notification sounds from Xcode project", "success") }
        } catch (error) {
            progress.log(`Warning: Could not remove sound files from Xcode project: ${error.message}`, "warning")
        }
    }

    async function addSoundFilesToXcodeProject() {
        try {
            const projectFilePath = path.join(PROJECT_DIR, `${PROJECT_NAME}.xcodeproj`, "project.pbxproj") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            const bundlePath = `${PROJECT_DIR}/${PROJECT_NAME}`
            const audioFormats = ["mp3", "wav", "m4a", "caf"]
            const soundFiles = []
            for (const sound of NOTIFICATION_SOUNDS) {
                for (const format of audioFormats) {
                    const soundPath = `${bundlePath}/${sound.resourceName}.${format}`
                    if (fs.existsSync(soundPath)) { soundFiles.push({ filename: `${sound.resourceName}.${format}`, resourceName: sound.resourceName, format }); break }
                }
            }
            if (soundFiles.length === 0) { progress.log("No sound files to add to Xcode project", "info"); return }
            let projectContent
            try { projectContent = fs.readFileSync(projectFilePath, "utf8") } catch { throw new Error(`Xcode project file not found at: ${projectFilePath}`) }
            for (const soundFile of soundFiles) {
                const fileRefId = generateProjectObjectId(soundFile.filename, "_ref")
                const buildFileId = generateProjectObjectId(soundFile.filename, "_build")
                if (projectContent.includes(`/* ${soundFile.filename} */`)) { progress.log(`Sound ${soundFile.filename} already in Xcode project`, "info"); continue }
                progress.log(`Adding ${soundFile.filename} to Xcode project`, "info")
                const fileRefEntry = `\t\t${fileRefId} /* ${soundFile.filename} */ = {isa = PBXFileReference; lastKnownFileType = audio.${soundFile.format === "mp3" ? "mp3" : "wav"}; path = ${soundFile.filename}; sourceTree = "<group>"; };`
                projectContent = projectContent.replace(/(\/\* End PBXFileReference section \*\/)/, `${fileRefEntry}\n$1`)
                const buildFileEntry = `\t\t${buildFileId} /* ${soundFile.filename} in Resources */ = {isa = PBXBuildFile; fileRef = ${fileRefId} /* ${soundFile.filename} */; };`
                projectContent = projectContent.replace(/(\/\* End PBXBuildFile section \*\/)/, `${buildFileEntry}\n$1`)
                const groupPattern = /(\/\* iosnativeWebView \*\/ = \{[^}]*children = \([^)]*)/
                if (groupPattern.test(projectContent)) projectContent = projectContent.replace(groupPattern, `$1\n\t\t\t\t${fileRefId} /* ${soundFile.filename} */,`)
                const resourcesPattern = /(\/\* Resources \*\/ = \{[^}]*files = \([^)]*)/
                if (resourcesPattern.test(projectContent)) projectContent = projectContent.replace(resourcesPattern, `$1\n\t\t\t\t${buildFileId} /* ${soundFile.filename} in Resources */,`)
                progress.log(`✅ Added ${soundFile.filename} to Xcode project`, "success")
            }
            fs.writeFileSync(projectFilePath, projectContent, "utf8")
            progress.log(`Registered ${soundFiles.length} sound file(s) in Xcode project`, "success")
        } catch (error) {
            progress.log(`Warning: Could not add sound files to Xcode project: ${error.message}`, "warning")
            throw error
        }
    }

    async function cleanupNotificationAssets(removeFirebaseConfig = false) {
        try {
            const assetsPath = `${PROJECT_DIR}/${PROJECT_NAME}/Assets.xcassets`
            const bundlePath = `${PROJECT_DIR}/${PROJECT_NAME}`
            const audioFormats = ["mp3", "wav", "m4a", "caf"]
            for (const icon of NOTIFICATION_ICONS) {
                const imagesetPath = `${assetsPath}/${icon.resourceName}.imageset`
                if (fs.existsSync(imagesetPath)) { fs.rmSync(imagesetPath, { recursive: true, force: true }); progress.log(`Removed ${icon.resourceName}.imageset`, "info") }
            }
            for (const sound of NOTIFICATION_SOUNDS) {
                for (const format of audioFormats) {
                    const soundPath = `${bundlePath}/${sound.resourceName}.${format}`
                    if (fs.existsSync(soundPath)) { fs.unlinkSync(soundPath); progress.log(`Removed ${sound.resourceName}.${format}`, "info") }
                }
            }
            await removeSoundFilesFromXcodeProject()
            if (removeFirebaseConfig) {
                const iosGoogleServicesPath = `${bundlePath}/${GOOGLE_SERVICES_FILENAME}`
                if (fs.existsSync(iosGoogleServicesPath)) { fs.unlinkSync(iosGoogleServicesPath); progress.log("Removed GoogleService-Info.plist from iOS project directory", "info") }
                await removeGoogleServicesPlistFromXcodeProject()
            }
            progress.log("Cleaned up notification assets", "success")
        } catch (error) {
            progress.log(`Warning: Error cleaning notification assets: ${error.message}`, "warning")
        }
    }

    async function processNotificationAssets(webviewConfig) {
        const hasNotificationConfig = !!webviewConfig.notifications?.enabled
        try {
            await cleanupNotificationAssets(!hasNotificationConfig)
            if (!hasNotificationConfig) { progress.log("Notifications disabled - skipped asset processing", "info"); return }
            const hasGoogleServices = await handleGoogleServicesPlist()
            if (!hasGoogleServices) progress.log("Continuing without Firebase - only local notifications will work", "warning")
            const iconsProcessed = await processNotificationIcons()
            const soundsProcessed = await processNotificationSounds()
            if (soundsProcessed > 0) await addSoundFilesToXcodeProject()
            const totalAssets = iconsProcessed + soundsProcessed
            if (totalAssets > 0) progress.log(`Notification asset processing completed: ${totalAssets} asset(s) processed`, "success")
            else progress.log("No notification assets found - using system defaults", "info")
        } catch (error) {
            progress.log(`Warning: Error processing notifications: ${error.message}`, "warning")
        }
    }

    // ─── Offline page ─────────────────────────────────────────────────────────

    async function addOfflinePageToXcodeProject() {
        try {
            const projectFilePath = getXcodeProjectFilePath()
            const offlineFileName = "offline.html"
            const offlineRelativePath = "offline/offline.html"
            let projectContent
            try { projectContent = fs.readFileSync(projectFilePath, "utf8") } catch { progress.log("Xcode project file not found while adding offline.html", "warning"); return }
            if (projectContent.includes(`/* ${offlineFileName} */`)) { progress.log("offline.html already registered in Xcode project", "info"); return }
            const fileRefId = generateProjectObjectId(offlineFileName, "_ref")
            const buildFileId = generateProjectObjectId(offlineFileName, "_build")
            const fileRefEntry = `\t\t${fileRefId} /* ${offlineFileName} */ = {isa = PBXFileReference; lastKnownFileType = text.html; path = ${offlineRelativePath}; sourceTree = "<group>"; };`
            projectContent = projectContent.replace(/(\/\* End PBXFileReference section \*\/)/, `${fileRefEntry}\n$1`)
            const buildFileEntry = `\t\t${buildFileId} /* ${offlineFileName} in Resources */ = {isa = PBXBuildFile; fileRef = ${fileRefId} /* ${offlineFileName} */; };`
            projectContent = projectContent.replace(/(\/\* End PBXBuildFile section \*\/)/, `${buildFileEntry}\n$1`)
            const groupPattern = /(\/\* iosnativeWebView \*\/ = \{[^}]*children = \([^)]*)/
            if (groupPattern.test(projectContent)) projectContent = projectContent.replace(groupPattern, `$1\n\t\t\t\t${fileRefId} /* ${offlineFileName} */,`)
            const resourcesPattern = /(\/\* Resources \*\/ = \{[^}]*files = \([^)]*)/
            if (resourcesPattern.test(projectContent)) projectContent = projectContent.replace(resourcesPattern, `$1\n\t\t\t\t${buildFileId} /* ${offlineFileName} in Resources */,`)
            fs.writeFileSync(projectFilePath, projectContent, "utf8")
            progress.log("Registered offline.html with Xcode project", "success")
        } catch (error) {
            progress.log(`Warning: Failed to register offline.html in Xcode project: ${error.message}`, "warning")
        }
    }

    async function copyOfflinePage() {
        try {
            const sourcePath = path.join(PUBLIC_PATH, "offline.html") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            const destDir = `${PROJECT_DIR}/${PROJECT_NAME}/offline`
            if (!fs.existsSync(sourcePath)) { progress.log("offline.html not found in public/; skipping offline asset copy", "warning"); return false }
            fs.mkdirSync(destDir, { recursive: true })
            fs.copyFileSync(sourcePath, `${destDir}/offline.html`)
            progress.log("offline.html copied to iOS bundle", "success")
            await addOfflinePageToXcodeProject()
            return true
        } catch (error) {
            progress.log(`Warning: Error copying offline.html: ${error.message}`, "warning")
            return false
        }
    }

    // ─── Splash screen & app icon ─────────────────────────────────────────────

    async function copySplashscreenAssets() {
        try {
            const publicDir = `${process.cwd()}/public/ios`
            const assetsDir = `${PROJECT_DIR}/${PROJECT_NAME}/Assets.xcassets`
            if (!WEBVIEW_CONFIG.splashScreen) { progress.log("No splash screen configuration found, skipping asset copy", "info"); return }
            const imageExtensions = ["png", "jpg", "jpeg"]
            let splashImageFound = false
            for (const ext of imageExtensions) {
                const sourcePath = `${publicDir}/splashscreen.${ext}`
                if (fs.existsSync(sourcePath)) {
                    const imagesetDir = `${assetsDir}/launchscreen.imageset`
                    if (!fs.existsSync(imagesetDir)) fs.mkdirSync(imagesetDir, { recursive: true })
                    fs.copyFileSync(sourcePath, `${imagesetDir}/launchscreen.${ext}`)
                    const contentsJson = { images: [{ filename: `launchscreen.${ext}`, idiom: "universal", scale: "1x" }], info: { author: "xcode", version: 1 } }
                    fs.writeFileSync(`${imagesetDir}/Contents.json`, JSON.stringify(contentsJson, null, 2))
                    progress.log(`Created launch screen imageset: launchscreen.${ext}`, "success")
                    splashImageFound = true
                    break
                }
            }
            if (!splashImageFound) {
                progress.log("No custom splash screen image found in public folder", "info")
                progress.log("Supported formats: splashscreen.png, splashscreen.jpg, splashscreen.jpeg", "info")
            }
        } catch (error) {
            progress.log(`Warning: Error copying splash screen assets: ${error.message}`, "warning")
        }
    }

    async function copyAppIcon() {
        try {
            const publicDir = `${process.cwd()}/public/ios/appIcons`
            const assetsDir = `${PROJECT_DIR}/${PROJECT_NAME}/Assets.xcassets`
            const iconSetDir = `${assetsDir}/AppIcon.appiconset`
            if (!fs.existsSync(publicDir)) { progress.log("Public directory not found, skipping app icon copy", "info"); return }
            const iconSizes = [
                { size: "20x20", idiom: "iphone", scale: "2x" }, { size: "20x20", idiom: "iphone", scale: "3x" },
                { size: "29x29", idiom: "iphone", scale: "2x" }, { size: "29x29", idiom: "iphone", scale: "3x" },
                { size: "40x40", idiom: "iphone", scale: "2x" }, { size: "40x40", idiom: "iphone", scale: "3x" },
                { size: "60x60", idiom: "iphone", scale: "2x" }, { size: "60x60", idiom: "iphone", scale: "3x" },
                { size: "1024x1024", idiom: "ios-marketing", scale: "1x" },
            ]
            const imageExtensions = ["png", "jpg", "jpeg"]
            const findImagesRecursively = (dir, extensions) => {
                let results = []
                try {
                    for (const item of fs.readdirSync(dir)) {
                        const fullPath = `${dir}${path.sep}${item}`
                        const stat = fs.statSync(fullPath)
                        if (stat.isDirectory()) results = results.concat(findImagesRecursively(fullPath, extensions))
                        else if (stat.isFile() && extensions.includes(path.extname(item).toLowerCase().slice(1))) results.push(fullPath)
                    }
                } catch (err) { /* ignore */ }
                return results
            }
            const allImages = findImagesRecursively(publicDir, imageExtensions)
            const foundIcons = []
            if (!fs.existsSync(iconSetDir)) fs.mkdirSync(iconSetDir, { recursive: true })
            const contentsPath = `${iconSetDir}/Contents.json`
            let contents
            try { contents = JSON.parse(fs.readFileSync(contentsPath, "utf8")) } catch { contents = null }
            if (!contents || !Array.isArray(contents.images)) contents = { images: [], info: { author: "xcode", version: 1 } }
            for (const { size, idiom, scale } of iconSizes) {
                const expectedName = `icon-${size}-${scale}`
                let foundImage = null
                for (const ext of imageExtensions) {
                    const matchingImage = allImages.find((imgPath) => path.basename(imgPath, `.${ext}`) === expectedName)
                    if (matchingImage) { foundImage = { path: matchingImage, ext }; break }
                }
                if (foundImage) {
                    const filename = `${expectedName}.${foundImage.ext}`
                    fs.copyFileSync(foundImage.path, `${iconSetDir}/${filename}`)
                    foundIcons.push({ size, scale, filename, idiom })
                    const iconKey = `${size}-${idiom}-${scale}`
                    contents.images = contents.images.filter((img) => `${img.size}-${img.idiom}-${img.scale}` !== iconKey)
                    contents.images.push({ size, idiom, scale, filename })
                }
            }
            if (foundIcons.length > 0) {
                fs.writeFileSync(contentsPath, JSON.stringify(contents, null, 2))
                progress.log(`Updated AppIcon.appiconset with ${foundIcons.length} icon(s):`, "success")
                foundIcons.forEach((icon) => progress.log(`  • ${icon.size} @${icon.scale} (${icon.idiom})`, "info"))
            } else {
                progress.log("No app icon files found in public folder", "info")
                progress.log("Expected naming pattern: icon-{size}-{scale}.{ext}", "info")
                progress.log("Example: icon-20x20-2x.png, icon-60x60-3x.png, icon-1024x1024-1x.png", "info")
            }
        } catch (error) {
            progress.log(`Warning: Error copying app icons: ${error.message}`, "warning")
        }
    }

    return { processNotificationAssets, copyOfflinePage, copySplashscreenAssets, copyAppIcon }
}
