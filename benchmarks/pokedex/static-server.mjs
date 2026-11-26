// Serves data/sprites at http://localhost:4000/sprites/<id>.png, the image origin the Pokédex app uses.
// A separate origin keeps image traffic out of the Catalyst server's numbers.
//
// usage: node static-server.mjs
import http from "node:http"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "data/sprites")
const PORT = 4000

http.createServer(async (req, res) => {
    const match = req.url.match(/^\/sprites\/(\d+)\.png/)
    if (!match) {
        res.writeHead(404)
        return res.end()
    }
    try {
        const body = await readFile(path.join(dir, `${match[1]}.png`))
        res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600", "content-length": body.length })
        res.end(body)
    } catch {
        res.writeHead(404)
        res.end()
    }
}).listen(PORT, () => console.log(`sprites on http://localhost:${PORT}/sprites/`))
