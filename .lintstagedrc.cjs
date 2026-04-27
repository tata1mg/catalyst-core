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
    "scripts/**/*.{js,cjs,mjs}": (files) => toPrettierCommand(files.map(normalize)) || [],
    "*.{json,md,yml,yaml}": (files) => toPrettierCommand(files.map(normalize)) || [],
}
