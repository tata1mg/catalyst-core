import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { ERROR_DEFINITIONS } from "./registry.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// packages/catalyst-core/src/errors -> repo root /errors
const ERRORS_DIR = path.resolve(__dirname, "../../../../errors")
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
    if (!existsSync(ERRORS_DIR)) return
    const categories = new Set(Object.values(ERROR_DEFINITIONS).map((d) => d.category))
    for (const category of categories) {
        const dir = path.join(ERRORS_DIR, category)
        if (existsSync(dir)) {
            for (const file of readdirSync(dir)) {
                if (file.endsWith(".md")) rmSync(path.join(dir, file))
            }
        }
    }
}

// Other packages (e.g. create-catalyst-app) own their own categories and
// merge their entries into this same index.json. Only clear/overwrite keys
// for categories this registry itself defines, so a regen here never wipes
// entries owned by another package's generator.
function readExistingIndex() {
    if (!existsSync(INDEX_PATH)) return {}
    try {
        return JSON.parse(readFileSync(INDEX_PATH, "utf8"))
    } catch {
        return {}
    }
}

export function generateDocs() {
    clearGeneratedCategoryDirs()

    const ownedCategories = new Set(Object.values(ERROR_DEFINITIONS).map((d) => d.category))
    const index = readExistingIndex()
    for (const code of Object.keys(index)) {
        if (ownedCategories.has(index[code].category)) delete index[code]
    }

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

if (import.meta.url === `file://${process.argv[1]}`) {
    const { count, errorsDir } = generateDocs()
    console.log(`Generated ${count} error doc(s) + index.json in ${errorsDir}`)
}
