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

// renderMode and pprFallback go on the split() wrapper: the server reads them before the
// page module has loaded.
const PPRPage = split(() => import("../pages/PPRPage/PPRPage"), {
    ssr: true,
})
PPRPage.renderMode = "ppr"
PPRPage.pprFallback = <div data-testid="ppr-skeleton">Loading PPR page...</div>

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
            {
                path: "ppr",
                component: PPRPage,
            },
        ],
    },
]

export default routes
