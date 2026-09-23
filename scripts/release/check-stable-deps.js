const fs = require("fs")
const path = require("path")
const semver = require("semver")

const dependencyFields = ["dependencies", "peerDependencies", "optionalDependencies"]
const packageDirs = process.argv.slice(2)

if (packageDirs.length === 0) {
    console.error("usage: check-stable-deps.js <package-dir> [...]")
    process.exit(1)
}

function collectFiles(packageDir) {
    const manifest = path.join(packageDir, "package.json")

    if (!fs.existsSync(manifest)) {
        console.error(`no package.json in ${packageDir}`)
        process.exit(1)
    }

    const files = [manifest]
    const templatesDir = path.join(packageDir, "templates")

    if (fs.existsSync(templatesDir)) {
        const entries = fs
            .readdirSync(templatesDir, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name))

        for (const entry of entries) {
            const templateManifest = path.join(templatesDir, entry.name, "package.json")
            if (entry.isDirectory() && fs.existsSync(templateManifest)) {
                files.push(templateManifest)
            }
        }
    }

    return files
}

const offenders = []

for (const packageDir of packageDirs) {
    for (const file of collectFiles(packageDir)) {
        const manifest = JSON.parse(fs.readFileSync(file, "utf8"))

        for (const field of dependencyFields) {
            for (const [name, rawRange] of Object.entries(manifest[field] || {})) {
                // an aliased dependency carries the real range after "npm:<name>@",
                // and <name> may itself be scoped
                const range = rawRange.startsWith("npm:")
                    ? rawRange.slice(rawRange.lastIndexOf("@") + 1)
                    : rawRange

                try {
                    if (semver.minVersion(range).prerelease.length > 0) {
                        offenders.push(`${file}: ${name}@${rawRange}`)
                    }
                } catch {
                    console.log(`skipped ${file}: ${name}@${rawRange}`)
                }
            }
        }
    }
}

for (const offender of offenders) {
    console.error(offender)
}

process.exit(offenders.length > 0 ? 1 : 0)
