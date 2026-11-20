import React from "react"
import { useCurrentRouteData } from "catalyst-core"
import { Link } from "react-router"

const Pokemon = () => {
    const { data, error, isFetching } = useCurrentRouteData()
    if (isFetching) return <div className="container">Loading…</div>
    if (error || !data) return <div className="container">Not found</div>
    return (
        <div className="container">
            <Link to="/" className="back">← All Pokémon</Link>
            <h1 style={{ textTransform: "capitalize" }}>{data.name} <span className="num">#{data.id}</span></h1>
            <img src={`http://localhost:4000/sprites/${data.id}.png`} width="96" height="96" alt={data.name} />
            <p>{data.types.map((t) => <span key={t} className="badge">{t}</span>)} · {data.height / 10} m · {data.weight / 10} kg</p>
            <div className="cols">
                <section><h2>Moves</h2><ul className="chips">{data.moves.map((m) => <li key={m}>{m}</li>)}</ul></section>
                <section><h2>Games</h2><ul className="chips">{data.games.map((g) => <li key={g}>{g}</li>)}</ul></section>
            </div>
        </div>
    )
}
Pokemon.clientFetcher = async ({ params }) => (await fetch(`/api/pokemon/${params.name}`)).json()
Pokemon.serverFetcher = async ({ params }) => {
    const all = globalThis.__POKEMON__
    return all.find((p) => p.name === params.name) || null
}
Pokemon.setMetaData = ({ data } = {}) => [<title key="title">{data?.name || "Pokémon"}</title>]
export default Pokemon
