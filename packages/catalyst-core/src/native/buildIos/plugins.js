"use strict"

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { execSync } = require("child_process")

const PLUGIN_RESOURCE_ROOT = "PluginResources"

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function packageRequirementKey(dependency) {
    return `${dependency.requirement.type}:${dependency.requirement.version}`
}

function mergePackageDependency(map, dependency, sourceLabel) {
    const existing = map.get(dependency.url)
    if (!existing) {
        map.set(dependency.url, {
            url: dependency.url,
            package: dependency.package,
            requirement: dependency.requirement,
            products: [...new Set(dependency.products)],
        })
        return
    }
    if (packageRequirementKey(existing) !== packageRequirementKey(dependency)) {
        throw new Error(
            `iOS package dependency conflict for '${dependency.url}' while processing ${sourceLabel}: '${existing.requirement.type}:${existing.requirement.version}' vs '${dependency.requirement.type}:${dependency.requirement.version}'`
        )
    }
    if (existing.package !== dependency.package) {
        throw new Error(
            `iOS package identity conflict for '${dependency.url}' while processing ${sourceLabel}: '${existing.package}' vs '${dependency.package}'`
        )
    }
    existing.products = [...new Set([...existing.products, ...dependency.products])].sort()
}

function formatSwiftPackageRequirement(dependency) {
    if (dependency.requirement.type === "from") return `from: "${dependency.requirement.version}"`
    if (dependency.requirement.type === "exact") return `exact: "${dependency.requirement.version}"`
    throw new Error(`Unsupported iOS package requirement type: ${dependency.requirement.type}`)
}

function formatSwiftPackageEntries(dependencies) {
    return dependencies.map(
        (d) => `        .package(url: "${d.url}", ${formatSwiftPackageRequirement(d)})`
    )
}

function formatSwiftProductEntries(dependencies) {
    return dependencies.flatMap((d) =>
        d.products.map((p) => `                .product(name: "${p}", package: "${d.package}")`)
    )
}

function formatPbxprojPath(value) {
    return /[^A-Za-z0-9_./-]/.test(value) ? `"${value}"` : value
}

function detectPbxprojFileType(filePath) {
    const extension = path.extname(filePath).toLowerCase()
    const fileTypes = {
        ".json": "text.json", ".plist": "text.plist.xml", ".txt": "text", ".html": "text.html",
        ".js": "sourcecode.javascript", ".css": "text.css", ".png": "image.png",
        ".jpg": "image.jpeg", ".jpeg": "image.jpeg", ".gif": "image.gif", ".svg": "image.svg",
        ".mp3": "audio.mp3", ".wav": "audio.wav", ".m4a": "audio.m4a", ".caf": "audio.caf", ".pdf": "image.pdf",
    }
    return fileTypes[extension] || "file"
}

function generateProjectObjectId(identifier, suffix = "") {
    return crypto.createHash("md5").update(`${identifier}:${suffix}`).digest("hex").substring(0, 24).toUpperCase()
}

function replaceRequired(content, pattern, replacement, errorMessage) {
    if (!pattern.test(content)) throw new Error(errorMessage)
    return content.replace(pattern, replacement)
}

// ─── Module factory ───────────────────────────────────────────────────────────

module.exports = function createPluginsPhase(ctx) {
    const { WEBVIEW_CONFIG, PROJECT_DIR, PROJECT_NAME, SCHEME_NAME, isGoogleSignInEnabled, progress, getXcodeProjectFilePath } = ctx

    async function generatePackageSwift(pluginDependencies = []) {
        try {
            const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false
            const baseCoreDependencies = [
                { url: "https://github.com/kylef/JSONSchema.swift", package: "JSONSchema.swift", requirement: { type: "from", version: "0.6.0" }, products: ["JSONSchema"] },
                { url: "https://github.com/google/GoogleSignIn-iOS", package: "GoogleSignIn-iOS", requirement: { type: "from", version: "7.0.0" }, products: ["GoogleSignIn"] },
            ]
            const notificationsDependencies = isNotificationsEnabled
                ? [{ url: "https://github.com/firebase/firebase-ios-sdk", package: "firebase-ios-sdk", requirement: { type: "from", version: "12.3.0" }, products: ["FirebaseCore", "FirebaseMessaging"] }]
                : []

            const coreDependencyMap = new Map()
            baseCoreDependencies.forEach((d) => mergePackageDependency(coreDependencyMap, d, "base core"))
            pluginDependencies.forEach((d) => mergePackageDependency(coreDependencyMap, d, "plugin manifests"))
            const coreDependencies = [...coreDependencyMap.values()].sort((l, r) => l.url.localeCompare(r.url))

            const packageDependencyMap = new Map()
            coreDependencies.forEach((d) => mergePackageDependency(packageDependencyMap, d, "core target"))
            notificationsDependencies.forEach((d) => mergePackageDependency(packageDependencyMap, d, "notifications target"))
            const packageDependencies = [...packageDependencyMap.values()].sort((l, r) => l.url.localeCompare(r.url))

            progress.log(`🔧 Generating Package.swift (notifications: ${isNotificationsEnabled})`, "info")

            const configHash = crypto.createHash("md5")
                .update(JSON.stringify({ notifications: isNotificationsEnabled, googleSignIn: isGoogleSignInEnabled, pluginDependencies: coreDependencies }))
                .digest("hex")

            const hashFilePath = path.join(PROJECT_DIR, ".package-config-hash") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            const targetPath = path.join(PROJECT_DIR, "Package.swift") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            let shouldUpdate = true

            if (fs.existsSync(hashFilePath)) {
                const previousHash = fs.readFileSync(hashFilePath, "utf8")
                if (previousHash === configHash) {
                    shouldUpdate = false
                    progress.log("Package.swift already up to date", "info")
                }
            }

            if (!fs.existsSync(targetPath)) {
                shouldUpdate = true
                progress.log("Package.swift missing, will generate it now", "info")
            }

            if (shouldUpdate) {
                progress.log("Generating Package.swift dynamically", "info")

                let packageContent = `// swift-tools-version: 5.9
// Auto-generated Package.swift - DO NOT EDIT MANUALLY
// Generated based on config: notifications.enabled = ${isNotificationsEnabled}
import PackageDescription

let package = Package(
    name: "iosnativeWebView",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "CatalystCore", targets: ["CatalystCore"])`

                if (isNotificationsEnabled) {
                    packageContent += `,\n        .library(name: "CatalystNotifications", targets: ["CatalystNotifications"])`
                }

                packageContent += `
    ],
    dependencies: [
${formatSwiftPackageEntries(packageDependencies).join(",\n")}
    ],
    targets: [
        // Core functionality (WebView, bridge, utils, constants)
        // App-level files (AppDelegate, ContentView) are in iosnativeWebView/ directory
        .target(
            name: "CatalystCore",
            dependencies: [
${formatSwiftProductEntries(coreDependencies).join(",\n")}
            ],
            path: "Sources/Core"
        )`

                if (isNotificationsEnabled) {
                    packageContent += `,
        // Notifications functionality (optional, includes Firebase)
        .target(
            name: "CatalystNotifications",
            dependencies: [
                "CatalystCore",
${formatSwiftProductEntries(notificationsDependencies).join(",\n")}
            ],
            path: "Sources/CatalystNotifications"
        )`
                }

                packageContent += `\n    ]\n)\n`

                fs.writeFileSync(targetPath, packageContent, "utf8")
                progress.log(`Generated Package.swift with ${isNotificationsEnabled ? "notifications enabled" : "notifications disabled"}`, "success")
                fs.writeFileSync(hashFilePath, configHash)

                progress.log("Resolving package dependencies...", "info")
                try {
                    execSync(`cd "${PROJECT_DIR}" && rm -rf .build`, { stdio: "ignore" }) // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                    try { fs.rmSync(path.join(PROJECT_DIR, "Package.resolved"), { force: true }) } catch { progress.log("") } // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
                    execSync(`cd "${PROJECT_DIR}" && rm -rf .swiftpm`, { stdio: "ignore" }) // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                    const projectPath = path.join(PROJECT_DIR, `${PROJECT_NAME}.xcodeproj`) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
                    execSync(`cd "${PROJECT_DIR}" && xcodebuild -resolvePackageDependencies -project "${projectPath}" -scheme "${SCHEME_NAME}"`, { stdio: "inherit" }) // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                    progress.log("Package dependencies resolved successfully", "success")
                } catch (error) {
                    if (isNotificationsEnabled) {
                        progress.log(`❌ CRITICAL: Package resolution failed. Firebase dependencies required for notifications could not be resolved.`, "error")
                        throw new Error(`Package resolution failed: ${error.message}. This is required when notifications are enabled.`)
                    } else {
                        progress.log(`Warning: Package resolution may have failed: ${error.message}`, "warning")
                    }
                }
            }

            progress.log("✅ Package.swift ready", "success")
        } catch (error) {
            progress.log(`❌ Failed to generate Package.swift: ${error.message}`, "error")
            throw error
        }
    }

    async function updateXcodeProjectPackageDependencies() {
        try {
            const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false
            const projectFilePath = path.join(PROJECT_DIR, `${PROJECT_NAME}.xcodeproj`, "project.pbxproj") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal

            progress.log(`🔧 Updating Xcode package dependencies (notifications: ${isNotificationsEnabled})`, "info")

            if (!fs.existsSync(projectFilePath)) throw new Error(`Xcode project file not found at: ${projectFilePath}`)

            let projectContent = fs.readFileSync(projectFilePath, "utf8")

            const NOTIF_BUILD_FILE_ID = "C99974352E97D56900C25611"
            const NOTIF_PRODUCT_ID = "C99974362E97D56900C25611"
            const hasNotifications = projectContent.includes("/* CatalystNotifications */")

            if (isNotificationsEnabled && !hasNotifications) {
                progress.log("Adding CatalystNotifications to Xcode project", "info")
                projectContent = projectContent.replace(
                    /(C99974342E97D56900C25611 \/\* CatalystCore in Frameworks \*\/ = {isa = PBXBuildFile; productRef = C99974332E97D56900C25611 \/\* CatalystCore \*\/; };)/,
                    `$1\n\t\t${NOTIF_BUILD_FILE_ID} /* CatalystNotifications in Frameworks */ = {isa = PBXBuildFile; productRef = ${NOTIF_PRODUCT_ID} /* CatalystNotifications */; };`
                )
                projectContent = projectContent.replace(
                    /(C99974342E97D56900C25611 \/\* CatalystCore in Frameworks \*\/,)/,
                    `$1\n\t\t\t\t${NOTIF_BUILD_FILE_ID} /* CatalystNotifications in Frameworks */,`
                )
                projectContent = projectContent.replace(
                    /(packageProductDependencies = \(\s*C99974332E97D56900C25611 \/\* CatalystCore \*\/,)/,
                    `$1\n\t\t\t\t${NOTIF_PRODUCT_ID} /* CatalystNotifications */,`
                )
                projectContent = projectContent.replace(
                    /(\/\* End XCSwiftPackageProductDependency section \*\/)/,
                    `\t\t${NOTIF_PRODUCT_ID} /* CatalystNotifications */ = {\n\t\t\tisa = XCSwiftPackageProductDependency;\n\t\t\tpackage = C99974322E97D56900C25611 /* XCLocalSwiftPackageReference "." */;\n\t\t\tproductName = CatalystNotifications;\n\t\t};\n$1`
                )
                fs.writeFileSync(projectFilePath, projectContent, "utf8")
                progress.log("✅ CatalystNotifications added to Xcode project", "success")
            } else if (!isNotificationsEnabled && hasNotifications) {
                progress.log("Removing CatalystNotifications from Xcode project", "info")
                projectContent = projectContent.replace(/\t\t[A-F0-9]+ \/\* CatalystNotifications in Frameworks \*\/ = {isa = PBXBuildFile; productRef = [A-F0-9]+ \/\* CatalystNotifications \*\/; };\n/g, "")
                projectContent = projectContent.replace(/\t\t\t\t[A-F0-9]+ \/\* CatalystNotifications in Frameworks \*\/,\n/g, "")
                projectContent = projectContent.replace(/\t\t\t\t[A-F0-9]+ \/\* CatalystNotifications \*\/,\n/g, "")
                projectContent = projectContent.replace(/\t\t[A-F0-9]+ \/\* CatalystNotifications \*\/ = {\n\t\t\tisa = XCSwiftPackageProductDependency;\n\t\t\tpackage = [A-F0-9]+ \/\* XCLocalSwiftPackageReference "." \*\/;\n\t\t\tproductName = CatalystNotifications;\n\t\t};\n/g, "")
                fs.writeFileSync(projectFilePath, projectContent, "utf8")
                progress.log("✅ CatalystNotifications removed from Xcode project", "success")
            } else {
                progress.log("Package dependencies already correct", "info")
            }
        } catch (error) {
            progress.log(`❌ Failed to update package dependencies: ${error.message}`, "error")
            throw error
        }
    }

    async function removePluginResourcesFromXcodeProject() {
        try {
            const projectFilePath = getXcodeProjectFilePath()
            let projectContent
            try {
                projectContent = fs.readFileSync(projectFilePath, "utf8")
            } catch (err) {
                if (err.code === "ENOENT") return
                throw err
            }
            const patterns = [
                /\t\t[A-F0-9]+ \/\* PluginResources\/[^*]+ \*\/ = \{isa = PBXFileReference;[^\n]*path = [^;]*PluginResources\/[^;]+; sourceTree = "<group>"; \};\n/g,
                /\t\t[A-F0-9]+ \/\* PluginResources\/[^*]+ in Resources \*\/ = \{isa = PBXBuildFile;[^\n]*\};\n/g,
                /\t\t\t\t[A-F0-9]+ \/\* PluginResources\/[^*]+ \*\/,\n/g,
                /\t\t\t\t[A-F0-9]+ \/\* PluginResources\/[^*]+ in Resources \*\/,\n/g,
            ]
            let modified = false
            for (const pattern of patterns) {
                const nextContent = projectContent.replace(pattern, "")
                if (nextContent !== projectContent) { projectContent = nextContent; modified = true }
            }
            if (modified) {
                fs.writeFileSync(projectFilePath, projectContent, "utf8")
                progress.log("Removed managed plugin resources from Xcode project", "info")
            }
        } catch (error) {
            throw new Error(`Could not remove plugin resources from Xcode project: ${error.message}`)
        }
    }

    async function addPluginResourcesToXcodeProject(resources) {
        try {
            if (resources.length === 0) return
            const projectFilePath = getXcodeProjectFilePath()
            let projectContent
            try {
                projectContent = fs.readFileSync(projectFilePath, "utf8")
            } catch (err) {
                if (err.code === "ENOENT") throw new Error(`Xcode project file not found at: ${projectFilePath}`)
                throw err
            }
            for (const resource of resources) {
                const label = resource.bundleRelativePath
                const fileRefId = generateProjectObjectId(label, "_ref")
                const buildFileId = generateProjectObjectId(label, "_build")
                const pbxprojPath = formatPbxprojPath(label)
                const fileType = detectPbxprojFileType(label)
                const fileRefEntry = `\t\t${fileRefId} /* ${label} */ = {isa = PBXFileReference; lastKnownFileType = ${fileType}; path = ${pbxprojPath}; sourceTree = "<group>"; };`
                projectContent = replaceRequired(projectContent, /(\/\* End PBXFileReference section \*\/)/, `${fileRefEntry}\n$1`, "PBXFileReference section not found while registering plugin resources")
                const buildFileEntry = `\t\t${buildFileId} /* ${label} in Resources */ = {isa = PBXBuildFile; fileRef = ${fileRefId} /* ${label} */; };`
                projectContent = replaceRequired(projectContent, /(\/\* End PBXBuildFile section \*\/)/, `${buildFileEntry}\n$1`, "PBXBuildFile section not found while registering plugin resources")
                projectContent = replaceRequired(projectContent, /(\/\* iosnativeWebView \*\/ = \{[^}]*children = \([^)]*)/, `$1\n\t\t\t\t${fileRefId} /* ${label} */,`, "iosnativeWebView group not found while registering plugin resources")
                projectContent = replaceRequired(projectContent, /(\/\* Resources \*\/ = \{[^}]*files = \([^)]*)/, `$1\n\t\t\t\t${buildFileId} /* ${label} in Resources */,`, "Resources build phase not found while registering plugin resources")
            }
            fs.writeFileSync(projectFilePath, projectContent, "utf8")
            progress.log(`Registered ${resources.length} managed plugin resource(s) in Xcode project`, "success")
        } catch (error) {
            throw new Error(`Could not add plugin resources to Xcode project: ${error.message}`)
        }
    }

    async function syncPluginResources(pluginComposition = {}) {
        try {
            const resources = pluginComposition.resources || []
            const pluginResourceDir = path.join(PROJECT_DIR, PROJECT_NAME, PLUGIN_RESOURCE_ROOT) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            fs.rmSync(pluginResourceDir, { recursive: true, force: true })
            await removePluginResourcesFromXcodeProject()
            if (resources.length === 0) { progress.log("No managed plugin resources to sync", "info"); return }
            for (const resource of resources) {
                const normalizedBundleRelativePath = path.posix.normalize(resource.bundleRelativePath || "")
                const expectedPrefix = `${PLUGIN_RESOURCE_ROOT}/`
                if (!normalizedBundleRelativePath.startsWith(expectedPrefix) || normalizedBundleRelativePath.includes("../") || path.posix.isAbsolute(normalizedBundleRelativePath)) {
                    throw new Error(`Invalid managed plugin resource path: ${resource.bundleRelativePath}`)
                }
                // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - The normalized path is validated above and containment is enforced immediately below.
                const targetPath = path.resolve(PROJECT_DIR, PROJECT_NAME, normalizedBundleRelativePath)
                if (targetPath !== pluginResourceDir && !targetPath.startsWith(`${pluginResourceDir}${path.sep}`)) {
                    throw new Error(`Managed plugin resource escaped bundle directory: ${resource.bundleRelativePath}`)
                }
                fs.mkdirSync(path.dirname(targetPath), { recursive: true })
                fs.copyFileSync(resource.sourcePath, targetPath)
            }
            await addPluginResourcesToXcodeProject(resources)
            progress.log(`Synced ${resources.length} managed plugin resource(s)`, "success")
        } catch (error) {
            progress.log(`❌ Failed to sync plugin resources: ${error.message}`, "error")
            throw error
        }
    }

    return { generatePackageSwift, updateXcodeProjectPackageDependencies, syncPluginResources }
}
