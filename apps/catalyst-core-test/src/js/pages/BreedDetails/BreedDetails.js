import React, { Suspense, use } from "react"
import { useRouteData, useParams, Link } from "catalyst-core"

// Deferred field: use()'d inside its own Suspense boundary, independent of the
// critical breedImages above it — this is what actually exercises the
// deferred-streaming pipeline (buildLoaderPromiseMap -> deferredStream ->
// hydration) end to end in a real browser, not just in unit tests.
const RelatedBreeds = ({ promise }) => {
    const related = use(promise)
    const names = related?.message || []
    return (
        <ul className="related-breeds" data-testid="related-breeds">
            {names.map((name) => (
                <li key={name} style={{ textTransform: "capitalize" }}>
                    {name}
                </li>
            ))}
        </ul>
    )
}

const BreedDetails = () => {
    const params = useParams()
    const API_URL = process.env.API_URL
    const NODE_SERVER_HOSTNAME = process.env.NODE_SERVER_HOSTNAME
    const { breedImages, relatedBreeds } = useRouteData()

    const images = breedImages?.message || []
    const breedName = params?.breed

    return (
        <div className="container">
            <Link to="/" className="back-link">
                &larr; Back to All Breeds
            </Link>
            <h1 style={{ textTransform: "capitalize" }}>{breedName} Dogs Available for Adoption</h1>
            <div className="dog-list">
                {images.slice(0, 8).map((imageUrl, index) => (
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
            <h2>Related breeds</h2>
            <Suspense fallback={<p data-testid="related-breeds-loading">Loading related breeds...</p>}>
                <RelatedBreeds promise={relatedBreeds} />
            </Suspense>
            <div data-testid={"client-var"}>{API_URL}</div>
            <div data-testid={"server-var"}>{NODE_SERVER_HOSTNAME}</div>
        </div>
    )
}

export default BreedDetails
