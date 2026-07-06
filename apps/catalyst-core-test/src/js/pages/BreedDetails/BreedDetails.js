import React from "react"
import { useCurrentRouteData, useParams, Link } from "@tata1mg/router"

const BreedDetails = () => {
    const params = useParams()
    const { API_URL, NODE_SERVER_HOSTNAME } = process.env
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

BreedDetails.clientFetcher = async ({ params }) => {
    try {
        const breedName = params.breed
        const response = await fetch(`https://dog.ceo/api/breed/${breedName}/images`)
        const data = await response.json()
        return data
    } catch (error) {
        console.error("Error fetching breed details:", error)
        throw error
    }
}

BreedDetails.serverFetcher = async ({ params }) => {
    try {
        const breedName = params.breed
        const response = await fetch(`https://dog.ceo/api/breed/${breedName}/images`)
        const data = await response.json()
        return data
    } catch (error) {
        console.error("Error fetching breed details:", error)
        throw error
    }
}

export default BreedDetails
