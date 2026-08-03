import React from "react"
import { Link, useCurrentRouteData } from "catalyst-core"
import { api } from "catalyst-core/api"

const Home = () => {
    const { data, error, isFetching } = useCurrentRouteData()

    if (isFetching) return <div className="container">Loading breeds...</div>
    if (error) return <div className="container">Error loading breeds: {error.message}</div>

    const dogs = data?.message || []
    const breeds = Object.keys(dogs)

    return (
        <div className="container">
            <h1>Available Dog Breeds</h1>
            <div className="breed-list">
                {breeds.slice(0, 12).map((breed) => (
                    <div key={breed} className="breed-card">
                        <h2 className="breed-name">{breed}</h2>
                        <p>Click to see available dogs</p>
                        <Link to={`/breed/${breed}`} className="btn" data-testid={breed}>
                            View Dogs
                        </Link>
                    </div>
                ))}
            </div>
        </div>
    )
}

// Same call on client and server: in the browser this is a normal fetch; during
// SSR the api client dispatches directly to the handler in server/api/index.js
// in-process (loopback), skipping the network round-trip entirely.
const fetchBreeds = async () => {
    try {
        return await api.get("/api/breeds/list/all")
    } catch (error) {
        console.error("Error fetching dog breeds:", error)
        throw error
    }
}

Home.clientFetcher = fetchBreeds
Home.serverFetcher = fetchBreeds

Home.setMetaData = () => {
    return [<title key="title">Home</title>]
}

export default Home
