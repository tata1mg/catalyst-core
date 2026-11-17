// The "dynamic" data source for the PPR-style apps: GET /api/pokemon after a fixed delay (default 400 ms, DELAY_MS to change).
import http from "node:http"; import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import path from "node:path"
const all = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "data/pokemon.json"), "utf8"))
const list = all.map(({ id, name, types }) => ({ id, name, types })), DELAY = +(process.env.DELAY_MS || 400)
http.createServer((q, r) => { const h = { "access-control-allow-origin": "*", "content-type": "application/json", "cache-control": "no-store" }
  if (q.url.startsWith("/api/pokemon")) setTimeout(() => { r.writeHead(200, h); r.end(JSON.stringify({ pokemon: list })) }, DELAY); else { r.writeHead(404, h); r.end("{}") } }).listen(4100)
