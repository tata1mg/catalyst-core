import React from "react"
import loadable from "@loadable/component"
import MainLayout from "../layouts/MainLayout/MainLayout"

const Home = loadable(() => import("../pages/Home/Home"), {
    ssr: true,
})

const BreedDetails = loadable(() => import("../pages/BreedDetails/BreedDetails"), {
    ssr: true,
})

const About = loadable(() => import("../pages/About/About"), {
    ssr: false,
    fallback: <div>Loading about page...</div>,
})

const routes = [
    {
        path: "/",
        component: MainLayout,
        children: [
            {
                path: "",
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
