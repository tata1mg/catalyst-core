const path = require("path")

const quote = (file) => JSON.stringify(file)

const oxlintAllowed = [
    "packages/catalyst-core/bin/",
    "packages/catalyst-core/mcp_v2/",
    "packages/catalyst-core/src/native/",
    "apps/catalyst-core-test/src/js/components/",
    "apps/catalyst-core-test/src/js/containers/Home/",
    "apps/catalyst-core-test/src/js/layouts/",
    "apps/catalyst-core-test/src/js/pages/",
    "apps/catalyst-core-test/tests/",
]

const oxlintAllowedFiles = new Set([
    "packages/catalyst-core/src/otel.js",
    "packages/catalyst-core/src/sentry.js",
    "apps/catalyst-core-test/api.js",
    "apps/catalyst-core-test/client/styles.js",
    "apps/catalyst-core-test/playwright.config.js",
])

// lint-staged passes absolute paths; the allowlists above are repo-relative.
function normalize(file) {
    return path.relative(__dirname, file).split(path.sep).join("/")
}

function toOxfmtCommand(files) {
    return files.length ? `npx oxfmt ${files.map(quote).join(" ")}` : null
}

const docsFormatIgnoredPrefixes = [
    "docs/.docusaurus/",
    "docs/api/",
    "docs/build/",
    "docs/content/",
    "docs/docs/",
    "docs/login-page/build/",
    "docs/login-page/public/",
    "docs/public-docs/",
    "docs/static/",
]

function isDocsFormatIgnored(file) {
    return docsFormatIgnoredPrefixes.some((prefix) => file.startsWith(prefix))
}

function toOxfmtCommandWithoutIgnoredDocs(files) {
    return toOxfmtCommand(files.map(normalize).filter((file) => !isDocsFormatIgnored(file)))
}

function toLintAndFormatCommands(files) {
    const normalizedFiles = files.map(normalize)
    const oxlintFiles = normalizedFiles.filter(
        (file) => oxlintAllowedFiles.has(file) || oxlintAllowed.some((prefix) => file.startsWith(prefix))
    )

    const commands = []

    if (oxlintFiles.length) {
        commands.push(`npx oxlint ${oxlintFiles.map(quote).join(" ")}`)
    }

    const formatCommand = toOxfmtCommand(normalizedFiles)

    if (formatCommand) {
        commands.push(formatCommand)
    }

    return commands
}

module.exports = {
    "packages/catalyst-core/**/*.{js,jsx}": toLintAndFormatCommands,
    "packages/create-catalyst-app/**/*.{js,jsx,cjs,mjs}": (files) =>
        toOxfmtCommand(files.map(normalize)) || [],
    "apps/catalyst-core-test/**/*.{js,jsx,cjs,mjs}": toLintAndFormatCommands,
    "docs/**/*.{js,jsx,cjs,mjs,css,html}": (files) => toOxfmtCommandWithoutIgnoredDocs(files) || [],
    "scripts/**/*.{js,cjs,mjs}": (files) => toOxfmtCommand(files.map(normalize)) || [],
    "*.{json,md,yml,yaml}": (files) => toOxfmtCommandWithoutIgnoredDocs(files) || [],
}
