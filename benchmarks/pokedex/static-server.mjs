// Serves data/sprites at /sprites/N.png for all three Pokédex apps (same origin, same headers).
import http from "node:http"; import { readFile } from "node:fs/promises"; import { fileURLToPath } from "node:url"; import path from "node:path"
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "data/sprites")
http.createServer(async (q, r) => { const m = q.url.match(/^\/sprites\/(\d+)\.png/); if (!m) { r.writeHead(404); return r.end() }
  try { const b = await readFile(path.join(dir, m[1] + ".png")); r.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600", "content-length": b.length }); r.end(b) } catch { r.writeHead(404); r.end() } }).listen(4000)
