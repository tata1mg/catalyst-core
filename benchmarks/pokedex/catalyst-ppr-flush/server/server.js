import { readFileSync } from "fs"
import { fileURLToPath } from "url"

const all = JSON.parse(readFileSync(fileURLToPath(new URL("./pokemon.json", import.meta.url)), "utf8"))

globalThis.__POKEMON__ = all

export function addMiddlewares(app) {
    // Workaround, not the shipped default: catalyst-core mounts compression() without flushing, which holds streamed chunks back.
    // Flushing the compressor after every chunk piped to the response lets the Suspense shell reach the browser before the dynamic section.
    app.use((req, res, next) => { res.on("pipe", (src) => src.on("data", () => { if (typeof res.flush === "function") res.flush() })); next() })
    app.get("/api/pokemon", (req, res) => res.send({ pokemon: all.map(({ id, name, types }) => ({ id, name, types })) }))
    app.get("/api/pokemon/:name", (req, res) => res.send(all.find((p) => p.name === req.params.name) || null))
}
