const path = require("path")

const quote = (file) => JSON.stringify(file)

const eslintAllowed = [
    "packages/catalyst-core/bin/",
    "packages/catalyst-core/mcp_v2/",
    "packages/catalyst-core/src/native/",
    "packages/catalyst-core/template/src/js/components/",
    "packages/catalyst-core/template/src/js/containers/Home/",
    "packages/catalyst-core/template/src/js/layouts/",
    "packages/catalyst-core/template/src/js/pages/",
    "packages/catalyst-core/template/tests/",
]

const eslintAllowedFiles = new Set([
    "packages/catalyst-core/src/otel.js",
    "packages/catalyst-core/src/sentry.js",
    "packages/catalyst-core/template/api.js",
    "packages/catalyst-core/template/client/styles.js",
    "packages/catalyst-core/template/playwright.config.js",
])

function normalize(file) {
    return file.split(path.sep).join("/")
}

function toPrettierCommand(files) {
    return files.length ? `npx prettier --write ${files.map(quote).join(" ")}` : null
}

const docsPrettierIgnoredPrefixes = [
    "apps/docs/.docusaurus/",
    "apps/docs/api/",
    "apps/docs/build/",
    "apps/docs/content/",
    "apps/docs/docs/",
    "apps/docs/login-page/build/",
    "apps/docs/login-page/public/",
    "apps/docs/public-docs/",
    "apps/docs/static/",
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
    "apps/docs/**/*.{js,jsx,cjs,mjs,css,html}": (files) => toPrettierCommandWithoutIgnoredDocs(files) || [],
    "scripts/**/*.{js,cjs,mjs}": (files) => toPrettierCommand(files.map(normalize)) || [],
    "*.{json,md,yml,yaml}": (files) => toPrettierCommandWithoutIgnoredDocs(files) || [],
}
