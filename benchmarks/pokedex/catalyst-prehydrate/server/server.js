import { readFileSync } from "fs"
import { fileURLToPath } from "url"

const all = JSON.parse(readFileSync(fileURLToPath(new URL("./pokemon.json", import.meta.url)), "utf8"))

globalThis.__POKEMON__ = all

export function addMiddlewares(app) {
    app.get("/api/pokemon", (req, res) => res.send({ pokemon: all.map(({ id, name, types }) => ({ id, name, types })) }))
    app.get("/api/pokemon/:name", (req, res) => res.send(all.find((p) => p.name === req.params.name) || null))
}
