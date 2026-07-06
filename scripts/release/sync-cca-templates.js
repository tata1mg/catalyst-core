const fs = require("fs")
const path = require("path")

const repoRoot = path.resolve(__dirname, "..", "..")
const templatesDir = path.join(repoRoot, "packages", "create-catalyst-app", "templates")
const shouldCheckOnly = process.argv.includes("--check")
const catalystPackageName = "catalyst-core"

function getArgValue(flagName) {
    const arg = process.argv.find((item) => item.startsWith(`${flagName}=`))
    return arg ? arg.slice(flagName.length + 1) : null
}

const targetVersion = getArgValue("--package-version")

if (!targetVersion) {
    console.error("--package-version is required")
    process.exit(1)
}

const templateDirs = fs
    .readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

const updatedTemplates = []
const invalidTemplates = []

for (const templateDir of templateDirs) {
    const packageJsonPath = path.join(templatesDir, templateDir, "package.json")

    if (!fs.existsSync(packageJsonPath)) {
        continue
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
    const currentVersion = packageJson.dependencies?.[catalystPackageName]

    if (!currentVersion) {
        continue
    }

    if (currentVersion !== targetVersion) {
        if (shouldCheckOnly) {
            invalidTemplates.push({
                name: templateDir,
                currentVersion,
            })
            continue
        }

        packageJson.dependencies[catalystPackageName] = targetVersion
        fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 4)}\n`)
        updatedTemplates.push(templateDir)
    }
}

if (shouldCheckOnly && invalidTemplates.length > 0) {
    console.error("create-catalyst-app templates are out of sync with catalyst-core:")
    for (const template of invalidTemplates) {
        console.error(
            `- ${template.name}: ${catalystPackageName}@${template.currentVersion} -> ${targetVersion}`
        )
    }
}

if (shouldCheckOnly && invalidTemplates.length > 0) {
    process.exit(1)
}

if (!shouldCheckOnly) {
    console.log(
        updatedTemplates.length > 0
            ? `Updated template ${catalystPackageName} versions in: ${updatedTemplates.join(", ")}`
            : `All create-catalyst-app templates already matched ${catalystPackageName}`
    )
}
