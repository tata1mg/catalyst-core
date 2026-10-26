/* eslint-disable no-extra-semi */
"use strict"

var _fs = _interopRequireDefault(require("fs"))
var _path = _interopRequireDefault(require("path"))
var _utils = require("./utils.js")
var _theme = require("../cli/theme.js")

function _interopRequireDefault(e) {
    return e && e.__esModule ? e : { default: e }
}

// Simple progress logging without TerminalProgress dependency
class SimpleProgress {
    constructor(title) {
        this.title = title
        this.currentStep = null
        this.startedAt = 0
        // Deferred: this module is imported by the Android build, which prints
        // its own header. Printing here on import produced two headers, the
        // first of them for work that had not started and often never runs.
        this.headerShown = false
    }

    ensureHeader() {
        if (this.headerShown) return
        this.headerShown = true
        console.log(_theme.header(this.title))
    }

    start(stepId) {
        this.ensureHeader()
        this.currentStep = { id: stepId }
        this.startedAt = Date.now()
        console.log(`${_theme.GUTTER}${_theme.t.accent(_theme.glyph.running)} ${stepId}`)
    }

    complete(stepId) {
        this.ensureHeader()
        console.log(_theme.step(stepId, this.startedAt ? Date.now() - this.startedAt : null))
        this.currentStep = null
    }

    fail(stepId, message) {
        this.ensureHeader()
        console.log(_theme.step(stepId, null, "fail"))
        // Backstop: runCommand already scrubs its errors, but this is where any
        // failure in the signing flow ends up on screen.
        if (message)
            console.log(
                `${_theme.GUTTER}${_theme.t.dim(_theme.glyph.last)} ${_theme.t.bad((0, _utils.redactSecrets)(message))}`
            )
    }

    log(message, type = "info") {
        this.ensureHeader()
        const mark =
            type === "error"
                ? _theme.t.bad(_theme.glyph.fail)
                : type === "warning"
                  ? _theme.t.warn(_theme.glyph.warn)
                  : type === "success"
                    ? _theme.t.ok(_theme.glyph.done)
                    : _theme.t.dim(_theme.glyph.info)
        console.log(`${_theme.GUTTER}${_theme.t.dim(_theme.glyph.pipe)} ${mark} ${message}`)
    }

    printTreeContent(title, items) {
        this.ensureHeader()
        console.log(`\n${_theme.GUTTER}${_theme.t.bold(title)}`)
        items.forEach((item) => {
            if (typeof item === "string") {
                console.log(item)
            } else {
                const indent = "  ".repeat(item.indent || 0)
                const prefix = item.prefix || ""
                console.log(`${indent}${prefix}${item.text}`)
            }
        })
        console.log("")
    }
}

const progress = new SimpleProgress("Android AAB Builder")

/**
 * Generate the release webview config and build the signed bundle inside the
 * temp copy. Two Gradle runs: the manifest's allowBackup placeholder is read
 * from webview_config.properties while Gradle configures the project, so the
 * file must exist before bundleRelease is configured.
 *
 * Signing and version values arrive in `gradle.env` as ORG_GRADLE_PROJECT_*
 * variables; nothing secret is put on the command line.
 */
async function createSignedAAB(projectPaths, androidConfig) {
    const { newProjectPath } = projectPaths
    const { gradle } = androidConfig

    if (!gradle || !gradle.configPath || !gradle.env) {
        throw new Error("A resolved config and upload key are required to build the signed AAB")
    }

    progress.log("Building signed Android App Bundle (AAB)...", "info")

    const absoluteProjectPath = _path.default.resolve(newProjectPath)
    const gradlewPath = _path.default.join(absoluteProjectPath, "gradlew")
    if (!_fs.default.existsSync(gradlewPath)) {
        throw new Error(`gradlew not found at: ${gradlewPath}. Ensure this is a valid Android project.`)
    }
    _fs.default.chmodSync(gradlewPath, 0o755)

    const common = [`-PconfigPath=${gradle.configPath}`, "-PcatalystBuildType=release", "--console=plain"]
    const run = (args) =>
        (0, _utils.runInteractiveCommand)(
            gradlewPath,
            args,
            {},
            { env: gradle.env, cwd: absoluteProjectPath }
        )

    progress.log("Generating the release webview configuration...", "info")
    await run([
        "generateWebViewConfig",
        `-PbuildOptimisation=${Boolean(gradle.buildOptimisation)}`,
        ...common,
    ])

    progress.log("Building signed AAB (clean bundleRelease)...", "info")
    await run(["clean", "bundleRelease", ...common])
    progress.log("Bundle build completed", "success")

    const aabPath = _path.default.join(
        newProjectPath,
        "app",
        "build",
        "outputs",
        "bundle",
        "release",
        "app-release.aab"
    )
    if (!_fs.default.existsSync(aabPath)) {
        throw new Error(`Signed AAB file was not generated at ${aabPath}`)
    }

    const stats = _fs.default.statSync(aabPath)
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2)
    progress.log(`Signed AAB created (${fileSizeMB} MB)`, "success")

    return { aabPath, outputAabPath: aabPath, fileSize: fileSizeMB }
}

async function initializeConfig(configPath) {
    if (!configPath) {
        throw new Error("Config path is required")
    }

    if (!_fs.default.existsSync(configPath)) {
        throw new Error(`Config file not found at: ${configPath}`)
    }

    progress.log(`Reading config from: ${configPath}`, "info")

    const configFile = _fs.default.readFileSync(configPath, "utf8")
    const config = JSON.parse(configFile)

    if (!config.android) {
        throw new Error("Android configuration missing in config file")
    }

    const { android } = config

    // Validate required fields (only newProjectName is truly required)
    if (!android.newProjectName) {
        throw new Error("newProjectName is required in android config")
    }

    progress.log(`Project path: ${android.projectPath}`, "info")
    progress.log(`Old project name: ${android.oldProjectName}`, "info")
    progress.log(`New project name: ${android.newProjectName}`, "info")

    if (android.outputPath) {
        progress.log(`Custom output path: ${android.outputPath}`, "info")
    } else {
        const parentDir = _path.default.dirname(android.projectPath)
        const defaultOutputPath = _path.default.join(parentDir, "build-output")
        progress.log(`Default output path: ${defaultOutputPath}`, "info")
    }

    if (android.createSignedAAB) {
        progress.log(`Signed AAB creation: Enabled`, "info")

        if (android.keystoreConfig) {
            // Check for placeholder passwords
            if (
                android.keystoreConfig.storePassword === "your_store_password" ||
                android.keystoreConfig.keyPassword === "your_key_password" ||
                android.keystoreConfig.storePassword === "your_password" ||
                android.keystoreConfig.keyPassword === "your_password"
            ) {
                progress.log(
                    `Warning: Keystore contains placeholder passwords. Please update them.`,
                    "warning"
                )
            } else {
                progress.log(`Keystore configuration: Valid`, "success")
            }
        } else {
            progress.log(`Warning: Keystore configuration missing for AAB creation`, "warning")
        }
    } else {
        progress.log(`Signed AAB creation: Disabled (set createSignedAAB: true to enable)`, "info")
    }

    return { android, config }
}

async function diagnoseAndroidProject(projectPath) {
    progress.log("Diagnosing Android project structure...", "info")

    if (!_fs.default.existsSync(projectPath)) {
        throw new Error(`Project path does not exist: ${projectPath}`)
    }

    // Check for common Android project patterns (supporting both .gradle and .gradle.kts)
    const patterns = [
        {
            files: ["build.gradle", "build.gradle.kts"],
            description: "Root build gradle",
            type: "either",
        },
        {
            files: ["settings.gradle", "settings.gradle.kts"],
            description: "Settings gradle",
            type: "either",
        },
        {
            files: ["gradlew"],
            description: "Gradle wrapper script",
            type: "single",
        },
        {
            files: ["gradle.properties"],
            description: "Gradle properties",
            type: "single",
        },
        {
            files: ["app/build.gradle", "app/build.gradle.kts"],
            description: "App module build gradle",
            type: "either",
        },
        {
            files: ["app/src/main/AndroidManifest.xml"],
            description: "Android manifest",
            type: "single",
        },
        {
            files: ["app/src/main/java"],
            description: "Java source directory",
            type: "single",
        },
        {
            files: ["app/src/main/res"],
            description: "Android resources",
            type: "single",
        },
    ]

    const diagnostics = {
        foundFiles: [],
        missingFiles: [],
        projectType: "unknown",
        usesKotlinDSL: false,
    }

    for (const pattern of patterns) {
        let found = false
        let foundFile = null

        if (pattern.type === "either") {
            // Check if either variant exists
            for (const file of pattern.files) {
                const fullPath = _path.default.join(projectPath, file)
                if (_fs.default.existsSync(fullPath)) {
                    found = true
                    foundFile = file
                    if (file.endsWith(".kts")) {
                        diagnostics.usesKotlinDSL = true
                    }
                    break
                }
            }
        } else {
            // Check single file
            const fullPath = _path.default.join(projectPath, pattern.files[0])
            if (_fs.default.existsSync(fullPath)) {
                found = true
                foundFile = pattern.files[0]
            }
        }

        if (found) {
            diagnostics.foundFiles.push({ ...pattern, foundFile })
            progress.log(`Found: ${pattern.description}${foundFile ? ` (${foundFile})` : ""}`, "success")
        } else {
            diagnostics.missingFiles.push(pattern)
            progress.log(`Missing: ${pattern.description}`, "warning")
        }
    }

    // Determine project type
    const hasRootBuildFile = diagnostics.foundFiles.some(
        (f) => f.files.includes("build.gradle") || f.files.includes("build.gradle.kts")
    )
    const hasAppBuildFile = diagnostics.foundFiles.some(
        (f) => f.files.includes("app/build.gradle") || f.files.includes("app/build.gradle.kts")
    )
    const hasGradlew = diagnostics.foundFiles.some((f) => f.files.includes("gradlew"))

    if (hasRootBuildFile && hasAppBuildFile) {
        diagnostics.projectType = "standard-android"
    } else if (hasGradlew) {
        diagnostics.projectType = "gradle-project"
    } else {
        diagnostics.projectType = "incomplete"
    }

    progress.log(`Project type detected: ${diagnostics.projectType}`, "info")
    if (diagnostics.usesKotlinDSL) {
        progress.log(`Project uses Kotlin DSL (.kts files)`, "info")
    }

    // Try to find build files in unexpected locations
    if (diagnostics.missingFiles.length > 0) {
        progress.log("Searching for missing files in alternate locations...", "info")
        try {
            const findBuildFiles = `find "${projectPath}" \\( -name "build.gradle" -o -name "build.gradle.kts" -o -name "settings.gradle" -o -name "settings.gradle.kts" -o -name "AndroidManifest.xml" \\) -type f`
            const foundFiles = (0, _utils.runCommand)(findBuildFiles)
            if (foundFiles.trim()) {
                progress.log("Found build files in unexpected locations:", "info")
                foundFiles
                    .trim()
                    .split("\n")
                    .forEach((file) => {
                        progress.log(`  ${file}`, "info")
                    })
            }
        } catch (searchError) {
            progress.log("Could not search for alternative file locations", "warning")
        }
    }

    return diagnostics
}

async function validateProjectStructure(androidConfig) {
    const { projectPath, oldProjectName } = androidConfig

    progress.log("Validating project structure...", "info")

    if (!_fs.default.existsSync(projectPath)) {
        throw new Error(`Project path does not exist: ${projectPath}`)
    }

    // Run comprehensive diagnostics
    const diagnostics = await diagnoseAndroidProject(projectPath)

    if (diagnostics.projectType === "incomplete") {
        throw new Error(
            `Android project appears to be incomplete. Missing critical files: ${diagnostics.missingFiles.map((f) => f.description).join(", ")}`
        )
    }

    if (diagnostics.projectType !== "standard-android") {
        progress.log(
            `Warning: Project type "${diagnostics.projectType}" may not be fully compatible`,
            "warning"
        )
    }

    // Check if the old project name exists in the path
    if (!projectPath.includes(oldProjectName)) {
        progress.log(`Warning: Project path doesn't contain old project name "${oldProjectName}"`, "warning")
    }

    // Get the parent directory
    const parentDir = _path.default.dirname(projectPath)
    const currentProjectDir = _path.default.basename(projectPath)

    if (currentProjectDir !== oldProjectName) {
        progress.log(
            `Warning: Current directory name "${currentProjectDir}" differs from old project name "${oldProjectName}"`,
            "warning"
        )
    }

    // Create output directory path - where final AAB will be saved
    const outputPath = androidConfig.outputPath
        ? _path.default.resolve(androidConfig.outputPath)
        : _path.default.resolve(parentDir, "build-output")

    progress.log(`Original project: ${projectPath}`, "info")
    progress.log(`Output directory: ${outputPath}`, "info")

    progress.log("Project structure validation completed", "success")

    return {
        parentDir,
        currentProjectDir,
        oldProjectPath: projectPath,
        outputPath,
        diagnostics,
    }
}

async function createBackup(projectPaths, androidConfig) {
    if (!androidConfig.createBackup) {
        progress.log("Backup creation skipped (not requested)", "info")
        return null
    }

    progress.log("Creating project backup...", "info")

    const backupPath = `${projectPaths.oldProjectPath}_backup_${Date.now()}`

    try {
        ;(0, _utils.runCommand)(`cp -r "${projectPaths.oldProjectPath}" "${backupPath}"`)
        progress.log(`Backup created at: ${backupPath}`, "success")
        return backupPath
    } catch (error) {
        throw new Error(`Failed to create backup: ${error.message}`)
    }
}

async function createTempDeploymentProject(projectPaths, androidConfig) {
    const { oldProjectPath } = projectPaths
    const { oldProjectName, newProjectName, packageName } = androidConfig

    progress.log("Creating temporary deployment project...", "info")

    // Create a temporary directory based on package name (if available) or timestamp
    const tempDirSuffix = packageName ? packageName.replace(/\./g, "_") : Date.now().toString()
    const tempDir = _path.default.join(_path.default.dirname(oldProjectPath), `temp_build_${tempDirSuffix}`)

    // Remove existing temp directory with same name if it exists
    if (_fs.default.existsSync(tempDir)) {
        progress.log(`Removing existing temp directory: ${tempDir}`, "info")
        try {
            ;(0, _utils.runCommand)(`rm -rf "${tempDir}"`)
        } catch (cleanupError) {
            progress.log(
                `Warning: Could not remove existing temp directory: ${cleanupError.message}`,
                "warning"
            )
        }
    }

    try {
        // First, let's check what's actually in the source directory
        progress.log(`Inspecting source directory: ${oldProjectPath}`, "info")
        if (!_fs.default.existsSync(oldProjectPath)) {
            throw new Error(`Source project path does not exist: ${oldProjectPath}`)
        }

        const sourceFiles = _fs.default.readdirSync(oldProjectPath)
        progress.log(`Source directory contents: ${sourceFiles.join(", ")}`, "info")

        // Copy the entire project to the temporary location using rsync for better file preservation
        progress.log(`Copying project to temporary location...`, "info")
        progress.log(`Source: ${oldProjectPath}`, "info")
        progress.log(`Temp destination: ${tempDir}`, "info")

        // Use rsync to preserve all file attributes and handle symlinks properly
        ;(0, _utils.runCommand)(`rsync -av "${oldProjectPath}/" "${tempDir}/"`)
        progress.log(`Created temporary copy for building`, "success")

        // Only check for gradlew which is absolutely essential for building
        const gradlewPath = _path.default.join(tempDir, "gradlew")
        if (!_fs.default.existsSync(gradlewPath)) {
            throw new Error(
                "Critical file missing: gradlew not found. This is required for building the project."
            )
        }

        // Log what we have (for debugging purposes only, not validation)
        progress.log(`Checking copied files (informational only):`, "info")
        const filesToCheck = [
            { path: "gradlew", desc: "Gradle wrapper" },
            { path: "build.gradle", desc: "Root build.gradle" },
            { path: "build.gradle.kts", desc: "Root build.gradle.kts" },
            { path: "app/build.gradle", desc: "App build.gradle" },
            { path: "app/build.gradle.kts", desc: "App build.gradle.kts" },
            { path: "settings.gradle", desc: "Settings gradle" },
            { path: "settings.gradle.kts", desc: "Settings gradle.kts" },
            { path: "app/src/main/AndroidManifest.xml", desc: "Android manifest" },
        ]

        filesToCheck.forEach((file) => {
            const fullPath = _path.default.join(tempDir, file.path)
            const exists = _fs.default.existsSync(fullPath)
            progress.log(`  ${file.desc}: ${exists ? "found" : "not found"}`, exists ? "info" : "warning")
        })

        // List all files in temp directory for debugging
        if (_fs.default.existsSync(tempDir)) {
            const tempFiles = _fs.default.readdirSync(tempDir)
            progress.log(`Temp directory contents: ${tempFiles.join(", ")}`, "info")
        }
    } catch (error) {
        // Clean up on error
        if (_fs.default.existsSync(tempDir)) {
            try {
                ;(0, _utils.runCommand)(`rm -rf "${tempDir}"`)
            } catch (cleanupError) {
                progress.log(`Warning: Could not cleanup temp directory: ${cleanupError.message}`, "warning")
            }
        }
        throw new Error(`Failed to create temporary deployment copy: ${error.message}`)
    }

    // Find and rename any subdirectories that contain the old project name within the temp copy
    try {
        const findCommand = `find "${tempDir}" -type d -name "*${oldProjectName}*"`
        const result = (0, _utils.runCommand)(findCommand)

        if (result.trim()) {
            const dirsToRename = result
                .trim()
                .split("\n")
                .filter((dir) => dir.trim())

            for (const dir of dirsToRename) {
                const newDirName = dir.split(oldProjectName).join(newProjectName)
                if (dir !== newDirName) {
                    ;(0, _utils.runCommand)(`mv "${dir}" "${newDirName}"`)
                    progress.log(
                        `Renamed subdirectory: ${_path.default.basename(dir)} → ${_path.default.basename(newDirName)}`,
                        "success"
                    )
                }
            }
        }
    } catch (error) {
        progress.log(`Warning: Error finding subdirectories to rename: ${error.message}`, "warning")
    }

    progress.log("Temporary deployment project created successfully", "success")
    return tempDir
}

async function finalizeAABAndCleanup(projectPaths, androidConfig, aabResult, tempDeploymentPath) {
    const { oldProjectPath } = projectPaths

    progress.log("Finalizing AAB and cleaning up temporary files...", "info")

    try {
        // Create final output directory next to original project
        const outputDir =
            androidConfig.outputPath ||
            _path.default.join(_path.default.dirname(oldProjectPath), "build-output")
        if (!_fs.default.existsSync(outputDir)) {
            _fs.default.mkdirSync(outputDir, { recursive: true })
            progress.log(`Created output directory: ${outputDir}`, "success")
        }

        // Copy AAB to final location with descriptive name
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0]
        const finalAabName = `${androidConfig.newProjectName}-release-${timestamp}.aab`
        const finalAabPath = _path.default.join(outputDir, finalAabName)

        _fs.default.copyFileSync(aabResult.outputAabPath, finalAabPath)
        progress.log(`AAB saved to: ${finalAabPath}`, "note")

        // Clean up temporary deployment directory
        await cleanupTempDeployment(tempDeploymentPath)

        return {
            ...aabResult,
            finalAabPath,
            finalAabName,
            outputDir,
        }
    } catch (error) {
        throw new Error(`Failed to finalize AAB: ${error.message}`)
    }
}

async function cleanupTempDeployment(tempDeploymentPath) {
    if (!tempDeploymentPath || !_fs.default.existsSync(tempDeploymentPath)) {
        return
    }

    try {
        progress.log("Cleaning up temporary deployment files...", "info")
        ;(0, _utils.runCommand)(`rm -rf "${tempDeploymentPath}"`)
        progress.log("Temporary files cleaned up successfully", "success")
    } catch (error) {
        progress.log(`Warning: Could not cleanup temporary directory: ${error.message}`, "warning")
    }
}

async function updateFileContents(projectPaths, androidConfig) {
    const { newProjectPath } = projectPaths
    const { oldProjectName, newProjectName, packageName } = androidConfig

    progress.log("Updating file contents and names...", "info")

    try {
        // STEP 1: Update packageName in build.gradle.kts and source files
        if (packageName) {
            const OLD_PACKAGE = "io.yourname.androidproject"
            progress.log(`Replacing package name: ${OLD_PACKAGE} → ${packageName}`, "info")

            // Update build.gradle.kts
            const buildGradlePath = _path.default.join(newProjectPath, "app", "build.gradle.kts")
            if (_fs.default.existsSync(buildGradlePath)) {
                let content = _fs.default.readFileSync(buildGradlePath, "utf8")
                content = content.replace(
                    /namespace = "io\.yourname\.androidproject"/g,
                    `namespace = "${packageName}"`
                )
                content = content.replace(
                    /applicationId = "io\.yourname\.androidproject"/g,
                    `applicationId = "${packageName}"`
                )
                _fs.default.writeFileSync(buildGradlePath, content, "utf8")
                progress.log(`Updated build.gradle.kts with package: ${packageName}`, "success")
            }

            // Update source directory structure for all source sets
            const sourceSets = ["main", "test", "noFcm", "withFcm"]
            const newPackageParts = packageName.split(".")
            let totalUpdatedFiles = 0

            for (const sourceSet of sourceSets) {
                const oldPackagePath = _path.default.join(
                    newProjectPath,
                    "app",
                    "src",
                    sourceSet,
                    "java",
                    "io",
                    "yourname",
                    "androidproject"
                )

                if (_fs.default.existsSync(oldPackagePath)) {
                    const newPackagePath = _path.default.join(
                        newProjectPath,
                        "app",
                        "src",
                        sourceSet,
                        "java",
                        ...newPackageParts
                    )

                    const packagePathChanged =
                        _path.default.resolve(oldPackagePath) !== _path.default.resolve(newPackagePath)

                    if (packagePathChanged) {
                        // Create new package directory
                        const newPackageDir = _path.default.dirname(newPackagePath)
                        _fs.default.mkdirSync(newPackageDir, { recursive: true })

                        // Move source files
                        ;(0, _utils.runCommand)(`mv "${oldPackagePath}" "${newPackagePath}"`)
                        progress.log(`Moved ${sourceSet} source files to: ${newPackagePath}`, "success")
                    } else {
                        progress.log(
                            `Package path unchanged for ${sourceSet}; skipping source directory move`,
                            "info"
                        )
                    }

                    // Update package declarations in source files
                    const findCommand = `find "${newPackagePath}" -type f \\( -name "*.kt" -o -name "*.java" \\)`
                    const sourceFiles = (0, _utils.runCommand)(findCommand)
                        .trim()
                        .split("\n")
                        .filter((f) => f.trim())

                    let updatedCount = 0
                    for (const file of sourceFiles) {
                        let content = _fs.default.readFileSync(file, "utf8")
                        if (content.includes(OLD_PACKAGE)) {
                            content = content.replace(new RegExp(OLD_PACKAGE, "g"), packageName)
                            _fs.default.writeFileSync(file, content, "utf8")
                            updatedCount++
                        }
                    }
                    totalUpdatedFiles += updatedCount
                    progress.log(
                        `Updated package declarations in ${updatedCount} ${sourceSet} files`,
                        "success"
                    )

                    // Clean up old empty directories
                    try {
                        ;(0, _utils.runCommand)(
                            `find "${_path.default.join(newProjectPath, "app", "src", sourceSet, "java")}" -type d -empty -delete`
                        )
                    } catch (err) {
                        // Ignore cleanup errors
                    }
                }
            }

            if (totalUpdatedFiles > 0) {
                progress.log(`Total package declarations updated: ${totalUpdatedFiles} files`, "success")
            }

            // Update AndroidManifest.xml
            const manifestPath = _path.default.join(
                newProjectPath,
                "app",
                "src",
                "main",
                "AndroidManifest.xml"
            )
            if (_fs.default.existsSync(manifestPath)) {
                let content = _fs.default.readFileSync(manifestPath, "utf8")
                if (content.includes(OLD_PACKAGE)) {
                    content = content.replace(new RegExp(OLD_PACKAGE, "g"), packageName)
                    _fs.default.writeFileSync(manifestPath, content, "utf8")
                    progress.log(`Updated AndroidManifest.xml with package: ${packageName}`, "success")
                }
            }

            // Update proguard-rules.pro
            const proguardPath = _path.default.join(newProjectPath, "app", "proguard-rules.pro")
            if (_fs.default.existsSync(proguardPath)) {
                let content = _fs.default.readFileSync(proguardPath, "utf8")
                if (content.includes(OLD_PACKAGE)) {
                    content = content.replace(new RegExp(OLD_PACKAGE.replace(/\./g, "\\."), "g"), packageName)
                    _fs.default.writeFileSync(proguardPath, content, "utf8")
                    progress.log(`Updated proguard-rules.pro with package: ${packageName}`, "success")
                }
            }
        }

        // STEP 2: Find and rename files that contain the old project name
        const findFilesCommand = `find "${newProjectPath}" -type f -name "*${oldProjectName}*"`
        const fileResult = (0, _utils.runCommand)(findFilesCommand)

        if (fileResult.trim()) {
            const filesToRename = fileResult
                .trim()
                .split("\n")
                .filter((file) => file.trim())

            for (const file of filesToRename) {
                const newFileName = file.split(oldProjectName).join(newProjectName)
                if (file !== newFileName) {
                    ;(0, _utils.runCommand)(`mv "${file}" "${newFileName}"`)
                    progress.log(
                        `Renamed file: ${_path.default.basename(file)} → ${_path.default.basename(newFileName)}`,
                        "success"
                    )
                }
            }
        }

        // STEP 3: Update file contents that reference the old project name
        const fileTypes = [
            "*.gradle",
            "*.gradle.kts",
            "*.xml",
            "*.json",
            "*.properties",
            "*.java",
            "*.kt",
            "*.kts",
            "*.js",
            "*.ts",
            "*.md",
        ]

        for (const fileType of fileTypes) {
            try {
                const findContentCommand = `find "${newProjectPath}" -name "${fileType}" -type f`
                const files = (0, _utils.runCommand)(findContentCommand)

                if (files.trim()) {
                    const fileList = files
                        .trim()
                        .split("\n")
                        .filter((file) => file.trim())

                    for (const file of fileList) {
                        try {
                            const content = _fs.default.readFileSync(file, "utf8")
                            if (content.includes(oldProjectName)) {
                                const updatedContent = content.split(oldProjectName).join(newProjectName)
                                _fs.default.writeFileSync(file, updatedContent, "utf8")
                                progress.log(
                                    `Updated content in: ${_path.default.relative(newProjectPath, file)}`,
                                    "info"
                                )
                            }
                        } catch (fileError) {
                            progress.log(
                                `Warning: Could not update file ${file}: ${fileError.message}`,
                                "warning"
                            )
                        }
                    }
                }
            } catch (typeError) {
                // Continue with other file types if one fails
                progress.log(`Warning: Error processing ${fileType} files: ${typeError.message}`, "warning")
            }
        }

        progress.log("File content updates completed", "success")
    } catch (error) {
        throw new Error(`Error updating file contents: ${error.message}`)
    }
}

async function buildAndroidAAB(configPathOrConfig) {
    let androidConfig
    let projectPaths
    let backupPath
    let tempDeploymentPath

    try {
        // Initialize configuration - handle both config path and direct config object
        progress.start("config")
        if (typeof configPathOrConfig === "string") {
            const { android } = await initializeConfig(configPathOrConfig)
            androidConfig = android
        } else {
            // Direct config object passed (from buildAppAndroid.js)
            // All defaults should already be applied in buildAppAndroid.js
            androidConfig = configPathOrConfig

            // Validate required fields
            if (!androidConfig.newProjectName) {
                throw new Error("newProjectName is required in android config")
            }
            if (!androidConfig.projectPath) {
                throw new Error("projectPath is required in android config")
            }
            if (!androidConfig.oldProjectName) {
                throw new Error("oldProjectName is required in android config")
            }

            progress.log(`Using configuration from buildAppAndroid.js`, "info")
            progress.log(`Project path: ${androidConfig.projectPath}`, "info")
            progress.log(`Old project name: ${androidConfig.oldProjectName}`, "info")
            progress.log(`New project name: ${androidConfig.newProjectName}`, "info")
            progress.log(`Deployment path: ${androidConfig.deploymentPath || "Not specified"}`, "info")
            progress.log(`Overwrite existing: ${androidConfig.overwriteExisting}`, "info")
        }
        progress.complete("config")

        // Validate project structure
        progress.start("validation")
        projectPaths = await validateProjectStructure(androidConfig)
        progress.complete("validation")

        // Create backup if requested
        progress.start("backup")
        backupPath = await createBackup(projectPaths, androidConfig)
        progress.complete("backup")

        // Create temporary deployment project copy
        progress.start("createTempDeployment")
        tempDeploymentPath = await createTempDeploymentProject(projectPaths, androidConfig)
        progress.complete("createTempDeployment")

        // Update file contents in temp deployment
        progress.start("updateFileContents")
        await updateFileContents({ ...projectPaths, newProjectPath: tempDeploymentPath }, androidConfig)
        progress.complete("updateFileContents")

        progress.start("createSignedAAB")
        let aabResult = await createSignedAAB(
            { ...projectPaths, newProjectPath: tempDeploymentPath },
            androidConfig
        )
        progress.complete("createSignedAAB")

        // Copy AAB to final location and cleanup temp deployment
        progress.start("finalizeAAB")
        aabResult = await finalizeAABAndCleanup(projectPaths, androidConfig, aabResult, tempDeploymentPath)
        progress.complete("finalizeAAB")

        // Print completion summary
        progress.printTreeContent("Build Summary", [
            "Android AAB build completed successfully:",
            {
                text: `Original project: ${projectPaths.oldProjectPath}`,
                indent: 1,
                prefix: "├─ ",
                color: "gray",
            },
            {
                text: `Project name: ${androidConfig.oldProjectName} → ${androidConfig.newProjectName}`,
                indent: 1,
                prefix: "├─ ",
                color: "gray",
            },
            {
                text: `Deployment path: ${androidConfig.deploymentPath || "Not specified"}`,
                indent: 1,
                prefix: "├─ ",
                color: "gray",
            },
            {
                text: `Overwrite existing: ${androidConfig.overwriteExisting}`,
                indent: 1,
                prefix: "├─ ",
                color: "gray",
            },
            { text: `Backup created: ${backupPath ? "Yes" : "No"}`, indent: 1, prefix: "├─ ", color: "gray" },
            {
                text: `Signed AAB: ${aabResult ? "Created" : "Skipped"}`,
                indent: 1,
                prefix: "└─ ",
                color: "gray",
            },
            "",
            "Output Files:",
            {
                text: `Original preserved at: ${projectPaths.oldProjectPath}`,
                indent: 1,
                prefix: "├─ ",
                color: "green",
            },
            ...(backupPath
                ? [{ text: `Backup: ${backupPath}`, indent: 1, prefix: "├─ ", color: "gray" }]
                : []),
            ...(aabResult
                ? [
                      {
                          text: `AAB file: ${aabResult.finalAabPath}`,
                          indent: 1,
                          prefix: "├─ ",
                          color: "green",
                      },
                      {
                          text: `AAB size: ${aabResult.fileSize} MB`,
                          indent: 1,
                          prefix: "└─ ",
                          color: "green",
                      },
                  ]
                : [{ text: `No AAB created`, indent: 1, prefix: "└─ ", color: "gray" }]),
        ])

        return aabResult
    } catch (error) {
        // Clean up temp deployment on error
        if (tempDeploymentPath) {
            await cleanupTempDeployment(tempDeploymentPath)
        }

        // The caller (buildApp:android) prints the full diagnostic, including
        // Gradle's own error, from `error.output`.
        if (progress.currentStep) progress.fail(progress.currentStep.id, error.message)
        throw error
    }
}

// Export functions for use as a module - using the same export pattern as buildAppAndroid.js
// This allows the functions to be imported with ES6 import syntax from other modules
exports.buildAndroidAAB = buildAndroidAAB
exports.createAndroidDeployment = buildAndroidAAB
exports.renameAndroidProject = buildAndroidAAB

// Execute if run directly
if (require.main === module) {
    const configPath = process.argv[2]
    if (!configPath) {
        console.error("Usage: node renameAndroidProject.js <config-path>")
        process.exit(1)
    }
    buildAndroidAAB(configPath).catch((error) => {
        console.error("Script failed:", error.message)
        process.exit(1)
    })
}
