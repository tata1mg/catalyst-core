const { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } = require("fs")
const path = require("path")
const { ERROR_DEFINITIONS } = require("./errors.cjs")

// packages/create-catalyst-app/scripts -> repo root /errors
const ERRORS_DIR = path.resolve(__dirname, "../../../errors")
const INDEX_PATH = path.join(ERRORS_DIR, "index.json")

function renderMarkdown(code, def) {
    return `# ${code}

**Category:** ${def.category}

## Message

${def.defaultMessage}

## Details

${def.defaultDetails}

## Suggested action

${def.suggestedAction}
`
}

function clearGeneratedCategoryDirs() {
    const dir = path.join(ERRORS_DIR, "CCA")
    if (!existsSync(dir)) return
    for (const file of readdirSync(dir)) {
        if (file.endsWith(".md")) rmSync(path.join(dir, file))
    }
}

function readExistingIndex() {
    if (!existsSync(INDEX_PATH)) return {}
    try {
        return JSON.parse(readFileSync(INDEX_PATH, "utf8"))
    } catch {
        return {}
    }
}

function generateDocs() {
    clearGeneratedCategoryDirs()

    // Merge into the shared errors/index.json rather than overwriting it —
    // catalyst-core's own generateDocs.js owns every other category.
    const index = readExistingIndex()

    for (const [code, def] of Object.entries(ERROR_DEFINITIONS)) {
        const dir = path.join(ERRORS_DIR, def.category)
        mkdirSync(dir, { recursive: true })
        const filePath = path.join(dir, `${code}.md`)
        writeFileSync(filePath, renderMarkdown(code, def))

        index[code] = {
            category: def.category,
            message: def.defaultMessage,
            details: def.defaultDetails,
            suggestedAction: def.suggestedAction,
            docUrl: `https://github.com/tata1mg/catalyst-core/blob/main/errors/${def.category}/${code}.md`,
        }
    }

    mkdirSync(ERRORS_DIR, { recursive: true })
    writeFileSync(INDEX_PATH, JSON.stringify(index, null, 4))

    return { count: Object.keys(ERROR_DEFINITIONS).length, errorsDir: ERRORS_DIR }
}

if (require.main === module) {
    const { count, errorsDir } = generateDocs()
    console.log(`Generated ${count} error doc(s) and merged into index.json in ${errorsDir}`)
}

module.exports = { generateDocs }
