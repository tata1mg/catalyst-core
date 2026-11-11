import { writeFileSync, existsSync } from "node:fs"
const N = 151, out = []
const get = async (u) => { for (let i = 0; i < 4; i++) { try { const r = await fetch(u); if (r.ok) return r; } catch {} await new Promise(r => setTimeout(r, 500 * (i + 1))) } throw new Error(u) }
let next = 1
await Promise.all(Array.from({ length: 8 }, async () => { while (next <= N) { const id = next++; const d = await (await get(`https://pokeapi.co/api/v2/pokemon/${id}`)).json()
  out[id - 1] = { id, name: d.name, types: d.types.map(t => t.type.name), height: d.height, weight: d.weight, moves: d.moves.slice(0, 24).map(m => m.move.name), games: d.game_indices.map(g => g.version.name) }
  const f = `data/sprites/${id}.png`; if (!existsSync(f)) writeFileSync(f, Buffer.from(await (await get(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`)).arrayBuffer())) } }))
writeFileSync("data/pokemon.json", JSON.stringify(out))
console.log(out.length, "pokemon", JSON.stringify(out).length, "bytes json")
