import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { ERROR_DEFINITIONS } from "./registry.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// packages/catalyst-core/src/errors -> repo root /errors
const ERRORS_DIR = path.resolve(__dirname, "../../../../errors")

function renderMarkdown(code, def) {
    return `# ${code}

**Category:** ${def.category}

## Message

${def.defaultMessage}

## Details

${def.defaultDetails}

## Recoverable

${def.recoverable ? "Yes — you can fix this and retry without restarting your workflow." : "No — this typically requires investigating the underlying cause."}

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

export function generateDocs() {
    clearGeneratedCategoryDirs()

    const index = {}

    for (const [code, def] of Object.entries(ERROR_DEFINITIONS)) {
        const dir = path.join(ERRORS_DIR, def.category)
        mkdirSync(dir, { recursive: true })
        const filePath = path.join(dir, `${code}.md`)
        writeFileSync(filePath, renderMarkdown(code, def))

        index[code] = {
            category: def.category,
            message: def.defaultMessage,
            details: def.defaultDetails,
            recoverable: def.recoverable,
            suggestedAction: def.suggestedAction,
            docUrl: `https://github.com/tata1mg/catalyst-core/blob/main/errors/${def.category}/${code}.md`,
        }
    }

    mkdirSync(ERRORS_DIR, { recursive: true })
    writeFileSync(path.join(ERRORS_DIR, "index.json"), JSON.stringify(index, null, 4))

    return { count: Object.keys(index).length, errorsDir: ERRORS_DIR }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { count, errorsDir } = generateDocs()
    console.log(`Generated ${count} error doc(s) + index.json in ${errorsDir}`)
}
