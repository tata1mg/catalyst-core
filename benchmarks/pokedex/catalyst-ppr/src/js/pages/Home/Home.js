import React, { Suspense, use, useState } from "react"
import { useCurrentRouteData } from "catalyst-core"
import { Link } from "react-router"

const SPRITES = "http://localhost:4000/sprites"
const API = "http://localhost:4100/api/pokemon"
const TYPES = ["bug", "dragon", "electric", "fairy", "fighting", "fire", "flying", "ghost", "grass", "ground", "ice", "normal", "poison", "psychic", "rock", "steel", "water"]

// Server: the promise was started in serverFetcher, once per request, so the shell can be sent before it settles.
// Browser: the server streams the data next to the grid (window.__POKEMON__), so there is no second request.
let browserList
function getList(data) {
    if (typeof window === "undefined") return data.listPromise
    if (!browserList) browserList = window.__POKEMON__ ? Promise.resolve(window.__POKEMON__) : fetch(API).then((r) => r.json()).then((j) => j.pokemon)
    return browserList
}

function Grid({ data, q, type }) {
    const list = use(getList(data))
    const shown = list.filter((p) => p.name.includes(q.trim().toLowerCase()) && (!type || p.types.includes(type)))
    return (
        <>
            <script dangerouslySetInnerHTML={{ __html: `window.__POKEMON__=${JSON.stringify(list)}` }} />
            <ul className="grid">
                {shown.map((p, i) => (
                    <li key={p.id}>
                        <Link to={`/pokemon/${p.name}`} className="card" data-testid={p.name}>
                            <img src={`${SPRITES}/${p.id}.png`} width="96" height="96" alt={p.name} loading={i < 6 ? "eager" : "lazy"} />
                            <div className="num">#{String(p.id).padStart(3, "0")}</div>
                            <div className="name">{p.name}</div>
                            {p.types.map((t) => <span key={t} className="badge">{t}</span>)}
                        </Link>
                    </li>
                ))}
            </ul>
        </>
    )
}

const Skeleton = () => <ul className="grid">{[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <li key={i} className="skeleton" />)}</ul>

const Home = () => {
    const { data } = useCurrentRouteData()
    const [q, setQ] = useState("")
    const [type, setType] = useState("")
    return (
        <div className="container">
            <h1>Pokédex</h1>
            <div className="controls">
                <input type="search" aria-label="Search Pokémon" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
                <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="">All types</option>
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
            </div>
            <Suspense fallback={<Skeleton />}>
                <Grid data={data || {}} q={q} type={type} />
            </Suspense>
        </div>
    )
}

Home.clientFetcher = async () => ({})
Home.serverFetcher = async () => ({ listPromise: fetch(API).then((r) => r.json()).then((j) => j.pokemon) })   // not awaited: the dynamic part streams
Home.setMetaData = () => [<title key="title">Pokédex</title>]
export default Home
