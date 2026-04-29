const path = require("path")

const quote = (file) => JSON.stringify(file)

const eslintAllowed = [
    "packages/catalyst-core/bin/",
    "packages/catalyst-core/mcp_v2/",
    "packages/catalyst-core/src/native/",
    "apps/catalyst-core-test/src/js/components/",
    "apps/catalyst-core-test/src/js/containers/Home/",
    "apps/catalyst-core-test/src/js/layouts/",
    "apps/catalyst-core-test/src/js/pages/",
    "apps/catalyst-core-test/tests/",
]

const eslintAllowedFiles = new Set([
    "packages/catalyst-core/src/otel.js",
    "packages/catalyst-core/src/sentry.js",
    "apps/catalyst-core-test/api.js",
    "apps/catalyst-core-test/client/styles.js",
    "apps/catalyst-core-test/playwright.config.js",
])

function normalize(file) {
    return file.split(path.sep).join("/")
}

function toPrettierCommand(files) {
    return files.length ? `npx prettier --write ${files.map(quote).join(" ")}` : null
}

const docsPrettierIgnoredPrefixes = [
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

function isDocsPrettierIgnored(file) {
    return docsPrettierIgnoredPrefixes.some((prefix) => file.startsWith(prefix))
}

function toPrettierCommandWithoutIgnoredDocs(files) {
    return toPrettierCommand(files.map(normalize).filter((file) => !isDocsPrettierIgnored(file)))
}

module.exports = {
    "packages/catalyst-core/**/*.{js,jsx}": (files) => {
        const normalizedFiles = files.map(normalize)
        const eslintFiles = normalizedFiles.filter(
            (file) => eslintAllowedFiles.has(file) || eslintAllowed.some((prefix) => file.startsWith(prefix))
        )

        const commands = []

        if (eslintFiles.length) {
            commands.push(
                `npm exec --workspace packages/catalyst-core -- eslint ${eslintFiles.map(quote).join(" ")}`
            )
        }

        const prettierCommand = toPrettierCommand(normalizedFiles)

        if (prettierCommand) {
            commands.push(prettierCommand)
        }

        return commands
    },
    "packages/create-catalyst-app/**/*.{js,jsx,cjs,mjs}": (files) =>
        toPrettierCommand(files.map(normalize)) || [],
    "apps/catalyst-core-test/**/*.{js,jsx,cjs,mjs}": (files) => {
        const normalizedFiles = files.map(normalize)
        const eslintFiles = normalizedFiles.filter(
            (file) => eslintAllowedFiles.has(file) || eslintAllowed.some((prefix) => file.startsWith(prefix))
        )

        const commands = []

        if (eslintFiles.length) {
            commands.push(
                `npm exec --workspace packages/catalyst-core -- eslint ${eslintFiles.map(quote).join(" ")}`
            )
        }

        const prettierCommand = toPrettierCommand(normalizedFiles)

        if (prettierCommand) {
            commands.push(prettierCommand)
        }

        return commands
    },
    "docs/**/*.{js,jsx,cjs,mjs,css,html}": (files) => toPrettierCommandWithoutIgnoredDocs(files) || [],
    "scripts/**/*.{js,cjs,mjs}": (files) => toPrettierCommand(files.map(normalize)) || [],
    "*.{json,md,yml,yaml}": (files) => toPrettierCommandWithoutIgnoredDocs(files) || [],
}
