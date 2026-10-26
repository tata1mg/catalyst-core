import React from "react"
import { split } from "catalyst-core"
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
            },
            {
                path: "about",
                component: About,
            },
        ],
    },
]

export default routes
