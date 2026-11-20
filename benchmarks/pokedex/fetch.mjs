// Downloads the 151 sprites the Pokédex shows into data/sprites/ (not committed: PokeAPI artwork).
// The Pokémon data itself is committed at app/server/pokemon.json.
//
// usage: node fetch.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, "data/sprites")
mkdirSync(outDir, { recursive: true })
const ids = JSON.parse(readFileSync(path.join(here, "app/server/pokemon.json"), "utf8")).map((p) => p.id)

async function get(url) {
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            const res = await fetch(url)
            if (res.ok) return Buffer.from(await res.arrayBuffer())
        } catch {
            // retried below
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
    }
    throw new Error(`failed to download ${url}`)
}

const queue = ids.filter((id) => !existsSync(path.join(outDir, `${id}.png`)))
const workers = Array.from({ length: 8 }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`
        writeFileSync(path.join(outDir, `${id}.png`), await get(url))
    }
})
await Promise.all(workers)
console.log(`${ids.length} sprites in ${outDir}`)
