const fs = require("fs")
const path = require("path")

const repoRoot = path.resolve(__dirname, "..", "..")
const corePackagePath = path.join(repoRoot, "packages", "catalyst-core", "package.json")
const templatesDir = path.join(repoRoot, "packages", "create-catalyst-app", "templates")
const shouldCheckOnly = process.argv.includes("--check")
const supportedCatalystPackages = ["catalyst-core", "catalyst-core-internal"]

function getArgValue(flagName) {
    const arg = process.argv.find((item) => item.startsWith(`${flagName}=`))
    return arg ? arg.slice(flagName.length + 1) : null
}

const corePackage = JSON.parse(fs.readFileSync(corePackagePath, "utf8"))
const targetPackageName = getArgValue("--package-name") || corePackage.name
const targetVersion = getArgValue("--package-version") || corePackage.version

const templateDirs = fs
    .readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

const updatedTemplates = []
const invalidTemplates = []
const invalidFiles = []

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function createPackageReferenceRegex(packageName, flags = "") {
    return new RegExp(`(^|[^A-Za-z0-9_-])(${escapeRegExp(packageName)})(?=$|[^A-Za-z0-9_-])`, flags)
}

function hasPackageReference(content, packageName) {
    return createPackageReferenceRegex(packageName).test(content)
}

function replacePackageReferences(content, packageName, replacement) {
    return content.replace(createPackageReferenceRegex(packageName, "g"), `$1${replacement}`)
}

function walkTemplateFiles(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    let files = []

    for (const entry of entries) {
        const entryPath = path.join(currentDir, entry.name)

        if (entry.isDirectory()) {
            files = files.concat(walkTemplateFiles(entryPath))
            continue
        }

        if (!/\.(js|jsx|ts|tsx|json|md|cjs|mjs|scss)$/.test(entry.name)) {
            continue
        }

        files.push(entryPath)
    }

    return files
}

function getConflictingPackageNames(content) {
    return supportedCatalystPackages.filter(
        (packageName) => packageName !== targetPackageName && hasPackageReference(content, packageName)
    )
}

for (const templateDir of templateDirs) {
    const packageJsonPath = path.join(templatesDir, templateDir, "package.json")

    if (!fs.existsSync(packageJsonPath)) {
        continue
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
    const dependencyEntries = Object.entries(packageJson.dependencies || {})
    const currentDependency = dependencyEntries.find(([name]) => supportedCatalystPackages.includes(name))
    const currentPackageName = currentDependency?.[0]
    const currentVersion = currentDependency?.[1]

    if (!currentPackageName || !currentVersion) {
        continue
    }

    if (currentPackageName !== targetPackageName || currentVersion !== targetVersion) {
        if (shouldCheckOnly) {
            invalidTemplates.push({
                name: templateDir,
                currentPackageName,
                currentVersion,
            })
            continue
        }

        for (const packageName of supportedCatalystPackages) {
            delete packageJson.dependencies[packageName]
        }

        packageJson.dependencies[targetPackageName] = targetVersion
        fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 4)}\n`)
        updatedTemplates.push(templateDir)
    }
}

for (const filePath of walkTemplateFiles(templatesDir)) {
    if (filePath.endsWith("package.json")) {
        continue
    }

    const currentContent = fs.readFileSync(filePath, "utf8")
    const conflictingPackages = getConflictingPackageNames(currentContent)

    if (conflictingPackages.length === 0) {
        continue
    }

    if (shouldCheckOnly) {
        invalidFiles.push({
            filePath: path.relative(repoRoot, filePath),
            conflictingPackages,
        })
        continue
    }

    let nextContent = currentContent
    for (const packageName of conflictingPackages) {
        nextContent = replacePackageReferences(nextContent, packageName, targetPackageName)
    }

    fs.writeFileSync(filePath, nextContent)
}

if (shouldCheckOnly && invalidTemplates.length > 0) {
    console.error("create-catalyst-app templates are out of sync with catalyst-core:")
    for (const template of invalidTemplates) {
        console.error(
            `- ${template.name}: ${template.currentPackageName}@${template.currentVersion} -> ${targetPackageName}@${targetVersion}`
        )
    }
}

if (shouldCheckOnly && invalidFiles.length > 0) {
    console.error("create-catalyst-app template source files reference the wrong catalyst package:")
    for (const entry of invalidFiles) {
        console.error(`- ${entry.filePath}: ${entry.conflictingPackages.join(", ")} -> ${targetPackageName}`)
    }
}

if (shouldCheckOnly && (invalidTemplates.length > 0 || invalidFiles.length > 0)) {
    process.exit(1)
}

if (!shouldCheckOnly) {
    console.log(
        updatedTemplates.length > 0
            ? `Updated template ${targetPackageName} versions in: ${updatedTemplates.join(", ")}`
            : `All create-catalyst-app templates already matched ${targetPackageName}`
    )
}
