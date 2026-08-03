import React from "react"
import { useCurrentRouteData, useParams, Link } from "catalyst-core"
import { api } from "catalyst-core/api"

const BreedDetails = () => {
    const params = useParams()
    const API_URL = process.env.API_URL
    const NODE_SERVER_HOSTNAME = process.env.NODE_SERVER_HOSTNAME
    const { data, error, isFetching } = useCurrentRouteData()

    if (isFetching) return <div className="container">Loading breed details...</div>
    if (error) return <div className="container">Error loading breed details: {error.message}</div>
    if (!data) return <div className="container">No breed found</div>

    const breedImages = data.message || []
    const breedName = params?.breed

    return (
        <div className="container">
            <Link to="/" className="back-link">
                &larr; Back to All Breeds
            </Link>
            <h1 style={{ textTransform: "capitalize" }}>{breedName} Dogs Available for Adoption</h1>
            <div className="dog-list">
                {breedImages.slice(0, 8).map((imageUrl, index) => (
                    <div key={index} className="dog-card">
                        <img src={imageUrl} alt={`${breedName} ${index + 1}`} className="dog-image" />
                        <div className="dog-info">
                            <h2 style={{ textTransform: "capitalize" }}>
                                {breedName} #{index + 1}
                            </h2>
                            <p>Age: {Math.floor(Math.random() * 10) + 1} years</p>
                        </div>
                    </div>
                ))}
            </div>
            <div data-testid={"client-var"}>{API_URL}</div>
            <div data-testid={"server-var"}>{NODE_SERVER_HOSTNAME}</div>
        </div>
    )
}

// Same call on client and server — see Home.js for why.
const fetchBreedImages = async ({ params }) => {
    try {
        return await api.get(`/api/breed/${params.breed}/images`)
    } catch (error) {
        console.error("Error fetching breed details:", error)
        throw error
    }
}

BreedDetails.clientFetcher = fetchBreedImages
BreedDetails.serverFetcher = fetchBreedImages

export default BreedDetails
