import React, { useState, useMemo } from "react"
import { useCurrentRouteData } from "catalyst-core"
import { Link } from "react-router"

const SPRITES = "http://localhost:4000/sprites"

const Home = () => {
    const { data, error, isFetching } = useCurrentRouteData()
    const [q, setQ] = useState("")
    const [type, setType] = useState("")
    const all = data?.pokemon || []
    const types = useMemo(() => [...new Set(all.flatMap((p) => p.types))].sort(), [all])
    const shown = useMemo(
        () => all.filter((p) => p.name.includes(q.trim().toLowerCase()) && (!type || p.types.includes(type))),
        [all, q, type]
    )
    if (isFetching) return <div className="container">Loading…</div>
    if (error) return <div className="container">Error: {error.message}</div>
    return (
        <div className="container">
            <h1>Pokédex</h1>
            <div className="controls">
                <input type="search" aria-label="Search Pokémon" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
                <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="">All types</option>
                    {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
            </div>
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
        </div>
    )
}

Home.clientFetcher = async () => (await fetch("/api/pokemon")).json()
Home.serverFetcher = async () => {
    const all = globalThis.__POKEMON__
    return { pokemon: all.map(({ id, name, types }) => ({ id, name, types })) }
}
Home.setMetaData = () => [<title key="title">Pokédex</title>]
export default Home
