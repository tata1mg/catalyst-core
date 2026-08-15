import React from "react"
import { split } from "catalyst-core"
import { api } from "catalyst-core/api"
import MainLayout from "../layouts/MainLayout/MainLayout"

const Home = split(() => import("../pages/Home/Home"), {
    ssr: true,
})

const BreedDetails = split(() => import("../pages/BreedDetails/BreedDetails"), {
    ssr: true,
})

const About = split(() => import("../pages/About/About"), {
    ssr: false,
    fallback: <div>Loading about page...</div>,
})

// Declared here, not inside BreedDetails.js's own lazy chunk: a loader must be
// callable without waiting on the route's component to finish loading first
// (RFC 0001) — the whole point of moving it out of the chunk is running the
// chunk download and the data fetch in parallel, not one after the other.
const breedDetailsLoader = async ({ params }) => ({
    breedImages: await api.get(`/api/breed/${params.breed}/images`), // critical — awaited
    relatedBreeds: api.get(`/api/breeds/related/${params.breed}`), // deferred — not awaited
})

const routes = [
    {
        path: "/",
        component: MainLayout,
        children: [
            {
                index: true,
                component: Home,
            },
            {
                path: "breed/:breed",
                component: BreedDetails,
                loader: breedDetailsLoader,
            },
            {
                path: "about",
                component: About,
            },
        ],
    },
]

export default routes
